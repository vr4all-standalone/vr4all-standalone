const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { extractPlayerZip } = require('./official-player-runner');

// Node port of the creator's Windows install flow for Road Rash: Jailbreak PC & VR (scripts/install-player.ps1,
// install.ps1 and install-quest-player.ps1). The creator's rrtool/rrgame self-checks are Windows executables and are
// not run here; VR4ALL checks the disc identity itself (executable and the three overlays by size and SHA-1).
const PACKAGE = 'com.rrjb.vr';
const EXT = `/sdcard/Android/data/${PACKAGE}/files`;
const REMOTE = `${EXT}/disc.bin`;
const SECTOR = 2352;
const FORM1 = 2048;
const FORM1_OFFSET = 24;
const LONG = { timeoutMs: 90 * 60 * 1000 };
const MAX_PART_BYTES = 16 * 1024 ** 2;
const MAX_ROOT_BYTES = 4 * 1024 ** 2;

const DISC_IDENTITY = Object.freeze({
  title: 'Road Rash: Jailbreak (USA)',
  serial: 'SLUS-01053',
  volume: 'SLUS_01053',
  // The first part is the executable.
  parts: Object.freeze([
    { name: 'SLUS_010.53', size: 311296, sha1: '67ed165a2c517d4e6106fb0dfa324d66dd9a76f1' },
    { name: 'RASHCDF.BIN', size: 283936, sha1: 'a3fec4b4e9292c358d0f6dc529843f5d8f25924a' },
    { name: 'RASHCDG.BIN', size: 467080, sha1: 'cfe43a7786759f2cb9c57751cf99e84d1074782c' },
    { name: 'RASHCDI.BIN', size: 79196, sha1: '9a8b79d8739713c12b0a2dc4d75ef8f0a2cc0b06' },
  ]),
});

const REQUIRED_FILES = ['tools/rrgame.exe', 'tools/rrtool.exe', 'scripts/install-player.ps1', 'scripts/install.ps1',
  'scripts/install-quest-player.ps1', 'scripts/platform-tools.ps1', 'scripts/transfer-saves.ps1'];

async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function findPackageRoot(extracted) {
  const hasFile = (directory, relative) => fs.stat(path.join(directory, relative)).then((stat) => stat.isFile(), () => false);
  const candidates = [extracted];
  for (const entry of await fs.readdir(extracted, { withFileTypes: true })) {
    if (entry.isDirectory()) candidates.push(path.join(extracted, entry.name));
  }
  const withManifest = [];
  for (const directory of candidates) if (await hasFile(directory, 'release-manifest.json')) withManifest.push(directory);
  if (!withManifest.length) throw new Error('Official player package is missing its release manifest');
  const complete = [];
  for (const directory of withManifest) if (await hasFile(directory, path.join('scripts', 'install-player.ps1'))) complete.push(directory);
  if (complete.length !== 1) throw new Error('Official player package is missing its installer script');
  return complete[0];
}

