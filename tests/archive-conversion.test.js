const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { inspectListing, needsZipConversion, inspectDirectory, inspectDirectoryArchive, extractDirectoryArchive, packageDirectoryToZip, removeConversionDirectory, convertArchiveToZip } = require('../src/archive-conversion');
const runFile = promisify(execFile);
const sevenZip = path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe');
const bundledZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');

test('game archive conversion stays on the selected drive and removes its private files', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.selected-conversion-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'game.dat'), 'owned fixture');
  const archive = path.join(root, 'game.7z');
  await runFile(bundledZip, ['a', '-t7z', archive, 'game.dat'], { cwd: root, windowsHide: true });
  const tempRoot = path.join(root, 'chosen build folder');
  await fs.mkdir(tempRoot);
  const converted = await convertArchiveToZip(archive, { tempRoot });
  assert.equal(path.dirname(converted.directory), tempRoot);
  const listing = await runFile(bundledZip, ['l', converted.path], { windowsHide: true });
  assert.match(listing.stdout, /game\.dat/);
  await removeConversionDirectory(converted.directory, tempRoot);
  assert.deepEqual(await fs.readdir(tempRoot), []);
  assert.equal(await fs.readFile(path.join(root, 'game.dat'), 'utf8'), 'owned fixture');
});

test('only ZIP profile fields offer 7z and RAR conversion', () => {
  assert.equal(needsZipConversion({ kind: 'file', extensions: ['.zip'] }, 'timecris.7z'), true);
  assert.equal(needsZipConversion({ kind: 'file', extensions: ['.zip'] }, 'timecris.rar'), true);
  assert.equal(needsZipConversion({ kind: 'file', extensions: ['.chd'] }, 'disc.7z'), false);
});

test('archive listing rejects unsafe paths before extraction', () => {
  const listing = '7-Zip\n----------\nPath = ../outside.bin\nSize = 2\nEncrypted = -\n';
  assert.throws(() => inspectListing(listing), /unsafe path/i);
  const encrypted = '7-Zip\n----------\nPath = game.bin\nSize = 2\nEncrypted = +\n';
  assert.throws(() => inspectListing(encrypted), /Password-protected/i);
});

test('RAR listing accepts an empty Symbolic Link field', () => {
  const listing = '----------\nPath = game.bin\nSize = 12\nAttributes = A\nSymbolic Link = \nHard Link = \n';
  assert.deepEqual(inspectListing(listing), { files: 1, unpackedBytes: 12 });
});

test('game folder archives accept ZIP and 7z with a wrapper, but reject an installer archive', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-folder-archive-'));
  const item = { label: 'Amnesia game', requiredDirectories: ['config', 'maps', 'entities'] };
  try {
    const game = path.join(root, 'Amnesia The Dark Descent');
    for (const folder of item.requiredDirectories) {
      await fs.mkdir(path.join(game, folder), { recursive: true });
      await fs.writeFile(path.join(game, folder, 'data.bin'), folder);
    }
    for (const type of ['zip', '7z']) {
      const archive = path.join(root, `Amnesia The Dark Descent.${type}`);
      await runFile(bundledZip, ['a', `-t${type}`, archive, 'Amnesia The Dark Descent'], { cwd: root, windowsHide: true });
      assert.equal((await inspectDirectoryArchive(item, archive)).root, 'Amnesia The Dark Descent');
      const extracted = await extractDirectoryArchive(item, archive);
      try { assert.equal(await fs.readFile(path.join(extracted.path, 'maps', 'data.bin'), 'utf8'), 'maps'); }
      finally { await removeConversionDirectory(extracted.directory); }
    }
    const installer = path.join(root, 'Amnesia installer.zip');
    await fs.writeFile(path.join(root, 'setup.exe'), 'installer');
    await runFile(bundledZip, ['a', '-tzip', installer, 'setup.exe'], { cwd: root, windowsHide: true });
    await assert.rejects(inspectDirectoryArchive(item, installer), /missing.*config/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('folder packing rejects links, empty folders, unsafe names, and over-limit contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-pack-check-'));
  try {
    await assert.rejects(inspectDirectory(root), /no regular files/i);
    await fs.writeFile(path.join(root, 'good.bin'), 'owned fixture');
    const link = path.join(root, 'linked.bin');
    try { await fs.symlink(path.join(root, 'good.bin'), link); }
    catch (error) { if (error.code !== 'EPERM') throw error; }
    if (await fs.lstat(link).catch(() => null)) {
      await assert.rejects(inspectDirectory(root), /link/i);
      await fs.rm(link);
    }
    const result = await inspectDirectory(root);
    assert.equal(result.files, 1);
    assert.equal(result.unpackedBytes, 13);
    for (let index = 0; index < 5000; index++) await fs.writeFile(path.join(root, `extra-${index}.bin`), '');
    await assert.rejects(inspectDirectory(root), /5,000 entries/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('folder contents are packed at ZIP root with nested paths preserved', { skip: process.platform !== 'win32' }, async () => {
  if (!(await fs.stat(sevenZip).catch(() => null))?.isFile()) return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-pack-root-'));
  let converted;
  try {
    const source = path.join(root, 'timecris');
    await fs.mkdir(path.join(source, 'nested'), { recursive: true });
    await fs.writeFile(path.join(source, 'game.bin'), 'owned game');
    await fs.writeFile(path.join(source, 'nested', 'board.bin'), 'owned board');
    converted = await packageDirectoryToZip(source, 'timecris');
    const listing = await runFile(sevenZip, ['l', '-slt', converted.path], { windowsHide: true });
    assert.match(listing.stdout, /Path = game\.bin/);
    assert.match(listing.stdout, /Path = nested\\board\.bin/);
    assert.doesNotMatch(listing.stdout, /Path = timecris\\game\.bin/);
  } finally {
    if (converted) await removeConversionDirectory(converted.directory);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('folder ZIP packaging works on Windows without a separate 7-Zip installation', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-pack-native-'));
  const prior = { zip: process.env.VR4ALL_7ZIP, files: process.env.ProgramFiles, files86: process.env['ProgramFiles(x86)'], path: process.env.PATH };
  let converted;
  try {
    const source = path.join(root, 'owned game');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'game.bin'), 'owned file');
    process.env.VR4ALL_7ZIP = path.join(root, 'missing-7z.exe');
    process.env.ProgramFiles = root;
    process.env['ProgramFiles(x86)'] = root;
    process.env.PATH = root;
    converted = await packageDirectoryToZip(source, 'game');
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const listing = await runFile(tar, ['-tf', converted.path], { windowsHide: true });
    assert.match(listing.stdout, /^game\.bin\r?$/m);
  } finally {
    for (const [key, value] of Object.entries({ VR4ALL_7ZIP: prior.zip, ProgramFiles: prior.files, 'ProgramFiles(x86)': prior.files86, PATH: prior.path })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (converted) await removeConversionDirectory(converted.directory);
    await fs.rm(root, { recursive: true, force: true });
  }
});
