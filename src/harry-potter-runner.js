const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createInflateRaw } = require('node:zlib');
const { findAdb } = require('./adb');

const repo = 'dubrovskiy-yevhen-stakelogic/harry-potter-vr';
const maxZipBytes = 2 * 1024 ** 3;
const maxExpandedBytes = 8 * 1024 ** 3;
const maxEntries = 5000;
const requiredGameDirs = ['maps', 'textures', 'sounds', 'music', 'system'];

function crc32(bytes, seed = 0xffffffff) {
  let crc = seed;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
}

function safeZipName(raw) {
  const normalized = raw.replace(/\\/g, '/');
  const name = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const parts = name.split('/');
  if (!name || name.length > 4096 || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
    || parts.some((part) => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part)
      || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`ZIP contains an unsafe path: ${raw.slice(0, 120)}`);
  }
  return { name, isDirectory: normalized.endsWith('/') };
}

async function readAt(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await handle.read(buffer, read, length - read, position + read);
    if (!result.bytesRead) throw new Error('ZIP archive is truncated');
    read += result.bytesRead;
  }
  return buffer;
}

async function inspectZip(archive, maxBytes) {
  const handle = await fsp.open(archive, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22 || size > maxBytes) throw new Error('ZIP archive is empty or too large');
    const tailLength = Math.min(size, 65557);
    const tail = await readAt(handle, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP archive has no valid directory');
    const count = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
    if (!count || count > maxEntries || tail.readUInt16LE(eocd + 8) !== count) throw new Error('ZIP entry count exceeds the limit or is invalid');
    if (tail.readUInt16LE(eocd + 4) || tail.readUInt16LE(eocd + 6)) throw new Error('Multi-disk ZIP archives are not supported');
    if (directorySize > 32 * 1024 ** 2 || directoryOffset + directorySize > size - tailLength + eocd) throw new Error('ZIP directory is invalid or too large');
    const directory = await readAt(handle, directorySize, directoryOffset);
    const entries = [];
    const names = new Set();
    let position = 0;
    let expanded = 0;
    for (let i = 0; i < count; i++) {
      if (position + 46 > directory.length || directory.readUInt32LE(position) !== 0x02014b50) throw new Error('ZIP directory is invalid');
      const flags = directory.readUInt16LE(position + 8);
      const method = directory.readUInt16LE(position + 10);
      const crc = directory.readUInt32LE(position + 16);
      const packedSize = directory.readUInt32LE(position + 20);
      const size = directory.readUInt32LE(position + 24);
      const nameLength = directory.readUInt16LE(position + 28);
      const extraLength = directory.readUInt16LE(position + 30);
      const commentLength = directory.readUInt16LE(position + 32);
      const external = directory.readUInt32LE(position + 38);
      const localOffset = directory.readUInt32LE(position + 42);
      const madeBy = directory.readUInt16LE(position + 4) >>> 8;
      if (packedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64 entries are not supported');
      if (flags & 1 || flags & 0x40 || ![0, 8].includes(method)) throw new Error('ZIP uses unsupported encryption or compression');
      if (position + 46 + nameLength + extraLength + commentLength > directory.length) throw new Error('ZIP directory is truncated');
      const nameBytes = directory.subarray(position + 46, position + 46 + nameLength);
      if (!(flags & 0x800) && nameBytes.some((byte) => byte > 127)) throw new Error('ZIP uses an unsupported text encoding');
      const raw = nameBytes.toString('utf8');
      if (!Buffer.from(raw, 'utf8').equals(nameBytes)) throw new Error('ZIP entry name is not valid UTF-8');
      const { name, isDirectory } = safeZipName(raw);
      const key = name.toLowerCase();
      if (names.has(key)) throw new Error('ZIP contains duplicate paths');
      names.add(key);
      const unixType = madeBy === 3 ? ((external >>> 16) & 0xf000) : 0;
      if ((unixType && unixType !== 0x8000 && unixType !== 0x4000) || (external & 0x400)) throw new Error('ZIP contains a link or unsupported file type');
      if (isDirectory && (packedSize || size || unixType === 0x8000)) throw new Error('ZIP has an invalid directory entry');
      expanded += size;
      if (expanded > maxBytes) throw new Error('ZIP expands beyond the size limit');
      if (localOffset + 30 > directoryOffset) throw new Error('ZIP local entry is invalid');
      const local = await readAt(handle, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method) throw new Error('ZIP local entry disagrees with directory');
      const localNameLength = local.readUInt16LE(26);
      const dataOffset = localOffset + 30 + localNameLength + local.readUInt16LE(28);
      if (dataOffset + packedSize > directoryOffset) throw new Error('ZIP entry overlaps its directory');
      const localName = await readAt(handle, localNameLength, localOffset + 30);
      if (localName.toString('utf8') !== raw) throw new Error('ZIP local entry name disagrees with directory');
      entries.push({ name, isDirectory, method, crc, size, packedSize, dataOffset });
      position += 46 + nameLength + extraLength + commentLength;
    }
    if (position !== directory.length) throw new Error('ZIP directory has unexpected data');
    return entries;
  } finally { await handle.close(); }
}

async function extractZipSafely(archive, destination, { maxBytes = maxExpandedBytes, signal } = {}) {
  signal?.throwIfAborted();
  if ((await fsp.lstat(destination).catch(() => null))) throw new Error('ZIP extraction destination already exists');
  const entries = await inspectZip(archive, maxBytes);
  await fsp.mkdir(destination, { recursive: true });
  try {
    for (const entry of entries) {
      signal?.throwIfAborted();
      const target = path.join(destination, ...entry.name.split('/'));
      if (entry.isDirectory) { await fsp.mkdir(target, { recursive: true }); continue; }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      let bytes = 0;
      let crc = 0xffffffff;
      const verify = new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > entry.size) return done(new Error('ZIP entry expands beyond its declared size'));
        crc = crc32(chunk, crc);
        done(null, chunk);
      } });
      const source = entry.packedSize ? fs.createReadStream(archive, { start: entry.dataOffset, end: entry.dataOffset + entry.packedSize - 1 }) : Readable.from([]);
      const output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
      if (entry.method === 8) await pipeline(source, createInflateRaw(), verify, output, { signal });
      else await pipeline(source, verify, output, { signal });
      if (bytes !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw new Error(`ZIP entry failed size or CRC verification: ${entry.name}`);
    }
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
  return destination;
}

