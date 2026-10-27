const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { listExportPhones, exportPhoneGame, checkPhoneGame } = require('../src/phone-export');

function apk(entries, packageId) {
  const strings = ['manifest', 'package', packageId];
  const encoded = strings.map((value) => Buffer.concat([Buffer.from([value.length, Buffer.byteLength(value)]), Buffer.from(value), Buffer.from([0])]));
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
  entries = [['AndroidManifest.xml', Buffer.concat([header, pool, ...encoded, start])], ...entries.map((name) => [name, Buffer.from('owned fixture')])];
  const locals = [], central = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name); const local = Buffer.alloc(30); const directory = Buffer.alloc(46);
    const crc = require('node:zlib').crc32(bytes);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes); central.push(directory, filename); offset += local.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const rdrData = ['act', 'animationres', 'camera', 'flash', 'fonts', 'fragments', 'gringores', 'mapres', 'naturalmotion', 'navres', 'shaders', 'strings', 'terrainboundres', 'terrainlodres', 'textures', 'treeres', 'tune', 'vfx', 'vgd'].map((name) => `assets/data/${name}_android.rpf`)
  .concat(['content', 'cutscene', 'grassres', 'psocache', 'audio', 'audio2', 'base/content'].map((name) => `assets/game/${name}_android.rpf`));

