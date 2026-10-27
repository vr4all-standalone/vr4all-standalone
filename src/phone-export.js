const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readManifestPackage } = require('./apk-verification');
const { sevenZipPath, runSevenZip } = require('./archive-conversion');
const { exportRdrPrivatePacks } = require('./rdr-phone-packs');
const { importRdrGameData } = require('./rdr-game-data');

const rdrData = ['act', 'animationres', 'camera', 'flash', 'fonts', 'fragments', 'gringores', 'mapres', 'naturalmotion', 'navres', 'shaders', 'strings', 'terrainboundres', 'terrainlodres', 'textures', 'treeres', 'tune', 'vfx', 'vgd'].map((name) => `assets/data/${name}_android.rpf`)
  .concat(['content', 'cutscene', 'grassres', 'psocache', 'audio', 'audio2', 'base/content'].map((name) => `assets/game/${name}_android.rpf`));
const profiles = Object.freeze({
  'rdr1-vr': { packageId: 'com.rockstargames.rdr', version: '1.58.63226194', code: '63226194', engine: 'lib/arm64-v8a/librdr.so', data: rdrData },
  'gta-sa-vr': { packageId: 'com.rockstargames.gtasa', version: '2.11.311', code: '4234641', engine: 'lib/arm64-v8a/libGame.so', data: ['assets/data/gta.dat', 'assets/anim/anim.img', 'assets/texdb/gta3.img'] },
});
const validSerial = (serial) => typeof serial === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(serial);
const isQuest = (model) => /quest|oculus/i.test(model || '');
// Older test/ADB adapters do not provide a model. Keep their existing behavior.
const isHeadsetListing = (device) => !device.model || isQuest(device.model);

async function phoneIdentity(adb, device) {
  if (!validSerial(device.serial)) throw new Error('Invalid Android device serial');
  const model = String(await adb.run(['-s', device.serial, 'shell', 'getprop', 'ro.product.model'])).trim();
  const manufacturer = String(await adb.run(['-s', device.serial, 'shell', 'getprop', 'ro.product.manufacturer'])).trim();
  if (!model || !manufacturer) throw new Error('Could not identify the phone. Unlock it and approve USB debugging.');
  return { serial: device.serial, state: device.state, model, manufacturer, headset: isQuest(`${model} ${manufacturer}`) };
}

async function listExportPhones(adb) {
  const devices = await adb.listDevices();
  const phones = [];
  for (const device of devices.slice(0, 32)) {
    if (!validSerial(device.serial)) continue;
    if (device.state !== 'device') {
      if (!isQuest(device.model) || device.model === 'Quest headset') phones.push({ serial: device.serial, state: device.state, model: device.model === 'Quest headset' ? 'Android device' : device.model || 'Android device' });
      continue;
    }
    try {
      const identity = await phoneIdentity(adb, device);
      if (!identity.headset) phones.push(identity);
    } catch { phones.push({ serial: device.serial, state: 'offline', model: device.model || 'Android device' }); }
  }
  return phones;
}

async function exportedEntries(file) {
  const { stdout } = await runSevenZip(await sevenZipPath(), ['l', '-slt', '-p-', file]);
  const entries = stdout.split(/^-{10,}\s*$/m)[1];
  if (!entries) throw new Error('Exported APK has no readable ZIP directory');
  const names = new Set();
  for (const block of entries.trim().split(/\r?\n\s*\r?\n/)) {
    const name = block.match(/^Path = (.+)$/m)?.[1]?.trim();
    const size = block.match(/^Size = (\d+)$/m)?.[1];
    if (name && Number(size) > 0) names.add(name.replaceAll('\\', '/'));
  }
  return names;
}

