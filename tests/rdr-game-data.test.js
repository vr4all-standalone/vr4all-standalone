const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { apk } = require('./helpers/rdr-apk-fixture');
const required = ['content', 'cutscene', 'grassres', 'psocache', 'audio', 'audio2', 'base/content'].map((name) => `assets/game/${name}_android.rpf`);
const { importRdrGameData, withRdrGameData } = require('../src/rdr-game-data');

async function setup(t) {
  const root = await fs.mkdtemp(path.join(__dirname, '.rdr-data-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), destination = path.join(root, 'export');
  await fs.mkdir(source); await fs.mkdir(destination);
  return { root, source, destination };
}

test('additional RDR data imports all world resources without replacing the original game APK', async (t) => {
  const { source, destination } = await setup(t);
  await fs.writeFile(path.join(destination, 'base.apk'), 'original Netflix code');
  const resources = [...required, 'assets/game/redemption/armadillo_android.rpf'];
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(resources, 'com.rockstargames.rdr'));
  const records = await importRdrGameData(source, destination);
  assert.equal(records.length, resources.length);
  assert.deepEqual(records.map((record) => record.path).sort(), resources.sort());
  for (const record of records) {
    const bytes = await fs.readFile(path.join(destination, 'asset-packs', record.pack, ...record.path.split('/')));
    assert.equal(record.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(await fs.readFile(path.join(destination, 'base.apk'), 'utf8'), 'original Netflix code');
  assert.equal(await fs.stat(path.join(destination, 'split_game0.apk')).catch(() => null), null);
});

test('a raw asset-packs folder can be imported and an incomplete pack is rejected', async (t) => {
  const { source, destination } = await setup(t);
  for (const member of required) {
    const file = path.join(source, 'streamed', member);
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `RPF6 ${member}`);
  }
  assert.equal((await importRdrGameData(source, destination)).length, 7);
  const emptyExport = path.join(destination, 'other'); await fs.mkdir(emptyExport);
  await fs.unlink(path.join(source, 'streamed', required.at(-1)));
  await assert.rejects(importRdrGameData(source, emptyExport), /incomplete|missing/i);
});

test('resource import refuses an unrelated APK and unsafe archive paths', async (t) => {
  const { source, destination } = await setup(t);
  const file = path.join(source, 'split_game0.apk');
  await fs.writeFile(file, apk(required, 'com.unrelated.app'));
  await assert.rejects(importRdrGameData(source, destination), /RDR|different.*game/i);
  await fs.writeFile(file, apk([...required, '../escape.rpf'], 'com.rockstargames.rdr'));
  await assert.rejects(importRdrGameData(source, destination), /unsafe|path/i);
  assert.equal(await fs.stat(path.join(source, 'escape.rpf')).catch(() => null), null);
});

test('a supplemented build stages original APKs and cleans temporary files after failure', async (t) => {
  const { root, source, destination } = await setup(t);
  const base = apk(['lib/arm64-v8a/librdr.so'], 'com.netflix.NGP.Kamo');
  await fs.writeFile(path.join(destination, 'base.apk'), base);
  await fs.writeFile(path.join(destination, 'split_data0.apk'), apk(['assets/data/act_android.rpf'], 'com.netflix.NGP.Kamo'));
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(required, 'com.netflix.NGP.Kamo'));
  const temp = path.join(root, 'temp'); let prepared;
  await assert.rejects(withRdrGameData({ gamePackage: destination, audioSource: source }, temp, async (folder) => {
    prepared = folder;
    assert.deepEqual(await fs.readFile(path.join(folder, 'base.apk')), base);
    assert.ok((await fs.stat(path.join(folder, 'asset-packs', 'game0', ...required[0].split('/')))).isFile());
    throw new Error('synthetic builder failure');
  }), /synthetic builder failure/);
  assert.equal(await fs.stat(prepared).catch(() => null), null);
  assert.deepEqual(await fs.readFile(path.join(destination, 'base.apk')), base);
});

test('a game-data APKS imports its game splits and ignores its replacement base APK', async (t) => {
  const { root, source, destination } = await setup(t);
  await fs.writeFile(path.join(source, 'base.apk'), 'untrusted replacement code');
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(required, 'com.rockstargames.rdr'));
  const { sevenZipPath, runSevenZip } = require('../src/archive-conversion');
  const archive = path.join(root, 'additional.apks');
  await runSevenZip(await sevenZipPath(), ['a', '-tzip', archive, '*'], { cwd: source });
  const records = await importRdrGameData(archive, destination);
  assert.equal(records.length, 7);
  assert.equal(await fs.stat(path.join(destination, 'base.apk')).catch(() => null), null);
});