function phone(gameId = 'gta-sa-vr', options = {}) {
  const packageId = gameId === 'rdr1-vr' ? options.netflix ? 'com.netflix.NGP.Kamo' : 'com.rockstargames.rdr' : 'com.rockstargames.gtasa';
  const entries = gameId === 'rdr1-vr'
    ? { 'base.apk': ['lib/arm64-v8a/librdr.so'], 'split_data0.apk': options.incomplete ? rdrData.slice(0, 19) : rdrData }
    : { 'base.apk': [], 'split_config.arm64_v8a.apk': ['lib/arm64-v8a/libGame.so'], 'split_data_main.apk': ['assets/data/gta.dat', 'assets/anim/anim.img', 'assets/texdb/gta3.img'] };
  const files = Object.fromEntries(Object.entries(entries).map(([name, names]) => [name, apk(names, packageId)]));
  const remote = (name) => `/data/app/~~owned==/${packageId}-ABC==/${name}`;
  const requests = [];
  const privateBytes = Buffer.from('private owned game data');
  const privateRoot = `/data/user/0/${packageId}/files/assetpacks`;
  const adb = {
    listDevices: async () => [{ serial: 'QUEST', model: 'Quest 3', state: 'device' }, { serial: 'PHONE', model: 'Pixel 8', state: 'device' }],
    run: async (args) => {
      requests.push(args);
      assert.equal(args[0], '-s');
      const serial = args[1]; const command = args.slice(2);
      if (command[0] === 'shell' && command[1] === 'getprop') return command[2] === 'ro.product.model' ? (serial === 'QUEST' ? 'Quest 3' : 'Pixel 8') : (serial === 'QUEST' ? 'Oculus' : 'Google');
      assert.equal(serial, 'PHONE', 'Only the explicitly chosen phone may be read');
      if (command.slice(0, 3).join(' ') === 'shell dumpsys package') return command.at(-1) !== packageId && !options.both ? '' : options.wrongVersion ? 'versionName=9.0\nversionCode=1' : gameId === 'rdr1-vr' ? 'versionName=1.58.63226194\nversionCode=63226194' : 'versionName=2.11.311\nversionCode=4234641';
      if (command.slice(0, 2).join(' ') === 'shell id') return '2000';
      if (command.slice(0, 3).join(' ') === 'shell which su') { if (options.root) return '/system/bin/su'; throw new Error('su: not found'); }
      if (options.root && command[0] === 'shell' && command[1].startsWith("su -c '")) {
        const script = command[1].slice(7, -1);
        if (script === 'id -u') return '0';
        if (script === `ls -1 ${privateRoot}`) return options.unsafePack ? 'streamed;touch_bad' : '_tmp\nstreamed';
        if (script === `ls -1 ${privateRoot}/streamed`) return '63226194';
        if (script === `ls -1 ${privateRoot}/streamed/63226194`) return '_tmp\n20\n21';
        if (script === `cd ${privateRoot}/streamed/63226194/21/assets && find . -type f -exec stat -c %s:%n {} +`) return options.unsafePrivateFile ? '4:./../../other-app/private' : rdrData.slice(19, options.packIncomplete ? -1 : undefined).map((name) => `${privateBytes.length}:./${name.slice(7)}`).join('\n');
        if (script.startsWith(`sha256sum ${privateRoot}/streamed/63226194/21/assets/`)) return `${crypto.createHash('sha256').update(privateBytes).digest('hex')}  file`;
        throw new Error(`Unexpected privileged command: ${script}`);
      }
      if (command.slice(0, 3).join(' ') === 'shell pm path') return options.paths || Object.keys(files).map((name) => `package:${remote(name)}`).join('\n');
      if (command.slice(0, 3).join(' ') === 'shell unzip -l' && options.listing) {
        if (options.listing === 'malformed') return 'unrecognized listing';
        const names = entries[path.posix.basename(command.at(-1))];
        return `Archive: ${command.at(-1)}\n  Length      Date    Time    Name\n---------  ---------- -----   ----\n${names.map((name) => `       13  ${options.listing === 'iso' ? '2017-06-04' : '01-01-1981'} 00:00   ${name}`).join('\n')}\n---------                     -------\n      999                     ${names.length + (options.listing === 'truncated' ? 1 : 0)} files`;
      }
      const bytes = files[path.posix.basename(command.at(-1))];
      if (command.slice(0, 2).join(' ') === 'shell stat') return String(bytes.length);
      if (command.slice(0, 2).join(' ') === 'shell sha256sum') return `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${command.at(-1)}`;
      if (command[0] === 'pull') {
        await fs.writeFile(command[2], options.corrupt ? 'broken transfer' : files[path.posix.basename(command[1])]);
        return '1 file pulled';
      }
      throw new Error(`Unexpected phone mutation or command: ${command.join(' ')}`);
    },
    runToFile: async (args, destination, transfer) => {
      requests.push(args);
      assert.equal(args[1], 'PHONE'); assert.equal(args[2], 'exec-out');
      assert.ok(args[3].startsWith(`su -c 'cat ${privateRoot}/streamed/63226194/21/assets/game/`));
      assert.equal(transfer.maxBytes, privateBytes.length);
      await fs.writeFile(destination, options.privateCorrupt ? Buffer.alloc(privateBytes.length) : privateBytes, { flag: 'wx' });
    },
  };
  return { adb, files, requests };
}

test('RDR readiness reads actual APK contents without copying and does not infer completeness from count', async () => {
  const { adb, requests } = phone('rdr1-vr', { listing: true });
  const result = await checkPhoneGame('rdr1-vr', { serial: 'PHONE' }, { adb });
  assert.equal(result.status, 'complete');
  assert.equal(result.canExport, true);
  assert.equal(result.apkCount, 2);
  assert.deepEqual(result.missing, []);
  assert.equal(requests.some((args) => args[2] === 'pull' || args[2] === 'exec-out' || args.includes('su')), false);
});

for (const netflix of [false, true]) {
  test(`RDR readiness explains missing private resources for ${netflix ? 'Netflix' : 'Google Play'} before copying`, async (t) => {
    const root = await fs.mkdtemp(path.join(__dirname, '.readiness-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const { adb, requests } = phone('rdr1-vr', { netflix, incomplete: true, listing: true });
    const result = await checkPhoneGame('rdr1-vr', { serial: 'PHONE' }, { adb });
    assert.equal(result.status, 'additional-data-required');
    assert.equal(result.canExport, false);
    assert.equal(result.missing.length, 7);
    assert.match(result.message, /private.*storage/i);
    await assert.rejects(exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root }, { adb }), /additional.*data|private.*storage/i);
    assert.equal(requests.some((args) => args[2] === 'pull'), false);
    assert.deepEqual(await fs.readdir(root), []);
  });
}

