const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { buildInstallPlan, selectRelease } = require('../src/core');
const { inspectDevice } = require('../src/device-library');
const { scanLibraryFolder } = require('../src/library-folder');
const { verifyGameFile } = require('../src/file-verification');

const profile = (id) => getCatalog().find((game) => game.id === id);
const release = (name) => [{ tag_name: 'v1.0.0', assets: [{ name, browser_download_url: `https://github.com/vr4all-standalone/hotd2-arcade-vr/releases/download/v1.0.0/${name}` }] }];

test('HOTD2 arcade installs its own APK and a packed USA set with optional separate special BIOS', () => {
  const game = profile('hotd2-vr');
  assert.equal(game.source.repo, 'vr4all-standalone/hotd2-arcade-vr');
  assert.equal(game.projectUrl, 'https://github.com/vr4all-standalone/hotd2-arcade-vr');
  assert.deepEqual([game.console, game.genre], ['Arcade', 'Rail shooter']);
  const input = { serial: 'TEST', apkPath: 'C:\\Ports\\hotd2-arcade-vr-quest.apk', files: { hotd2: 'C:\\Owned\\hotd2.zip' } };
  const plan = buildInstallPlan(game, input).map(({ args }) => args);
  assert.ok(plan.some((args) => args.join(' ') === '-s TEST shell appops set com.vrlightgunhub.hotd2arcade MANAGE_EXTERNAL_STORAGE allow'));
  assert.deepEqual(plan.filter((args) => args[2] === 'push'), [['-s', 'TEST', 'push', 'C:\\Owned\\hotd2.zip', '/sdcard/Download/hotd2.zip']]);
  const withBios = buildInstallPlan(game, { ...input, files: { ...input.files, hod2bios: 'C:\\Owned\\hod2bios.zip' } });
  assert.ok(withBios.some(({ args }) => args.join(' ') === '-s TEST push C:\\Owned\\hod2bios.zip /sdcard/Download/hod2bios.zip'));
  assert.throws(() => buildInstallPlan(game, { ...input, files: {} }), /Select/);
  for (const extension of ['chd', 'cdi', 'gdi']) assert.throws(() => buildInstallPlan(game, { ...input, files: { hotd2: `C:\\Owned\\hotd2.${extension}` } }), /must be .zip/);
  assert.match(game.guidance, /USA/);
  assert.match(game.guidance, /b23d1a0c/i);
  assert.match(game.guidance, /20 MPR/i);
  assert.match(game.guidance, /hod2bios\.zip/);
});

test('standalone release selectors reject the sibling port and non-Quest assets', () => {
  const cases = [
    ['hotd2-vr', 'hotd2-arcade-vr-quest.apk', ['hotd2-vr-quest.apk', 'mok-vr-quest.apk', 'hotd2-arcade-vr-pico.apk', 'hotd2-arcade-vr-pcvr.zip', 'hotd2-arcade-vr-quest.apk.sha256']],
    ['mok-vr', 'mok-vr-quest.apk', ['hotd2-vr-quest.apk', 'hotd2-arcade-vr-quest.apk', 'mok-vr-pico.apk', 'mok-vr-pcvr.zip', 'mok-vr-quest.apk.sha256']],
  ];
  for (const [id, wanted, rejected] of cases) {
    assert.equal(selectRelease(release(wanted), profile(id).source)?.assetName, wanted, id);
    for (const name of rejected) assert.equal(selectRelease(release(name), profile(id).source), null, `${id}: ${name}`);
  }
});

test('older HOTD2 and MOK ports remain variants with their original media and release', () => {
  const dreamcast = profile('hotd2-dreamcast-vr');
  const upstream = profile('mok-upstream-vr');
  assert.equal(dreamcast?.variantOf, 'hotd2-vr');
  assert.equal(upstream?.variantOf, 'mok-vr');
  for (const game of [dreamcast, upstream]) {
    assert.equal(game.source.repo, 'mikermak/hotd2-vr');
    assert.equal(selectRelease(release('hotd2-vr-quest.apk'), game.source)?.assetName, 'hotd2-vr-quest.apk');
  }
  assert.deepEqual(dreamcast.data[0].extensions, ['.chd', '.cdi']);
  assert.deepEqual(upstream.data.map(({ id, destination, optional }) => [id, destination, Boolean(optional)]), [
    ['mok', '/sdcard/Download/mok.zip', false], ['chd', '/sdcard/Download/mok/gds-0022.chd', false], ['naomi', '/sdcard/Download/naomi.zip', true],
  ]);
  const roots = getCatalog().filter((game) => !game.variantOf);
  assert.equal(roots.filter((game) => game.id === 'hotd2-vr').length, 1);
  assert.equal(roots.filter((game) => game.id === 'mok-vr').length, 1);
});

