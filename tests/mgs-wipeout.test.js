const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getCatalog } = require('../src/catalog');
const { buildInstallPlan } = require('../src/core');
const { packageWipeoutData, transferWipeoutData } = require('../src/wipeout-data');
const { validateMgsDiscPairs } = require('../src/mgs-discs');
const { inspectWipeoutDisc, extractWipeoutDisc, inspectWipeoutArchive, extractWipeoutArchive } = require('../src/wipeout-disc');

const runFile = promisify(execFile);

async function makeWipeoutDisc(root) {
  const sector = (content) => { const raw = Buffer.alloc(2352); raw.fill(0xff, 1, 11); raw[15] = 2; content.copy(raw, 24); return raw; };
  const record = (name, extent, size, directory = false) => {
    const label = Buffer.from(name, 'latin1');
    const output = Buffer.alloc(33 + label.length + (label.length % 2 === 0 ? 1 : 0));
    output[0] = output.length; output.writeUInt32LE(extent, 2); output.writeUInt32LE(size, 10);
    output[25] = directory ? 2 : 0; output[28] = output[31] = 1; output[32] = label.length; label.copy(output, 33);
    return output;
  };
  const directory = (entries) => {
    const output = Buffer.alloc(2048); let offset = 0;
    for (const entry of entries) { entry.copy(output, offset); offset += entry.length; }
    return output;
  };
  const sectors = Array.from({ length: 40 }, () => sector(Buffer.alloc(2048)));
  const pvd = Buffer.alloc(2048); pvd[0] = 1; pvd.write('CD001', 1, 'ascii'); pvd[6] = 1;
  record('\0', 20, 2048, true).copy(pvd, 156); sectors[16] = sector(pvd);
  sectors[20] = sector(directory([record('\0', 20, 2048, true), record('\1', 20, 2048, true), record('WIPEOUT', 21, 2048, true)]));
  sectors[21] = sector(directory([record('\0', 21, 2048, true), record('\1', 20, 2048, true), record('COMMON', 22, 2048, true), record('TEXTURES', 23, 2048, true), record('TRACK01', 24, 2048, true)]));
  const fixtures = [['COMMON', 22, 'ALLSH.PRM;1', 25], ['TEXTURES', 23, 'WIPTITLE.TIM;1', 26], ['TRACK01', 24, 'SKY.PRM;1', 27]];
  for (const [name, dirSector, file, dataSector] of fixtures) {
    sectors[dirSector] = sector(directory([record('\0', dirSector, 2048, true), record('\1', 21, 2048, true), record(file, dataSector, name.length)]));
    sectors[dataSector] = sector(Buffer.from(name));
  }
  const bin = path.join(root, 'Wipeout Track 1.bin');
  const cue = path.join(root, 'Wipeout.cue');
  await fs.writeFile(bin, Buffer.concat(sectors));
  await fs.writeFile(cue, 'FILE "Wipeout Track 1.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n');
  return { bin, cue };
}