test('additional resources cannot be copied through an existing destination link', async (t) => {
  const { root, source, destination } = await setup(t);
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(required, 'com.netflix.NGP.Kamo'));
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(destination, 'asset-packs'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(importRdrGameData(source, destination), /link|regular/i);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('a standalone renamed APK retains its original code when supplemental resources are selected', async (t) => {
  const { root, source, destination } = await setup(t);
  const base = apk(['lib/arm64-v8a/librdr.so'], 'com.netflix.NGP.Kamo');
  const gamePackage = path.join(destination, 'RDR.apk'); await fs.writeFile(gamePackage, base);
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(required, 'com.rockstargames.rdr'));
  await withRdrGameData({ gamePackage, audioSource: source }, path.join(root, 'temp'), async (stage) => {
    assert.deepEqual(await fs.readFile(path.join(stage, 'base.apk')), base);
  });
});

test('wrapped primary APK archives retain all original APK bytes during supplementation', async (t) => {
  const { root, source, destination } = await setup(t);
  const base = apk(['lib/arm64-v8a/librdr.so'], 'com.netflix.NGP.Kamo');
  const split = apk(['assets/data/act_android.rpf'], 'com.netflix.NGP.Kamo', 'data0');
  const wrapped = path.join(destination, 'export'); await fs.mkdir(wrapped);
  await fs.writeFile(path.join(wrapped, 'base.apk'), base); await fs.writeFile(path.join(wrapped, 'split_data0.apk'), split);
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(required, 'com.rockstargames.rdr'));
  const { sevenZipPath, runSevenZip } = require('../src/archive-conversion');
  const gamePackage = path.join(root, 'original.apks');
  await runSevenZip(await sevenZipPath(), ['a', '-tzip', gamePackage, '*'], { cwd: destination });
  await withRdrGameData({ gamePackage, audioSource: source }, path.join(root, 'temp'), async (stage) => {
    assert.deepEqual(await fs.readFile(path.join(stage, 'base.apk')), base);
    assert.deepEqual(await fs.readFile(path.join(stage, 'split_data0.apk')), split);
    assert.deepEqual((await fs.readdir(stage)).sort(), ['asset-packs', 'base.apk', 'split_data0.apk']);
  });
});

test('XAPK unsafe split paths and duplicate manifest identities are rejected', async (t) => {
  const { root, source, destination } = await setup(t);
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(required, 'com.rockstargames.rdr'));
  const { sevenZipPath, runSevenZip } = require('../src/archive-conversion');
  for (const [index, split] of [undefined, '../escape'].entries()) {
    await fs.writeFile(path.join(destination, 'one.apk'), apk(['lib/arm64-v8a/librdr.so'], 'com.netflix.NGP.Kamo'));
    await fs.writeFile(path.join(destination, 'two.apk'), apk(['assets/data/act_android.rpf'], 'com.netflix.NGP.Kamo', split));
    const gamePackage = path.join(root, `invalid-${index}.xapk`);
    await runSevenZip(await sevenZipPath(), ['a', '-tzip', gamePackage, '*'], { cwd: destination });
    await assert.rejects(withRdrGameData({ gamePackage, audioSource: source }, path.join(root, 'temp'), () => assert.fail('must not build')), /duplicate|unsafe/i);
    assert.deepEqual(await fs.readdir(path.join(root, 'temp')), []);
  }
});

test('XAPK arbitrary filenames are normalized by their original manifest split identities', async (t) => {
  const { root, source, destination } = await setup(t);
  const base = apk(['lib/arm64-v8a/librdr.so'], 'com.netflix.NGP.Kamo');
  const split = apk(['assets/data/act_android.rpf'], 'com.netflix.NGP.Kamo', 'data0');
  await fs.writeFile(path.join(destination, 'com.netflix.NGP.Kamo.apk'), base);
  await fs.writeFile(path.join(destination, 'com.netflix.NGP.Kamo.data0.apk'), split);
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(required, 'com.rockstargames.rdr'));
  const { sevenZipPath, runSevenZip } = require('../src/archive-conversion');
  const gamePackage = path.join(root, 'original.xapk');
  await runSevenZip(await sevenZipPath(), ['a', '-tzip', gamePackage, '*'], { cwd: destination });
  await withRdrGameData({ gamePackage, audioSource: source }, path.join(root, 'temp'), async (stage) => {
    assert.deepEqual(await fs.readFile(path.join(stage, 'base.apk')), base);
    assert.deepEqual(await fs.readFile(path.join(stage, 'split_data0.apk')), split);
  });
});

test('base.apk supplementation ignores unrelated sibling folders and links', async (t) => {
  const { root, source, destination } = await setup(t);
  const base = apk(['lib/arm64-v8a/librdr.so'], 'com.netflix.NGP.Kamo');
  const gamePackage = path.join(destination, 'base.apk'); await fs.writeFile(gamePackage, base);
  await fs.symlink(source, path.join(destination, 'unrelated-link'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(required, 'com.rockstargames.rdr'));
  await withRdrGameData({ gamePackage, audioSource: source }, path.join(root, 'temp'), async (stage) => {
    assert.deepEqual(await fs.readFile(path.join(stage, 'base.apk')), base);
    assert.equal(await fs.stat(path.join(stage, 'unrelated-link')).catch(() => null), null);
  });
});
