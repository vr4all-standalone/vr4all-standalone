const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { inspectSingleFileArchive, extractSingleFileArchive } = require('./archive-conversion');

const runFile = promisify(execFile);
const sectorBytes = 2352;
const payloadBytes = 2048;
const maxFiles = 2000;
const maxExtractedBytes = 512 * 1024 * 1024;
const criticalFiles = ['common/allsh.prm', 'textures/wiptitle.tim', 'track01/sky.prm'];
const checkedChds = new Map();

function isWipeoutDisc(source) { return ['.bin', '.cue', '.chd'].includes(path.extname(source || '').toLowerCase()); }
function isWipeoutArchive(source) { return ['.zip', '.7z', '.rar'].includes(path.extname(source || '').toLowerCase()); }

async function inspectWipeoutArchive(source) {
  for (const extension of ['.cue', '.chd', '.bin']) {
    const item = { kind: 'file', label: 'Wipeout disc', extensions: [extension], destination: '/sdcard/Download/' };
    try {
      const inspected = await inspectSingleFileArchive(item, source);
      return { item, member: inspected.member };
    } catch (error) {
      if (!/archive is missing/i.test(error.message)) throw error;
    }
  }
  throw new Error('Wipeout archive needs one CUE with its BIN, one CHD, or one BIN');
}

async function extractWipeoutArchive(source) {
  const { item } = await inspectWipeoutArchive(source);
  return extractSingleFileArchive(item, source);
}

async function inspectWipeoutFolder(source, workspace) {
  const entries = await fs.readdir(source, { withFileTypes: true });
  if (['common', 'textures', 'track01'].every((name) => entries.some((entry) => entry.name.toLowerCase() === name && entry.isDirectory()))) return null;
  for (const extension of ['.cue', '.chd', '.bin']) {
    const matches = entries.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === extension);
    if (matches.length > 1) throw new Error(`Choose one Wipeout ${extension.toUpperCase()} file from this folder`);
    if (matches.length === 1) {
      const selected = path.join(source, matches[0].name);
      return { path: selected, ...await inspectWipeoutDisc(selected, workspace) };
    }
  }
  return null;
}