test('Wipeout accepts owned BIN and CUE and extracts the required PS1 files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wipeout-disc-'));
  try {
    const { bin, cue } = await makeWipeoutDisc(root);
    for (const source of [bin, cue]) {
      assert.equal((await inspectWipeoutDisc(source)).kind, 'ps1-disc');
      const prepared = await extractWipeoutDisc(source, path.join(root, 'build'));
      assert.equal(await fs.readFile(path.join(prepared.path, 'common', 'allsh.prm'), 'utf8'), 'COMMON');
      assert.equal(await fs.readFile(path.join(prepared.path, 'textures', 'wiptitle.tim'), 'utf8'), 'TEXTURES');
      assert.equal(await fs.readFile(path.join(prepared.path, 'track01', 'sky.prm'), 'utf8'), 'TRACK01');
      await prepared.cleanup();
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Wipeout accepts a ZIP containing an owned CUE and its BIN', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wipeout-zip-'));
  try {
    const { bin, cue } = await makeWipeoutDisc(root);
    const archive = path.join(root, 'disc.zip');
    const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
    await runFile(sevenZip, ['a', '-tzip', archive, path.basename(bin), path.basename(cue)], { cwd: root });
    assert.match((await inspectWipeoutArchive(archive)).member, /\.cue$/i);
    const wrapped = await extractWipeoutArchive(archive);
    try {
      const packaged = await packageWipeoutData(wrapped.path, path.join(root, 'build'));
      try { assert.ok((await fs.stat(packaged.path)).size > 0); }
      finally { await packaged.cleanup(); }
    } finally { await fs.rm(wrapped.directory, { recursive: true, force: true }); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Wipeout extracts a CHD and packages its disc files for Quest import', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wipeout-chd-'));
  try {
    const { cue } = await makeWipeoutDisc(root);
    const chd = path.join(root, 'disc.chd');
    await runFile(path.join(__dirname, '..', 'vendor', 'chdman', 'chdman.exe'), ['createcd', '-i', cue, '-o', chd]);
    assert.equal((await inspectWipeoutDisc(chd)).format, 'CHD');
    const packaged = await packageWipeoutData(chd, path.join(root, 'build'));
    try {
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      const { stdout } = await runFile(tar, ['-tf', packaged.path]);
      assert.match(stdout, /wipeout\/common\/allsh\.prm/);
      assert.match(stdout, /wipeout\/textures\/wiptitle\.tim/);
    } finally { await packaged.cleanup(); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Metal Gear Solid requires both BIN/CUE disc pairs and copies them into the English ROM folder', () => {
  const game = getCatalog().find((entry) => entry.id === 'mgs-vr');
  assert.deepEqual(game.data.map((entry) => entry.id), ['disc1Bin', 'disc1Cue', 'disc2Bin', 'disc2Cue']);
  assert.ok(game.data.every((entry) => entry.destination === '/sdcard/MGSVR/roms/en/'));
  assert.throws(() => buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\MGS.apk', files: {} }), /Disc 1 BIN/);
  const files = Object.fromEntries(game.data.map((entry) => [entry.id, `C:\\Owned\\${entry.id}${entry.extensions[0]}`]));
  const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\MGS.apk', files });
  assert.equal(plan.filter((step) => step.args[2] === 'push').length, 4);
  assert.ok(plan.filter((step) => step.args[2] === 'push').every((step) => step.args.at(-1).startsWith('/sdcard/MGSVR/roms/en/')));
});

test('Metal Gear Solid rejects duplicate disc names and mismatched CUE references', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-mgs-discs-'));
  try {
    const first = path.join(root, 'one');
    const second = path.join(root, 'two');
    await fs.mkdir(first);
    await fs.mkdir(second);
    const files = {
      disc1Bin: path.join(first, 'game.bin'), disc1Cue: path.join(first, 'game.cue'),
      disc2Bin: path.join(second, 'game.bin'), disc2Cue: path.join(second, 'game.cue'),
    };
    await fs.writeFile(files.disc1Cue, 'FILE "game.bin" BINARY\n');
    await fs.writeFile(files.disc2Cue, 'FILE "game.bin" BINARY\n');
    await assert.rejects(validateMgsDiscPairs(files), /duplicate names/);
    files.disc2Bin = path.join(second, 'disc2.bin');
    files.disc2Cue = path.join(second, 'disc2.cue');
    await fs.writeFile(files.disc2Cue, 'FILE "wrong.bin" BINARY\n');
    await assert.rejects(validateMgsDiscPairs(files), /Disc 2 CUE must reference/);
    await fs.writeFile(files.disc2Cue, 'FILE "disc2.bin" BINARY\n');
    await assert.doesNotReject(validateMgsDiscPairs(files));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Wipeout accepts prepared game data and packages a wipeout-rooted USTAR in the chosen build folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wipeout-test-'));
  try {
    const source = path.join(root, 'wipeout');
    for (const name of ['common', 'textures', 'track01']) {
      await fs.mkdir(path.join(source, name), { recursive: true });
      await fs.writeFile(path.join(source, name, 'fixture.dat'), name);
    }
    const workspace = path.join(root, 'chosen-build-folder');
    const result = await packageWipeoutData(source, workspace);
    assert.ok(result.path.startsWith(workspace + path.sep));
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const { stdout } = await runFile(tar, ['-tf', result.path]);
    assert.match(stdout, /wipeout\/track01\/fixture\.dat/);
    assert.match(stdout, /wipeout\/common\/fixture\.dat/);
    await result.cleanup();
    assert.equal(await fs.stat(result.path).then(() => true, () => false), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Wipeout also packages loose extracted game folders under the required wipeout TAR root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wipeout-loose-'));
  try {
    const source = path.join(root, 'disc-files');
    for (const name of ['common', 'textures', 'track01']) {
      await fs.mkdir(path.join(source, name), { recursive: true });
      await fs.writeFile(path.join(source, name, 'fixture.dat'), name);
    }
    const packed = await packageWipeoutData(source, path.join(root, 'build'));
    try {
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      const { stdout } = await runFile(tar, ['-tf', packed.path]);
      assert.match(stdout, /wipeout\/common\/fixture\.dat/);
    } finally { await packed.cleanup(); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Wipeout transfer launches the app when needed and pushes the TAR for in-app import', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wipeout-transfer-'));
  const tarPath = path.join(root, 'wipeout.tar');
  await fs.writeFile(tarPath, 'test tar');
  const calls = [];
  const adb = { async run(args) {
    calls.push(args);
    if (args.includes('test')) return calls.some((call) => call.includes('am') && call.includes('start')) ? '' : Promise.reject(new Error('not created'));
    if (args.includes('stat')) return '8';
    return '';
  } };
  try {
    await transferWipeoutData(adb, 'Q3', tarPath, () => {});
    assert.ok(calls.some((args) => args.includes('start') && args.includes('online.portroyale.wipeoutrewritevr/android.app.NativeActivity')));
    assert.ok(calls.some((args) => args.includes('push') && args.at(-1) === '/sdcard/Android/data/online.portroyale.wipeoutrewritevr/files/wipeout.tar'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