// Mirrors install-player.ps1 (c5bc589). The creator pins version === '0.1.0', a packaging artifact: a semver pattern
// plus the Android package name is checked instead.
async function verifyPackage(packageRoot) {
  let manifest;
  try { manifest = JSON.parse((await fs.readFile(path.join(packageRoot, 'release-manifest.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new Error('Official release manifest is unreadable'); }
  if (typeof manifest?.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Unexpected release version.');
  if (manifest.package !== PACKAGE || !Array.isArray(manifest.files)) throw new Error('Unexpected release package.');
  const seen = new Set();
  for (const file of manifest.files) {
    const relative = typeof file?.path === 'string' ? file.path : '';
    if (!relative || /(^|[\\/])\.\.([\\/]|$)|^[\\/]|:/.test(relative) || seen.has(relative.toLowerCase())) throw new Error('Invalid release manifest path.');
    seen.add(relative.toLowerCase());
    const local = path.join(packageRoot, ...relative.split(/[\\/]/));
    const stat = await fs.stat(local).catch(() => null);
    if (!stat?.isFile() || !/^[0-9a-f]{64}$/i.test(file.sha256 || '') || (await hashFile(local, 'sha256')) !== file.sha256.toLowerCase()) {
      throw new Error(`Release file failed verification: ${relative}`);
    }
  }
  for (const required of REQUIRED_FILES) {
    if (!seen.has(required)) throw new Error(`Required release file is missing from the manifest: ${required}`);
  }
  const apks = manifest.files.filter((file) => /^RoadRashJailbreak-VR-.*\.apk$/.test(file.path));
  if (apks.length !== 1) {
    throw new Error('This package has no Quest APK yet: Quest requires the VR build. Use INSTALL-PC.bat for the desktop game.');
  }
  return path.join(packageRoot, apks[0].path);
}

async function findSingleBin(folder) {
  const images = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const local = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(local);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.bin') images.push(local);
    }
  }
  await walk(folder);
  if (images.length !== 1) throw new Error(`The archive must hold exactly one BIN image (found ${images.length}).`);
  return images[0];
}

// install.ps1: .zip/.7z hold exactly one BIN; a .cue must be a single MODE2/2352 data track; a .bin is used as is.
async function normalizeDisc(discImage, work) {
  const extension = path.extname(discImage).toLowerCase();
  if (extension === '.zip' || extension === '.7z') {
    await extractPlayerZip(discImage, work);
    return findSingleBin(work);
  }
  if (extension === '.cue') {
    const cue = (await fs.readFile(discImage, 'utf8')).replace(/^\uFEFF/, '');
    const files = [...cue.matchAll(/^\s*FILE\s+"([^"]+)"\s+BINARY\s*$/gim)];
    if (files.length !== 1 || !/TRACK\s+0?1\s+MODE2\/2352/i.test(cue)) throw new Error('Use a single data-track MODE2/2352 BIN/CUE dump.');
    const bin = path.join(path.dirname(discImage), files[0][1].replaceAll('\\', '/'));
    if (!(await fs.stat(bin).catch(() => null))?.isFile()) throw new Error(`The CUE sheet points to a missing BIN image: ${files[0][1]}`);
    return bin;
  }
  return discImage;
}

// Positional reads of the 2048-byte Form-1 user data of a raw 2352-byte-sector image; never reads the image whole.
async function readForm1(handle, sectorCount, lba, size) {
  const out = Buffer.alloc(size);
  for (let done = 0; done < size;) {
    const index = lba + Math.floor(done / FORM1);
    if (index >= sectorCount) throw new Error('disc read past end of image');
    const inside = done % FORM1;
    const take = Math.min(FORM1 - inside, size - done);
    const { bytesRead } = await handle.read(out, done, take, index * SECTOR + FORM1_OFFSET + inside);
    if (bytesRead !== take) throw new Error('disc read past end of image');
    done += take;
  }
  return out;
}

async function readRootFiles(handle, sectorCount) {
  const pvd = await readForm1(handle, sectorCount, 16, FORM1);
  if (pvd.subarray(1, 6).toString('latin1') !== 'CD001') throw new Error('no ISO9660 primary volume descriptor at LBA 16');
  const volume = pvd.subarray(40, 72).toString('latin1').replace(/[ \0]+$/, '');
  const rootSize = pvd.readUInt32LE(156 + 10);
  if (rootSize > MAX_ROOT_BYTES) throw new Error('the ISO9660 root directory is implausibly large');
  const root = await readForm1(handle, sectorCount, pvd.readUInt32LE(156 + 2), rootSize);
  const files = new Map();
  for (let offset = 0; offset < rootSize;) {
    const length = root[offset];
    if (length === 0) { offset = (Math.floor(offset / FORM1) + 1) * FORM1; continue; }
    if (offset + length > rootSize) break;
    const nameLength = root[offset + 32];
    let name = root.subarray(offset + 33, offset + 33 + nameLength).toString('latin1');
    const record = { lba: root.readUInt32LE(offset + 2), size: root.readUInt32LE(offset + 10), directory: Boolean(root[offset + 25] & 2) };
    offset += length;
    if (nameLength === 1 && (name === '\0' || name === '\x01')) continue;
    if (name.length > 2 && name.endsWith(';1')) name = name.slice(0, -2);
    if (!record.directory) files.set(name.toUpperCase(), record);
  }
  return { volume, files };
}

// Resolves { supported, volume, reason } for a raw MODE2/2352 image, with the first failing reason in the creator's order.
async function identifyDisc(bin, identity = DISC_IDENTITY) {
  const size = (await fs.stat(bin)).size;
  if (!size || size % SECTOR) throw new Error(`not a raw 2352-byte-sector BIN image: ${bin}`);
  const handle = await fs.open(bin, 'r');
  try {
    const sectorCount = size / SECTOR;
    const { volume, files } = await readRootFiles(handle, sectorCount);
    const problems = [];
    for (const part of identity.parts) {
      const record = files.get(part.name);
      if (!record) { problems.push({ part, missing: true }); continue; }
      let sha1 = `not checked: size ${record.size}, expected ${part.size}`;
      if (record.size <= MAX_PART_BYTES) sha1 = crypto.createHash('sha1').update(await readForm1(handle, sectorCount, record.lba, record.size)).digest('hex');
      if (record.size !== part.size || sha1 !== part.sha1) problems.push({ part, sha1 });
    }
    const [exe] = identity.parts;
    const exeProblem = problems.find((problem) => problem.part === exe);
    const volumeOk = volume === identity.volume;
    let reason = null;
    if (!volumeOk && exeProblem?.missing) reason = `volume ${volume || '(none)'} is not ${identity.title}, ${identity.volume}`;
    else if (exeProblem?.missing) reason = `the executable ${exe.name} is missing`;
    else if (exeProblem) reason = `${exe.name} has SHA-1 ${exeProblem.sha1}, not the supported ${exe.sha1.slice(0, 8)}… (another revision or a modified image)`;
    else if (problems.length) {
      const [other] = problems;
      reason = other.missing ? `${other.part.name} is missing` : `${other.part.name} differs from the supported release (SHA-1 ${other.sha1})`;
    } else if (!volumeOk) reason = `unexpected volume id ${volume}`;
    return { supported: !reason, volume, reason };
  } finally { await handle.close(); }
}

async function installRoadRashLinux(packageRoot, input, options = {}) {
  const { adb, serial, discImage, work, onLog = () => {} } = input;
  const identity = options.identity || DISC_IDENTITY;
  const apk = await verifyPackage(packageRoot);
  onLog('Official Road Rash package files verified.');

  const bin = await normalizeDisc(discImage, work);
  const found = await identifyDisc(bin, identity);
  if (!found.supported) {
    throw new Error(`Unsupported disc image: ${discImage}\n${found.reason}\nOnly ${identity.title}, ${identity.serial}, executable SHA-1 ${identity.parts[0].sha1} is supported.`);
  }
  onLog(`Disc identified: ${identity.title} ${identity.serial} (volume ${found.volume}, ${identity.parts[0].name} SHA-1 ${identity.parts[0].sha1.slice(0, 8)}…)`);
  onLog('VR4ALL checked the disc identity; the creator’s extra rrtool checks run only on Windows.');

  const S = ['-s', serial];
  const devices = await adb.listDevices();
  if (!devices.some((device) => device.serial === serial && device.state === 'device')) {
    throw new Error('The selected Quest is not connected and authorized.');
  }
  onLog('Installing the Road Rash: Jailbreak VR app (existing saves are kept)...');
  const installed = await adb.run([...S, 'install', '-r', apk]);
  if (/\bFailure \[/.test(installed)) throw new Error(`APK installation failed. Do not uninstall to work around an update/signing error; export saves first. ${installed}`);
  await adb.run([...S, 'shell', `mkdir -p ${EXT}`]);

  onLog('Hashing the disc image...');
  const expected = await hashFile(bin, 'sha1');
  const bytes = (await fs.stat(bin)).size;
  const hashPattern = new RegExp(`^${expected}\\s`);
  const remoteHash = await adb.run([...S, 'shell', `if [ -f '${REMOTE}' ]; then sha1sum '${REMOTE}'; else echo missing; fi`], undefined, LONG);
  if (hashPattern.test(remoteHash)) onLog('The disc image on the headset is already identical; not copied again.');
  else {
    onLog(`Copying ${path.basename(bin)} (${(bytes / 1024 ** 2).toFixed(0)} MiB) to the headset as disc.bin...`);
    await adb.run([...S, 'push', bin, REMOTE], undefined, LONG);
  }
  const remoteSize = await adb.run([...S, 'shell', `stat -c %s ${REMOTE}`]);
  if (remoteSize.trim() !== String(bytes)) throw new Error(`Disc size differs on the headset (${remoteSize.trim()}, expected ${bytes}).`);
  if (!hashPattern.test(await adb.run([...S, 'shell', `sha1sum ${REMOTE}`], undefined, LONG))) throw new Error('Disc SHA-1 differs on the headset.');
  onLog(`Disc verified on the headset: ${REMOTE} (${bytes} bytes, SHA-1 ${expected}).`);

  const version = /versionName=(\S+)/.exec(await adb.run([...S, 'shell', `dumpsys package ${PACKAGE}`]))?.[1];
  if (version) onLog(`Installed ${PACKAGE} ${version}.`);
  onLog('Road Rash: Jailbreak VR installed. Launch it from Unknown Sources on the headset. Existing saves were retained.');
  return { exitCode: 0, tag: input.release?.tag };
}

module.exports = { installRoadRashLinux, findPackageRoot, identifyDisc, normalizeDisc, DISC_IDENTITY };