async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function inspectPhoneGame(gameId, input, adb) {
  let profile = profiles[gameId];
  if (!profile) throw new Error('Phone export supports RDR and Google Play GTA SA');
  if (!validSerial(input?.serial)) throw new Error('Choose a connected, authorized Android phone');
  const device = (await adb.listDevices()).find((entry) => entry.serial === input.serial && entry.state === 'device');
  if (!device) throw new Error('Choose a connected, authorized Android phone. Unlock it and approve USB debugging.');
  const identity = await phoneIdentity(adb, device);
  if (identity.headset) throw new Error('Choose the Android phone containing the game, not your Quest');
  const run = (...args) => adb.run(['-s', input.serial, ...args]);
  const edition = input.edition || 'auto';
  if (!['auto', 'google-play', 'netflix'].includes(edition) || gameId !== 'rdr1-vr' && edition === 'netflix') throw new Error('Choose a supported game edition');
  let dump;
  if (gameId === 'rdr1-vr') {
    const installed = [];
    for (const candidate of [{ edition: 'google-play', packageId: 'com.rockstargames.rdr', label: 'Google Play RDR' }, { edition: 'netflix', packageId: 'com.netflix.NGP.Kamo', label: 'Netflix RDR' }]) {
      if (edition !== 'auto' && edition !== candidate.edition) continue;
      const details = String(await run('shell', 'dumpsys', 'package', candidate.packageId));
      if (/^\s*versionName=\S+/m.test(details)) installed.push({ ...candidate, dump: details });
    }
    if (installed.length > 1) throw new Error('Both RDR editions are installed. Choose Google Play or Netflix in the game edition selector.');
    if (!installed.length) throw new Error(`Install ${edition === 'netflix' ? 'Red Dead Redemption NETFLIX' : edition === 'google-play' ? 'Google Play Red Dead Redemption' : 'Google Play or Netflix Red Dead Redemption'} on the selected phone first.`);
    profile = { ...profile, ...installed[0] };
    dump = profile.dump;
  } else { profile = { ...profile, edition: 'google-play', label: 'Google Play GTA SA' }; dump = String(await run('shell', 'dumpsys', 'package', profile.packageId)); }
  const version = dump.match(/^\s*versionName=([^\s]+)/m)?.[1];
  const code = dump.match(/^\s*versionCode=(\d+)/m)?.[1];
  if (!version) throw new Error(`Install ${profile.label} (${profile.packageId}) on this phone first.`);
  if (version !== profile.version || code !== profile.code) throw new Error(`This VR port requires ${profile.label} version ${profile.version}; the phone has ${version} (${code || 'unknown code'}).`);
  const inventory = String(await run('shell', 'pm', 'path', profile.packageId));
  const remotePaths = inventory.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    if (!line.startsWith('package:')) throw new Error('Could not read the installed APK paths');
    return line.slice(8).trim();
  });
  if (remotePaths.length < 2 || remotePaths.length > 128) throw new Error('The installed game does not expose a complete APK split set');
  const names = new Set();
  const plan = [];
  for (const remote of remotePaths) {
    const name = path.posix.basename(remote);
    if (!/^\/data\/app\/[A-Za-z0-9_./=+~-]+\.apk$/.test(remote) || remote.split('/').includes('..')
      || !/^(base|split_[A-Za-z0-9_.-]+)\.apk$/.test(name) || names.has(name.toLowerCase())) throw new Error('The phone returned an unsafe or unsupported APK path');
    names.add(name.toLowerCase());
    const rawSize = String(await run('shell', 'stat', '-c', '%s', remote)).trim();
    if (!/^\d+$/.test(rawSize) || Number(rawSize) < 1 || Number(rawSize) >= 4 * 1024 ** 3) throw new Error(`Invalid APK size for ${name}`);
    plan.push({ remote, name, size: Number(rawSize) });
  }
  if (!names.has('base.apk')) throw new Error('The installed split set is missing base.apk');
  const read = (...args) => adb.run(['-s', input.serial, ...args], undefined, { timeoutMs: 15000 });
  return { profile, identity, version, inventory, plan, run, read };
}

