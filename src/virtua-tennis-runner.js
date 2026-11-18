const fs = require('node:fs/promises');
const path = require('node:path');
const { runLogged } = require('./run-logged');
const { inspectApkPackage } = require('./apk-verification');

const REPO = 'https://github.com/mrchrisster/virtuatennis3-vr.git';
const PACKAGE = 'org.lindbergh.vt3.vr';
const PARTS = ['vt3_Lindbergh', 'shader', 'lib'];

async function regularFile(file) {
  const stat = await fs.lstat(file).catch(() => null);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink() && stat.size);
}

async function validateVirtuaTennisInput(input) {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  if (typeof input.gamePackage !== 'string' || !path.isAbsolute(input.gamePackage)) throw new Error('Choose your owned Virtua Tennis 3 disk0 folder');
  const supplied = path.resolve(input.gamePackage);
  for (const candidate of [supplied, path.join(supplied, 'disk0'), path.join(supplied, 'extracted', 'disk0')]) {
    const stat = await fs.lstat(candidate).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink() || !await regularFile(path.join(candidate, 'vt3_Lindbergh', 'vt3_Lindbergh_HD'))) continue;
    for (const part of PARTS) {
      const folder = await fs.lstat(path.join(candidate, part)).catch(() => null);
      if (!folder?.isDirectory() || folder.isSymbolicLink()) throw new Error(`The Virtua Tennis 3 disk0 folder is missing ${part}`);
    }
    if (!await regularFile(path.join(candidate, 'lib', 'libCg.so'))) throw new Error('The Virtua Tennis 3 disk0 folder is missing lib/libCg.so');
    return { serial: input.serial, gamePackage: candidate };
  }
  throw new Error('Choose the Virtua Tennis 3 disk0 folder containing vt3_Lindbergh/vt3_Lindbergh_HD');
}

async function checked(command, args, settings, label, runCommand) {
  const result = await runCommand(command, args, settings);
  if (result.code !== 0) throw new Error(`${label} failed (exit ${result.code}): ${(result.tail || []).slice(-6).join(' | ').slice(-1200) || 'see activity log'}`);
  return result;
}

async function findGit(options = {}) {
  if (options.git) return options.git;
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')];
  for (const root of roots.filter(Boolean)) {
    for (const relative of ['Git/cmd/git.exe', 'Git/bin/git.exe']) {
      const candidate = path.join(root, relative);
      if (await regularFile(candidate)) return candidate;
    }
  }
  return 'git';
}

async function updateVirtuaTennisSource(source, onLog = () => {}, options = {}) {
  const runCommand = options.runCommand || runLogged;
  const git = await findGit(options);
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const execute = (args, label, captureStdout = false) => checked(git, args, { env, timeoutMs: 15 * 60 * 1000, onLine: onLog, captureStdout }, label, runCommand);
  const checkout = await fs.lstat(path.join(source, '.git')).catch(() => null);
  if (checkout) {
    const remote = (await execute(['-C', source, 'remote', 'get-url', 'origin'], 'Checking Virtua Tennis 3 source', true)).stdout.trim();
    if (remote.replace(/\.git$/i, '').toLowerCase() !== REPO.replace(/\.git$/i, '').toLowerCase()) throw new Error('Virtua Tennis 3 source cache points to an unexpected repository');
    onLog('Refreshing the creator’s Virtua Tennis 3 source...');
    await execute(['-C', source, 'fetch', '--depth=1', 'origin', 'main'], 'Refreshing Virtua Tennis 3 source');
    await execute(['-C', source, 'checkout', '--detach', 'FETCH_HEAD'], 'Updating Virtua Tennis 3 source');
  } else {
    if ((await fs.readdir(source).catch(() => [])).length) throw new Error('Virtua Tennis 3 source cache is not a Git checkout. Choose another PC build folder.');
    await fs.mkdir(path.dirname(source), { recursive: true });
    onLog('Downloading the creator’s Virtua Tennis 3 source and recompilation toolkit...');
    await execute(['clone', '--recursive', '--depth=1', '--branch', 'main', REPO, source], 'Downloading Virtua Tennis 3 source');
  }
  await execute(['-C', source, 'submodule', 'update', '--init', '--recursive'], 'Refreshing Virtua Tennis 3 toolkit');
  if (!await regularFile(path.join(source, 'scripts', 'build-quest-windows.ps1'))) throw new Error('Creator source is missing its Windows Quest build script');
  const sha = (await execute(['-C', source, 'rev-parse', 'HEAD'], 'Checking Virtua Tennis 3 revision', true)).stdout.trim();
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Creator source returned an invalid revision');
  return { directory: source, sha };
}

