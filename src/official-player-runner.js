const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { inspectListing, sevenZipPath, runSevenZip } = require('./archive-conversion');

const recipes = Object.freeze({
  'descent12-vr': {
    script: 'files/setup-quest.ps1',
    apk: 'files/DescentVR.apk',
    input: 'directory',
    args: ({ gamePath, serial, adbPath }) => ['-Quiet', '-NoSearch', '-GamePath', gamePath, '-Serial', serial, '-Adb', adbPath, '-Json'],
  },
  'gothic2-vr': {
    script: 'Quest/tools/install-release.ps1',
    apk: /(^|\/)Quest\/Gothic-II-VR-[0-9.]+\.apk$/i,
    input: 'directory',
    args: ({ gamePath, serial, adbPath }) => ['-GameDir', gamePath, '-Serial', serial, '-SdkRoot', path.dirname(path.dirname(adbPath))],
  },
  'gt2-vr': {
    script: 'native/scripts/install-player.ps1',
    apk: /(^|\/)native\/GT2-VR-[0-9.]+\.apk$/i,
    input: 'file',
    extensions: ['.bin', '.iso', '.zip'],
    args: ({ gamePath, serial, adbPath, work }) => ['-DiscImage', gamePath, '-Target', 'Quest', '-Adb', adbPath, '-Serial', serial, '-NoBios', '-InstallDir', path.join(work, 'runtime')],
  },
  'animal-crossing-vr': {
    script: 'AnimalCrossing-Quest/Install-Quest.ps1',
    apk: 'AnimalCrossing-Quest/AnimalCrossing-Quest.apk',
    input: 'file',
    extensions: ['.iso', '.gcm', '.ciso'],
    args: ({ gamePath, adbPath }) => ['-AdbPath', adbPath, '-RomPath', gamePath, '-NonInteractive'],
    singleHeadset: true,
  },
});

async function validateOwnedInput(gameId, gamePath, updateOnly = false) {
  const recipe = recipes[gameId];
  if (!recipe) throw new Error('No integrated Quest player recipe for this port');
  if (!gamePath && updateOnly) return null;
  if (typeof gamePath !== 'string' || !path.isAbsolute(gamePath)) throw new Error('Choose your owned game file or folder');
  const stat = await fs.lstat(gamePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat[recipe.input === 'directory' ? 'isDirectory' : 'isFile']()) throw new Error('Choose an existing regular game ' + (recipe.input === 'directory' ? 'folder' : 'file'));
  if (recipe.extensions && !recipe.extensions.includes(path.extname(gamePath).toLowerCase())) throw new Error('Supported game files: ' + recipe.extensions.join(', '));
  if (recipe.input === 'file' && (!stat.size || stat.size > 16 * 1024 ** 3)) throw new Error('Game file is empty or larger than 16 GB');
  if (recipe.input === 'directory' && !(await fs.readdir(gamePath)).length) throw new Error('Game folder is empty');
  return gamePath;
}

async function extractPlayerZip(zipPath, work) {
  const binary = await sevenZipPath();
  const { stdout } = await runSevenZip(binary, ['l', '-slt', '-p-', zipPath]);
  inspectListing(stdout);
  await fs.mkdir(work, { recursive: true });
  await runSevenZip(binary, ['x', '-y', '-p-', '-o' + work, zipPath]);
}

async function findRecipeFile(root, suffix) {
  const wanted = typeof suffix === 'string' ? suffix.toLowerCase().replaceAll('\\', '/') : null;
  const matches = [];
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Official release contains an unexpected link');
      const local = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(local);
      else if (entry.isFile()) {
        const relative = path.relative(root, local).replaceAll('\\', '/').toLowerCase();
        if (wanted ? relative === wanted || relative.endsWith('/' + wanted) : suffix.test(relative)) matches.push(local);
      }
    }
  }
  await walk(root);
  if (matches.length !== 1) throw new Error('Official release is missing its expected Quest player file: ' + suffix);
  return matches[0];
}

