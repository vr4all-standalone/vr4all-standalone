const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { buildInstallPlan } = require('../src/core');
const { inspectDevice, packages } = require('../src/device-library');
const { verifyGameFile } = require('../src/file-verification');

const id = 'max-payne-nightmare-vr';
const root = '/sdcard/Android/data/com.MPQ.HaveliSkywalker/files/';

function apkFixture(packageId) {
  const strings = ['manifest', 'package', packageId];
  const encoded = strings.map((value) => Buffer.concat([Buffer.from([value.length, value.length]), Buffer.from(value), Buffer.from([0])]));
  const pool = Buffer.alloc(28 + 4 * strings.length);
  pool.writeUInt16LE(1); pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(pool.length + encoded.reduce((sum, bytes) => sum + bytes.length, 0), 4);
  pool.writeUInt32LE(strings.length, 8); pool.writeUInt32LE(0x100, 16); pool.writeUInt32LE(pool.length, 20);
  let cursor = 0;
  encoded.forEach((bytes, index) => { pool.writeUInt32LE(cursor, 28 + index * 4); cursor += bytes.length; });
  const start = Buffer.alloc(56);
  start.writeUInt16LE(0x102); start.writeUInt16LE(16, 2); start.writeUInt32LE(56, 4);
  start.writeUInt32LE(0xffffffff, 16); start.writeUInt16LE(20, 24); start.writeUInt16LE(20, 26); start.writeUInt16LE(1, 28);
  start.writeUInt32LE(0xffffffff, 36); start.writeUInt32LE(1, 40); start.writeUInt32LE(2, 44);
  start.writeUInt16LE(8, 48); start.writeUInt8(3, 51); start.writeUInt32LE(2, 52);
  const header = Buffer.alloc(8); header.writeUInt16LE(3); header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + pool.readUInt32LE(4) + start.length, 4);
  const manifest = Buffer.concat([header, pool, ...encoded, start]);
  const filename = Buffer.from('AndroidManifest.xml');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(filename.length, 26);
  local.writeUInt32LE(manifest.length, 18); local.writeUInt32LE(manifest.length, 22);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(manifest.length, 20); central.writeUInt32LE(manifest.length, 24);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + manifest.length, 16);
  return Buffer.concat([local, filename, manifest, central, filename, end]);
}

test('Max Payne Nightmare Edition is a creator-hosted manual APK with two owned game inputs', () => {
  const game = getCatalog().find((entry) => entry.id === id);
  assert.ok(game);
  assert.equal(game.title, 'Max Payne VR: Nightmare Edition');
  assert.equal(game.gameName, 'Max Payne');
  assert.equal(game.source, undefined);
  assert.equal(game.projectUrl, 'https://drive.google.com/file/d/1_o_Q7EUyWM0OMrTU4itctTIkYyrapCnr/view');
  assert.deepEqual([game.console, game.genre], ['Android', 'Shooter']);
  assert.deepEqual(game.data.map((item) => [item.id, item.extensions, item.destination]), [
    ['mobileApk', ['.apk'], root],
    ['obb', ['.obb'], root],
  ]);
  assert.ok(game.data.every((item) => !item.optional));
  assert.equal(packages[id], 'com.MPQ.HaveliSkywalker');
});

test('Max Payne install copies the original mobile APK and OBB without renaming them', () => {
  const game = getCatalog().find((entry) => entry.id === id);
  const plan = buildInstallPlan(game, {
    serial: 'Q3S', apkPath: 'C:\\Downloads\\Max_Payne_VR_0.9.1_import321.apk',
    files: {
      mobileApk: 'C:\\Games\\MaxPayneMobile1.7.apk',
      obb: 'C:\\Games\\main.3.com.rockstar.maxpayne.obb',
    },
  });
  assert.deepEqual(plan.filter((step) => step.args.includes('push')).map((step) => step.args.at(-1)), [
    `${root}MaxPayneMobile1.7.apk`,
    `${root}main.3.com.rockstar.maxpayne.obb`,
  ]);
  assert.throws(() => buildInstallPlan(game, {
    serial: 'Q3S', apkPath: 'C:\\Downloads\\Max_Payne_VR_0.9.1_import321.apk',
    files: { mobileApk: 'C:\\Games\\MaxPayneMobile1.7.apk' },
  }), /Select.*OBB/i);
});

test('Max Payne scan distinguishes missing, staged, and imported game data', async () => {
  const game = getCatalog().find((entry) => entry.id === id);
  const contents = new Map();
  const adb = { run: async (args) => {
    if (args.includes('packages')) return 'package:com.MPQ.HaveliSkywalker\n';
    if (args.includes('dumpsys')) return 'versionName=0.9.1\n';
    if (args.includes('ls')) return (contents.get(args.at(-1)) || []).join('\n');
    return '';
  } };
  assert.equal((await inspectDevice(adb, 'Q3S', [game]))[id].dataReady, false);
  contents.set(root.replace(/\/$/, ''), ['MaxPayneMobile1.7.apk', 'main.3.com.rockstar.maxpayne.obb']);
  assert.equal((await inspectDevice(adb, 'Q3S', [game]))[id].dataReady, true);
  contents.set(root.replace(/\/$/, ''), ['maxpayne']);
  contents.set(`${root}maxpayne`, ['x_data.ras', 'x_level1.ras', 'MaxPayneSoundsv2.msf']);
  assert.equal((await inspectDevice(adb, 'Q3S', [game]))[id].dataReady, true);
});

test('Max Payne inputs reject a different mobile APK and a mismatched OBB name', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-max-payne-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const game = getCatalog().find((entry) => entry.id === id);
  const mobileApk = game.data.find((item) => item.id === 'mobileApk');
  const obb = game.data.find((item) => item.id === 'obb');
  const apk = path.join(temp, 'MaxPayneMobile.apk');
  await fs.writeFile(apk, apkFixture('com.other.game'));
  await assert.rejects(() => verifyGameFile(game, mobileApk, apk), /original Max Payne Mobile APK/);
  await fs.writeFile(apk, apkFixture('com.rockstar.maxpayne'));
  assert.equal((await verifyGameFile(game, mobileApk, apk)).level, 'package');
  const wrongObb = path.join(temp, 'main.3.com.other.game.obb');
  await fs.writeFile(wrongObb, 'fixture');
  await assert.rejects(() => verifyGameFile(game, obb, wrongObb), /main\.<number>\.com\.rockstar\.maxpayne\.obb/);
  const goodObb = path.join(temp, 'main.3.com.rockstar.maxpayne.obb');
  await fs.writeFile(goodObb, 'fixture');
  assert.equal((await verifyGameFile(game, obb, goodObb)).level, 'filename');
});
