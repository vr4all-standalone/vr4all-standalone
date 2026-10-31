const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const archiveExtensions = new Set(['.7z', '.rar']);
const folderArchiveExtensions = new Set(['.zip', '.7z', '.rar']);
const maxUnpackedBytes = 8n * 1024n ** 3n;
const maxEntries = 5000;

function acceptsZipContents(item) {
  return item?.kind === 'file' && item.extensions?.some((extension) => extension.toLowerCase() === '.zip');
}

function needsZipConversion(item, file) {
  return acceptsZipContents(item) && archiveExtensions.has(path.extname(file).toLowerCase());
}

async function sevenZipPath() {
  const candidates = process.platform === 'win32'
    ? [process.env.VR4ALL_7ZIP, process.resourcesPath && path.join(process.resourcesPath, '7zip', '7z.exe'), path.join(__dirname, '..', 'vendor', '7zip', '7z.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'), '7z.exe']
    : [process.env.VR4ALL_7ZIP, '7zz', '7z'];
  for (const candidate of candidates.filter(Boolean)) {
    if (!path.isAbsolute(candidate)) return candidate;
    if ((await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  throw new Error('7-Zip is needed to convert .7z or .rar files to ZIP');
}

async function runSevenZip(binary, args, options = {}) {
  try {
    return await runFile(binary, args, { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, ...options });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('7-Zip is needed to convert .7z or .rar files to ZIP');
    if (error.killed) throw new Error('Archive conversion took too long');
    throw new Error(`Archive conversion failed: ${String(error.stderr || error.stdout || error.message).trim().slice(0, 320)}`);
  }
}

function parseListing(listing, allowedEntries = maxEntries) {
  const content = listing.split(/^-{10,}\s*$/m)[1];
  if (!content) throw new Error('Archive has no readable file listing');
  const entries = content.trim().split(/\r?\n\s*\r?\n/).map((block) => Object.fromEntries(block.split(/\r?\n/).map((line) => {
    const separator = line.indexOf(' = ');
    return separator < 0 ? null : [line.slice(0, separator), line.slice(separator + 3)];
  }).filter(Boolean)));
  if (!entries.length || entries.length > allowedEntries) throw new Error(`Archive must contain 1–${allowedEntries.toLocaleString('en-US')} entries`);
  let total = 0n;
  let files = 0;
  const names = new Set();
  for (const entry of entries) {
    const raw = entry.Path || '';
    const normalized = raw.replace(/\\/g, '/').replace(/\/$/, '');
    const parts = normalized.split('/');
    if (!normalized || normalized.length > 4096 || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)
      || parts.some((part) => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part) || /[. ]$/.test(part))) {
      throw new Error(`Archive contains an unsafe path: ${raw.slice(0, 120)}`);
    }
    const key = normalized.toLowerCase();
    if (names.has(key)) throw new Error('Archive contains duplicate paths');
    names.add(key);
    if (entry.Encrypted === '+') throw new Error('Password-protected archives cannot be converted automatically');
    const hasLink = Object.entries(entry).some(([field, value]) =>
      /symbolic link|hard link|copy link|reparse/i.test(field) && value.trim() && value.trim() !== '-');
    if (/^l/i.test(entry.Attributes || '') || hasLink) throw new Error('Archive contains a link');
    const folder = entry.Folder === '+' || /^D/.test(entry.Attributes || '');
    if (folder) continue;
    files++;
    if (!/^\d+$/.test(entry.Size || '')) throw new Error('Archive has an invalid file size');
    total += BigInt(entry.Size);
    if (total > maxUnpackedBytes) throw new Error('Archive expands beyond the 8 GB conversion limit');
  }
  if (!files) throw new Error('Archive contains no regular files');
  return { summary: { files, unpackedBytes: Number(total) }, entries: entries.map((entry) => ({ name: entry.Path.replace(/\\/g, '/').replace(/\/$/, ''), directory: entry.Folder === '+' || /^D/.test(entry.Attributes || '') })) };
}

function inspectListing(listing) { return parseListing(listing).summary; }

function directoryRoot(entries, item) {
  const names = entries.map((entry) => entry.name);
  const prefixes = new Set(['']);
  for (const name of names) {
    const parts = name.split('/');
    for (let index = 1; index < parts.length; index++) prefixes.add(parts.slice(0, index).join('/'));
  }
  const requiredFiles = (item.requiredEntries || []).map((name) => name.toLowerCase());
  const requiredFolders = (item.requiredDirectories || []).map((name) => name.toLowerCase());
  const oneOfFolders = (item.oneOfDirectories || []).map((name) => name.toLowerCase());
  const requiredNested = Object.entries(item.requiredNestedEntries || {}).map(([folder, files]) => [folder.toLowerCase(), files.map((file) => file.toLowerCase())]);
  const requiredExtensions = (item.requiredExtensions || []).map((extension) => extension.toLowerCase());
  if (requiredFiles.length || requiredFolders.length || requiredExtensions.length || oneOfFolders.length || requiredNested.length) {
    const matches = [...prefixes].filter((prefix) => {
      const start = prefix ? `${prefix}/` : '';
      const files = new Set();
      const folders = new Set();
      for (const entry of entries) {
        if (!entry.name.startsWith(start)) continue;
        const tail = entry.name.slice(start.length);
        if (!tail) continue;
        const first = tail.split('/')[0].toLowerCase();
        if (tail.includes('/') || entry.directory) folders.add(first);
        else files.add(first);
      }
      return requiredFiles.every((name) => files.has(name)) && requiredFolders.every((name) => folders.has(name))
        && (!oneOfFolders.length || oneOfFolders.some((name) => folders.has(name)))
        && requiredExtensions.every((extension) => [...files].some((name) => name.endsWith(extension)))
        && requiredNested.every(([folder, nestedFiles]) => nestedFiles.every((file) => entries.some((entry) => !entry.directory && entry.name.toLowerCase() === `${start}${folder}/${file}`.toLowerCase())));
    });
    if (!matches.length) throw new Error(`${item.label || 'Game archive'} is missing ${[...requiredFiles, ...requiredFolders, ...requiredExtensions].join(', ')}`);
    return matches.sort((a, b) => a.length - b.length)[0];
  }
  const roots = new Set(names.map((name) => name.split('/')[0]));
  if (roots.size !== 1) return '';
  const root = [...roots][0];
  return entries.some((entry) => entry.name.startsWith(`${root}/`))
    && entries.every((entry) => entry.name.startsWith(`${root}/`) || entry.name === root && entry.directory) ? root : '';
}

async function inspectDirectoryArchive(item, source, options = {}) {
  if (!folderArchiveExtensions.has(path.extname(source).toLowerCase())) throw new Error('Choose a ZIP, 7z, or RAR game archive');
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isFile() || !stat.size || stat.size > Number(maxUnpackedBytes)) throw new Error('Choose a nonempty game archive under 8 GB');
  const binary = await sevenZipPath();
  const { stdout } = await runSevenZip(binary, ['l', '-slt', '-p-', source]);
  const { summary, entries } = parseListing(stdout, options.maxEntries || maxEntries);
  return { ...summary, root: directoryRoot(entries, item) };
}

