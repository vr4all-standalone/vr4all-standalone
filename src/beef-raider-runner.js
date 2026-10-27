const fs = require('node:fs/promises');
const fileStream = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Team Beef's SideQuest instructions name these folders and this Quest destination:
// https://sidequestvr.com/app/38086/beef-raider-xr-tomb-raider-in-vr
const destination = '/sdcard/BeefraiderXR';
// https://raw.githubusercontent.com/Team-Beef-Studios/BeefRaiderXR/main/Projects/Android/AndroidManifest.xml
const packageName = 'com.drbeef.beefraiderxr';
const folderNames = ['Audio', 'FMV', 'DATA'];
const maxEntries = 20000;
const officialRepos = ['Team-Beef-Studios/BeefRaiderXR', 'DrBeef/BeefRaiderXR'];
const apkName = 'beefraiderxr-1.0.0.apk';

async function verifyOfficialApk(apkPath, release) {
  if (!release || release.stale || release.tag !== '1.0.0' || release.assetName !== apkName
    || release.repo && !officialRepos.includes(release.repo)) {
    throw new Error('Choose the current official Beef Raider XR Quest APK release');
  }
  const allowedUrls = officialRepos.map((repo) => `https://github.com/${repo}/releases/download/1.0.0/${apkName}`);
  if (!allowedUrls.includes(release.downloadUrl)) throw new Error('Choose the official Beef Raider XR Quest APK URL');
  if (typeof apkPath !== 'string' || !path.isAbsolute(apkPath)) throw new Error('Choose an absolute official Beef Raider XR APK path');
  const cacheName = `${crypto.createHash('sha256').update(release.downloadUrl).digest('hex').slice(0, 16)}-${apkName}`;
  if (![apkName, cacheName].includes(path.basename(apkPath).toLowerCase())) throw new Error('Choose the official Beef Raider XR Quest APK file');
  const stat = await fs.lstat(apkPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Official Beef Raider XR APK is missing or empty');
  if (stat.size > 1024 ** 3) throw new Error('Official Beef Raider XR APK exceeds the size limit');
  if (release.size != null && (!Number.isSafeInteger(release.size) || release.size <= 0 || stat.size !== release.size)) {
    throw new Error('Official Beef Raider XR APK size does not match release metadata');
  }
  if (release.digest != null && !/^sha256:[a-f0-9]{64}$/i.test(release.digest)) {
    throw new Error('Official Beef Raider XR APK has an invalid SHA-256 digest');
  }
  const handle = await fs.open(apkPath, 'r');
  try {
    const magic = Buffer.alloc(4);
    await handle.read(magic, 0, 4, 0);
    if (magic.toString('hex') !== '504b0304') throw new Error('Official Beef Raider XR APK is not a ZIP archive');
  } finally { await handle.close(); }
  if (release.digest != null) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fileStream.createReadStream(apkPath)) hash.update(chunk);
    if (`sha256:${hash.digest('hex')}` !== release.digest.toLowerCase()) throw new Error('Official Beef Raider XR APK failed SHA-256 verification');
  }
}

async function connectedQuest(adb, serial) {
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '')) throw new Error('Choose a connected Quest serial');
  if (!adb || typeof adb.listDevices !== 'function' || typeof adb.run !== 'function') {
    throw new Error('ADB is required for Beef Raider XR setup');
  }
  const devices = await adb.listDevices();
  if (!devices.some((device) => device.serial === serial && device.state === 'device')) {
    throw new Error('Choose a connected, authorized Quest');
  }
}

