const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ORIGINAL_NAME, inspectCrazyTaxiOriginal, readApkPackage, downloadVerified, installOnQuest, installCrazyTaxi,
} = require('../src/crazy-taxi-runner');

function zip(entries) {
  const locals = [];
  const directories = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directories.push(central, filename);
    offset += local.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(directories);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function binaryManifest(packageName) {
  const strings = ['manifest', 'package', packageName];
  const encoded = strings.map((value) => {
    const bytes = Buffer.from(value);
    return Buffer.concat([Buffer.from([value.length, bytes.length]), bytes, Buffer.from([0])]);
  });
  const pool = Buffer.alloc(28 + 4 * strings.length);
  pool.writeUInt16LE(0x0001);
  pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(pool.length + encoded.reduce((sum, value) => sum + value.length, 0), 4);
  pool.writeUInt32LE(strings.length, 8);
  pool.writeUInt32LE(0x100, 16);
  pool.writeUInt32LE(pool.length, 20);
  let cursor = 0;
  encoded.forEach((value, index) => { pool.writeUInt32LE(cursor, 28 + index * 4); cursor += value.length; });
  const start = Buffer.alloc(56);
  start.writeUInt16LE(0x0102);
  start.writeUInt16LE(16, 2);
  start.writeUInt32LE(start.length, 4);
  start.writeUInt32LE(0xffffffff, 16);
  start.writeUInt32LE(0, 20);
  start.writeUInt16LE(20, 24);
  start.writeUInt16LE(20, 26);
  start.writeUInt16LE(1, 28);
  start.writeUInt32LE(0xffffffff, 36);
  start.writeUInt32LE(1, 40);
  start.writeUInt32LE(2, 44);
  start.writeUInt16LE(8, 48);
  start.writeUInt8(3, 51);
  start.writeUInt32LE(2, 52);
  const xml = Buffer.alloc(8);
  xml.writeUInt16LE(0x0003);
  xml.writeUInt16LE(8, 2);
  xml.writeUInt32LE(xml.length + pool.readUInt32LE(4) + start.length, 4);
  return Buffer.concat([xml, pool, ...encoded, start]);
}

async function fixture(t, name, entries) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-crazy-taxi-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, name);
  await fs.writeFile(file, zip(entries));
  return file;
}

test('accepts the compatible original APKM bytes with either .apkm or .apk extension', async (t) => {
  const original = await fixture(t, ORIGINAL_NAME, [
    ['info.json', JSON.stringify({ pname: 'com.sega.CrazyTaxiplayhaven', release_version: '6.0-80' })],
    ['base.apk', 'fixture'],
  ]);
  assert.match((await inspectCrazyTaxiOriginal(original)).message, /metadata/i);
  const renamed = path.join(path.dirname(original), 'owned-crazy-taxi.apk');
  await fs.copyFile(original, renamed);
  assert.equal((await inspectCrazyTaxiOriginal(renamed)).kind, 'original-apkm');
});

test('recognizes an already patched Crazy Taxi VR APK regardless of .apk or .apkm extension', async (t) => {
  const apk = await fixture(t, 'Crazy-Taxi-VR.apk', [['AndroidManifest.xml', binaryManifest('com.baywilly.crazytaxivr')]]);
  assert.equal((await inspectCrazyTaxiOriginal(apk)).kind, 'vr-apk');
  const mislabeled = path.join(path.dirname(apk), ORIGINAL_NAME);
  await fs.copyFile(apk, mislabeled);
  assert.equal((await inspectCrazyTaxiOriginal(mislabeled)).kind, 'vr-apk');
  const unrelated = await fixture(t, 'not-crazy-taxi.apk', [['AndroidManifest.xml', binaryManifest('com.other.game')]]);
  await assert.rejects(inspectCrazyTaxiOriginal(unrelated), /package|Crazy Taxi/i);
});

test('rejects a misleading APKM whose content names another game', async (t) => {
  const original = await fixture(t, ORIGINAL_NAME, [
    ['info.json', JSON.stringify({ pname: 'com.other.game', release_version: '6.0-80' })],
    ['base.apk', 'fixture'],
  ]);
  await assert.rejects(inspectCrazyTaxiOriginal(original), /package/i);
});

test('rejects a different Crazy Taxi revision despite the expected filename', async (t) => {
  const original = await fixture(t, ORIGINAL_NAME, [
    ['info.json', JSON.stringify({ pname: 'com.sega.CrazyTaxiplayhaven', release_version: '6.0-81' })],
    ['base.apk', 'fixture'],
  ]);
  await assert.rejects(inspectCrazyTaxiOriginal(original), /version/i);
});

test('reads binary Android manifest package from the patched APK', async (t) => {
  const apk = await fixture(t, 'output.apk', [['AndroidManifest.xml', binaryManifest('com.baywilly.crazytaxivr')]]);
  assert.equal(await readApkPackage(apk), 'com.baywilly.crazytaxivr');
});