async function inspectSingleFileArchive(item, source) {
  if (!folderArchiveExtensions.has(path.extname(source).toLowerCase())) throw new Error('Choose a ZIP, 7z, or RAR archive');
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isFile() || !stat.size || stat.size > Number(maxUnpackedBytes)) throw new Error('Choose a nonempty archive under 8 GB');
  const { stdout } = await runSevenZip(await sevenZipPath(), ['l', '-slt', '-p-', source]);
  const { entries, summary } = parseListing(stdout);
  const extensions = (item.extensions || []).map((extension) => extension.toLowerCase()).filter((extension) => item.includeArchiveMembers || !folderArchiveExtensions.has(extension));
  const expected = item.archiveMember?.toLowerCase();
  let matches = entries.filter((entry) => !entry.directory && (expected
    ? path.posix.basename(entry.name).toLowerCase() === expected
    : extensions.includes(path.posix.extname(entry.name).toLowerCase())));
  if (!expected && !String(item.destination || '').endsWith('/')) {
    const destinationName = path.posix.basename(item.destination).toLowerCase();
    const exact = matches.filter((entry) => path.posix.basename(entry.name).toLowerCase() === destinationName);
    if (exact.length === 1) matches = exact;
  }
  if (!matches.length) throw new Error(`${item.label || 'Game file'} archive is missing ${item.archiveMember || extensions.join(' or ')}`);
  if (matches.length > 1) throw new Error(`${item.label || 'Game file'} archive contains multiple possible files; extract it and select one`);
  return { ...summary, member: matches[0].name };
}

async function extractSingleFileArchive(item, source, options = {}) {
  const inspected = await inspectSingleFileArchive(item, source);
  const tempRoot = options.tempRoot || os.tmpdir();
  if (!path.isAbsolute(tempRoot)) throw new Error('Archive extraction needs an absolute temporary folder');
  await fs.mkdir(tempRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(tempRoot, 'vr4all-convert-'));
  const extracted = path.join(directory, 'contents');
  try {
    await fs.mkdir(extracted);
    await runSevenZip(await sevenZipPath(), ['x', '-y', '-p-', `-o${extracted}`, source]);
    await inspectDirectory(extracted);
    const memberPath = path.join(extracted, ...inspected.member.split('/'));
    const stat = await fs.lstat(memberPath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Archive game file is missing or empty after extraction');
    return { path: memberPath, directory, ...inspected };
  } catch (error) {
    await removeConversionDirectory(directory, tempRoot);
    throw error;
  }
}

async function extractDirectoryArchive(item, source, options = {}) {
  const inspected = await inspectDirectoryArchive(item, source, options);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-convert-'));
  const extracted = path.join(directory, 'contents');
  try {
    await fs.mkdir(extracted);
    await runSevenZip(await sevenZipPath(), ['x', '-y', '-p-', `-o${extracted}`, source]);
    await inspectDirectory(extracted, options);
    const gamePath = inspected.root ? path.join(extracted, ...inspected.root.split('/')) : extracted;
    if (!(await fs.stat(gamePath).catch(() => null))?.isDirectory()) throw new Error('Game archive does not contain the expected folder');
    return { path: gamePath, directory, ...inspected };
  } catch (error) {
    await removeConversionDirectory(directory);
    throw error;
  }
}

async function removeConversionDirectory(directory, parentRoot = os.tmpdir()) {
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(parentRoot);
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('vr4all-convert-')) return;
  await fs.rm(resolved, { recursive: true, force: true });
}

