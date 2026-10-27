const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { extractPlayerZip, findRecipeFile, removeWork } = require('./official-player-runner');
const { inspectApkPackage } = require('./apk-verification');

const run = promisify(execFile);

async function installMagicCarpet(input) {
  const { apkPath, importerZip, gamePath, serial, adb, workRoot = os.tmpdir(), onLog = () => {} } = input || {};
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '') || !adb?.run) throw new Error('Choose a connected Quest');
  if (!(await fs.stat(apkPath).catch(() => null))?.isFile()) throw new Error('Official Magic Carpet APK is unavailable');
  const packageId = await (input.inspectApk || inspectApkPackage)(apkPath, adb.getPath?.());
  if (packageId !== 'technology.master.mc.vr') throw new Error('APK is not the official Magic Carpet VR package');
  if (!gamePath) {
    onLog('Updating the Quest APK; baked game data remains on the headset.');
    await adb.run(['-s', serial, 'install', '-r', apkPath]);
    return { packageId, updatedOnly: true };
  }
  const stat = await fs.lstat(gamePath).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink() || !(await fs.readdir(gamePath)).length) throw new Error('Drop your installed Magic Carpet game folder');
  if (!(await fs.stat(importerZip).catch(() => null))?.isFile()) throw new Error('Official Windows importer ZIP is unavailable');
  await fs.mkdir(workRoot, { recursive: true });
  const work = await fs.mkdtemp(path.join(workRoot, 'vr4all-player-'));
  try {
    const extracted = path.join(work, 'importer');
    onLog('Extracting the official Magic Carpet importer...');
    await extractPlayerZip(importerZip, extracted);
    const importer = await findRecipeFile(extracted, 'mgc-import.exe');
    const baked = path.join(work, 'baked');
    onLog('Checking your owned Magic Carpet files...');
    await run(importer, ['scan', gamePath], { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
    onLog('Baking Quest game data with the official importer...');
    await run(importer, ['bake', gamePath, baked], { windowsHide: true, timeout: 45 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
    if (!(await fs.stat(baked).catch(() => null))?.isDirectory() || !(await fs.readdir(baked)).length) throw new Error('Official importer produced no baked game data');
    onLog('Copying baked game data to the selected headset...');
    await adb.run(['-s', serial, 'shell', 'mkdir', '-p', '/sdcard/mgcarpet']);
    await adb.run(['-s', serial, 'shell', 'rm', '-f', '/sdcard/mgcarpet/baked/vr4all-transfer.complete']);
    await adb.run(['-s', serial, 'push', baked, '/sdcard/mgcarpet/'], (chunk) => onLog(String(chunk).trim().slice(0, 400)));
    onLog('Installing the official Quest APK...');
    await adb.run(['-s', serial, 'install', '-r', apkPath]);
    await adb.run(['-s', serial, 'shell', 'touch', '/sdcard/mgcarpet/baked/vr4all-transfer.complete']);
    return { packageId, updatedOnly: false };
  } finally {
    await removeWork(work, workRoot);
  }
}

module.exports = { installMagicCarpet };
