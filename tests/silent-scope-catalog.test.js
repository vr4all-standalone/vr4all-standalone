const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { buildInstallPlan, selectRelease } = require('../src/core');
const { inspectDevice, packages } = require('../src/device-library');

const discFiles = [
  'Silent Scope (USA).cue',
  'Silent Scope (USA) (Track 1).bin',
  'Silent Scope (USA) (Track 2).bin',
  'Silent Scope (USA) (Track 3).bin',
];

test('Silent Scope installs the creator Quest APK and stages all four owned Dreamcast tracks', () => {
  const game = getCatalog().find((entry) => entry.id === 'silent-scope-vr');
  assert.ok(game);
  assert.equal(game.console, 'Dreamcast');
  assert.equal(game.genre, 'Rail shooter');
  assert.equal(packages[game.id], 'com.vrlightgunhub.silentscope');
  assert.equal(game.source.repo, 'vr4all-standalone/silent-scope-vr');
  assert.equal(game.verifyApkHash, true);
  assert.equal(selectRelease([{ tag_name: 'v0.0.68', assets: [
    { name: 'silent-scope-vr-quest.apk', browser_download_url: 'https://github.com/vr4all-standalone/silent-scope-vr/releases/download/v0.0.68/silent-scope-vr-quest.apk' },
    { name: 'silent-scope-vr-source.zip', browser_download_url: 'https://github.com/vr4all-standalone/silent-scope-vr/releases/download/v0.0.68/silent-scope-vr-source.zip' },
  ] }], game.source)?.assetName, 'silent-scope-vr-quest.apk');
  assert.deepEqual(game.data[0].requiredEntries, discFiles);
  assert.deepEqual(game.data[0].copyEntries, discFiles);
  assert.equal(game.data[0].destination, '/sdcard/Download/SilentScope/');
  assert.match(game.afterInstall, /choose.*disc files/i);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', game.art)));

  const plan = buildInstallPlan(game, {
    serial: 'Quest3S', apkPath: 'C:\\Mods\\silent-scope-vr-quest.apk',
    files: { game: 'C:\\Games\\Silent Scope (USA)' }, directoryEntries: { game: discFiles },
  });
  assert.equal(plan.filter((step) => step.label.startsWith('Copy game/')).length, 4);
  for (const name of discFiles) {
    assert.ok(plan.some((step) => step.label === `Copy game/${name}` && step.args.at(-1) === '/sdcard/Download/SilentScope/'));
  }
});

test('Silent Scope is ready after the headset imports all four tracks, not just after staging them', async () => {
  const game = getCatalog().find((entry) => entry.id === 'silent-scope-vr');
  let imported = '';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.vrlightgunhub.silentscope';
    if (command === 'shell dumpsys package com.vrlightgunhub.silentscope') return 'versionName=0.0.68';
    if (command === 'shell ls -1 /sdcard/Download/SilentScope/') return discFiles.join('\n');
    if (command === 'shell ls -1 /sdcard/Android/data/com.vrlightgunhub.silentscope/files/games/dreamcast') return imported;
    return '';
  } };
  assert.equal((await inspectDevice(adb, 'Quest3S', [game]))[game.id].dataReady, false);
  imported = discFiles.slice(0, 3).join('\n');
  assert.equal((await inspectDevice(adb, 'Quest3S', [game]))[game.id].dataReady, false);
  imported = discFiles.join('\n');
  assert.equal((await inspectDevice(adb, 'Quest3S', [game]))[game.id].dataReady, true);
});