async function rdrReadiness(inventory, input) {
  const { profile, identity, plan, read } = inventory;
  const result = { edition: profile.edition, packageId: profile.packageId, version: profile.version, model: identity.model, apkCount: plan.length };
  const present = new Set();
  for (const file of plan) {
    // Read ZIP directories on the phone, not multi-GB APK payloads. Some Android
    // versions have no compatible unzip: unknown readiness must remain usable.
    const listing = await read('shell', 'unzip', '-l', file.remote).catch(() => '');
    const footer = String(listing).match(/^\s*\d+\s+(\d+)\s+files?\s*$/m);
    if (!/\bLength\b[^\r\n]*\bName\b/.test(listing) || !footer) {
      return { ...result, status: 'unknown', canExport: true, missing: null, message: 'This phone cannot preview APK contents. You can export; VR4ALL will verify game data after copying. Additional files may still be needed.' };
    }
    let parsed = 0;
    for (const line of String(listing).split(/\r?\n/)) {
      const match = line.match(/^\s*(\d+)\s+(?:\d{4}-\d{2}-\d{2}|\d{2}[-/]\d{2}[-/]\d{2,4})\s+\d{2}:\d{2}(?::\d{2})?\s+(\S+)\s*$/);
      if (match) { parsed++; if (Number(match[1]) > 0) present.add(match[2]); }
    }
    // Treat unexpected table formatting as unavailable rather than diagnosing
    // missing resources from a listing we did not understand.
    if (!parsed || parsed !== Number(footer[1])) {
      return { ...result, status: 'unknown', canExport: true, missing: null, message: 'This phone uses an unrecognized APK listing format. VR4ALL will verify the game data after copying.' };
    }
  }
  const missing = profile.data.filter((entry) => !present.has(entry));
  if (!missing.length) return { ...result, status: 'complete', canExport: true, missing, message: 'All required game-data entries are present in the phone APKs. No additional data source is needed. Export will verify the copied files; the builder checks engine compatibility.' };
  if (input.audioSource) return { ...result, status: 'additional-data-selected', canExport: true, missing, message: `${missing.length} required game-data entries are absent from the phone APKs. Your selected additional data will be checked and imported during export. Your original phone APKs are kept.` };
  const root = await read('shell', 'id', '-u').then((value) => String(value).trim() === '0', () => false);
  const su = !root && await read('shell', 'which', 'su').then((value) => /^\/[A-Za-z0-9_./+-]+$/.test(String(value).trim()), () => false);
  if (root || su) return { ...result, status: 'private-packs', canExport: true, missing, message: 'Game packs are absent from the APKs, but existing root access may allow export from private storage. Export will request access and verify all files. VR4ALL does not root the phone.' };
  return { ...result, status: 'additional-data-required', canExport: false, missing, message: `${profile.label}: ${missing.length} required game-data entries are absent from the APKs. Finish the phone download and enter gameplay, then check again. If already complete, the packs may be in private Android storage, which this phone cannot export without existing root access. Select matching Additional RDR game data or use a complete export from a device that can read all packs. VR4ALL does not provide a game-data download. Buying another edition does not guarantee a complete export.` };
}

async function checkPhoneGame(gameId, input, { adb } = {}) {
  if (gameId !== 'rdr1-vr') throw new Error('Game-data readiness checks support RDR');
  return rdrReadiness(await inspectPhoneGame(gameId, input, adb), input);
}

