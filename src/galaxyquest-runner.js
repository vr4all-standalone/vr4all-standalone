const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { inspectDirectory } = require('./archive-conversion');
const { removeWork } = require('./official-player-runner');
const { inspectApkPackage } = require('./apk-verification');

const packageId = 'com.galaxy.quest';
const remoteGame = '/sdcard/Android/data/com.galaxy.quest/files/game';
const discExtensions = new Set(['.iso', '.rvz', '.wbfs', '.gcz', '.wia', '.ciso']);
const gib = 1024n ** 3n;
const retryableTransfer = /broken pipe|no response|device offline|connection reset|transport.*error|protocol fault|timed? out/i;

function packConvertedGame(source, archive) {
  const executable = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-cf', archive, '-C', source, '.'], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Could not pack GalaxyQuest game files: ${stderr.trim() || `tar exited ${code}`}`)));
  });
}

async function chooseGalaxyWorkRoot(gamePath, fallbackRoot, options = {}) {
  if (!gamePath || !path.isAbsolute(gamePath) || !path.isAbsolute(fallbackRoot)) throw new Error('Choose an absolute GalaxyQuest conversion workspace');
  const statfs = options.statfs || fs.statfs;
  const mkdir = options.mkdir || ((directory) => fs.mkdir(directory, { recursive: true }));
  const sourceStat = await fs.stat(gamePath).catch(() => null);
  const required = sourceStat?.isDirectory() ? 10n * gib : 16n * gib;
  let probe = path.dirname(fallbackRoot);
  while (!(await fs.stat(probe).catch(() => null))?.isDirectory() && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const volume = await statfs(probe);
  const free = BigInt(volume.bavail) * BigInt(volume.bsize);
  if (free < required) {
    throw new Error(`GalaxyQuest needs about ${required / gib} GB free in the selected build folder (${fallbackRoot}); this drive has ${(Number(free) / Number(gib)).toFixed(1)} GB. Choose another folder in Settings > Workspace.`);
  }
  try { await mkdir(fallbackRoot); }
  catch (error) { throw new Error(`Cannot use the selected build folder (${fallbackRoot}): ${error.message}. Choose another folder in Settings > Workspace.`); }
  return fallbackRoot;
}

async function validateGalaxyInput(gamePath, updateOnly = false) {
  if (!gamePath && updateOnly) return null;
  if (typeof gamePath !== 'string' || !path.isAbsolute(gamePath)) throw new Error('Drop your Super Mario Galaxy disc image or extracted folder');
  const stat = await fs.lstat(gamePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error('Choose a regular disc image or extracted folder');
  if (stat.isFile() && (!discExtensions.has(path.extname(gamePath).toLowerCase()) || !stat.size)) throw new Error('Supported Galaxy disc formats: ISO, RVZ, WBFS, GCZ, WIA, CISO');
  if (stat.isDirectory() && !(await fs.readdir(gamePath)).length) throw new Error('Extracted disc folder is empty');
  return gamePath;
}

function convertWithAuthorTool(executable, source, output, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--convert-only', source, output], { windowsHide: true });
    let tail = '';
    const report = (chunk) => {
      const value = String(chunk).trim();
      if (!value) return;
      tail = (tail + '\n' + value).slice(-4000);
      onLog(value.slice(0, 500));
    };
    child.stdout.on('data', report);
    child.stderr.on('data', report);
    const timer = setTimeout(() => child.kill(), 2 * 60 * 60 * 1000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error('GalaxyQuest converter exited ' + code + ': ' + tail.slice(-900)));
    });
  });
}

async function installGalaxyQuest(input) {
  const { apkPath, converterPath, gamePath, serial, adb, workRoot, onLog = () => {}, inspectApk = inspectApkPackage, convert = convertWithAuthorTool } = input || {};
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '') || !adb?.run) throw new Error('Choose a connected Quest');
  if (!(await fs.stat(apkPath).catch(() => null))?.isFile()) throw new Error('Official GalaxyQuest APK is unavailable');
  if (await inspectApk(apkPath, adb.getPath?.()) !== packageId) throw new Error('APK is not the official GalaxyQuest Quest package');
  await validateGalaxyInput(gamePath, !gamePath);
  if (!gamePath) {
    onLog('Updating GalaxyQuest APK; existing converted game files stay on the headset.');
    await adb.run(['-s', serial, 'install', '--no-incremental', '-r', apkPath]);
    return { packageId, updatedOnly: true };
  }
  if (!(await fs.stat(converterPath).catch(() => null))?.isFile() || path.extname(converterPath).toLowerCase() !== '.exe') throw new Error('Official GalaxyQuest Windows converter is unavailable');
  if (!workRoot || !path.isAbsolute(workRoot)) throw new Error('Choose a writable conversion workspace');
  await fs.mkdir(workRoot, { recursive: true });
  const work = await fs.mkdtemp(path.join(workRoot, 'vr4all-player-'));
  try {
    const cooked = path.join(work, 'converted');
    onLog('Converting your owned Super Mario Galaxy disc with the official packaged tool...');
    await convert(converterPath, gamePath, cooked, onLog);
    const summary = await inspectDirectory(cooked);
    if (!summary.files) throw new Error('GalaxyQuest converter produced no game files');
    onLog('Installing the official GalaxyQuest Quest APK...');
    await adb.run(['-s', serial, 'install', '--no-incremental', '-r', apkPath]);
    await adb.run(['-s', serial, 'shell', 'mkdir', '-p', remoteGame]);
    await adb.run(['-s', serial, 'shell', 'rm', '-f', remoteGame + '/vr4all-transfer.complete']);
    const archive = path.join(work, 'game-data.tar');
    const remoteArchive = `/data/local/tmp/vr4all-galaxy-${randomUUID()}.tar`;
    onLog('Packing converted game files for the Quest...');
    await packConvertedGame(cooked, archive);
    try {
      onLog('Copying the game archive to the selected headset...');
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await adb.run(['-s', serial, 'push', '-Z', archive, remoteArchive], (chunk) => {
            const line = String(chunk).trim();
            if (line && !line.includes('%')) onLog(line.slice(0, 400));
          });
          break;
        } catch (error) {
          if (!retryableTransfer.test(error.message)) throw error;
          if (attempt === 3) throw new Error(`GalaxyQuest USB transfer failed after 3 attempts: ${error.message}. Keep the Quest awake and check the USB cable or port.`);
          onLog(`USB transfer interrupted (${error.message.slice(-160)}). Retrying copy ${attempt + 1}/3 without reconverting the game...`);
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
      }
      onLog('Unpacking game files on the headset...');
      await adb.run(['-s', serial, 'shell', 'tar', '-xf', remoteArchive, '-C', remoteGame]);
      await adb.run(['-s', serial, 'shell', 'chmod', '-R', 'a+rX', remoteGame]);
      await adb.run(['-s', serial, 'shell', 'touch', remoteGame + '/vr4all-transfer.complete']);
    } finally {
      await adb.run(['-s', serial, 'shell', 'rm', '-f', remoteArchive]).catch(() => {});
    }
    return { packageId, updatedOnly: false, files: summary.files };
  } finally {
    await removeWork(work, workRoot);
  }
}

module.exports = { validateGalaxyInput, chooseGalaxyWorkRoot, convertWithAuthorTool, installGalaxyQuest, packageId };
