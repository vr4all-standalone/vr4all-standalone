const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { extractZipSafely } = require('./harry-potter-runner');
const { withShortBuildPath } = require('./build-path');
const { buildEnvironment } = require('./build-environment');
const { withSharedBuildTools, findSharedJavaHome } = require('./shared-build-tools');

const repo = 'dubrovskiy-yevhen-stakelogic/vice-city-vr-quest';
const gameDirs = ['data', 'TEXT', 'anim', 'txd', 'skins', 'mp3', 'movies', 'models', 'Audio'];
const maxSourceBytes = 250 * 1024 ** 2;

function signalWithTimeout(signal, milliseconds) {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function completeGameFolder(folder) {
  const stat = await fsp.lstat(folder).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return false;
  const entries = await fsp.readdir(folder, { withFileTypes: true });
  const found = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
  for (const name of gameDirs) {
    const entry = found.get(name.toLowerCase());
    if (!entry?.isDirectory() || entry.isSymbolicLink()) return name;
  }
  return true;
}

async function validateViceCityInput(input) {
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Choose a connected Quest serial');
  const gamePackage = input?.gamePackage;
  if (typeof gamePackage !== 'string' || !path.isAbsolute(gamePackage) || gamePackage.length > 4096) {
    throw new Error('Choose an absolute owned Vice City PC folder or ZIP');
  }
  const stat = await fsp.lstat(gamePackage).catch(() => null);
  if (!stat || stat.isSymbolicLink()) throw new Error('Owned Vice City folder or ZIP does not exist or is a link');
  if (stat.isDirectory()) {
    const valid = await completeGameFolder(gamePackage);
    if (valid !== true) throw new Error(`Complete PC installation requires the ${valid || 'game data'} folder`);
    return { gamePackage: path.resolve(gamePackage), serial: input.serial, kind: 'directory' };
  }
  if (!stat.isFile() || !stat.size || path.extname(gamePackage).toLowerCase() !== '.zip') {
    throw new Error('Choose a nonempty owned Vice City PC folder or ZIP');
  }
  return { gamePackage: path.resolve(gamePackage), serial: input.serial, kind: 'zip' };
}

async function resolveCommit(fetchImpl, signal) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'VR4All-vice-city-builder' };
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/commits/master`, {
    headers, signal: signalWithTimeout(signal, 20000),
  });
  let sha;
  if (response.ok) {
    const body = await response.json();
    sha = body?.sha;
  } else if ([403, 429].includes(response.status)) {
    const refs = await fetchImpl(`https://github.com/${repo}/info/refs?service=git-upload-pack`, {
      headers: { 'User-Agent': 'VR4All-vice-city-builder' }, signal: signalWithTimeout(signal, 20000),
    });
    if (!refs.ok) throw new Error(`Could not check official Vice City source (${response.status}; Git reference ${refs.status})`);
    const advertised = await refs.text();
    if (advertised.length > 1024 * 1024) throw new Error('Official Git reference response is unexpectedly large');
    sha = advertised.match(/([a-f0-9]{40}) refs\/heads\/master(?:\n|\r|$)/i)?.[1];
  } else throw new Error(`Could not check official Vice City source (${response.status})`);
  if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('Official source returned an invalid commit SHA');
  return sha.toLowerCase();
}