async function chdmanPath() {
  const candidates = [process.env.VR4ALL_CHDMAN,
    process.resourcesPath && path.join(process.resourcesPath, 'chdman', 'chdman.exe'),
    path.join(__dirname, '..', 'vendor', 'chdman', 'chdman.exe'), 'chdman.exe'];
  for (const candidate of candidates.filter(Boolean)) {
    if (!path.isAbsolute(candidate) || (await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  throw new Error('VR4ALL needs chdman to read a Wipeout CHD');
}

async function runChdman(args) {
  try {
    return await runFile(await chdmanPath(), args, { windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`Could not read Wipeout CHD: ${String(error.stderr || error.stdout || error.message).trim().slice(0, 280)}`);
  }
}

async function resolveBin(source) {
  if (path.extname(source).toLowerCase() === '.bin') return { bin: source, firstSector: 0 };
  const cue = await fs.readFile(source, 'latin1');
  let file = null;
  let dataTrack = false;
  for (const line of cue.split(/\r?\n/)) {
    const selected = line.match(/^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+BINARY\s*$/i);
    if (selected) { file = selected[1] || selected[2]; dataTrack = false; continue; }
    const track = line.match(/^\s*TRACK\s+\d+\s+(\S+)/i);
    if (track) { dataTrack = /^(MODE1|MODE2)\/2352$/i.test(track[1]); continue; }
    const index = line.match(/^\s*INDEX\s+01\s+(\d+):(\d+):(\d+)/i);
    if (index && dataTrack && file) {
      if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw new Error('Wipeout CUE references a BIN outside its folder');
      const firstSector = Number(index[1]) * 4500 + Number(index[2]) * 75 + Number(index[3]);
      return { bin: path.resolve(path.dirname(source), file), firstSector };
    }
  }
  throw new Error('Wipeout CUE needs a MODE1/2352 or MODE2/2352 data track and its BIN');
}

async function openDisc(source) {
  const { bin, firstSector } = await resolveBin(source);
  const stat = await fs.stat(bin).catch(() => null);
  if (!stat?.isFile() || stat.size < 40 * sectorBytes) throw new Error('Wipeout BIN is missing or too small');
  const handle = await fs.open(bin, 'r');
  const raw = Buffer.alloc(sectorBytes);
  async function readRaw(lba) {
    if (!Number.isSafeInteger(lba) || lba < 0 || (firstSector + lba + 1) * sectorBytes > stat.size) throw new Error('Wipeout disc has a file outside its data track');
    const { bytesRead } = await handle.read(raw, 0, sectorBytes, (firstSector + lba) * sectorBytes);
    if (bytesRead !== sectorBytes) throw new Error('Wipeout disc is truncated');
    return raw;
  }
  let offset = -1;
  let pvd;
  try {
    const pvdRaw = await readRaw(16);
    for (const candidate of [24, 16]) {
      if (pvdRaw[candidate] === 1 && pvdRaw.toString('ascii', candidate + 1, candidate + 6) === 'CD001') { offset = candidate; break; }
    }
    if (offset < 0) throw new Error('Wipeout disc needs a raw 2352-byte PlayStation BIN/CUE or CHD');
    pvd = Buffer.from(pvdRaw.subarray(offset, offset + payloadBytes));
  } catch (error) { await handle.close(); throw error; }
  async function readSector(lba) { return Buffer.from((await readRaw(lba)).subarray(offset, offset + payloadBytes)); }
  return { handle, pvd, readSector };
}

function parseRecord(block, offset) {
  const length = block[offset];
  if (!length || length < 34 || offset + length > block.length) throw new Error('Wipeout disc contains a malformed directory');
  const nameLength = block[offset + 32];
  if (33 + nameLength > length) throw new Error('Wipeout disc contains a malformed filename');
  const rawName = block.toString('latin1', offset + 33, offset + 33 + nameLength);
  const name = rawName === '\0' || rawName === '\1' ? rawName : rawName.replace(/;\d+$/, '').toLowerCase();
  return { name, extent: block.readUInt32LE(offset + 2), size: block.readUInt32LE(offset + 10), directory: Boolean(block[offset + 25] & 2) };
}

async function directoryEntries(disc, record) {
  if (!record.directory || record.size > 1024 * 1024) throw new Error('Wipeout disc has an invalid directory');
  const entries = [];
  const sectors = Math.ceil(record.size / payloadBytes);
  for (let index = 0; index < sectors; index++) {
    const block = await disc.readSector(record.extent + index);
    for (let offset = 0; offset < payloadBytes;) {
      if (!block[offset]) break;
      const entry = parseRecord(block, offset);
      if (entry.name !== '\0' && entry.name !== '\1') entries.push(entry);
      offset += block[offset];
    }
  }
  return entries;
}

async function gameRoot(disc) {
  const root = parseRecord(disc.pvd, 156);
  const wipeout = (await directoryEntries(disc, root)).find((entry) => entry.name === 'wipeout' && entry.directory);
  if (!wipeout) throw new Error('This disc has no WIPEOUT game-data folder');
  const entries = await directoryEntries(disc, wipeout);
  for (const name of ['common', 'textures', 'track01']) {
    if (!entries.some((entry) => entry.name === name && entry.directory)) throw new Error(`Wipeout disc is missing ${name}`);
  }
  return wipeout;
}

async function checkCriticalFiles(disc, root) {
  const top = await directoryEntries(disc, root);
  for (const required of criticalFiles) {
    const [folder, name] = required.split('/');
    const entry = top.find((item) => item.name === folder && item.directory);
    if (!entry || !(await directoryEntries(disc, entry)).some((item) => item.name === name && !item.directory && item.size > 0)) {
      throw new Error(`This disc is missing Wipeout file ${required}`);
    }
  }
}

async function writeGameData(disc, root, output) {
  let files = 0; let total = 0; const found = new Set();
  async function visit(folder, target, prefix, depth) {
    if (depth > 8) throw new Error('Wipeout disc has too many nested folders');
    await fs.mkdir(target, { recursive: true });
    const names = new Set();
    for (const entry of await directoryEntries(disc, folder)) {
      if (!/^[a-z0-9._-]+$/.test(entry.name) || entry.name === '.' || entry.name === '..' || names.has(entry.name)) throw new Error('Wipeout disc contains an unsafe or duplicate filename');
      names.add(entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const destination = path.join(target, entry.name);
      if (entry.directory) { await visit(entry, destination, name, depth + 1); continue; }
      if (++files > maxFiles || (total += entry.size) > maxExtractedBytes) throw new Error('Wipeout disc game data exceeds the extraction limit');
      const handle = await fs.open(destination, 'wx');
      try {
        for (let index = 0, remaining = entry.size; remaining > 0; index++, remaining -= payloadBytes) {
          const block = await disc.readSector(entry.extent + index);
          const payload = block.subarray(0, Math.min(remaining, payloadBytes));
          for (let offset = 0; offset < payload.length;) {
            const { bytesWritten } = await handle.write(payload, offset);
            if (!bytesWritten) throw new Error('Could not write extracted Wipeout game data');
            offset += bytesWritten;
          }
        }
      } finally { await handle.close(); }
      found.add(name);
    }
  }
  await visit(root, output, '', 0);
  const missing = criticalFiles.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Wipeout disc is missing required files: ${missing.join(', ')}`);
  return { files, bytes: total };
}

async function inspectWipeoutDisc(source, workspace = os.tmpdir()) {
  if (!isWipeoutDisc(source)) throw new Error('Choose a Wipeout BIN, CUE, or CHD');
  if (path.extname(source).toLowerCase() === '.chd') {
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isFile() || !stat.size) throw new Error('Choose an existing Wipeout CHD');
    const key = `${path.resolve(source)}:${stat.size}:${stat.mtimeMs}`;
    if (checkedChds.has(key)) return checkedChds.get(key);
    const { stdout } = await runChdman(['info', '-i', source]);
    if (!/TRACK:1\s+TYPE:MODE[12]_RAW/i.test(stdout)) throw new Error('Wipeout CHD has no PlayStation data track');
    await fs.mkdir(workspace, { recursive: true });
    const directory = await fs.mkdtemp(path.join(workspace, 'vr4all-wipeout-check-'));
    try {
      const cue = path.join(directory, 'disc.cue');
      await runChdman(['extractcd', '-i', source, '-o', cue, '-ob', path.join(directory, 'disc.bin')]);
      const disc = await openDisc(cue);
      try { await checkCriticalFiles(disc, await gameRoot(disc)); }
      finally { await disc.handle.close(); }
      const result = { kind: 'ps1-disc', format: 'CHD' };
      checkedChds.set(key, result);
      return result;
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
  const disc = await openDisc(source);
  try { await checkCriticalFiles(disc, await gameRoot(disc)); return { kind: 'ps1-disc', format: path.extname(source).slice(1).toUpperCase() }; }
  finally { await disc.handle.close(); }
}

async function extractWipeoutDisc(source, workspace) {
  if (!path.isAbsolute(workspace)) throw new Error('Choose an absolute PC build folder');
  await fs.mkdir(workspace, { recursive: true });
  const directory = await fs.mkdtemp(path.join(workspace, 'vr4all-wipeout-disc-'));
  try {
    let image = source;
    if (path.extname(source).toLowerCase() === '.chd') {
      const cue = path.join(directory, 'disc.cue');
      await runChdman(['extractcd', '-i', source, '-o', cue, '-ob', path.join(directory, 'disc.bin')]);
      image = cue;
    }
    const disc = await openDisc(image);
    try {
      const root = await gameRoot(disc);
      const output = path.join(directory, 'wipeout');
      const result = await writeGameData(disc, root, output);
      return { path: output, directory, ...result, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
    } finally { await disc.handle.close(); }
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { isWipeoutDisc, isWipeoutArchive, inspectWipeoutDisc, extractWipeoutDisc, inspectWipeoutArchive, extractWipeoutArchive, inspectWipeoutFolder };
