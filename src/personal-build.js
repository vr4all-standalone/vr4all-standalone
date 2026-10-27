const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWriteStream } = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile, spawn } = require('node:child_process');
const { withShortBuildPath } = require('./build-path');
const { buildEnvironment } = require('./build-environment');
const { withSharedBuildTools, findSharedJavaHome } = require('./shared-build-tools');
const { convertArchiveToZip, removeConversionDirectory } = require('./archive-conversion');
const { withRdrGameData } = require('./rdr-game-data');

const profiles = Object.freeze({
  'gta-sa-vr': Object.freeze({ repo: 'dubrovskiy-yevhen-stakelogic/gta-sa-vr-quest', audio: true }),
  'rdr1-vr': Object.freeze({ repo: 'dubrovskiy-yevhen-stakelogic/rdr1-quest', audio: false }),
});
const gameExtensions = new Set(['.apk', '.apks', '.zip', '.xapk', '.apkm', '.7z', '.rar']);
const audioExtensions = new Set(['.7z', '.zip', '.rar']);

function profileFor(gameId) {
  const profile = profiles[gameId];
  if (!profile) throw new Error('This game has no supported personal build profile');
  return profile;
}

async function checkInputPath(value, label, extensions) {
  if (typeof value !== 'string' || !value || value.length > 4096 || !path.isAbsolute(value)) throw new Error(`Choose a local ${label} path`);
  const stat = await fs.stat(value).catch(() => null);
  if (!stat || !stat.isFile() && !stat.isDirectory()) throw new Error(`${label} path does not exist`);
  if (stat.isFile() && (!stat.size || !extensions.has(path.extname(value).toLowerCase()))) throw new Error(`${label} must be a supported APK or archive, or choose its export folder`);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(value);
    if (!entries.length) throw new Error(`${label} folder is empty`);
    if (label === 'game export' && !entries.some((name) => name.toLowerCase() === 'base.apk')) throw new Error('Game export folder needs base.apk and its companion files');
  }
  return path.resolve(value);
}

async function validatePersonalBuildInput(gameId, input) {
  const profile = profileFor(gameId);
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  const gamePackage = await checkInputPath(input.gamePackage, 'game export', gameExtensions);
  const audioSource = profile.audio ? await checkInputPath(input.audioSource, 'audio source', audioExtensions)
    : gameId === 'rdr1-vr' && input.audioSource ? await checkInputPath(input.audioSource, 'additional RDR game data', gameExtensions) : null;
  return { gamePackage, audioSource, serial: input.serial };
}

function buildPowerShellArgs(gameId, input, kitDir, workDir) {
  const profile = profileFor(gameId);
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(kitDir, 'tools', 'build-and-install.ps1'), '-GamePackage', input.gamePackage];
  if (profile.audio) args.push('-AudioSource', input.audioSource);
  args.push('-WorkDir', workDir, '-Serial', input.serial, '-NonInteractive');
  return args;
}

function extractZip(zipPath, destination) {
  return new Promise((resolve, reject) => execFile('tar.exe', ['-xf', zipPath, '-C', destination], { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message)) : resolve()));
}

async function downloadZip(response, target) {
  if (!response.ok || !response.body) throw new Error(`Official source download failed (${response.status})`);
  let bytes = 0;
  const limit = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    done(bytes > 250 * 1024 ** 2 ? new Error('Official source archive is unexpectedly large') : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(target, { flags: 'wx' }));
  if (!bytes) throw new Error('Official source archive is empty');
}

