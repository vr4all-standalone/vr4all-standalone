const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { inspectDirectory } = require('./archive-conversion');
const { removeWork, extractPlayerZip, findRecipeFile } = require('./official-player-runner');
const { inspectApkPackage } = require('./apk-verification');
const { findOnPath } = require('./find-tool');
const { runLogged } = require('./run-logged');

const packageId = 'com.galaxy.quest';
const remoteGame = '/sdcard/Android/data/com.galaxy.quest/files/game';
const discExtensions = new Set(['.iso', '.rvz', '.wbfs']);
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
  if (stat.isFile() && (!discExtensions.has(path.extname(gamePath).toLowerCase()) || !stat.size)) throw new Error('Creator-supported Galaxy disc formats: ISO, RVZ, WBFS, or an extracted disc folder');
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

// Port of the creator's game_partition (tools/install.py): the folder, or its DATA subfolder, must hold a full GameCube data partition.
async function gamePartition(folder) {
  const isFile = async (target) => (await fs.stat(target).catch(() => null))?.isFile() === true;
  const isDirectory = async (target) => (await fs.stat(target).catch(() => null))?.isDirectory() === true;
  for (const candidate of [folder, path.join(folder, 'DATA')]) {
    if (await isFile(path.join(candidate, 'sys', 'fst.bin')) && await isFile(path.join(candidate, 'sys', 'main.dol'))
      && await isDirectory(path.join(candidate, 'files', 'ObjectData')) && await isDirectory(path.join(candidate, 'files', 'StageData'))) return candidate;
  }
  throw new Error('Select the whole extracted disc folder, or its DATA folder.');
}

// Linux: runs the creator's pure-Python cook.py from GalaxyQuest-converter.zip (Windows runs the packaged installer EXE instead).
async function convertWithCookScript(zipPath, source, output, onLog, { work, findTool = findOnPath, runner = runLogged } = {}) {
  await extractPlayerZip(zipPath, path.join(work, 'converter'));
  const cook = await findRecipeFile(path.join(work, 'converter'), 'tools/cook/cook.py');
  const python = findTool(['python3', 'python']);
  const probe = python && await runner(python, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'], { timeoutMs: 60000 });
  if (probe?.code !== 0) throw new Error('GalaxyQuest conversion needs Python 3.8 or newer (python3).');
  let folder = source;
  if ((await fs.stat(source)).isFile()) {
    const dolphinTool = findTool(['dolphin-tool', 'DolphinTool']);
    if (!dolphinTool) throw new Error('Disc images need dolphin-tool on Linux (Arch: pacman -S dolphin-emu-tool). Or choose the disc folder extracted with Dolphin.');
    folder = path.join(work, 'extracted');
    onLog('Extracting the disc image with dolphin-tool...');
    const extracted = await runner(dolphinTool, ['extract', '-i', source, '-o', folder, '--gameonly', '--quiet'], { cwd: work, timeoutMs: 30 * 60 * 1000, onLine: onLog });
    if (extracted.code !== 0) throw new Error('dolphin-tool could not extract the disc image: ' + extracted.tail.slice(-5).join(' | '));
  }
  const dataDir = await gamePartition(folder);
  const result = await runner(python, [cook, dataDir, output, '--with-movies', '--jobs', String(Math.min(os.cpus().length, 8))], {
    cwd: path.dirname(cook), timeoutMs: 2 * 60 * 60 * 1000, onLine: onLog, captureStdout: true,
  });
  const cooked = result.code === 0 && /^cooked \d+ disc files in [\d.]+s$/m.test(result.stdout)
    && (await fs.stat(path.join(output, 'sys', 'fst.bin')).catch(() => null))?.isFile();
  if (!cooked) {
    const errors = result.tail.filter((line) => /^ERROR\b/.test(line));
    throw new Error('GalaxyQuest conversion failed: ' + (errors.length ? errors : result.tail.slice(-5)).join(' | '));
  }
}

async function installGalaxyQuest(input) {
  const { apkPath, converterPath, gamePath, serial, adb, workRoot, onLog = () => {}, inspectApk = inspectApkPackage, convert } = input || {};
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '') || !adb?.run) throw new Error('Choose a connected Quest');
  if (!(await fs.stat(apkPath).catch(() => null))?.isFile()) throw new Error('Official GalaxyQuest APK is unavailable');
  if (await inspectApk(apkPath, adb.getPath?.()) !== packageId) throw new Error('APK is not the official GalaxyQuest Quest package');
  await validateGalaxyInput(gamePath, !gamePath);
  if (!gamePath) {
    onLog('Updating GalaxyQuest APK; existing converted game files stay on the headset.');
    await adb.run(['-s', serial, 'install', '--no-incremental', '-r', apkPath]);
    return { packageId, updatedOnly: true };
  }
  const converterKind = (await fs.stat(converterPath).catch(() => null))?.isFile() ? path.extname(converterPath).toLowerCase() : '';
  if (converterKind !== '.exe' && converterKind !== '.zip') throw new Error('Official GalaxyQuest converter is unavailable');
  if (!workRoot || !path.isAbsolute(workRoot)) throw new Error('Choose a writable conversion workspace');
  await fs.mkdir(workRoot, { recursive: true });
  const work = await fs.mkdtemp(path.join(workRoot, 'vr4all-player-'));
  try {
    const cooked = path.join(work, 'converted');
    onLog('Converting your owned Super Mario Galaxy disc with the official packaged tool...');
    const converter = convert || (converterKind === '.zip' ? convertWithCookScript : convertWithAuthorTool);
    await converter(converterPath, gamePath, cooked, onLog, { work });
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

module.exports = { validateGalaxyInput, chooseGalaxyWorkRoot, convertWithAuthorTool, convertWithCookScript, gamePartition, installGalaxyQuest, packageId };
