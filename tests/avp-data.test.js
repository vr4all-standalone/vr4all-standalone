const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { packageAvpData, transferAvpData, appFiles } = require('../src/avp-data');

const runFile = promisify(execFile);
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

async function ownedFolder(root) {
  const source = path.join(root, 'contents');
  for (const folder of ['avp_rifs/marine', 'fastfile', 'avp_huds', 'user_profiles']) await fs.mkdir(path.join(source, folder), { recursive: true });
  await fs.writeFile(path.join(source, 'avp_rifs', 'marine', 'als-dm-coop.rif'), 'owned rif');
  await fs.writeFile(path.join(source, 'fastfile', 'common.ffl'), 'owned ffl');
  await fs.writeFile(path.join(source, 'avp_huds', 'alien.rif'), 'owned hud');
  await fs.writeFile(path.join(source, 'language.txt'), 'gold');
  await fs.writeFile(path.join(source, 'avp.exe'), 'windows exe');
  await fs.writeFile(path.join(source, 'user_profiles', 'pc.prf'), 'pc save');
  return source;
}

test('AvP packaging keeps only owned game assets and leaves the EXE and PC saves out', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-avp-package-'));
  try {
    const packaged = await packageAvpData(await ownedFolder(root), path.join(root, 'builds'));
    const { stdout } = await runFile(tar, ['-tf', packaged.path]);
    const names = stdout.split(/\r?\n/).filter((line) => line && !line.endsWith('/')).sort();
    assert.deepEqual(names, ['avp_huds/alien.rif', 'avp_rifs/marine/als-dm-coop.rif', 'fastfile/common.ffl', 'language.txt']);
    assert.deepEqual(packaged.entries, ['avp_rifs', 'fastfile', 'language.txt', 'avp_huds']);
    assert.deepEqual(packaged.files.map((file) => file.path).sort(), names);
    await packaged.cleanup();
    assert.deepEqual(await fs.readdir(path.join(root, 'builds')), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('AvP packaging refuses a game folder without its fastfile data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-avp-package-'));
  try {
    const source = await ownedFolder(root);
    await fs.rm(path.join(source, 'fastfile'), { recursive: true });
    await assert.rejects(packageAvpData(source, path.join(root, 'builds')), /missing its fastfile folder/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('AvP carries movies, music and fresh-install defaults without copying profiles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-avp-media-'));
  try {
    const source = await ownedFolder(root);
    for (const folder of ['fmvs', 'cd_tracks']) {
      await fs.mkdir(path.join(source, folder));
      await fs.writeFile(path.join(source, folder, 'media.dat'), 'owned media');
    }
    await fs.writeFile(path.join(source, 'default.cfg'), 'retail defaults');
    const packaged = await packageAvpData(source, path.join(root, 'builds'));
    const { stdout } = await runFile(tar, ['-tf', packaged.path]);
    for (const name of ['fmvs/media.dat', 'cd_tracks/media.dat', 'default.cfg']) assert.ok(stdout.split(/\r?\n/).includes(name));
    assert.ok(!stdout.includes('pc.prf'));
    const calls = [];
    await transferAvpData({ run: async (args) => {
      calls.push(args);
      if (args[3] === 'test' && args[4] === '-e') throw new Error('no default.cfg on fresh install');
      if (args[3] === 'stat') return String((await fs.stat(packaged.path)).size);
      if (args[3] === 'cd') return packaged.files.map(file => `${file.bytes} ${file.path}`).join('\n');
      return '';
    } }, 'Q3', packaged);
    assert.ok(!calls.find(args => args[3] === 'tar').includes('--exclude'));
    await packaged.cleanup();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('AvP transfer never pushes into Android/data and rejects a partial unpack after removing its temp TAR', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-avp-transfer-'));
  try {
    const packaged = await packageAvpData(await ownedFolder(root), path.join(root, 'builds'));
    const calls = [];
    const sizes = new Map();
    const adb = { run: async (args) => {
      calls.push(args);
      if (args[2] === 'push') {
        if (args.at(-1).startsWith('/sdcard/Android/data/')) throw new Error('remote secure_mkdirs() failed: Operation not permitted');
        sizes.set(args.at(-1), (await fs.stat(args.at(-2))).size);
      }
      if (args[3] === 'stat') return String(sizes.get(args.at(-1).slice(1, -1)) ?? '');
      if (args[3] === 'cd') return `${'owned rif'.length} avp_rifs/marine/als-dm-coop.rif\n`;
      return '';
    } };
    await assert.rejects(transferAvpData(adb, 'Q3', packaged), /incomplete on the headset: 3 of 4 files/);
    const pushes = calls.filter((args) => args[2] === 'push');
    assert.equal(pushes.length, 1);
    assert.match(pushes[0].at(-1), /^\/data\/local\/tmp\/vr4all-avp-[0-9a-f-]+\.tar$/);
    const extract = calls.find((args) => args[3] === 'tar');
    assert.deepEqual(extract.slice(3), ['tar', '-xf', pushes[0].at(-1), '-C', appFiles]);
    assert.ok(calls.findIndex((args) => args.includes('force-stop')) < calls.indexOf(pushes[0]));
    assert.ok(calls.indexOf(extract) < calls.findIndex((args) => args[3] === 'cd'));
    assert.deepEqual(calls.at(-1).slice(3), ['rm', '-f', pushes[0].at(-1)]);
    await packaged.cleanup();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
