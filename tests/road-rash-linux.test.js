const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { installRoadRashLinux, findPackageRoot, identifyDisc, normalizeDisc, DISC_IDENTITY } = require('../src/road-rash-linux');
const { buildDisc, fixtureIdentity, fakeAdb, PARTS, sha1 } = require('./helpers/road-rash-disc');
const { sevenZipBinary } = require('./helpers/seven-zip');

const REMOTE = '/sdcard/Android/data/com.rrjb.vr/files/disc.bin';
const APK = 'RoadRashJailbreak-VR-0.1.0.apk';
const REQUIRED = ['tools/rrgame.exe', 'tools/rrtool.exe', 'scripts/install-player.ps1', 'scripts/install.ps1',
  'scripts/install-quest-player.ps1', 'scripts/platform-tools.ps1', 'scripts/transfer-saves.ps1'];

async function writePackage(root, { drop = [], phantom = [], manifest = {}, tamper } = {}) {
  const names = [...REQUIRED, APK].filter((name) => !drop.includes(name));
  // Manifest entries that point outside the package are never written to disk.
  const files = phantom.map((name) => ({ path: name, bytes: 1, sha256: '0'.repeat(64) }));
  for (const name of names) {
    const data = Buffer.from(`content of ${name}`);
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), tamper === name ? 'changed' : data);
    files.push({ path: name, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex').toUpperCase() });
  }
  const text = JSON.stringify({ name: 'Road Rash: Jailbreak PC & VR', version: '0.1.0', package: 'com.rrjb.vr', quest: true, files, ...manifest });
  await fs.writeFile(path.join(root, 'release-manifest.json'), '\uFEFF' + text);
  return root;
}

