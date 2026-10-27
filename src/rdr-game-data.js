const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readManifestPackage, readManifestSplit } = require('./apk-verification');
const { sevenZipPath, runSevenZip, inspectListing, removeConversionDirectory } = require('./archive-conversion');

const requiredGameData = ['content', 'cutscene', 'grassres', 'psocache', 'audio', 'audio2', 'base/content'].map((name) => `assets/game/${name}_android.rpf`);
const splitName = /^split_(game[0-9]+|streamed)\.apk$/i;
const resourceName = /^assets\/game\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:rpf|bk2)$/i;
const limit = 8 * 1024 ** 3;

async function listArchive(file) {
  const { stdout } = await runSevenZip(await sevenZipPath(), ['l', '-slt', '-p-', file]);
  inspectListing(stdout); // Reject traversal, links, duplicates, encryption and excessive expansion before extraction.
  return stdout.split(/^-{10,}\s*$/m)[1].trim().split(/\r?\n\s*\r?\n/).map((block) => ({
    name: block.match(/^Path = (.+)$/m)[1].replaceAll('\\', '/').replace(/\/$/, ''),
    bytes: Number(block.match(/^Size = (\d+)$/m)?.[1] || 0),
    directory: /^Folder = \+$/m.test(block) || /^Attributes = D/m.test(block),
  }));
}

async function requireSpace(directory, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit) throw new Error('RDR game data exceeds the 8 GB input limit');
  const disk = await fs.statfs(directory);
  if (Number(disk.bavail) * Number(disk.bsize) < bytes + 256 * 1024 ** 2) throw new Error('Not enough free space on the selected drive for the additional RDR game data');
}

async function extractMembers(file, members, destination) {
  if (!members.length) return;
  const names = members.map((member) => member.name);
  if (names.join('').length > 22000) throw new Error('RDR game-data archive has too many resource names');
  await fs.mkdir(destination, { recursive: true });
  await requireSpace(destination, members.reduce((sum, member) => sum + member.bytes, 0));
  await runSevenZip(await sevenZipPath(), ['x', '-y', '-p-', `-o${destination}`, file, ...names]);
}

async function plainFiles(root) {
  const files = []; let bytes = 0, count = 0;
  async function visit(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++count > 5000) throw new Error('RDR game-data folder contains too many entries');
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) throw new Error('RDR game data must contain only regular files and folders');
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), name);
      else {
        const file = path.join(directory, entry.name), stat = await fs.lstat(file);
        bytes += stat.size;
        if (files.length >= 5000 || bytes > limit) throw new Error('RDR game data exceeds the 8 GB input limit');
        files.push({ name, file, bytes: stat.size });
      }
    }
  }
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose a regular RDR data folder');
  await visit(root);
  return files;
}

function rawResource(name) {
  const match = name.match(/^(?:asset-packs\/)?([A-Za-z][A-Za-z0-9_]*)\/(assets\/game\/.+)$/)
    || name.match(/^()(assets\/game\/.+)$/);
  if (!match || !resourceName.test(match[2])) return null;
  return { pack: match[1] || 'game_data', path: match[2] };
}

