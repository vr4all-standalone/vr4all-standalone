const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { inspectDevice } = require('../src/device-library');

test('Birdman64VR selects the Quest APK and transfers the owned ROM to its documented folder', () => {
  const game = getCatalog().find((entry) => entry.id === 'birdman64-vr');
  assert.ok(game);
  assert.equal(game.console, 'Nintendo 64');
  assert.equal(game.genre, 'Flight combat');
  assert.equal(game.data[0].n64Sha1, 'ec771aedf54ee1b214c25404fb4ec51cfd43191a');
  const release = selectRelease([{ tag_name: 'v1.0.0', published_at: '2026-11-19T00:00:00Z', assets: [
    { name: 'Birdman64VR-windows-x64.zip', browser_download_url: 'https://github.com/CorrieDivitt/Birdman64VR/releases/download/v1.0.0/Birdman64VR-windows-x64.zip' },
    { name: 'Birdman64VR-quest.apk', browser_download_url: 'https://github.com/CorrieDivitt/Birdman64VR/releases/download/v1.0.0/Birdman64VR-quest.apk' },
  ] }], game.source);
  assert.equal(release.assetName, 'Birdman64VR-quest.apk');
  const steps = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Downloads\\Birdman64VR-quest.apk', files: { rom: 'C:\\ROMs\\Pilotwings 64.z64' } });
  assert.deepEqual(steps.find((step) => step.label === 'Copy rom').args.slice(-2), [
    'C:\\ROMs\\Pilotwings 64.z64', '/sdcard/Android/data/app.birdman64vr/files/rom/Pilotwings 64.z64',
  ]);
});

test('Birdman64VR is ready only when both its APK and imported ROM are on the Quest', async () => {
  const game = getCatalog().find((entry) => entry.id === 'birdman64-vr');
  let roms = '';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:app.birdman64vr';
    if (command === 'shell dumpsys package app.birdman64vr') return 'versionName=1.0.0';
    if (command === 'shell ls -1 /sdcard/Android/data/app.birdman64vr/files/rom/') return roms;
    return '';
  } };
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, false);
  roms = 'Pilotwings 64.z64';
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, true);
});