test('generic upstream package never marks either standalone port installed', async () => {
  const games = getCatalog().filter((game) => ['hotd2-vr', 'hotd2-dreamcast-vr', 'mok-vr', 'mok-upstream-vr'].includes(game.id));
  let installed = ['com.flycast.emulator.vr'];
  let names = 'House of the Dead 2.chd\nmok.zip\nhotd2.zip';
  let chd = 'gds-0022.chd';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return installed.map((id) => `package:${id}`).join('\n');
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0.0-gabc123';
    if (command === 'shell ls -1 /sdcard/Download' || command === 'shell ls -1 /sdcard/Download/') return names;
    if (command === 'shell ls -1 /sdcard/Download/mok') return chd;
    throw new Error(`Unexpected device probe: ${command}`);
  } };
  let scan = await inspectDevice(adb, 'TEST', games);
  assert.equal(scan['hotd2-vr'], undefined);
  assert.equal(scan['mok-vr'], undefined);
  assert.equal(scan['hotd2-dreamcast-vr']?.dataReady, true);
  assert.equal(scan['mok-upstream-vr']?.dataReady, true);
  assert.equal(scan['hotd2-dreamcast-vr']?.versionComparable, false);
  assert.equal(scan['mok-upstream-vr']?.versionComparable, false);
  installed.push('com.vrlightgunhub.hotd2arcade', 'com.vrlightgunhub.mok');
  scan = await inspectDevice(adb, 'TEST', games);
  assert.equal(scan['hotd2-vr']?.packageId, 'com.vrlightgunhub.hotd2arcade');
  assert.equal(scan['hotd2-vr']?.dataReady, true, 'embedded BIOS does not require a separate ZIP');
  assert.equal(scan['hotd2-vr']?.versionComparable, true);
  assert.equal(scan['mok-vr']?.versionComparable, true);
  names = 'House of the Dead 2.chd\nmok.zip\nhod2bios.zip';
  scan = await inspectDevice(adb, 'TEST', games);
  assert.equal(scan['hotd2-vr']?.dataReady, false, 'a Dreamcast disc and BIOS do not replace the arcade set');
  assert.equal(scan['mok-vr']?.dataReady, true);
  names += '\nhotd2.zip'; chd = '';
  scan = await inspectDevice(adb, 'TEST', games);
  assert.equal(scan['hotd2-vr']?.dataReady, true);
  assert.equal(scan['mok-vr']?.dataReady, false);
  assert.equal(scan['mok-upstream-vr']?.dataReady, false);
});

test('library scanning keeps arcade ZIPs and standalone APKs separate from Dreamcast media', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-hotd2-'));
  try {
    const game = profile('hotd2-vr');
    const zip = Buffer.from('504b0304000000000000000000000000000000000000000000000100000061504b010200000000000000000000000000000000000000000000000001000000000000000000000000000000000061504b050600000000010001002f0000001f0000000000', 'hex');
    await fs.writeFile(path.join(root, 'hotd2.zip'), zip);
    await fs.writeFile(path.join(root, 'House of the Dead 2.chd'), 'disc');
    await fs.writeFile(path.join(root, 'hotd2-arcade-vr-quest.apk'), 'apk');
    const verification = await verifyGameFile(game, game.data.find((item) => item.id === 'hotd2'), path.join(root, 'hotd2.zip'));
    assert.equal(verification.level, 'format');
    assert.match(verification.message, /contents are not independently verified/);
    const result = await scanLibraryFolder(root, getCatalog(), {}, { inspectApk: async () => 'com.vrlightgunhub.hotd2arcade' });
    const native = result.matches.find((match) => match.gameId === 'hotd2-vr');
    assert.equal(native?.files.hotd2, path.join(root, 'hotd2.zip'));
    assert.equal(native?.apkPath, path.join(root, 'hotd2-arcade-vr-quest.apk'));
    assert.equal(Object.values(native.files).some((file) => file.endsWith('.chd')), false);
    const dreamcast = result.matches.find((match) => match.gameId === 'hotd2-dreamcast-vr');
    assert.equal(dreamcast?.files.disc, path.join(root, 'House of the Dead 2.chd'));
    assert.equal(dreamcast?.apkPath, '');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
