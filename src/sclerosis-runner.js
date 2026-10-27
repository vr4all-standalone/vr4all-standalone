const fs = require('node:fs/promises');
const path = require('node:path');
const { inspectApkPackage } = require('./apk-verification');
const { inspectDirectoryArchive, extractDirectoryArchive, removeConversionDirectory } = require('./archive-conversion');

const packageId = 'com.CreaTeam.Sclerosis';
const remoteGame = '/sdcard/Amnesia The Dark Descent';

async function validateSclerosisGame(gamePath, updateOnly = false) {
  if (!gamePath && updateOnly) return null;
  if (typeof gamePath !== 'string' || !path.isAbsolute(gamePath)) throw new Error('Drop your installed Amnesia: The Dark Descent folder');
  const stat = await fs.lstat(gamePath).catch(() => null);
  if (stat?.isFile() && ['.zip', '.7z', '.rar'].includes(path.extname(gamePath).toLowerCase())) {
    await inspectDirectoryArchive({ label: 'Amnesia game archive', requiredDirectories: ['config', 'maps', 'entities'] }, gamePath);
    return gamePath;
  }
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose a regular Amnesia game folder');
  const names = new Set((await fs.readdir(gamePath)).map((name) => name.toLowerCase()));
  if (!names.has('config') || !names.has('maps') || !names.has('entities')) throw new Error('Amnesia game folder needs config, maps and entities');
  return gamePath;
}

async function installSclerosis({ apkPath, gamePath, serial, adb, inspectApk = inspectApkPackage, onLog = () => {} } = {}) {
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '') || !adb?.run) throw new Error('Choose a connected Quest');
  if (!(await fs.stat(apkPath).catch(() => null))?.isFile()) throw new Error('Drop the creator-hosted Sclerosis APK');
  if (await inspectApk(apkPath, adb.getPath?.()) !== packageId) throw new Error('APK is not the Sclerosis Android port');
  await validateSclerosisGame(gamePath, !gamePath);
  let extracted;
  try {
    if (gamePath && ['.zip', '.7z', '.rar'].includes(path.extname(gamePath).toLowerCase())) {
      extracted = await extractDirectoryArchive({ label: 'Amnesia game archive', requiredDirectories: ['config', 'maps', 'entities'] }, gamePath);
      gamePath = extracted.path;
      await validateSclerosisGame(gamePath);
    }
    onLog('Installing your saved Sclerosis creator APK...');
    await adb.run(['-s', serial, 'install', '-r', apkPath]);
    if (!gamePath) {
      onLog('APK updated. Existing Amnesia game files stay on the headset.');
      return { packageId, updatedOnly: true };
    }
    onLog('Copying your owned Amnesia game folder to the headset root...');
    await adb.run(['-s', serial, 'shell', "mkdir -p '/sdcard/Amnesia The Dark Descent'"]);
    await adb.run(['-s', serial, 'push', gamePath + path.sep + '.', remoteGame + '/'], (chunk) => {
      const line = String(chunk).trim();
      if (line && !line.includes('%')) onLog(line.slice(0, 400));
    });
    return { packageId, updatedOnly: false };
  } finally { if (extracted) await removeConversionDirectory(extracted.directory); }
}

module.exports = { validateSclerosisGame, installSclerosis, packageId, remoteGame };