async function acquireSourceKit(gameId, cacheRoot, log = () => {}, options = {}) {
  const { repo } = profileFor(gameId);
  const fetchImpl = options.fetchImpl || fetch;
  const extract = options.extract || extractZip;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'VR4All-personal-builder' };
  const commitResponse = await fetchImpl(`https://api.github.com/repos/${repo}/commits/main`, { headers, signal: AbortSignal.timeout(20000) });
  let sha;
  if (commitResponse.ok) ({ sha } = await commitResponse.json());
  else if ([403, 429].includes(commitResponse.status)) {
    log('GitHub API is rate limited; checking the public main-branch Git reference.');
    const refResponse = await fetchImpl(`https://github.com/${repo}/info/refs?service=git-upload-pack`, { headers: { 'User-Agent': 'VR4All-personal-builder' }, signal: AbortSignal.timeout(20000) });
    if (!refResponse.ok) throw new Error(`Could not check official ${repo} source (${commitResponse.status}; Git reference ${refResponse.status})`);
    const advertised = await refResponse.text();
    if (advertised.length > 1024 * 1024) throw new Error('Official Git reference response is unexpectedly large');
    sha = advertised.match(/([a-f0-9]{40}) refs\/heads\/main(?:\n|\r|$)/i)?.[1];
  } else throw new Error(`Could not check official ${repo} source (${commitResponse.status})`);
  if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('Official source returned an invalid commit SHA');
  const profileRoot = path.join(cacheRoot, gameId);
  const extractRoot = path.join(profileRoot, sha.toLowerCase());
  const marker = path.join(extractRoot, '.vr4all-complete');
  const existing = (await fs.readdir(extractRoot, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory());
  if ((await fs.stat(marker).catch(() => null))?.isFile() && existing.length === 1) {
    const directory = path.join(extractRoot, existing[0].name);
    if ((await fs.stat(path.join(directory, 'tools', 'build-and-install.ps1')).catch(() => null))?.isFile()) return { sha, directory, repo };
  }
  await fs.mkdir(profileRoot, { recursive: true });
  const unique = crypto.randomUUID();
  const zipPath = path.join(profileRoot, `${sha}-${unique}.zip`);
  try {
    log(`Downloading official ${repo} source at ${sha.slice(0, 12)}...`);
    const response = await fetchImpl(`https://codeload.github.com/${repo}/zip/${sha}`, { headers: { 'User-Agent': 'VR4All-personal-builder' }, signal: AbortSignal.timeout(5 * 60 * 1000) });
    await downloadZip(response, zipPath);
    if ((await fs.stat(extractRoot).catch(() => null))?.isDirectory()) await fs.rm(extractRoot, { recursive: true, force: true });
    await fs.mkdir(extractRoot, { recursive: true });
    await extract(zipPath, extractRoot);
    const folders = (await fs.readdir(extractRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    if (folders.length !== 1) throw new Error('Official source archive has an unexpected layout');
    const sourceRoot = path.join(extractRoot, folders[0].name);
    if (!(await fs.stat(path.join(sourceRoot, 'tools', 'build-and-install.ps1')).catch(() => null))?.isFile()) throw new Error('Official source archive is missing its build script');
    await fs.writeFile(marker, `${repo}\n${sha}\n`);
    return { sha, directory: sourceRoot, repo };
  } finally {
    await fs.rm(zipPath, { force: true }).catch(() => {});
  }
}

function runAuthorScript(gameId, input, kitDir, workDir, log = () => {}, options = {}) {
  return (options.withBuildPath || withShortBuildPath)(workDir, (shortPath) => runAuthorScriptAtPath(gameId, input, kitDir, shortPath, log, options), log, options);
}

async function runAuthorScriptAtPath(gameId, input, kitDir, workDir, log, options) {
  const spawnImpl = options.spawnImpl || spawn;
  const args = buildPowerShellArgs(gameId, input, kitDir, workDir);
  const javaHome = await findSharedJavaHome(workDir);
  // Explicit tool locations keep every author build on the same installed SDK.
  args.splice(6, 0, '-AndroidSdk', path.join(workDir, '.android-sdk'), ...(javaHome ? ['-JavaHome', javaHome] : []));
  return new Promise((resolve, reject) => {
    const child = spawnImpl('powershell.exe', args, { cwd: kitDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: buildEnvironment(workDir) });
    let authorError = '';
    const recordLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      log(trimmed.slice(0, 500));
      if (/^(?:ERROR|FAILED):\s*\S/i.test(trimmed)) authorError = trimmed.replace(/^(?:ERROR|FAILED):\s*/i, '').slice(0, 1000);
    };
    const streamRecorder = () => {
      let tail = '';
      return {
        record: (chunk) => {
          tail += String(chunk);
          const lines = tail.split(/\r?\n/);
          tail = lines.pop() || '';
          for (const line of lines) recordLine(line);
        },
        flush: () => recordLine(tail),
      };
    };
    const stdout = streamRecorder();
    const stderr = streamRecorder();
    child.stdout.on('data', stdout.record);
    child.stderr.on('data', stderr.record);
    let processError;
    child.once('error', (error) => { processError = error; });
    child.once('close', (code) => {
      stdout.flush(); stderr.flush();
      if (processError) reject(processError);
      else code === 0 ? resolve() : reject(new Error(`Official build and install failed (exit ${code})${authorError ? `: ${authorError}` : "; see activity for the author's error"}`));
    });
  });
}

async function withCompatibleGamePackage(source, tempRoot, operation, log = () => {}, options = {}) {
  const extension = path.extname(source).toLowerCase();
  if (!(await fs.stat(source)).isFile() || !['.apkm', '.7z', '.rar'].includes(extension)) return operation(source);
  if (!path.isAbsolute(tempRoot)) throw new Error('Game preparation needs an absolute temporary folder');
  let prepared;
  try {
    if (extension === '.apkm') {
      // APKM contains the same base/split APKs as APKS. The author reads ZIPs
      // without modifying them, so a private hard link avoids a multi-GB copy.
      log('Preparing APKM as ZIP for the official builder.');
      await fs.mkdir(tempRoot, { recursive: true });
      const directory = await fs.mkdtemp(path.join(tempRoot, 'vr4all-convert-'));
      prepared = { path: path.join(directory, 'game.zip'), directory };
      try { await (options.linkFile || fs.link)(source, prepared.path); }
      catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
        log('This drive needs a temporary copy of the APKM in the selected build folder.');
        await fs.copyFile(source, prepared.path);
      }
    } else {
      log(`Converting ${extension} game archive to ZIP in the selected build folder.`);
      prepared = await convertArchiveToZip(source, { tempRoot });
    }
    return await operation(prepared.path);
  } finally {
    if (prepared) await removeConversionDirectory(prepared.directory, tempRoot);
  }
}

async function runPersonalBuild(gameId, input, roots, log = () => {}, options = {}) {
  const kit = await acquireSourceKit(gameId, roots.cacheRoot, log, options);
  const workDir = path.join(roots.workRoot, gameId);
  await fs.mkdir(path.join(workDir, '.tmp'), { recursive: true });
  log(`Building from ${kit.repo} commit ${kit.sha.slice(0, 12)} for Quest ${input.serial}.`);
  await withSharedBuildTools(workDir, () => withCompatibleGamePackage(input.gamePackage, path.join(workDir, '.tmp'),
    (gamePackage) => gameId === 'rdr1-vr' ? withRdrGameData({ ...input, gamePackage }, path.join(workDir, '.tmp'),
      (completePackage) => runAuthorScript(gameId, { ...input, gamePackage: completePackage }, kit.directory, workDir, log, options), log)
      : runAuthorScript(gameId, { ...input, gamePackage }, kit.directory, workDir, log, options), log, options), log);
  return kit;
}

module.exports = { profiles, validatePersonalBuildInput, buildPowerShellArgs, acquireSourceKit, runAuthorScript, runPersonalBuild, withCompatibleGamePackage };
