// Personal Jurassic Park Arcade build. The creator publishes source, not APKs.
// Keep its ignored ext/ and output directories in one persistent checkout so
// signing identity and incremental build files survive later updates.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

const repo = 'https://github.com/Lovecore/jurassic-park-arcade-quest.git';
const packageId = 'com.jp2015.vr';
const gameHash = 'c18a9329e72a363937155d245440694e58b5a1e27984016ae7648af3413b4269';
const folders = ['g5/dino/data', 'g5/shaders', 'g5/g5engine', 'pmuser', 'programs_dec', 'g5/dino/data/programs_enc'];
const physx = Object.freeze({
  'libPhysXLoader.so.1': '18eaf2d3efa5f0830cb7efa4beb72bec194c6ec7b97a8a24bd9accc21f80dfd0',
  'libPhysXCore.so': 'e7abebbd2c8203e7172e0e3a905abb94b034dd7cbb6a12e4666a8b9409815d42',
  'libNxCooking.so': '0e09448b4b08e98905f2de136f0fbaf08c647080c5bde812e64c60dc6e29ffff',
  'libNxCharacter.so.1': '81a52480329e90fc64cd60c2f9dd50bde2c0f97ea96940fe11bda75e9685ae59',
});
const jurassicBuildSteps = () => [
  { script: 'tools/setup/fetch_deps.sh', inputs: [] },
  { script: 'tools/setup/prepare_game.sh', inputs: ['gamePackage', 'audioSource'] },
  { script: 'tools/build_all.sh', inputs: [] },
  { script: 'tools/quest/install.sh', inputs: ['gamePackage'] },
];

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function regularFile(file) {
  const stat = await fs.lstat(file).catch(() => null);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink() && stat.size > 0);
}

async function resolvePhysxFolder(gameFolder, supplied) {
  const candidates = [supplied, path.join(gameFolder, 'TeknoParrot', 'ElfLdr2', 'libs'),
    path.join(gameFolder, 'ElfLdr2', 'libs'), path.join(path.dirname(gameFolder), 'TeknoParrot', 'ElfLdr2', 'libs')];
  for (const candidate of candidates.filter(Boolean)) {
    const stat = await fs.lstat(candidate).catch(() => null);
    if (stat?.isDirectory() && !stat.isSymbolicLink()) return path.resolve(candidate);
  }
  return null;
}

async function validateJurassicInput(input, options = {}) {
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  if (typeof input.gamePackage !== 'string' || !path.isAbsolute(input.gamePackage)) throw new Error('Choose your owned Jurassic Park Arcade v1.08 game folder');
  const gamePackage = path.resolve(input.gamePackage);
  const stat = await fs.lstat(gamePackage).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose the extracted Jurassic Park Arcade v1.08 game folder');
  if (!await regularFile(path.join(gamePackage, 'game'))) throw new Error('The game folder needs its original `game` binary');
  for (const folder of folders) {
    if (!(await fs.stat(path.join(gamePackage, folder)).catch(() => null))?.isDirectory()) throw new Error(`The v1.08 game folder is missing ${folder}`);
  }
  const hash = await (options.hashFile || hashFile)(path.join(gamePackage, 'game'));
  if (hash !== (options.expectedGameHash || gameHash)) throw new Error('The `game` binary is not the supported Raw Thrills Linux PC v1.08 TeknoParrot dump (SHA-256 mismatch)');
  const audioSource = await resolvePhysxFolder(gamePackage, input.audioSource);
  if (!audioSource) throw new Error('Choose the TeknoParrot ElfLdr2/libs folder containing the four PhysX 2.8 i386 libraries');
  for (const [file, expected] of Object.entries(physx)) {
    const target = path.join(audioSource, file);
    if (!await regularFile(target)) throw new Error(`PhysX 2.8 library missing: ${file}`);
    if (await (options.hashFile || hashFile)(target) !== expected) throw new Error(`The PhysX 2.8 library ${file} has the wrong SHA-256`);
  }
  return { serial: input.serial, gamePackage, audioSource };
}

async function firstExisting(paths) {
  for (const candidate of paths.filter(Boolean)) if (await regularFile(candidate)) return candidate;
  return null;
}