function validateRelease(release) {
  if (release?.stale) throw new Error('The release metadata is stale; refresh it before installing');
  if (!/^sha256:[a-f0-9]{64}$/i.test(release?.digest || '')) throw new Error('The official player ZIP needs a SHA-256 digest');
  const version = /^v?(\d+\.\d+\.\d+(?:\.\d+)?)$/.exec(release?.tag || '')?.[1];
  if (!version || release.assetName !== `HPVR-Quest-${version}.zip`) throw new Error('Choose the official HPVR player release ZIP, not source code');
  const expected = `https://github.com/${repo}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(release.assetName)}`;
  if (release.downloadUrl !== expected) throw new Error('Choose an official Harry Potter VR release URL');
  if (release.size != null && (!Number.isSafeInteger(release.size) || release.size <= 0 || release.size > maxZipBytes)) throw new Error('Official release ZIP size is invalid or too large');
  return release;
}

async function downloadRelease(release, target, fetchImpl, signal) {
  signal?.throwIfAborted();
  const response = await fetchImpl(release.downloadUrl, { headers: { 'User-Agent': 'VR4All-player-installer' }, signal });
  if (!response.ok || !response.body) throw new Error(`Official player ZIP download failed (${response.status})`);
  let bytes = 0;
  const hash = crypto.createHash('sha256');
  const check = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    if (bytes > maxZipBytes) return done(new Error('Official player ZIP is too large'));
    hash.update(chunk);
    done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), check, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
  if (release.size && bytes !== release.size) throw new Error('Official player ZIP size does not match release metadata');
  if (`sha256:${hash.digest('hex')}` !== release.digest.toLowerCase()) throw new Error('Official player ZIP SHA-256 digest does not match release metadata');
}