function runPowerShell(script, args, onLog, timeoutMs = 90 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { windowsHide: true, cwd: path.dirname(script) });
    let tail = '';
    let remainder = '';
    const report = (chunk) => {
      remainder += String(chunk);
      const lines = remainder.split(/\r?\n/);
      remainder = lines.pop() || '';
      for (const line of lines) {
        const clean = line.trim();
        if (!clean) continue;
        tail = (tail + '\n' + clean).slice(-4000);
        onLog(clean.slice(0, 500));
      }
    };
    child.stdout.on('data', report);
    child.stderr.on('data', report);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (remainder.trim()) onLog(remainder.trim().slice(0, 500));
      code === 0 ? resolve() : reject(new Error('Official Quest installer exited ' + code + ': ' + tail.slice(-900)));
    });
  });
}

async function removeWork(work, parent) {
  const resolved = path.resolve(work);
  const root = path.resolve(parent);
  if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith('vr4all-player-')) throw new Error('Refusing to remove an unexpected player workspace');
  await fs.rm(resolved, { recursive: true, force: true });
}

async function requireSingleQuest3Family(adb, serial) {
  const quests = (await adb.listDevices()).filter((device) => device.state === 'device' && ['Quest 3', 'Quest 3S'].includes(device.model));
  if (quests.length !== 1 || quests[0].serial !== serial) {
    throw new Error('This author installer requires exactly one connected Quest 3 or 3S. Disconnect other Quest headsets and select the one to install on.');
  }
  return quests[0];
}

function allowQuest3SInInstaller(source) {
  const originalCheck = "if ($model.Text.Trim() -eq 'Quest 3') { $quests += $serial }";
  if (source.split(originalCheck).length !== 2) {
    throw new Error('The creator installer model check has changed; cannot safely enable Quest 3S support for this release.');
  }
  return source.replace(originalCheck, "if ($model.Text.Trim() -in @('Quest 3', 'Quest 3S')) { $quests += $serial }");
}

async function installOfficialPlayer(input) {
  const { gameId, gamePath, serial, adbPath, adb, zipPath, onLog = () => {}, runScript = runPowerShell } = input || {};
  const recipe = recipes[gameId];
  if (!recipe) throw new Error('No integrated Quest player recipe for this port');
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '')) throw new Error('Choose a connected Quest');
  if (!adb || typeof adb.run !== 'function') throw new Error('ADB is required');
  if (!adbPath || !(await fs.stat(adbPath).catch(() => null))?.isFile()) throw new Error('ADB executable is unavailable');
  if (!zipPath || path.extname(zipPath).toLowerCase() !== '.zip' || !(await fs.stat(zipPath).catch(() => null))?.isFile()) throw new Error('Official Quest installer ZIP is unavailable');
  await validateOwnedInput(gameId, gamePath, !gamePath);
  const selectedQuest = recipe.singleHeadset ? await requireSingleQuest3Family(adb, serial) : null;
  const workParent = input.workRoot || os.tmpdir();
  await fs.mkdir(workParent, { recursive: true });
  const work = await fs.mkdtemp(path.join(workParent, 'vr4all-player-'));
  try {
    onLog('Extracting the verified official Quest player ZIP...');
    await extractPlayerZip(zipPath, path.join(work, 'release'));
    const apk = await findRecipeFile(path.join(work, 'release'), recipe.apk);
    if (!gamePath) {
      onLog('Updating the Quest APK; existing game data stays on the headset.');
      await adb.run(['-s', serial, 'install', '-r', apk], (chunk) => onLog(String(chunk).trim().slice(0, 500)));
      return { apk, updatedOnly: true };
    }
    const script = await findRecipeFile(path.join(work, 'release'), recipe.script);
    if (gameId === 'animal-crossing-vr' && selectedQuest?.model === 'Quest 3S') {
      const original = await fs.readFile(script, 'utf8');
      await fs.writeFile(script, allowQuest3SInInstaller(original), 'utf8');
      onLog('Quest 3S is unverified by the port creator. VR4ALL adjusted the temporary installer model check; game compatibility still needs testing.');
    }
    onLog('Preparing your owned game data with the author’s packaged installer...');
    await runScript(script, recipe.args({ gamePath, serial, adbPath, work }), onLog);
    return { apk, updatedOnly: false };
  } finally {
    await removeWork(work, workParent);
  }
}

module.exports = { recipes, validateOwnedInput, extractPlayerZip, findRecipeFile, installOfficialPlayer, removeWork, requireSingleQuest3Family, allowQuest3SInInstaller };