async function downloadSource(fetchImpl, sha, target, signal) {
  const response = await fetchImpl(`https://codeload.github.com/${repo}/zip/${sha}`, {
    headers: { 'User-Agent': 'VR4All-vice-city-builder' }, signal: signalWithTimeout(signal, 5 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error(`Official Vice City source download failed (${response.status})`);
  let bytes = 0;
  const limit = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    done(bytes > maxSourceBytes ? new Error('Official Vice City source archive is unexpectedly large') : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(target, { flags: 'wx' }), { signal });
  if (!bytes) throw new Error('Official Vice City source archive is empty');
}

async function checkKit(directory) {
  for (const relative of ['BUILD_AND_INSTALL.bat', 'tools/build-and-install.ps1', 'overlay/android/app/build.gradle.kts']) {
    const file = path.join(directory, ...relative.split('/'));
    const stat = await fsp.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`Official Vice City source archive is missing ${relative}`);
  }
  const scriptBytes = await fsp.readFile(path.join(directory, 'tools', 'build-and-install.ps1'));
  const script = scriptBytes.toString('utf8');
  if (!/\$Serial\b/.test(script) || !/\$NonInteractive\b/.test(script) || !/\$GameDir\b/.test(script)) {
    throw new Error('Official Vice City build script does not support safe unattended installation');
  }
  return crypto.createHash('sha256').update(scriptBytes).digest('hex');
}

async function hashKitTree(directory) {
  const digest = crypto.createHash('sha256');
  let files = 0;
  async function visit(folder, prefix) {
    const entries = (await fsp.readdir(folder, { withFileTypes: true }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Vice City source cache contains a link');
      if (entry.isDirectory()) {
        digest.update(`D${relative.length}:${relative}\0`);
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        files++;
        if (files > 10000) throw new Error('Vice City source cache contains too many files');
        const stat = await fsp.lstat(absolute);
        digest.update(`F${relative.length}:${relative}:${stat.size}:`);
        for await (const chunk of fs.createReadStream(absolute)) digest.update(chunk);
        digest.update('\0');
      } else throw new Error('Vice City source cache contains an unsupported entry');
    }
  }
  await visit(directory, '');
  return digest.digest('hex');
}

async function acquireViceCitySource(cacheRoot, log = () => {}, options = {}) {
  if (typeof cacheRoot !== 'string' || !path.isAbsolute(cacheRoot)) throw new Error('Vice City source cache needs an absolute path');
  const fetchImpl = options.fetchImpl || fetch;
  const signal = options.signal;
  const sha = await resolveCommit(fetchImpl, signal);
  const profileRoot = path.join(cacheRoot, 'vice-city-vr');
  const finalRoot = path.join(profileRoot, sha);
  const kitDir = path.join(finalRoot, `vice-city-vr-quest-${sha}`);
  const marker = path.join(finalRoot, '.vr4all-complete');
  const saved = await fsp.readFile(marker, 'utf8').catch(() => null);
  if (saved) {
    let metadata;
    try { metadata = JSON.parse(saved); } catch { throw new Error('Vice City source cache marker is invalid'); }
    if (metadata.repo !== repo || metadata.sha !== sha || !/^[a-f0-9]{64}$/.test(metadata.treeSha256 || '')) {
      throw new Error('Vice City source cache marker is invalid');
    }
    await checkKit(kitDir);
    const actual = await hashKitTree(kitDir);
    if (actual !== metadata.treeSha256) throw new Error('Vice City source cache failed SHA-256 verification');
    log(`Using cached official Vice City source at ${sha.slice(0, 12)}.`);
    return { sha, directory: kitDir, repo };
  }
  if (await fsp.lstat(finalRoot).catch(() => null)) {
    throw new Error('Vice City source cache is incomplete; remove that cache entry before retrying');
  }
  await fsp.mkdir(profileRoot, { recursive: true });
  const stage = await fsp.mkdtemp(path.join(profileRoot, '.download-'));
  try {
    log(`Downloading official Vice City source at commit ${sha.slice(0, 12)}.`);
    const archive = path.join(stage, 'source.zip');
    await downloadSource(fetchImpl, sha, archive, signal);
    const extracted = path.join(stage, 'extracted');
    await extractZipSafely(archive, extracted, { signal });
    const entries = await fsp.readdir(extracted, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].name !== `vice-city-vr-quest-${sha}`) {
      throw new Error('Official Vice City source archive has an unexpected commit layout');
    }
    const unpackedKit = path.join(extracted, entries[0].name);
    await checkKit(unpackedKit);
    const treeSha256 = await hashKitTree(unpackedKit);
    await fsp.writeFile(path.join(extracted, '.vr4all-complete'), JSON.stringify({ repo, sha, treeSha256 }), { flag: 'wx' });
    await fsp.rename(extracted, finalRoot);
    return { sha, directory: kitDir, repo };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
}

async function locateGameRoot(folder) {
  if (await completeGameFolder(folder) === true) return folder;
  const entries = await fsp.readdir(folder, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
  if (folders.length === 1) {
    const candidate = path.join(folder, folders[0].name);
    if (await completeGameFolder(candidate) === true) return candidate;
  }
  throw new Error('Owned ZIP must contain a complete Vice City PC installation with data, TEXT, anim, txd, skins, mp3, movies, models and Audio');
}

function runAuthorScript(input, kit, workDir, log, options = {}) {
  return (options.withBuildPath || withShortBuildPath)(workDir, (shortPath) => runAuthorScriptAtPath(input, kit, shortPath, log, options), log, options);
}

async function runAuthorScriptAtPath(input, kit, workDir, log, options) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(kit.directory, 'tools', 'build-and-install.ps1'),
    '-GameDir', input.gamePath, '-Serial', input.serial, '-NonInteractive', '-WorkDir', workDir,
    '-AndroidSdk', path.join(workDir, '.android-sdk')];
  const javaHome = await findSharedJavaHome(workDir);
  if (javaHome) args.push('-JavaHome', javaHome);
  const spawnImpl = options.spawnImpl || spawn;
  return new Promise((resolve, reject) => {
    let child;
    try {
      // The desktop UI captures the author's diagnostics and supplies -LogPath if needed;
      // invoking the internal script avoids the BAT wrapper's intentionally blocking pause.
      child = spawnImpl('powershell.exe', args, {
        cwd: kit.directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal, env: buildEnvironment(workDir),
      });
    } catch (error) { reject(error); return; }
    const recent = [];
    const recorder = () => {
      let pending = '';
      return {
        record(chunk) {
          pending += String(chunk);
          const lines = pending.split(/\r?\n/);
          pending = (lines.pop() || '').slice(-1000);
          for (const line of lines) if (line.trim()) {
            const clean = line.trim().slice(0, 500);
            recent.push(clean); if (recent.length > 12) recent.shift();
            log(clean);
          }
        },
        flush() { if (pending.trim()) {
          const clean = pending.trim().slice(0, 500);
          recent.push(clean); if (recent.length > 12) recent.shift();
          log(clean);
        } },
      };
    };
    const stdout = recorder(), stderr = recorder();
    child.stdout.on('data', (chunk) => stdout.record(chunk));
    child.stderr.on('data', (chunk) => stderr.record(chunk));
    // AbortSignal can emit error while the child still has live stdio handles.
    // Keep the short drive mapped until close, including on spawn failure.
    let processError;
    child.once('error', (error) => { processError = error; });
    child.once('close', (code) => {
      stdout.flush(); stderr.flush();
      if (processError) reject(processError);
      else if (code === 0) resolve({ exitCode: 0, sha: kit.sha });
      else reject(new Error(`Official Vice City build and install failed (exit ${code}). ${recent.join(' ').slice(-1800)}`));
    });
  });
}

async function runViceCityBuild(input, roots, log = () => {}, options = {}) {
  const validated = await validateViceCityInput(input);
  if (!roots || typeof roots.workRoot !== 'string' || !path.isAbsolute(roots.workRoot)) {
    throw new Error('Vice City build needs an absolute work path');
  }
  const signal = input?.signal || options.signal;
  signal?.throwIfAborted();
  const kit = await acquireViceCitySource(roots.cacheRoot, log, { ...options, signal });
  const workDir = path.join(roots.workRoot, 'vice-city-vr');
  const tempRoot = options.tempRoot || path.join(workDir, '.tmp');
  await fsp.mkdir(tempRoot, { recursive: true });
  let gameStage;
  try {
    let gamePath = validated.gamePackage;
    if (validated.kind === 'zip') {
      gameStage = await fsp.mkdtemp(path.join(tempRoot, 'vr4all-vice-city-game-'));
      log('Inspecting and extracting your owned Vice City ZIP locally.');
      gamePath = await locateGameRoot(await extractZipSafely(validated.gamePackage, path.join(gameStage, 'game'), { signal }));
    }
    await fsp.mkdir(workDir, { recursive: true });
    log(`Building from ${kit.repo} commit ${kit.sha.slice(0, 12)} for Quest ${validated.serial}.`);
    return await withSharedBuildTools(workDir, () => runAuthorScript({ gamePath, serial: validated.serial }, kit, workDir, log, { ...options, signal }), log);
  } finally {
    if (gameStage) await fsp.rm(gameStage, { recursive: true, force: true });
  }
}

module.exports = { validateViceCityInput, acquireViceCitySource, runViceCityBuild };