async function exportPhoneGame(gameId, input, { adb, onLog = () => {}, statfs = fs.statfs } = {}) {
  const root = input?.downloadLocation;
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Choose an absolute export folder');
  const rootStat = await fs.lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Choose an existing regular export folder');
  const realRoot = await fs.realpath(root);
  const inspected = await inspectPhoneGame(gameId, input, adb);
  const { profile, identity, version, inventory, plan, run } = inspected;
  if (gameId === 'rdr1-vr') {
    onLog('Checking phone APK contents before copying game files.');
    const readiness = await rdrReadiness(inspected, input);
    onLog(readiness.message);
    if (!readiness.canExport) throw new Error(readiness.message);
  }
  const bytes = plan.reduce((sum, file) => sum + file.size, 0);
  const disk = await statfs(root);
  const needed = bytes + 256 * 1024 ** 2;
  if (Number(disk.bavail) * Number(disk.bsize) < needed) throw new Error(`Not enough free space in the export folder. Allow at least ${(needed / 1024 ** 3).toFixed(1)} GB on the selected drive.`);
  onLog(`Exporting ${profile.label} ${profile.version} from ${identity.model}. Keep the phone connected and unlocked.`);
  const directory = await fs.mkdtemp(path.join(root, `VR4ALL-export-${gameId}-`));
  let complete = false;
  try {
    const present = new Set();
    let engines = 0;
    const report = [];
    for (const [index, file] of plan.entries()) {
      onLog(`Copying APK ${index + 1}/${plan.length}: ${file.name}`);
      const partial = path.join(directory, `${file.name}.partial`);
      await run('pull', file.remote, partial);
      const copied = await fs.lstat(partial);
      if (!copied.isFile() || copied.isSymbolicLink() || copied.size !== file.size) throw new Error(`${file.name} transfer size does not match the phone`);
      const expected = String(await run('shell', 'sha256sum', file.remote)).match(/^([a-f0-9]{64})\s/i)?.[1]?.toLowerCase();
      const sha256 = await fileSha256(partial);
      if (!expected || sha256 !== expected) throw new Error(`${file.name} checksum does not match the phone. Reconnect and retry the export.`);
      if (await readManifestPackage(partial) !== profile.packageId) throw new Error(`${file.name} belongs to a different Android game`);
      const entries = await exportedEntries(partial);
      if (entries.has(profile.engine)) engines++;
      for (const name of entries) present.add(name);
      await fs.rename(partial, path.join(directory, file.name));
      report.push({ name: file.name, bytes: file.size, sha256 });
    }
    if (engines !== 1) throw new Error('Export needs exactly one ARM64 game engine. Install the ARM64 Google Play game on this phone.');
    const missing = profile.data.filter((entry) => !present.has(entry));
    const assetPacks = gameId === 'rdr1-vr' && missing.length ? input.audioSource
      ? await importRdrGameData(input.audioSource, directory, { present, onLog })
      : await exportRdrPrivatePacks({
      adb, serial: input.serial, packageId: profile.packageId, directory, missing, present, statfs, onLog,
      installedSplits: new Set(plan.filter((file) => file.name.startsWith('split_')).map((file) => file.name.slice(6, -4))),
    }) : [];
    for (const file of assetPacks) if (file.bytes > 0) present.add(file.path);
    if (profile.data.some((entry) => !present.has(entry))) throw new Error(`The game data is incomplete (${missing.length} required files missing). Open the game on the phone, finish all downloads, then export again.`);
    if (String(await run('shell', 'pm', 'path', profile.packageId)) !== inventory
      || !String(await run('shell', 'dumpsys', 'package', profile.packageId)).includes(`versionName=${profile.version}`)) throw new Error('The installed game changed during export. Retry after its update finishes.');
    await fs.writeFile(path.join(directory, 'vr4all-export.json'), JSON.stringify({ gameId, packageId: profile.packageId, edition: profile.edition, version, exportedAt: new Date().toISOString(), apks: report, assetPacks, ...(input.audioSource && gameId === 'rdr1-vr' ? { additionalDataSource: input.audioSource } : {}) }, null, 2));
    complete = true;
    onLog('Export verified. The official builder will check engine compatibility and signatures when you build.');
    return { gamePackage: directory, packageId: profile.packageId, edition: profile.edition, version };
  } finally {
    if (!complete) {
      // Only remove the unique directory created by this export, on the chosen drive.
      const actual = await fs.realpath(directory).catch(() => null);
      if (actual && path.dirname(actual) === realRoot && path.basename(actual).startsWith(`VR4ALL-export-${gameId}-`)) await fs.rm(directory, { recursive: true, force: true });
    }
  }
}

module.exports = { listExportPhones, checkPhoneGame, exportPhoneGame, isHeadsetListing };
