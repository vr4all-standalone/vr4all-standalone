const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectApkPackage } = require('./apk-verification');

const packageName = 'com.descentdevelopers.descent3';
const remoteRoot = `/sdcard/Android/data/${packageName}/files`;
const officialRepo = 'SgtBilko76/Descent3-VR';
const maxEntries = 10000;

function safeName(name) {
  if (!name || name === '.' || name === '..' || /[\x00-\x1f:]/.test(name)) throw new Error('Owned game folder contains an unsafe name');
  return name;
}

function remoteQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function regularFile(file, label) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error(`${label} must be an absolute path`);
  const stat = await fsp.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`${label} must be an existing nonempty regular file`);
  return stat;
}

async function verifyOfficialRelease(apkPath, release) {
  if (release.stale) throw new Error('Official Descent 3 VR release is stale; refresh GitHub first');
  const tag = release.tag;
  const asset = release.assetName;
  if (release.repo && release.repo !== officialRepo || !/^[A-Za-z0-9_.-]+$/.test(tag || '')
    || !/^Descent3-VR-[A-Za-z0-9_.-]+\.apk$/i.test(asset || '')) {
    throw new Error('Choose an official Descent 3 VR Quest APK release');
  }
  const expected = `https://github.com/${officialRepo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
  if (release.downloadUrl !== expected) throw new Error('Choose an official Descent 3 VR Quest APK release');
  const cachePrefix = crypto.createHash('sha256').update(expected).digest('hex').slice(0, 16);
  if (![asset.toLowerCase(), `${cachePrefix}-${asset}`.toLowerCase()].includes(path.basename(apkPath).toLowerCase())) {
    throw new Error('Choose an official Descent 3 VR Quest APK release file');
  }
  const stat = await regularFile(apkPath, 'Official APK');
  if (release.size != null && (!Number.isSafeInteger(release.size) || release.size !== stat.size)) throw new Error('Official APK size does not match release metadata');
  if (release.digest != null) {
    if (!/^sha256:[a-f0-9]{64}$/i.test(release.digest)) throw new Error('Invalid official APK SHA-256 digest');
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(apkPath)) hash.update(chunk);
    if (`sha256:${hash.digest('hex')}` !== release.digest.toLowerCase()) throw new Error('Official APK SHA-256 digest does not match');
  }
}

async function listOwnedData(gamePath) {
  if (typeof gamePath !== 'string' || !path.isAbsolute(gamePath)) throw new Error('Choose an absolute Descent 3 game folder');
  const stat = await fsp.lstat(gamePath).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose an existing regular Descent 3 game folder');
  const rootEntries = await fsp.readdir(gamePath, { withFileTypes: true });
  const lookup = new Map(rootEntries.map((entry) => [entry.name.toLowerCase(), entry]));
  if (!lookup.get('d3.hog')?.isFile()) throw new Error('Owned Descent 3 folder must contain d3.hog');
  for (const folder of ['missions', 'movies']) {
    if (!lookup.get(folder)?.isDirectory()) throw new Error(`Owned Descent 3 folder must contain ${folder}/`);
  }
  const files = [];
  const directories = [];
  let count = 0;
  const walk = async (localDir, remoteDir) => {
    const entries = await fsp.readdir(localDir, { withFileTypes: true });
    for (const entry of entries) {
      if (++count > maxEntries) throw new Error('Owned Descent 3 folder has too many entries');
      safeName(entry.name);
      if (entry.isSymbolicLink()) throw new Error('Owned Descent 3 folder contains a symbolic link');
      const local = path.join(localDir, entry.name);
      const remote = `${remoteDir}/${entry.name}`;
      if (entry.isDirectory()) { directories.push(remote); await walk(local, remote); }
      else if (entry.isFile()) files.push({ local, remote });
      else throw new Error('Owned Descent 3 folder contains an unsupported file type');
    }
  };
  for (const entry of rootEntries) {
    safeName(entry.name);
    if (entry.isSymbolicLink()) throw new Error('Owned Descent 3 folder contains a symbolic link');
    const lower = entry.name.toLowerCase();
    if (entry.isFile() && (lower.endsWith('.hog') || lower.endsWith('.pld'))) files.push({ local: path.join(gamePath, entry.name), remote: `${remoteRoot}/${entry.name}` });
    if (entry.isDirectory() && ['missions', 'movies'].includes(lower)) {
      const remote = `${remoteRoot}/${entry.name}`;
      directories.push(remote);
      await walk(path.join(gamePath, entry.name), remote);
    }
  }
  if (!files.some((file) => file.remote.toLowerCase().endsWith('/d3.hog'))) throw new Error('Owned Descent 3 folder must contain d3.hog');
  return { files, directories };
}

async function installDescent3(input) {
  const { apkPath, gamePath, serial, adb, release, signal } = input || {};
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '')) throw new Error('Choose a connected Quest serial');
  if (!adb || typeof adb.run !== 'function') throw new Error('ADB is required for Descent 3 VR setup');
  await regularFile(apkPath, 'Quest APK');
  if (path.extname(apkPath).toLowerCase() !== '.apk') throw new Error('Choose a Quest APK');
  if (release) await verifyOfficialRelease(apkPath, release);
  else {
    const inspect = input.inspectApk || inspectApkPackage;
    const actualPackage = await inspect(apkPath, adb.getPath?.());
    if (actualPackage !== packageName) throw new Error('Local APK package must be com.descentdevelopers.descent3');
  }
  const { files, directories } = gamePath ? await listOwnedData(gamePath) : { files: [], directories: [] };
  const onLog = typeof input.onLog === 'function' ? input.onLog : () => {};
  const run = async (...args) => {
    signal?.throwIfAborted();
    const output = await adb.run(['-s', serial, ...args], (chunk) => onLog(String(chunk).trim().slice(0, 500)));
    if (/^Failure\b/i.test(output || '')) throw new Error(output);
    return output;
  };
  onLog('Installing the Descent 3 VR engine APK.');
  await run('install', '-r', apkPath);
  if (!gamePath) {
    onLog('Quest APK updated. Existing Descent 3 game files were left on the headset.');
    return { packageName, filesCopied: 0 };
  }
  onLog(`Copying ${files.length} files from your owned Descent 3 installation.`);
  await run('shell', 'mkdir', '-p', remoteQuote(remoteRoot));
  for (const directory of directories) await run('shell', 'mkdir', '-p', remoteQuote(directory));
  for (const file of files) await run('push', file.local, file.remote);
  for (const directory of directories) await run('shell', 'chmod', '2777', remoteQuote(directory));
  onLog('Descent 3 VR data transfer and directory permissions completed.');
  return { packageName, filesCopied: files.length };
}

module.exports = { installDescent3, listOwnedData, verifyOfficialRelease };
