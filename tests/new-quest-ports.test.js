const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { inspectDevice, packages } = require('../src/device-library');

test('Project 06 VR selects the Quest APK and needs no separate game upload', () => {
  const game = getCatalog().find((entry) => entry.id === 'project06-vr');
  assert.ok(game);
  assert.equal(game.gameName, 'Sonic Project 06');
  assert.deepEqual([game.console, game.genre], ['PC', 'Platformer']);
  assert.equal(game.source.repo, 'moistman42069/Project06-VR');
  assert.deepEqual(game.data, []);
  assert.equal(packages[game.id], 'com.p06.quest');
  assert.equal(selectRelease([{ tag_name: 'v0.1.15', assets: [
    { name: 'p06-quest-0.1.15-source.zip', browser_download_url: 'https://github.com/moistman42069/Project06-VR/releases/download/v0.1.15/p06-quest-0.1.15-source.zip' },
    { name: 'p06-quest-0.1.15.apk', browser_download_url: 'https://github.com/moistman42069/Project06-VR/releases/download/v0.1.15/p06-quest-0.1.15.apk' },
  ] }], game.source)?.assetName, 'p06-quest-0.1.15.apk');
  assert.deepEqual(buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\p06.apk', files: {} }).map((step) => step.label), ['Install APK']);
});

test('Qualyx uses its own Quest APK and transfers only the owned Alyx game folders', () => {
  const game = getCatalog().find((entry) => entry.id === 'qualyx');
  assert.ok(game);
  assert.equal(game.gameName, 'Half-Life: Alyx');
  assert.deepEqual([game.console, game.genre], ['PC', 'Shooter']);
  assert.equal(game.source.repo, 'tinsarfal/Qualyx');
  assert.equal(packages[game.id], 'org.hlvr.quest');
  assert.deepEqual(game.data[0].requiredDirectories, ['hlvr', 'core']);
  assert.deepEqual(game.data[0].requiredNestedEntries, { hlvr: ['pak01_dir.vpk'], core: ['pak01_dir.vpk'] });
  assert.deepEqual(game.data[0].copyEntries, ['hlvr', 'core']);
  assert.equal(selectRelease([{ tag_name: '1.0.85', assets: [
    { name: 'Qualyx-1.0.85.apk', browser_download_url: 'https://github.com/tinsarfal/Qualyx/releases/download/1.0.85/Qualyx-1.0.85.apk' },
  ] }], game.source)?.assetName, 'Qualyx-1.0.85.apk');
  const plan = buildInstallPlan(game, {
    serial: 'Q3', apkPath: 'C:\\Qualyx.apk', files: { game: 'C:\\Alyx\\game' },
    directoryEntries: { game: ['hlvr', 'core', 'bin'] },
  });
  assert.deepEqual(plan.filter((step) => step.label.startsWith('Copy ')).map((step) => step.label), ['Copy game/hlvr', 'Copy game/core']);
});

test('Qualyx is ready only after both owned game archives reach the headset', async () => {
  const game = getCatalog().find((entry) => entry.id === 'qualyx');
  const files = {
    '/sdcard/Qualyx/game/hlvr': 'pak01_dir.vpk',
    '/sdcard/Qualyx/game/core': '',
  };
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:org.hlvr.quest';
    if (command === 'shell dumpsys package org.hlvr.quest') return 'versionName=1.0.85';
    if (command.startsWith('shell ls -1 ')) return files[command.slice('shell ls -1 '.length)] || '';
    return '';
  } };
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, false);
  files['/sdcard/Qualyx/game/core'] = 'pak01_dir.vpk';
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, true);
});