async function findSingleRoot(base, predicate, label) {
  let current = base;
  for (let depth = 0; depth < 4; depth++) {
    if (await predicate(current)) return current;
    const children = (await fsp.readdir(current, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
    if (children.length !== 1) break;
    current = path.join(current, children[0].name);
  }
  throw new Error(`${label} has no single supported root folder`);
}

async function isGameRoot(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const dirs = new Set(entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name.toLowerCase()));
  return requiredGameDirs.every((name) => dirs.has(name));
}

async function findGameRoot(gamePath) {
  const stat = await fsp.lstat(gamePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error('Choose an existing regular game folder or ZIP');
  if (!stat.isDirectory()) throw new Error('Choose a ZIP archive or extracted game folder');
  return findSingleRoot(gamePath, isGameRoot, 'Owned US PC game');
}

async function findBundleRoot(directory) {
  return findSingleRoot(directory, async (candidate) => {
    const script = await fsp.lstat(path.join(candidate, 'tools', 'INSTALL-HPVR.ps1')).catch(() => null);
    const manifestFile = await fsp.lstat(path.join(candidate, 'release-manifest.json')).catch(() => null);
    if (!script?.isFile() || script.isSymbolicLink() || !manifestFile?.isFile() || manifestFile.isSymbolicLink()) return false;
    let manifest;
    try { manifest = JSON.parse(await fsp.readFile(path.join(candidate, 'release-manifest.json'), 'utf8')); } catch { return false; }
    if (manifest.schema !== 1 || manifest.packageName !== 'io.github.hpvr.quest' || !/^[A-Za-z0-9_.-]+\.apk$/.test(manifest.apk || '')) return false;
    const apk = await fsp.lstat(path.join(candidate, manifest.apk)).catch(() => null);
    return apk?.isFile() && !apk.isSymbolicLink();
  }, 'Official player ZIP');
}

async function adbExecutable(explicit) {
  const candidate = explicit || findAdb();
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('ADB is required for unattended setup; configure Android Platform Tools in VR4All');
  const stat = await fsp.lstat(candidate).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('ADB path must point to an existing regular executable');
  return candidate;
}

function runInstaller(bundleRoot, gameRoot, serial, adbPath, onLog, signal, spawnImpl) {
  const script = path.join(bundleRoot, 'tools', 'INSTALL-HPVR.ps1');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-GamePath', gameRoot, '-DeviceSerial', serial, '-AdbPath', adbPath];
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawnImpl('powershell.exe', args, { cwd: bundleRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let completed = false;
    let success = false;
    const buffers = new Map();
    const record = (stream) => (chunk) => {
      const lines = ((buffers.get(stream) || '') + String(chunk)).split(/\r?\n/);
      buffers.set(stream, lines.pop());
      for (const line of lines) {
        const message = line.trim().slice(0, 1000);
        if (!message) continue;
        if (/^INSTALL=PASS DATA_IMPORT=PASS\b/.test(message)) success = true;
        onLog(message);
      }
    };
    child.stdout.on('data', record('stdout'));
    child.stderr.on('data', record('stderr'));
    const abort = () => child.kill?.();
    signal?.addEventListener('abort', abort, { once: true });
    const finish = (error, code) => {
      if (completed) return;
      completed = true;
      signal?.removeEventListener('abort', abort);
      for (const rest of buffers.values()) {
        const message = rest.trim().slice(0, 1000);
        if (message) { if (/^INSTALL=PASS DATA_IMPORT=PASS\b/.test(message)) success = true; onLog(message); }
      }
      if (signal?.aborted) reject(signal.reason || new Error('Installation cancelled'));
      else if (error) reject(error);
      else if (code !== 0) reject(new Error(`Official Harry Potter VR installer failed (exit ${code}); see activity for details`));
      else if (!success) reject(new Error('Official installer did not report INSTALL=PASS DATA_IMPORT=PASS success'));
      else resolve({ exitCode: 0 });
    };
    child.once('error', (error) => finish(error));
    child.once('close', (code) => finish(null, code));
  });
}

async function installHarryPotterPlayer(input, options = {}) {
  const release = validateRelease(input?.release);
  const serial = input?.serial;
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '')) throw new Error('Choose a connected Quest serial');
  const gamePath = input?.gamePath;
  if (typeof gamePath !== 'string' || !path.isAbsolute(gamePath)) throw new Error('Choose an absolute owned game folder or ZIP path');
  const signal = input.signal;
  signal?.throwIfAborted();
  const adbPath = await adbExecutable(input.adbPath);
  const stat = await fsp.lstat(gamePath).catch(() => null);
  if (!stat || stat.isSymbolicLink()) throw new Error('Choose an existing regular game folder or ZIP');
  if (stat.isFile() && path.extname(gamePath).toLowerCase() !== '.zip') throw new Error('Choose a ZIP archive or extracted game folder');
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('Choose a ZIP archive or extracted game folder');
  const tempRoot = options.tempRoot || os.tmpdir();
  const staging = await fsp.mkdtemp(path.join(tempRoot, 'vr4all-hpvr-'));
  const log = typeof input.onLog === 'function' ? input.onLog : () => {};
  try {
    let gameRoot;
    if (stat.isDirectory()) gameRoot = await findGameRoot(gamePath);
    else {
      log('Extracting your owned game ZIP locally.');
      gameRoot = await findGameRoot(await extractZipSafely(gamePath, path.join(staging, 'owned-game'), { signal }));
    }
    const archive = path.join(staging, 'player.zip');
    log('Downloading the official Harry Potter VR player ZIP.');
    await downloadRelease(release, archive, options.fetchImpl || fetch, signal);
    const bundleRoot = await findBundleRoot(await extractZipSafely(archive, path.join(staging, 'player'), { signal }));
    log('Preparing game data and installing with the author\'s Windows installer.');
    return await runInstaller(bundleRoot, gameRoot, serial, adbPath, log, signal, options.spawnImpl || spawn);
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { extractZipSafely, installHarryPotterPlayer };