test('RDR readiness accepts selected supplemental data without requiring root', async () => {
  const { adb, requests } = phone('rdr1-vr', { incomplete: true, listing: true });
  const result = await checkPhoneGame('rdr1-vr', { serial: 'PHONE', audioSource: 'D:/owned-data' }, { adb });
  assert.equal(result.status, 'additional-data-selected');
  assert.equal(result.canExport, true);
  assert.equal(requests.some((args) => args.includes('id') || args.includes('su')), false);
});

test('RDR readiness detects existing root tooling without requesting superuser access', async () => {
  const { adb, requests } = phone('rdr1-vr', { incomplete: true, listing: true, root: true });
  const result = await checkPhoneGame('rdr1-vr', { serial: 'PHONE' }, { adb });
  assert.equal(result.status, 'private-packs');
  assert.equal(result.canExport, true);
  assert.equal(requests.some((args) => args.some((arg) => arg.startsWith("su -c"))), false);
});

test('RDR readiness supports ISO dates used by Android ZIP listings', async () => {
  const { adb } = phone('rdr1-vr', { listing: 'iso', incomplete: true });
  const result = await checkPhoneGame('rdr1-vr', { serial: 'PHONE' }, { adb });
  assert.equal(result.status, 'additional-data-required');
  assert.equal(result.canExport, false);
  assert.equal(result.missing.length, 7);
});

for (const listing of [undefined, 'malformed', 'truncated']) {
  test(`RDR readiness is unknown when phone ZIP listing is ${listing || 'unavailable'}`, async () => {
    const { adb, requests } = phone('rdr1-vr', { incomplete: true, listing });
    const result = await checkPhoneGame('rdr1-vr', { serial: 'PHONE' }, { adb });
    assert.equal(result.status, 'unknown');
    assert.equal(result.canExport, true);
    assert.equal(result.missing, null);
    assert.equal(requests.some((args) => args[2] === 'pull'), false);
  });
}

test('Netflix RDR is automatically detected and a complete APK set exports without changing its package', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-netflix-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { adb } = phone('rdr1-vr', { netflix: true });
  const result = await exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root }, { adb });
  assert.equal(result.packageId, 'com.netflix.NGP.Kamo');
  const report = JSON.parse(await fs.readFile(path.join(result.gamePackage, 'vr4all-export.json'), 'utf8'));
  assert.equal(report.packageId, 'com.netflix.NGP.Kamo');
});

test('Netflix RDR with private missing packs explains root access rather than asking to install an already installed game', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-netflix-root-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { adb } = phone('rdr1-vr', { netflix: true, incomplete: true });
  await assert.rejects(exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root }, { adb }), (error) => /Netflix.*root|root.*Netflix/i.test(error.message) && !/Install the Google Play edition/.test(error.message));
  assert.deepEqual(await fs.readdir(root), []);
});

test('RDR with both editions installed requires a selection instead of silently exporting another edition', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-rdr-both-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { adb, requests } = phone('rdr1-vr', { both: true });
  await assert.rejects(exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root }, { adb }), /both.*edition|choose.*edition/i);
  assert.equal(requests.some((args) => args[2] === 'pull'), false);
});