async function installedPackagePath(adb, serial) {
  const output = await adb.run(['-s', serial, 'shell', 'pm', 'path', packageName]);
  return String(output).split(/\r?\n/).some((line) => /^package:\//.test(line.trim()));
}

async function installBeefRaiderApk(input) {
  const { apkPath, release, serial, adb, signal } = input || {};
  signal?.throwIfAborted();
  await verifyOfficialApk(apkPath, release);
  signal?.throwIfAborted();
  await connectedQuest(adb, serial);
  const onLog = typeof input.onLog === 'function' ? input.onLog : () => {};
  if (await installedPackagePath(adb, serial)) {
    onLog('BeefRaiderXR is already installed on the selected Quest; its demo and data were left in place.');
    return { packageName, installed: false, launchRequired: false };
  }
  signal?.throwIfAborted();
  onLog('Installing the official Beef Raider XR Quest APK.');
  const output = await adb.run(['-s', serial, 'install', apkPath]);
  if (!/\bSuccess\b/.test(String(output)) || !await installedPackagePath(adb, serial)) {
    throw new Error('Official Beef Raider XR APK installation did not confirm the expected Quest package');
  }
  onLog('Launch BeefRaiderXR once on the headset and grant permissions before transferring full-game data.');
  return { packageName, installed: true, launchRequired: true };
}

async function regularDirectory(directory, label) {
  const stat = await fs.lstat(directory).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be an existing regular folder`);
}

async function inspectBeefRaiderData(extractedPath) {
  if (typeof extractedPath !== 'string' || !path.isAbsolute(extractedPath)) {
    throw new Error('Choose an absolute Beef Raider Extraction Tool mod folder');
  }
  await regularDirectory(extractedPath, 'Extracted mod folder');
  const folders = [];
  let fileCount = 0;
  let entryCount = 0;
  for (const name of folderNames) {
    const localPath = path.join(extractedPath, name);
    await regularDirectory(localPath, `${name} folder`);
    let files = 0;
    const pending = [localPath];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        if (++entryCount > maxEntries) throw new Error('Extracted mod folder contains too many entries');
        const item = path.join(current, entry.name);
        const stat = await fs.lstat(item);
        if (stat.isSymbolicLink()) throw new Error(`Extracted mod folder contains a symbolic link: ${entry.name}`);
        if (stat.isDirectory()) pending.push(item);
        else if (stat.isFile()) files++;
        else throw new Error(`Extracted mod folder contains an unsupported entry: ${entry.name}`);
      }
    }
    if (!files) throw new Error(`${name} folder contains no extracted files`);
    fileCount += files;
    folders.push({ name, localPath, fileCount: files });
  }
  return { folders, fileCount };
}

async function transferBeefRaiderData(input) {
  const { extractedPath, serial, adb, signal } = input || {};
  signal?.throwIfAborted();
  const prepared = await inspectBeefRaiderData(extractedPath);
  signal?.throwIfAborted();
  await connectedQuest(adb, serial);
  let packagePath;
  try {
    packagePath = await installedPackagePath(adb, serial);
  } catch {
    throw new Error('Cannot confirm BeefRaiderXR is installed on the selected Quest. Install the official Quest APK first.');
  }
  if (!packagePath) {
    throw new Error('BeefRaiderXR is not installed on the selected Quest. Install the official Quest APK first.');
  }
  let remoteEntries;
  try {
    remoteEntries = await adb.run(['-s', serial, 'shell', 'ls', '-A', destination]);
  } catch {
    throw new Error('Cannot read the BeefraiderXR headset folder. Start BeefRaiderXR once and grant its permissions first.');
  }
  if (/^(?:Failure\b|.*No such file or directory)/i.test(String(remoteEntries).trim())) {
    throw new Error('Cannot read the BeefraiderXR headset folder. Start BeefRaiderXR once and grant its permissions first.');
  }
  const existing = new Set(String(remoteEntries).split(/\r?\n/).map((line) => line.trim().toLowerCase()));
  for (const { name } of prepared.folders) {
    if (existing.has(name.toLowerCase())) {
      throw new Error(`Quest already contains ${name}. Copying would overwrite existing data; handle it manually.`);
    }
  }
  const onLog = typeof input.onLog === 'function' ? input.onLog : () => {};
  for (const { name, localPath } of prepared.folders) {
    signal?.throwIfAborted();
    onLog(`Copying extracted ${name} to the selected Quest...`);
    await adb.run(['-s', serial, 'push', localPath, `${destination}/`]);
  }
  onLog('Beef Raider XR data transfer complete. Launch BeefRaiderXR under Unknown Sources.');
  return { destination, foldersCopied: prepared.folders.length, filesCopied: prepared.fileCount };
}

module.exports = { packageName, inspectBeefRaiderData, installBeefRaiderApk, transferBeefRaiderData };
