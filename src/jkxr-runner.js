const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const officialRepo = 'Team-Beef-Studios/JKXR';
const requiredAssets = {
  jk2: ['assets0.pk3', 'assets1.pk3', 'assets2.pk3', 'assets5.pk3'],
  jk3: ['assets0.pk3', 'assets1.pk3', 'assets2.pk3', 'assets3.pk3'],
};

async function checkOfficialApk(apkPath, release, kind) {
  if (typeof apkPath !== 'string' || !path.isAbsolute(apkPath) || path.extname(apkPath).toLowerCase() !== '.apk') {
    throw new Error(`Choose an absolute ${kind} Quest APK path`);
  }
  const stat = await fsp.lstat(apkPath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`${kind} Quest APK is missing or empty`);
  if (!release || release.stale || release.repo && release.repo !== officialRepo) throw new Error(`Choose a current official JKXR ${kind} release`);
  const tag = release.tag;
  const asset = release.assetName;
  const pattern = kind === 'engine' ? /^jkxr-[0-9]+\.[0-9]+\.[0-9]+\.apk$/i : /^jkxrcompanion_[a-z0-9.]+meta\.apk$/i;
  if (!/^[A-Za-z0-9_.-]+$/.test(tag || '') || !pattern.test(asset || '')) {
    throw new Error(`Choose an official JKXR ${kind} Quest APK release`);
  }
  const expected = `https://github.com/${officialRepo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
  if (release.downloadUrl !== expected) throw new Error(`Choose an official JKXR ${kind} Quest APK release`);
  const cachePrefix = crypto.createHash('sha256').update(expected).digest('hex').slice(0, 16);
  if (![asset.toLowerCase(), `${cachePrefix}-${asset}`.toLowerCase()].includes(path.basename(apkPath).toLowerCase())) {
    throw new Error(`Choose an official JKXR ${kind} Quest APK release file`);
  }
  if (release.size != null && (!Number.isSafeInteger(release.size) || release.size !== stat.size)) throw new Error(`${kind} Quest APK size differs from official release`);
  if (release.digest != null) {
    if (!/^sha256:[a-f0-9]{64}$/i.test(release.digest)) throw new Error(`${kind} release has an invalid SHA-256 digest`);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(apkPath)) hash.update(chunk);
    if (`sha256:${hash.digest('hex')}` !== release.digest.toLowerCase()) throw new Error(`${kind} APK SHA-256 digest differs from official release`);
  }
}

async function ownedAssets(gamePath, game) {
  if (!requiredAssets[game]) throw new Error('Choose Jedi Outcast (jk2) or Jedi Academy (jk3)');
  if (typeof gamePath !== 'string' || !path.isAbsolute(gamePath)) throw new Error('Choose an absolute owned Jedi game folder');
  let current = gamePath;
  for (const parts of [[], ['base'], ['GameData', 'base']]) {
    const candidate = path.join(current, ...parts);
    const stat = await fsp.lstat(candidate).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
    const entries = await fsp.readdir(candidate, { withFileTypes: true });
    const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
    if (!byName.has('assets0.pk3')) continue;
    const files = [];
    for (const name of requiredAssets[game]) {
      const entry = byName.get(name);
      if (!entry?.isFile() || entry.isSymbolicLink()) throw new Error(`Owned ${game.toUpperCase()} folder must contain ${name}`);
      const file = path.join(candidate, entry.name);
      const fileStat = await fsp.lstat(file);
      if (!fileStat.isFile() || !fileStat.size) throw new Error(`Owned ${game.toUpperCase()} folder has an empty or invalid ${name}`);
      files.push({ name, file });
    }
    return files;
  }
  throw new Error(`Owned ${game.toUpperCase()} folder must contain assets0.pk3`);
}

async function installJkxr(input) {
  const { engineApkPath, companionApkPath, engineRelease, companionRelease, gamePath, game, serial, adb, signal } = input || {};
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '')) throw new Error('Choose a connected Quest serial');
  if (!adb || typeof adb.run !== 'function') throw new Error('ADB is required for JKXR setup');
  await checkOfficialApk(engineApkPath, engineRelease, 'engine');
  await checkOfficialApk(companionApkPath, companionRelease, 'companion');
  const files = gamePath ? await ownedAssets(gamePath, game) : [];
  const onLog = typeof input.onLog === 'function' ? input.onLog : () => {};
  const run = async (...args) => {
    signal?.throwIfAborted();
    const output = await adb.run(['-s', serial, ...args], (chunk) => onLog(String(chunk).trim().slice(0, 500)));
    if (/^Failure\b/i.test(output || '')) throw new Error(output);
    return output;
  };
  onLog('Installing official JKXR Quest engine and Meta companion APKs.');
  await run('install', '-r', engineApkPath);
  await run('install', '-r', companionApkPath);
  if (files.length) {
    const remote = `/sdcard/JKXR/${game.toUpperCase()}/base`;
    await run('shell', 'mkdir', '-p', remote);
    for (const item of files) await run('push', item.file, `${remote}/${item.name}`);
    onLog(`Copied ${files.length} owned ${game.toUpperCase()} archives. Open JKXR on the headset once to grant its permissions, then use the companion app.`);
  } else onLog('JKXR APKs updated. Existing game files on the headset were left in place.');
  return { game: game || null, filesCopied: files.length };
}

module.exports = { installJkxr, ownedAssets, checkOfficialApk };