test('Netflix RDR exports verified private packs through existing root access in the builder format', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-netflix-packs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { adb, requests } = phone('rdr1-vr', { netflix: true, incomplete: true, root: true, both: true });
  const result = await exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root, edition: 'netflix' }, { adb });
  assert.equal(result.packageId, 'com.netflix.NGP.Kamo');
  for (const name of rdrData.slice(19)) assert.equal(await fs.readFile(path.join(result.gamePackage, 'asset-packs', 'streamed', name), 'utf8'), 'private owned game data');
  const report = JSON.parse(await fs.readFile(path.join(result.gamePackage, 'vr4all-export.json'), 'utf8'));
  assert.equal(report.assetPacks.length, 7);
  assert.ok(report.assetPacks.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal(requests.filter((args) => args[2] === 'exec-out').length, 7);
  assert.ok(requests.every((args) => !/\b(?:cp|chmod|rm|install|uninstall|push)\b/.test(args.slice(2).join(' '))), 'export must stream files without changing phone storage');
});

test('Google Play RDR also exports downloaded private packs from its own package when root already exists', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-rockstar-packs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { adb, requests } = phone('rdr1-vr', { incomplete: true, root: true });
  const result = await exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root, edition: 'google-play' }, { adb });
  assert.equal(result.packageId, 'com.rockstargames.rdr');
  for (const name of rdrData.slice(19)) assert.equal(await fs.readFile(path.join(result.gamePackage, 'asset-packs', 'streamed', name), 'utf8'), 'private owned game data');
  const report = JSON.parse(await fs.readFile(path.join(result.gamePackage, 'vr4all-export.json'), 'utf8'));
  assert.equal(report.assetPacks.length, 7);
  assert.ok(report.assetPacks.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.ok(requests.every((args) => !args.join(' ').includes('com.netflix.NGP.Kamo/files')));
});

test('Google Play RDR missing packs without root reports the storage limit instead of promising another edition will fix it', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-rockstar-root-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { adb } = phone('rdr1-vr', { incomplete: true });
  await assert.rejects(exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root }, { adb }), (error) => {
    assert.match(error.message, /Google Play RDR/);
    assert.match(error.message, /private.*storage/i);
    assert.match(error.message, /root access/i);
    assert.doesNotMatch(error.message, /buy|Google Play.*without root|finish all downloads/i);
    return true;
  });
  assert.deepEqual(await fs.readdir(root), []);
});

test('private pack export rejects unrecognized package IDs before reading the phone', async () => {
  const { exportRdrPrivatePacks } = require('../src/rdr-phone-packs');
  await assert.rejects(exportRdrPrivatePacks({ packageId: 'com.other.app', adb: { run() { throw new Error('Unexpected phone access'); } } }), /unsupported.*package/i);
});

test('a fresh unrooted Netflix phone export imports explicitly selected world packs without asking for root', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-netflix-supplement-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'separate-game-data'); await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'split_game0.apk'), apk(rdrData.slice(19), 'com.rockstargames.rdr'));
  const { adb, requests } = phone('rdr1-vr', { netflix: true, incomplete: true });
  const result = await exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root, audioSource: source }, { adb });
  const report = JSON.parse(await fs.readFile(path.join(result.gamePackage, 'vr4all-export.json'), 'utf8'));
  assert.equal(report.assetPacks.length, 7);
  assert.equal(report.packageId, 'com.netflix.NGP.Kamo');
  assert.equal(report.additionalDataSource, source);
  assert.equal(requests.some((args) => args.includes('su') || args.includes('id') || args[2] === 'exec-out'), false);
  assert.equal(await readManifestPackageForTest(path.join(result.gamePackage, 'base.apk')), 'com.netflix.NGP.Kamo');
});

async function readManifestPackageForTest(file) { return require('../src/apk-verification').readManifestPackage(file); }

for (const [label, options, pattern] of [
  ['unsafe pack name', { unsafePack: true }, /unsafe|unsupported.*pack/i],
  ['unsafe file path', { unsafePrivateFile: true }, /unsafe|unsupported.*file|path/i],
  ['incomplete private packs', { packIncomplete: true }, /incomplete|missing|download/i],
  ['corrupted private transfer', { privateCorrupt: true }, /checksum|match|verification/i],
]) {
  test(`Netflix rejects ${label} and leaves no incomplete export`, async (t) => {
    const root = await fs.mkdtemp(path.join(__dirname, '.phone-netflix-fail-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const { adb } = phone('rdr1-vr', { netflix: true, incomplete: true, root: true, ...options });
    await assert.rejects(exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root }, { adb }), pattern);
    assert.deepEqual(await fs.readdir(root), []);
  });
}

