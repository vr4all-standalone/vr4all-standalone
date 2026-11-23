const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { inspectDevice, packages } = require('../src/device-library');

test('Vib-Ribbon selects the standalone Quest ZIP, not the flat Android or Windows builds', () => {
  const game = getCatalog().find((entry) => entry.id === 'vib-ribbon-vr');
  assert.ok(game);
  assert.equal(game.sourceArchive, 'single-apk');
  assert.equal(packages[game.id], 'io.github.corriedivitt.vibribbonvr');
  assert.deepEqual(game.data[0].requiredExtensions, ['.cue', '.bin']);
  const release = selectRelease([{ tag_name: 'v1.0.0', published_at: '2026-11-22', assets: [
    { name: 'Vib-Ribbon-Android-1.0.0-experimental.zip', browser_download_url: 'https://github.com/CorrieDivitt/Ultimate-Vib-Ribbon/releases/download/v1.0.0/Vib-Ribbon-Android-1.0.0-experimental.zip' },
    { name: 'Ultimate-Vib-Ribbon-Windows-1.0.0.zip', browser_download_url: 'https://github.com/CorrieDivitt/Ultimate-Vib-Ribbon/releases/download/v1.0.0/Ultimate-Vib-Ribbon-Windows-1.0.0.zip' },
    { name: 'Vib-Ribbon-VR-Quest-1.0.0.zip', browser_download_url: 'https://github.com/CorrieDivitt/Ultimate-Vib-Ribbon/releases/download/v1.0.0/Vib-Ribbon-VR-Quest-1.0.0.zip' },
  ] }], game.source);
  assert.equal(release.assetName, 'Vib-Ribbon-VR-Quest-1.0.0.zip');
});

test('Vib-Ribbon initializes its app folder before copying the complete owned disc', () => {
  const game = getCatalog().find((entry) => entry.id === 'vib-ribbon-vr');
  const input = { serial: 'Q3', apkPath: 'C:\\Ports\\Vib-Ribbon-VR-Quest-1.0.0.apk', files: { disc: 'C:\\Games\\Vib-Ribbon' },
    directoryEntries: { disc: ['Vib-Ribbon.cue', 'track01.bin', 'track02.bin', 'notes.txt'] } };
  const plan = buildInstallPlan(game, input);
  const labels = plan.map((step) => step.label);
  assert.ok(labels.indexOf('Start Vib-Ribbon once') > labels.indexOf('Install APK'));
  assert.ok(labels.indexOf('Stop Vib-Ribbon after setup') < labels.indexOf('Copy disc/Vib-Ribbon.cue'));
  assert.deepEqual(labels.filter((label) => label.startsWith('Copy disc/')), ['Copy disc/Vib-Ribbon.cue', 'Copy disc/track01.bin', 'Copy disc/track02.bin']);
  assert.ok(labels.indexOf('Allow Vib-Ribbon to read disc files') > labels.indexOf('Copy disc/track02.bin'));
  assert.deepEqual(plan.find((step) => step.label === 'Start Vib-Ribbon once').args.slice(-4), ['am', 'start', '-n', 'io.github.corriedivitt.vibribbonvr/org.libsdl.app.SDLActivity']);
  assert.deepEqual(plan.find((step) => step.label === 'Allow Vib-Ribbon to read disc files').args.slice(-4), ['chmod', '-R', 'a+rwX', '/sdcard/Android/data/io.github.corriedivitt.vibribbonvr/files']);
  assert.throws(() => buildInstallPlan(game, { ...input, files: {} }), /Select Owned Vib-Ribbon PAL CUE and BIN folder/);
  const update = buildInstallPlan(game, { ...input, files: {}, reuseExistingData: true });
  assert.deepEqual(update.map((step) => step.label), ['Install APK']);
});

test('Vib-Ribbon is ready only when the headset has its CUE and BIN disc files', async () => {
  const game = getCatalog().find((entry) => entry.id === 'vib-ribbon-vr');
  const contents = new Map([['/sdcard/Android/data/io.github.corriedivitt.vibribbonvr/files/disc/', 'Vib-Ribbon.cue\ntrack01.bin']]);
  const adb = { run: async (args) => args.includes('pm') ? 'package:io.github.corriedivitt.vibribbonvr' : args.includes('dumpsys') ? 'versionName=1.0.0' : contents.get(args.at(-1)) || '' };
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, true);
  contents.set('/sdcard/Android/data/io.github.corriedivitt.vibribbonvr/files/disc/', 'Vib-Ribbon.cue');
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, false);
});