async function findTools(workRoot, adbPath, sharedToolsRoot) {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const gitRoots = [path.join(programFiles, 'Git'), path.join(process.env['ProgramFiles(x86)'] || '', 'Git'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git')];
  const git = await firstExisting(gitRoots.flatMap((root) => [path.join(root, 'cmd', 'git.exe'), path.join(root, 'bin', 'git.exe')]));
  const bash = await firstExisting(gitRoots.flatMap((root) => [path.join(root, 'bin', 'bash.exe'), path.join(root, 'usr', 'bin', 'bash.exe')]));
  if (!git || !bash) throw new Error('Jurassic Park build needs Git for Windows (Git Bash). Install it once, then retry in VR4ALL.');
  let python;
  for (const command of ['python', 'py']) {
    try {
      const args = command === 'py' ? ['-3', '-c', 'import sys; print(sys.executable); print(sys.version_info.major, sys.version_info.minor)']
        : ['-c', 'import sys; print(sys.executable); print(sys.version_info.major, sys.version_info.minor)'];
      const { stdout } = await exec(command, args, { windowsHide: true, timeout: 10000 });
      const [executable, version] = stdout.trim().split(/\r?\n/);
      const match = version?.match(/^(\d+)\s+(\d+)$/);
      if (match && (Number(match[1]) > 3 || Number(match[1]) === 3 && Number(match[2]) >= 10) && await regularFile(executable)) { python = executable; break; }
    } catch { /* Try the next installed Python launcher. */ }
  }
  if (!python) throw new Error('Jurassic Park build needs Python 3.10 or newer with venv. Install Python, then retry in VR4ALL.');
  const sdkCandidates = [process.env.ANDROID_SDK, process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME,
    sharedToolsRoot && path.join(sharedToolsRoot, 'shared', '.android-sdk'),
    sharedToolsRoot && path.join(sharedToolsRoot, 'gta-sa-vr', '.android-sdk'),
    sharedToolsRoot && path.join(sharedToolsRoot, 'rdr1-vr', '.android-sdk'),
    path.join(workRoot, 'gta-sa-vr', '.android-sdk'), path.join(workRoot, 'rdr1-vr', '.android-sdk'),
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')];
  let sdk;
  for (const candidate of sdkCandidates.filter(Boolean)) {
    if (await regularFile(path.join(candidate, 'ndk', '27.1.12297006', 'source.properties'))
      && await regularFile(path.join(candidate, 'build-tools', '36.0.0', 'aapt2.exe'))
      && await regularFile(path.join(candidate, 'platforms', 'android-36', 'android.jar'))) { sdk = candidate; break; }
  }
  if (!sdk) throw new Error('Jurassic Park needs Android SDK NDK 27.1.12297006, build-tools 36.0.0 and platform android-36. Install these in Android Studio SDK Manager, then retry.');
  const java = await firstExisting([process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'keytool.exe'),
    path.join(programFiles, 'Android', 'Android Studio', 'jbr', 'bin', 'keytool.exe'),
    sharedToolsRoot && path.join(sharedToolsRoot, 'shared', '.tools', 'temurin-jdk-21.0.11+10', 'bin', 'keytool.exe'),
    sharedToolsRoot && path.join(sharedToolsRoot, 'gta-sa-vr', '.tools', 'temurin-jdk-21.0.11+10', 'bin', 'keytool.exe'),
    path.join(workRoot, 'gta-sa-vr', '.tools', 'temurin-jdk-21.0.11+10', 'bin', 'keytool.exe')]);
  if (!java) throw new Error('Jurassic Park needs JDK 17 or newer. Install Android Studio or a JDK, then retry.');
  if (!await regularFile(adbPath)) throw new Error('VR4ALL could not find its ADB tool for the selected Quest');
  return { git, bash, python, sdk, javaHome: path.dirname(path.dirname(java)), adb: adbPath };
}

function runProgram(executable, args, { cwd, env, log, timeout = 2 * 60 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '', error;
    const onChunk = (chunk) => {
      tail += String(chunk);
      const lines = tail.split(/\r?\n/);
      tail = lines.pop().slice(-1000);
      for (const line of lines) if (line.trim()) { error = /^(?:ERROR:|fatal:|.*failed:)/i.test(line.trim()) ? line.trim().slice(0, 500) : error; log(line.trim().slice(0, 500)); }
    };
    child.stdout.on('data', onChunk); child.stderr.on('data', onChunk);
    child.once('error', (cause) => { error = cause.message; });
    const timer = setTimeout(() => child.kill(), timeout);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (tail.trim()) log(tail.trim().slice(0, 500));
      code === 0 ? resolve() : reject(new Error(`Jurassic Park build step failed (exit ${code}): ${error || tail.trim() || 'see activity log'}`));
    });
  });
}

function bashArgs(step, inputs) {
  const variables = step.inputs.map((name, index) => `"$(cygpath -u "$${index + 1}")"`).join(' ');
  return ['-c', `set -eu; export MSYS_NO_PATHCONV=1 ANDROID_SDK="$(cygpath -u "$VR4ALL_SDK_WIN")" JAVA_HOME="$(cygpath -u "$VR4ALL_JAVA_WIN")" ADB="$(cygpath -u "$VR4ALL_ADB_WIN")"; exec sh ${step.script}${variables ? ` ${variables}` : ''}`,
    '--', ...step.inputs.map((name) => inputs[name])];
}