test('phone source list excludes Quest and keeps unauthorized devices visible with guidance', async () => {
  const { adb } = phone();
  const list = adb.listDevices;
  adb.listDevices = async () => [...await list(), { serial: 'LOCKED', state: 'unauthorized', model: 'Android phone' }];
  const devices = await listExportPhones(adb);
  assert.deepEqual(devices.map((device) => device.serial), ['PHONE', 'LOCKED']);
  assert.equal(devices[1].state, 'unauthorized');
});

for (const gameId of ['gta-sa-vr', 'rdr1-vr']) {
  test(`${gameId} exports all APKs to a new chosen-folder child and verifies the copied bytes`, async (t) => {
    const root = await fs.mkdtemp(path.join(__dirname, '.phone-export-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const { adb, files } = phone(gameId);
    const result = await exportPhoneGame(gameId, { serial: 'PHONE', downloadLocation: root }, { adb });
    assert.equal(path.dirname(result.gamePackage), root);
    for (const [name, bytes] of Object.entries(files)) assert.deepEqual(await fs.readFile(path.join(result.gamePackage, name)), bytes);
    const report = JSON.parse(await fs.readFile(path.join(result.gamePackage, 'vr4all-export.json'), 'utf8'));
    assert.equal(report.packageId, gameId === 'rdr1-vr' ? 'com.rockstargames.rdr' : 'com.rockstargames.gtasa');
    assert.equal(report.apks.length, Object.keys(files).length);
    assert.ok(report.apks.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  });
}

for (const [label, options, message] of [
  ['wrong version', { wrongVersion: true }, /version.*2\.11\.311/i],
  ['unsafe remote path', { paths: 'package:/data/app/owned/base.apk\npackage:/data/app/../../sdcard/bad.apk' }, /unsafe|unsupported.*path/i],
  ['failed transfer verification', { corrupt: true }, /transfer|match|size|checksum/i],
]) {
  test(`export rejects ${label} and removes only its private output`, async (t) => {
    const root = await fs.mkdtemp(path.join(__dirname, '.phone-failure-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, 'keep.txt'), 'user data');
    const { adb } = phone('gta-sa-vr', options);
    await assert.rejects(() => exportPhoneGame('gta-sa-vr', { serial: 'PHONE', downloadLocation: root }, { adb }), message);
    assert.deepEqual(await fs.readdir(root), ['keep.txt']);
  });
}

test('incomplete RDR data is rejected rather than remembered as a complete export', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-incomplete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { adb } = phone('rdr1-vr', { incomplete: true });
  await assert.rejects(() => exportPhoneGame('rdr1-vr', { serial: 'PHONE', downloadLocation: root }, { adb }), /incomplete|missing.*data/i);
  assert.deepEqual(await fs.readdir(root), []);
});

test('Quest, unauthorized phones and a full destination drive cannot start a pull', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-preflight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { adb, requests } = phone();
  await assert.rejects(() => exportPhoneGame('gta-sa-vr', { serial: 'QUEST', downloadLocation: root }, { adb }), /phone|Quest/i);
  await assert.rejects(() => exportPhoneGame('gta-sa-vr', { serial: 'MISSING', downloadLocation: root }, { adb }), /connected|authorized/i);
  await assert.rejects(() => exportPhoneGame('gta-sa-vr', { serial: 'PHONE', downloadLocation: root }, { adb, statfs: async () => ({ bavail: 0, bsize: 4096 }) }), /space/i);
  assert.equal(requests.some((args) => args[2] === 'pull'), false);
  assert.deepEqual(await fs.readdir(root), []);
});