async function fixture(run, packageOptions) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-road-rash-linux-'));
  try {
    const packageRoot = await writePackage(path.join(root, 'package'), packageOptions);
    const bin = path.join(root, 'disc.bin');
    await fs.writeFile(bin, buildDisc());
    return await run({ root, packageRoot, bin, work: path.join(root, 'work') });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

const input = (ctx, adb, overrides = {}) => ({ adb, serial: 'Q3', discImage: ctx.bin, work: ctx.work, release: { tag: 'v0.1.0' }, onLog: () => {}, ...overrides });

test('the production identity pins the creator table', () => {
  assert.equal(DISC_IDENTITY.volume, 'SLUS_01053');
  assert.deepEqual(DISC_IDENTITY.parts.map((part) => [part.name, part.size]), [['SLUS_010.53', 311296], ['RASHCDF.BIN', 283936], ['RASHCDG.BIN', 467080], ['RASHCDI.BIN', 79196]]);
  assert.equal(DISC_IDENTITY.parts[0].sha1, '67ed165a2c517d4e6106fb0dfa324d66dd9a76f1');
});

test('identifyDisc accepts a matching MODE2/2352 image', async () => {
  await fixture(async ({ bin }) => {
    assert.deepEqual(await identifyDisc(bin, fixtureIdentity), { supported: true, volume: 'SLUS_01053', reason: null });
  });
});

test('identifyDisc explains a wrong volume, a missing overlay, a modified executable and a modified overlay', async () => {
  await fixture(async ({ root }) => {
    const image = async (name, options) => { const file = path.join(root, name); await fs.writeFile(file, buildDisc(options)); return identifyDisc(file, fixtureIdentity); };
    assert.match((await image('v.bin', { volume: 'OTHER' })).reason, /^unexpected volume id OTHER$/);
    assert.match((await image('vx.bin', { volume: 'OTHER', omit: ['SLUS_010.53'] })).reason, /^volume OTHER is not Road Rash: Jailbreak \(USA\), SLUS_01053$/);
    assert.match((await image('x.bin', { omit: ['SLUS_010.53'] })).reason, /^the executable SLUS_010\.53 is missing$/);
    assert.match((await image('o.bin', { omit: ['RASHCDG.BIN'] })).reason, /^RASHCDG\.BIN is missing$/);
    const changed = (name) => PARTS.map(([part, bytes]) => [part, part === name ? Buffer.alloc(bytes.length, 9) : bytes]);
    assert.match((await image('e.bin', { parts: changed('SLUS_010.53') })).reason, /^SLUS_010\.53 has SHA-1 [0-9a-f]{40}, not the supported [0-9a-f]{8}…/);
    assert.match((await image('m.bin', { parts: changed('RASHCDI.BIN') })).reason, /^RASHCDI\.BIN differs from the supported release \(SHA-1 [0-9a-f]{40}\)$/);
  });
});

test('identifyDisc rejects a 2048-byte ISO and an image without an ISO9660 descriptor', async () => {
  await fixture(async ({ root }) => {
    const iso = path.join(root, 'plain.bin');
    await fs.writeFile(iso, Buffer.alloc(2048 * 100));
    await assert.rejects(identifyDisc(iso, fixtureIdentity), /not a raw 2352-byte-sector BIN image/);
    const blank = path.join(root, 'blank.bin');
    await fs.writeFile(blank, Buffer.alloc(2352 * 40));
    await assert.rejects(identifyDisc(blank, fixtureIdentity), /no ISO9660 primary volume descriptor at LBA 16/);
    const short = path.join(root, 'short.bin');
    await fs.writeFile(short, Buffer.alloc(2352 * 10));
    await assert.rejects(identifyDisc(short, fixtureIdentity), /past end of image/);
  });
});

test('normalizeDisc accepts a single-track CUE, including a BOM and a backslash BIN name', async () => {
  await fixture(async ({ root, bin, work }) => {
    const cue = path.join(root, 'game.cue');
    await fs.writeFile(cue, '\uFEFFFILE "disc.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n');
    assert.equal(await normalizeDisc(cue, work), bin);
    await fs.writeFile(cue, 'FILE "sub\\disc.bin" BINARY\n  TRACK 01 MODE2/2352\n');
    await assert.rejects(normalizeDisc(cue, work), /missing BIN image/);
    assert.equal(await normalizeDisc(bin, work), bin);
  });
});

test('normalizeDisc rejects a CUE with two FILE lines or a non-MODE2 track', async () => {
  await fixture(async ({ root, work }) => {
    const cue = path.join(root, 'two.cue');
    await fs.writeFile(cue, 'FILE "a.bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "b.bin" BINARY\n  TRACK 02 AUDIO\n');
    await assert.rejects(normalizeDisc(cue, work), /single data-track MODE2\/2352 BIN\/CUE dump/);
    await fs.writeFile(cue, 'FILE "a.bin" BINARY\n  TRACK 01 MODE1/2048\n');
    await assert.rejects(normalizeDisc(cue, work), /single data-track MODE2\/2352 BIN\/CUE dump/);
  });
});

test('normalizeDisc extracts the single BIN of a ZIP and rejects a ZIP with two', async () => {
  await fixture(async ({ root, work }) => {
    const source = path.join(root, 'zip-src');
    await fs.mkdir(path.join(source, 'Road Rash'), { recursive: true });
    await fs.writeFile(path.join(source, 'Road Rash', 'RR.BIN'), 'disc');
    await fs.writeFile(path.join(source, 'Road Rash', 'RR.cue'), 'cue');
    const archive = path.join(root, 'one.zip');
    assert.equal(spawnSync(sevenZipBinary(), ['a', '-tzip', archive, '.'], { cwd: source, windowsHide: true }).status, 0);
    assert.equal(await normalizeDisc(archive, work), path.join(work, 'Road Rash', 'RR.BIN'));
    await fs.writeFile(path.join(source, 'Road Rash', 'EXTRA.bin'), 'more');
    const two = path.join(root, 'two.zip');
    assert.equal(spawnSync(sevenZipBinary(), ['a', '-tzip', two, '.'], { cwd: source, windowsHide: true }).status, 0);
    await assert.rejects(normalizeDisc(two, path.join(root, 'work2')), /exactly one BIN image \(found 2\)/);
  });
});

test('findPackageRoot finds the unique folder holding the manifest and installer script', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-road-rash-root-'));
  try {
    await fs.mkdir(path.join(root, 'RoadRashJailbreak-0.1.0', 'scripts'), { recursive: true });
    await fs.writeFile(path.join(root, 'RoadRashJailbreak-0.1.0', 'release-manifest.json'), '{}');
    await assert.rejects(findPackageRoot(root), /missing its installer script/);
    await fs.writeFile(path.join(root, 'RoadRashJailbreak-0.1.0', 'scripts', 'install-player.ps1'), '');
    assert.equal(await findPackageRoot(root), path.join(root, 'RoadRashJailbreak-0.1.0'));
    await fs.rm(path.join(root, 'RoadRashJailbreak-0.1.0', 'release-manifest.json'));
    await assert.rejects(findPackageRoot(root), /missing its release manifest/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Road Rash on Linux verifies the disc first, then installs, copies and verifies without ever clearing data', async () => {
  await fixture(async (ctx) => {
    const adb = fakeAdb();
    const logs = [];
    const result = await installRoadRashLinux(ctx.packageRoot, input(ctx, adb, { onLog: (line) => logs.push(line) }), { identity: fixtureIdentity });
    assert.deepEqual(result, { exitCode: 0, tag: 'v0.1.0' });
    const verbs = adb.calls.map((call) => call.split(' ')[0]);
    assert.deepEqual(verbs, ['devices', 'install', 'mkdir', 'if', 'push', 'stat', 'sha1sum', 'dumpsys']);
    assert.equal(adb.calls.find((call) => call.startsWith('install')), `install -r ${path.join(ctx.packageRoot, APK)}`);
    assert.ok(!adb.calls.some((call) => /uninstall|pm clear/.test(call)));
    assert.ok(logs.some((line) => /Disc identified: Road Rash: Jailbreak \(USA\) SLUS-01053/.test(line)));
    assert.ok(logs.some((line) => line.startsWith('Disc verified on the headset: ' + REMOTE)));
    assert.ok(logs.includes('Installed com.rrjb.vr 0.1.0.'));
    assert.ok(logs.some((line) => /rrtool checks run only on Windows/.test(line)));
  });
});

test('Road Rash on Linux does not copy a disc that is already identical on the headset', async () => {
  await fixture(async (ctx) => {
    const adb = fakeAdb({ remote: await fs.readFile(ctx.bin) });
    const logs = [];
    await installRoadRashLinux(ctx.packageRoot, input(ctx, adb, { onLog: (line) => logs.push(line) }), { identity: fixtureIdentity });
    assert.ok(!adb.calls.some((call) => call.startsWith('push')));
    assert.ok(logs.includes('The disc image on the headset is already identical; not copied again.'));
  });
});

test('Road Rash on Linux refuses an unsupported disc before touching the headset', async () => {
  await fixture(async (ctx) => {
    await fs.writeFile(ctx.bin, buildDisc({ omit: ['RASHCDG.BIN'] }));
    const adb = fakeAdb();
    await assert.rejects(installRoadRashLinux(ctx.packageRoot, input(ctx, adb), { identity: fixtureIdentity }), (error) => {
      assert.equal(error.message, `Unsupported disc image: ${ctx.bin}\nRASHCDG.BIN is missing\nOnly Road Rash: Jailbreak (USA), SLUS-01053, executable SHA-1 ${fixtureIdentity.parts[0].sha1} is supported.`);
      return true;
    });
    assert.deepEqual(adb.calls, []);
  });
});

test('Road Rash on Linux fails when the Quest is not connected and authorized, the install fails, or the copy is wrong', async () => {
  await fixture(async (ctx) => {
    const options = { identity: fixtureIdentity };
    await assert.rejects(installRoadRashLinux(ctx.packageRoot, input(ctx, fakeAdb({ devices: [{ serial: 'Q3', state: 'unauthorized' }] })), options), /not connected and authorized/);
    const failing = fakeAdb({ installOutput: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]' });
    await assert.rejects(installRoadRashLinux(ctx.packageRoot, input(ctx, failing), options), /APK installation failed.*INSTALL_FAILED_UPDATE_INCOMPATIBLE/);
    assert.ok(!failing.calls.some((call) => /uninstall|pm clear|mkdir/.test(call)));
    await assert.rejects(installRoadRashLinux(ctx.packageRoot, input(ctx, fakeAdb({ truncate: true })), options), /Disc size differs on the headset/);
    await assert.rejects(installRoadRashLinux(ctx.packageRoot, input(ctx, fakeAdb({ corrupt: true })), options), /Disc SHA-1 differs on the headset/);
  });
});

test('Road Rash on Linux verifies every package file and the manifest rules before any disc or adb work', async () => {
  const cases = [
    [{ tamper: 'tools/rrtool.exe' }, /Release file failed verification: tools\/rrtool\.exe/],
    [{ drop: ['scripts/transfer-saves.ps1'] }, /Required release file is missing from the manifest: scripts\/transfer-saves\.ps1/],
    [{ drop: [APK] }, /no Quest APK yet/],
    [{ manifest: { version: 'x' } }, /Unexpected release version/],
    [{ manifest: { package: 'com.other' } }, /Unexpected release package/],
    [{ phantom: ['../escape.txt'] }, /Invalid release manifest path/],
    [{ phantom: ['C:/x.txt'] }, /Invalid release manifest path/],
  ];
  for (const [packageOptions, expected] of cases) {
    await fixture(async (ctx) => {
      const adb = fakeAdb();
      await assert.rejects(installRoadRashLinux(ctx.packageRoot, input(ctx, adb), { identity: fixtureIdentity }), expected);
      assert.deepEqual(adb.calls, []);
    }, packageOptions);
  }
});