async function resourcesFrom(source, scratch) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error('Choose regular RDR game-data files');
  let files;
  if (stat.isDirectory()) files = await plainFiles(source);
  else if (path.extname(source).toLowerCase() === '.apk') files = [{ name: path.basename(source), file: source }];
  else {
    if (!stat.size || stat.size > limit) throw new Error('Choose an RDR data archive under 8 GB');
    const entries = await listArchive(source);
    const selected = entries.filter((entry) => !entry.directory && (rawResource(entry.name) || splitName.test(entry.name)));
    if (!selected.length) throw new Error('This archive has no additional RDR world/audio data. An APK-only download is incomplete.');
    const extracted = path.join(scratch, 'archive');
    await extractMembers(source, selected, extracted);
    files = await plainFiles(extracted);
  }
  const resources = [];
  for (const entry of files) {
    const raw = rawResource(entry.name);
    if (raw) { resources.push({ ...raw, file: entry.file, bytes: entry.bytes }); continue; }
    const split = entry.name.match(splitName);
    if (!split) continue;
    const packageId = await readManifestPackage(entry.file);
    if (!['com.netflix.NGP.Kamo', 'com.rockstargames.rdr'].includes(packageId)) throw new Error('Additional data APK belongs to a different game, not RDR');
    const entries = await listArchive(entry.file);
    const selected = entries.filter((member) => !member.directory && resourceName.test(member.name));
    if (resources.reduce((sum, resource) => sum + resource.bytes, 0) + selected.reduce((sum, member) => sum + member.bytes, 0) > limit) throw new Error('RDR game data exceeds the 8 GB input limit');
    const extracted = path.join(scratch, split[1]);
    await extractMembers(entry.file, selected, extracted);
    for (const member of selected) resources.push({ pack: split[1].toLowerCase(), path: member.name, file: path.join(extracted, ...member.name.split('/')), bytes: member.bytes });
  }
  const seen = new Set();
  for (const resource of resources) {
    const key = resource.path.toLowerCase();
    if (seen.has(key)) throw new Error('RDR data source repeats the same resource; choose one complete matching data set');
    seen.add(key);
  }
  return resources;
}

async function copyResource(resource, directory) {
  const target = path.join(directory, 'asset-packs', resource.pack, ...resource.path.split('/'));
  if (await fs.lstat(target).catch(() => null)) throw new Error('RDR additional data would overwrite an existing file');
  const stat = await fs.lstat(resource.file);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size !== resource.bytes) throw new Error('RDR game-data resource is empty or changed during import');
  let parent = directory;
  for (const part of path.relative(directory, path.dirname(target)).split(path.sep)) {
    parent = path.join(parent, part);
    const existing = await fs.lstat(parent).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('RDR destination contains a link or non-regular folder');
    if (!existing) await fs.mkdir(parent);
  }
  await fs.copyFile(resource.file, `${target}.partial`, require('node:fs').constants.COPYFILE_EXCL);
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(`${target}.partial`)) hash.update(chunk);
  await fs.rename(`${target}.partial`, target);
  return { pack: resource.pack, path: resource.path, bytes: stat.size, sha256: hash.digest('hex') };
}

async function importRdrGameData(source, directory, { present = new Set(), onLog = () => {} } = {}) {
  const output = await fs.lstat(directory);
  if (!output.isDirectory() || output.isSymbolicLink()) throw new Error('Choose a regular RDR output folder, not a link');
  const scratch = await fs.mkdtemp(path.join(directory, 'vr4all-convert-rdr-data-'));
  try {
    const resources = await resourcesFrom(source, scratch);
    const names = new Set([...present, ...resources.map((file) => file.path)]);
    const missing = requiredGameData.filter((name) => !names.has(name));
    if (missing.length) throw new Error(`Additional RDR game data is incomplete (${missing.length} required files missing). Choose matching 1.58.63226194 world, cutscene and audio packs.`);
    const bytes = resources.filter((file) => !present.has(file.path)).reduce((sum, file) => sum + file.bytes, 0);
    await requireSpace(directory, bytes);
    const report = [];
    for (const resource of resources) {
      if (present.has(resource.path)) continue;
      onLog(`Importing RDR game data: ${resource.pack}/${resource.path.slice(7)}`);
      report.push(await copyResource(resource, directory));
    }
    return report;
  } finally { await removeConversionDirectory(scratch, directory); }
}