async function runVirtuaTennisBuild(rawInput, options = {}) {
  if ((options.platform || process.platform) !== 'win32') throw new Error('Virtua Tennis 3 personal builds currently require Windows');
  const input = await validateVirtuaTennisInput(rawInput);
  const workspaceRoot = options.workspaceRoot;
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) throw new Error('Choose a PC build folder for Virtua Tennis 3');
  const workRoot = path.join(workspaceRoot, 'virtua-tennis-3-vr');
  const relative = path.relative(input.gamePackage, workRoot);
  if (!relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    throw new Error('Choose a PC build folder outside your Virtua Tennis 3 game files');
  }
  if (!options.adb?.run) throw new Error('Quest ADB connection is unavailable');
  const onLog = options.onLog || (() => {});
  const sourceKit = options.sourceKit || ((source) => updateVirtuaTennisSource(source, onLog, options));
  const kit = await sourceKit(path.join(workRoot, 'source'));
  if (!/^[a-f0-9]{40}$/i.test(kit.sha || '') || !await regularFile(path.join(kit.directory, 'scripts', 'build-quest-windows.ps1'))) {
    throw new Error('Creator build source is incomplete');
  }
  const adbPath = options.adb.getPath?.();
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', ANDROID_SERIAL: input.serial,
    PATH: `${adbPath ? `${path.dirname(adbPath)}${path.delimiter}` : ''}${process.env.PATH || ''}` };
  const runCommand = options.runCommand || runLogged;
  const script = path.join(kit.directory, 'scripts', 'build-quest-windows.ps1');
  const runScript = (extra, label, timeoutMs) => checked('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...extra, input.gamePackage],
    { cwd: kit.directory, env, timeoutMs, onLine: onLog }, label, runCommand);
  onLog('Checking your original Virtua Tennis 3 files and required build tools...');
  await runScript(['-Check'], 'Creator game and tool check', 10 * 60 * 1000);
  onLog('Building your personal Virtua Tennis 3 Quest APK...');
  await runScript([], 'Creator Virtua Tennis 3 build', 3 * 60 * 60 * 1000);
  const apk = path.join(kit.directory, 'quest', 'VirtuaTennis3VR.apk');
  if (!await regularFile(apk)) throw new Error('Creator build did not produce VirtuaTennis3VR.apk');
  const foundPackage = await (options.inspectApk || inspectApkPackage)(apk, adbPath);
  if (foundPackage !== PACKAGE) throw new Error(`Creator APK has unexpected package ${foundPackage || 'unknown'}; expected ${PACKAGE}. Nothing was installed.`);
  onLog('Installing the personal APK on the selected Quest...');
  const installed = await options.adb.run(['-s', input.serial, 'install', '-r', apk], undefined, { timeoutMs: 15 * 60 * 1000 });
  if (!/^Success\b/m.test(installed)) throw new Error(`Quest did not confirm Virtua Tennis 3 installation: ${installed || 'no response'}`);
  await options.adb.run(['-s', input.serial, 'shell', 'appops', 'set', '--uid', PACKAGE, 'MANAGE_EXTERNAL_STORAGE', 'allow']);
  await options.adb.run(['-s', input.serial, 'shell', 'mkdir', '-p', '/sdcard/VirtuaTennis3/']);
  for (const part of PARTS) {
    onLog(`Copying ${part} from your owned game to the Quest...`);
    await options.adb.run(['-s', input.serial, 'push', path.join(input.gamePackage, part), '/sdcard/VirtuaTennis3/'], undefined, { timeoutMs: 2 * 60 * 60 * 1000 });
  }
  for (const [relativeFile, remote] of [
    ['vt3_Lindbergh/vt3_Lindbergh_HD', '/sdcard/VirtuaTennis3/vt3_Lindbergh/vt3_Lindbergh_HD'],
    ['lib/libCg.so', '/sdcard/VirtuaTennis3/lib/libCg.so'],
  ]) {
    const localBytes = (await fs.stat(path.join(input.gamePackage, relativeFile))).size;
    const remoteBytes = String(await options.adb.run(['-s', input.serial, 'shell', 'stat', '-c', '%s', remote])).trim();
    if (remoteBytes !== String(localBytes)) throw new Error(`${relativeFile} transfer was incomplete (${remoteBytes || 'missing'} of ${localBytes} bytes)`);
  }
  onLog('Virtua Tennis 3 APK and required game files are on the selected Quest.');
  return { packageId: PACKAGE, sha: kit.sha, workDir: workRoot };
}

module.exports = { validateVirtuaTennisInput, updateVirtuaTennisSource, runVirtuaTennisBuild };