async function inspectDirectory(source, options = {}) {
  const root = await fs.lstat(source).catch(() => null);
  if (!root?.isDirectory() || root.isSymbolicLink()) throw new Error('Choose an existing regular folder');
  let entries = 0;
  let files = 0;
  let total = 0n;
  const topLevel = [];
  const names = new Set();
  async function visit(directory, prefix) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix) topLevel.push(entry.name);
      const parts = relative.split('/');
      if (relative.length > 4096 || parts.some((part) => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part) || /[. ]$/.test(part))) {
        throw new Error(`Folder contains an unsafe path: ${relative.slice(0, 120)}`);
      }
      const key = relative.toLowerCase();
      if (names.has(key)) throw new Error('Folder contains duplicate paths');
      names.add(key);
      if (++entries > (options.maxEntries || maxEntries)) throw new Error(`Folder must contain at most ${(options.maxEntries || maxEntries).toLocaleString('en-US')} entries`);
      const local = path.join(directory, entry.name);
      const stat = await fs.lstat(local);
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error('Folder contains a link or unsupported file');
      if (stat.isDirectory()) await visit(local, relative);
      else {
        files++;
        total += BigInt(stat.size);
        if (total > maxUnpackedBytes) throw new Error('Folder exceeds the 8 GB conversion limit');
      }
    }
  }
  await visit(source, '');
  if (!files) throw new Error('Folder contains no regular files');
  return { files, unpackedBytes: Number(total), topLevel };
}

async function packageDirectoryToZip(source, name = path.basename(source)) {
  const { topLevel, ...summary } = await inspectDirectory(source);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-convert-'));
  const safeName = path.basename(name).replace(/[^A-Za-z0-9._ ()-]/g, '_').replace(/\.zip$/i, '') || 'game';
  const zipPath = path.join(directory, `${safeName}.zip`);
  const manifest = path.join(directory, 'files.txt');
  try {
    await fs.writeFile(manifest, `${topLevel.join('\n')}\n`, 'utf8');
    const tar = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
    try {
      await runFile(tar, ['-a', '-cf', zipPath, '-C', source, '-T', manifest], {
        windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(`Could not package folder as ZIP: ${String(error.stderr || error.message).trim().slice(0, 320)}`);
    }
    const stat = await fs.stat(zipPath);
    if (!stat.size || stat.size > Number(maxUnpackedBytes)) throw new Error('ZIP exceeds the 8 GB conversion limit');
    return { path: zipPath, directory, ...summary };
  } catch (error) {
    await removeConversionDirectory(directory);
    throw error;
  }
}

async function convertArchiveToZip(source, options = {}) {
  const extension = path.extname(source).toLowerCase();
  if (!archiveExtensions.has(extension)) throw new Error('Choose a .7z or .rar archive');
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isFile() || !stat.size) throw new Error('Choose an existing nonempty archive');
  if (stat.size > Number(maxUnpackedBytes)) throw new Error('Archive exceeds the 8 GB conversion limit');
  const binary = await sevenZipPath();
  const { stdout } = await runSevenZip(binary, ['l', '-slt', '-p-', source]);
  const summary = inspectListing(stdout);
  const tempRoot = options.tempRoot || os.tmpdir();
  if (!path.isAbsolute(tempRoot)) throw new Error('Archive conversion needs an absolute temporary folder');
  await fs.mkdir(tempRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(tempRoot, 'vr4all-convert-'));
  const extracted = path.join(directory, 'contents');
  const zipPath = path.join(directory, `${path.basename(source, extension)}.zip`);
  try {
    await fs.mkdir(extracted);
    await runSevenZip(binary, ['x', '-y', '-p-', `-o${extracted}`, source]);
    const content = await fs.readdir(extracted);
    if (!content.length) throw new Error('Archive extraction produced no files');
    await runSevenZip(binary, ['a', '-tzip', '-mx=5', zipPath, '*'], { cwd: extracted });
    const zipStat = await fs.stat(zipPath);
    if (!zipStat.size) throw new Error('ZIP conversion produced an empty file');
    await fs.rm(extracted, { recursive: true, force: true });
    return { path: zipPath, directory, originalExtension: extension, ...summary };
  } catch (error) {
    await removeConversionDirectory(directory, tempRoot);
    throw error;
  }
}

module.exports = { needsZipConversion, acceptsZipContents, convertArchiveToZip, packageDirectoryToZip, inspectDirectory, inspectDirectoryArchive, extractDirectoryArchive, inspectSingleFileArchive, extractSingleFileArchive, removeConversionDirectory, inspectListing, sevenZipPath, runSevenZip };