async function runJurassicBuild(input, options = {}) {
  const log = options.onLog || (() => {});
  const workRoot = options.workspaceRoot;
  if (!path.isAbsolute(workRoot || '')) throw new Error('Choose an absolute PC build folder in VR4ALL');
  const root = path.join(workRoot, 'jurassic-park-arcade-vr');
  const source = path.join(root, 'source');
  const relative = path.relative(input.gamePackage, root);
  if (!relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('The PC build folder must be outside the owned game folder');
  await fs.mkdir(root, { recursive: true });
  const space = await fs.statfs(root);
  const freeBytes = options.freeBytes ?? space.bavail * space.bsize;
  if (freeBytes < 15 * 1024 ** 3 && !await regularFile(path.join(source, 'tools', 'quest', 'out', 'jp2015vr.apk'))) {
    throw new Error('Jurassic Park first build needs about 15 GB free in the selected PC build folder. Choose a drive with more space.');
  }
  const tools = await (options.findTools || findTools)(workRoot, options.adbPath, options.sharedToolsRoot);
  const env = { ...process.env, PATH: `${path.dirname(tools.python)};${process.env.PATH || ''}`, ANDROID_SERIAL: input.serial,
    VR4ALL_SDK_WIN: tools.sdk, VR4ALL_JAVA_WIN: tools.javaHome, VR4ALL_ADB_WIN: tools.adb, GIT_TERMINAL_PROMPT: '0', JOBS: String(Math.max(1, Math.min(8, os.cpus().length - 1))) };
  const run = options.runProgram || runProgram;
  const gitExec = options.gitExec || exec;
  if (await fs.stat(path.join(source, '.git')).catch(() => null)) {
    const { stdout } = await gitExec(tools.git, ['-C', source, 'remote', 'get-url', 'origin'], { windowsHide: true });
    if (stdout.trim().replace(/\.git$/, '').toLowerCase() !== repo.replace(/\.git$/, '').toLowerCase()) throw new Error('Jurassic Park source cache points to an unexpected repository');
    log('Refreshing the official Jurassic Park source. Personal build files and signing key stay in place.');
    await run(tools.git, ['-C', source, 'fetch', '--depth=1', 'origin', 'main'], { cwd: root, env, log });
    await run(tools.git, ['-C', source, 'checkout', '--detach', 'FETCH_HEAD'], { cwd: root, env, log });
  } else {
    if ((await fs.readdir(source).catch(() => [])).length) throw new Error('Jurassic Park source cache exists but is not a Git checkout. Choose a different PC build folder.');
    log('Downloading the official Jurassic Park source.');
    await run(tools.git, ['clone', '--depth=1', '--branch', 'main', repo, source], { cwd: root, env, log });
  }
  const { stdout } = await gitExec(tools.git, ['-C', source, 'rev-parse', 'HEAD'], { windowsHide: true });
  const sha = stdout.trim();
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Official Jurassic Park source returned an invalid commit');
  for (const step of jurassicBuildSteps()) {
    if (!await regularFile(path.join(source, step.script))) throw new Error(`Official Jurassic Park source is missing ${step.script}`);
    if (step.script === 'tools/quest/install.sh' && !await regularFile(path.join(source, 'tools', 'quest', 'out', 'jp2015vr.apk'))) {
      throw new Error('The creator build produced no Quest APK');
    }
    log(`Running the creator's ${step.script} (${sha.slice(0, 12)}).`);
    await run(tools.bash, bashArgs(step, input), { cwd: source, env, log, timeout: step.script === 'tools/build_all.sh' ? 3 * 60 * 60 * 1000 : 60 * 60 * 1000 });
  }
  const base = `/sdcard/Android/data/${packageId}/files`;
  const testData = (file) => run(tools.adb, ['-s', input.serial, 'shell', 'test', '-f', file], { env, log, timeout: 30000 });
  try {
    await testData(`${base}/game/game`);
    await testData(`${base}/libs/libPhysXCore.so`);
  } catch {
    try { await testData(`${base}/data.tar`); log('Game data is staged as data.tar; launch the game once to unpack it.'); }
    catch { throw new Error('The creator installer returned success, but game data was not found on the selected Quest'); }
  }
  return { sha, packageId };
}

module.exports = { validateJurassicInput, resolvePhysxFolder, requiredPhysxFiles: Object.keys(physx), jurassicBuildSteps, runJurassicBuild, bashArgs };
