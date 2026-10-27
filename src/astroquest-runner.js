const fs = require('node:fs/promises');
const path = require('node:path');
const { inspectApkPackage } = require('./apk-verification');

const packageId = 'com.astrobotquest.vrhost';
const remoteRoot = '/data/local/tmp/astro/games';

async function validateAstroGame(gamePath, updateOnly = false) {
  if (!gamePath && updateOnly) return null;
  if (typeof gamePath !== 'string' || !path.isAbsolute(gamePath)) throw new Error('Drop your extracted CUSA12392 game folder');
  const root = await fs.lstat(gamePath).catch(() => null);
  if (!root?.isDirectory() || root.isSymbolicLink()) throw new Error('Choose a regular extracted Astro Bot game folder');
  const names = await fs.readdir(gamePath);
  if (!names.includes('eboot.bin') || !names.includes('sce_sys') || !names.includes('sce_module')) {
    throw new Error('Astro Bot folder needs eboot.bin, sce_sys and sce_module from your own CUSA12392 dump');
  }
  if (!(await fs.stat(path.join(gamePath, 'eboot.bin'))).isFile()
    || !(await fs.stat(path.join(gamePath, 'sce_sys'))).isDirectory()
    || !(await fs.stat(path.join(gamePath, 'sce_module'))).isDirectory()) throw new Error('Astro Bot game tree has the wrong layout');
  return gamePath;
}

async function installAstroQuest({ apkPath, gamePath, serial, adb, inspectApk = inspectApkPackage, onLog = () => {} } = {}) {
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '') || !adb?.run) throw new Error('Choose a connected Quest');
  if (!(await fs.stat(apkPath).catch(() => null))?.isFile()) throw new Error('Official AstroQuest APK is unavailable');
  const actual = await inspectApk(apkPath, adb.getPath?.());
  if (actual !== packageId) throw new Error('APK is not the official AstroQuest Quest package');
  await validateAstroGame(gamePath, !gamePath);
  onLog('Installing the official AstroQuest Quest APK...');
  await adb.run(['-s', serial, 'install', '-r', apkPath]);
  if (!gamePath) {
    onLog('APK updated. Existing Astro Bot game data stays on the headset.');
    return { packageId, updatedOnly: true };
  }
  onLog('Preparing the selected headset for the extracted CUSA12392 game...');
  await adb.run(['-s', serial, 'shell', 'mkdir', '-p', remoteRoot]);
  await adb.run(['-s', serial, 'shell', 'mkdir', '-p', remoteRoot + '/CUSA12392']);
  await adb.run(['-s', serial, 'shell', 'rm', '-f', remoteRoot + '/CUSA12392/vr4all-transfer.complete']);
  onLog('Copying your owned Astro Bot game tree to the headset. This can take several minutes.');
  await adb.run(['-s', serial, 'push', gamePath + path.sep + '.', remoteRoot + '/CUSA12392/'], (chunk) => {
    const line = String(chunk).trim();
    if (line && !line.includes('%')) onLog(line.slice(0, 400));
  });
  await adb.run(['-s', serial, 'shell', 'touch', remoteRoot + '/CUSA12392/vr4all-transfer.complete']);
  onLog('Astro Bot game tree transferred. Start AstroQuest from Unknown Sources.');
  return { packageId, updatedOnly: false };
}

module.exports = { validateAstroGame, installAstroQuest, packageId, remoteRoot };