test('already patched Crazy Taxi VR APK installs without downloading or applying the patch', async (t) => {
  const apk = await fixture(t, ORIGINAL_NAME, [['AndroidManifest.xml', binaryManifest('com.baywilly.crazytaxivr')]]);
  const outputPath = path.join(path.dirname(apk), 'Crazy-Taxi-VR-output.apk');
  const calls = [];
  let installedBytes;
  const adb = { run: async (args) => {
    calls.push(args);
    if (args.includes('install')) installedBytes = await fs.readFile(args.at(-1));
    return args.includes('install') ? 'Success' : 'package:/data/app/com.baywilly.crazytaxivr/base.apk';
  } };
  const result = await installCrazyTaxi({ originalPath: apk, serial: 'Quest-1', adb, outputPath }, {
    fetchImpl: async () => { throw new Error('An already patched APK must not download the patch'); },
  });
  assert.equal(result.kind, 'vr-apk');
  assert.equal(result.tag, null);
  assert.equal(result.apkPath, null);
  assert.equal(await fs.stat(outputPath).catch(() => null), null, 'do not duplicate an already patched APK');
  assert.deepEqual(installedBytes, await fs.readFile(apk));
  assert.equal(path.extname(calls[0].at(-1)), '.apk');
  const normalApk = path.join(path.dirname(apk), 'provided-vr.apk');
  await fs.copyFile(apk, normalApk);
  calls.length = 0;
  await installCrazyTaxi({ originalPath: normalApk, serial: 'Quest-1', adb, outputPath });
  assert.deepEqual(calls[0], ['-s', 'Quest-1', 'install', '-r', normalApk]);
});

test('install rejects invalid headset selection before downloading', async (t) => {
  const original = await fixture(t, ORIGINAL_NAME, [
    ['info.json', JSON.stringify({ pname: 'com.sega.CrazyTaxiplayhaven', release_version: '6.0-80' })],
    ['base.apk', 'fixture'],
  ]);
  let fetched = false;
  await assert.rejects(installCrazyTaxi({ originalPath: original, serial: '../bad', adb: { run() {} } }, {
    fetchImpl: async () => { fetched = true; throw new Error('unexpected fetch'); },
  }), /connected Quest/i);
  assert.equal(fetched, false);
});

test('install rejects an invalid APK destination before downloading', async (t) => {
  const original = await fixture(t, ORIGINAL_NAME, [
    ['info.json', JSON.stringify({ pname: 'com.sega.CrazyTaxiplayhaven', release_version: '6.0-80' })],
    ['base.apk', 'fixture'],
  ]);
  let fetched = false;
  await assert.rejects(installCrazyTaxi({ originalPath: original, serial: 'Quest-1', adb: { run() {} }, outputPath: original }, {
    fetchImpl: async () => { fetched = true; throw new Error('unexpected fetch'); },
  }), /distinct.*APK output/i);
  assert.equal(fetched, false);
});

test('download verifies the official asset digest before accepting bytes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-crazy-taxi-download-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const body = Buffer.from('verified fixture');
  const expected = crypto.createHash('sha256').update(body).digest('hex');
  const asset = { url: 'https://github.com/example/asset', sha256: expected, maxBytes: 1024 };
  const good = path.join(root, 'good.bin');
  await downloadVerified(asset, good, async () => new Response(body));
  assert.deepEqual(await fs.readFile(good), body);
  await assert.rejects(downloadVerified(asset, path.join(root, 'bad.bin'), async () => new Response('tampered')), /SHA-256/i);
  await assert.rejects(downloadVerified({ ...asset, maxBytes: 4 }, path.join(root, 'large.bin'), async () => new Response(body)), /limit/i);
});

test('install confirms ADB success and the package on the selected Quest', async () => {
  const calls = [];
  const adb = { run: async (args) => {
    calls.push(args);
    return args.includes('install') ? 'Success' : 'package:/data/app/com.baywilly.crazytaxivr/base.apk';
  } };
  await installOnQuest(adb, 'Quest-1', 'C:\\owned\\crazy.apk');
  assert.deepEqual(calls, [
    ['-s', 'Quest-1', 'install', '-r', 'C:\\owned\\crazy.apk'],
    ['-s', 'Quest-1', 'shell', 'pm', 'path', 'com.baywilly.crazytaxivr'],
  ]);
});

test('install does not report success when ADB or package check fails', async () => {
  await assert.rejects(installOnQuest({ run: async () => 'Failure [INSTALL_FAILED]' }, 'Q1', 'game.apk'), /ADB.*install/i);
  await assert.rejects(installOnQuest({ run: async (args) => args.includes('install') ? 'Success' : '' }, 'Q1', 'game.apk'), /not found.*Quest/i);
});