async function withRdrGameData(input, tempRoot, operation, onLog = () => {}) {
  if (!input.audioSource) return operation(input.gamePackage);
  const stat = await fs.lstat(input.gamePackage);
  const root = stat.isDirectory() ? input.gamePackage : path.basename(input.gamePackage) === 'base.apk' ? path.dirname(input.gamePackage) : null;
  let rawFiles = [];
  if (root && await fs.lstat(path.join(root, 'asset-packs')).catch(() => null)) {
    rawFiles = (await plainFiles(path.join(root, 'asset-packs'))).map((file) => ({ ...file, name: `asset-packs/${file.name}` }));
  }
  if (root) {
    const present = new Set(rawFiles.map((file) => rawResource(file.name)?.path).filter(Boolean));
    if (requiredGameData.every((name) => present.has(name))) return operation(input.gamePackage);
  }
  await fs.mkdir(tempRoot, { recursive: true });
  const stage = await fs.mkdtemp(path.join(tempRoot, 'vr4all-convert-rdr-input-'));
  try {
    let originalFiles;
    if (root) {
      originalFiles = (await fs.readdir(root)).filter((name) => /^(base|split_[A-Za-z0-9_.-]+)\.apk$/i.test(name)).map((name) => ({ name, file: path.join(root, name) }));
      for (const file of rawFiles) if (rawResource(file.name)) await copyResource({ ...rawResource(file.name), ...file }, stage);
    } else if (path.extname(input.gamePackage).toLowerCase() === '.apk') {
      if (/^split_.*\.apk$/i.test(path.basename(input.gamePackage))) throw new Error('Select the original base APK or export folder, not a split APK');
      originalFiles = [{ name: 'base.apk', file: input.gamePackage }];
    } else {
      const entries = await listArchive(input.gamePackage);
      const xapk = path.extname(input.gamePackage).toLowerCase() === '.xapk';
      const selected = entries.filter((entry) => !entry.directory && (/^(base|split_[A-Za-z0-9_.-]+)\.apk$/i.test(path.posix.basename(entry.name)) || xapk && entry.name.toLowerCase().endsWith('.apk') || rawResource(entry.name)));
      const extracted = path.join(stage, 'vr4all-convert-rdr-archive');
      await extractMembers(input.gamePackage, selected, extracted);
      originalFiles = [];
      for (const entry of selected) {
        const file = path.join(extracted, ...entry.name.split('/'));
        if (entry.name.toLowerCase().endsWith('.apk')) {
          const split = xapk ? await readManifestSplit(file) : null;
          originalFiles.push({ name: xapk ? split === null ? 'base.apk' : `split_${split}.apk` : path.posix.basename(entry.name), file, temporary: true });
        } else if (rawResource(entry.name)) await copyResource({ ...rawResource(entry.name), file, bytes: entry.bytes }, stage);
      }
    }
    const names = new Set();
    for (const file of originalFiles) {
      if (names.has(file.name.toLowerCase())) throw new Error('RDR game archive contains duplicate base/split APK identities');
      names.add(file.name.toLowerCase());
      const item = await fs.lstat(file.file);
      if (!item.isFile() || item.isSymbolicLink()) throw new Error('Original RDR APK must be a regular file');
      if (file.temporary) await fs.rename(file.file, path.join(stage, file.name));
      else {
        await requireSpace(stage, item.size);
        await fs.copyFile(file.file, path.join(stage, file.name));
      }
    }
    // Primary archives have been copied into the canonical export layout. Their
    // extracted wrapper folders are no longer input and must not reach the builder.
    if (await fs.lstat(path.join(stage, 'vr4all-convert-rdr-archive')).catch(() => null)) await removeConversionDirectory(path.join(stage, 'vr4all-convert-rdr-archive'), stage);
    const present = new Set();
    for (const name of await fs.readdir(stage)) if (name.endsWith('.apk')) for (const member of await listArchive(path.join(stage, name))) present.add(member.name);
    for (const file of await plainFiles(stage)) { const raw = rawResource(file.name); if (raw) present.add(raw.path); }
    if (!requiredGameData.every((name) => present.has(name))) await importRdrGameData(input.audioSource, stage, { present, onLog });
    return await operation(stage);
  } finally { await removeConversionDirectory(stage, tempRoot); }
}

module.exports = { requiredGameData, importRdrGameData, withRdrGameData };
