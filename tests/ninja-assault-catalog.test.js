const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { inspectDevice } = require('../src/device-library');

function ninja() {
  const game = getCatalog().find((entry) => entry.id === 'ninja-assault-vr');
  assert.ok(game, 'Ninja Assault VR has its own library card');
  return game;
}

test('Ninja Assault is a separate Arcade rail shooter with local project artwork', () => {
  const game = ninja();
  assert.equal(game.title, 'Ninja Assault VR');
  assert.equal(game.gameName, 'Ninja Assault');
  assert.deepEqual([game.console, game.genre], ['Arcade', 'Rail shooter']);
  assert.equal(game.variantOf, undefined);
  assert.equal(game.projectUrl, 'https://github.com/vr4all-standalone/ninja-assault-vr');
  assert.ok(fs.statSync(path.join(__dirname, '..', 'public', game.art.slice(1))).size > 0);
});

test('Ninja Assault release selects its Quest APK and ignores the PC VR ZIP', () => {
  const game = ninja();
  assert.equal(game.source.repo, 'vr4all-standalone/ninja-assault-vr');
  const assets = ['ninja-assault-vr-pcvr.zip', 'ninja-assault-vr-quest.apk', 'SHA256SUMS.txt']
    .map((name) => ({ name, browser_download_url: `https://github.com/${game.source.repo}/releases/download/v1.0.0/${name}` }));
  assert.equal(selectRelease([{ tag_name: 'v1.0.0', assets }], game.source)?.assetName, 'ninja-assault-vr-quest.apk');
});

test('Ninja Assault installs the packed World cartridge and optional NAOMI BIOS without a CHD', () => {
  const game = ninja();
  assert.equal(game.fileAccessPackage, 'com.vrlightgunhub.ninjaassault');
  assert.deepEqual(game.data.map(({ id, destination, optional }) => [id, destination, Boolean(optional)]), [
    ['game', '/sdcard/Download/ninjaslt.zip', false],
    ['naomi', '/sdcard/Download/naomi.zip', true],
  ]);
  assert.match(game.guidance, /World NJA2 Ver\.A/);
  assert.match(game.guidance, /regional clones.*not supported/i);
  const plan = buildInstallPlan(game, {
    serial: 'QUEST3', apkPath: 'C:\\Downloads\\ninja-assault-vr-quest.apk',
    files: { game: 'C:\\Games\\ninjaslt.zip', naomi: 'C:\\Games\\naomi.zip' },
  });
  assert.ok(plan.some((step) => step.args.join(' ').includes('com.vrlightgunhub.ninjaassault MANAGE_EXTERNAL_STORAGE allow')));
  assert.ok(plan.some((step) => step.args.at(-1) === '/sdcard/Download/ninjaslt.zip'));
  assert.ok(plan.some((step) => step.args.at(-1) === '/sdcard/Download/naomi.zip'));
  assert.equal(plan.some((step) => /\.chd/i.test(step.args.join(' '))), false);
});

test('Ninja Assault rescan recognizes its package and requires the cartridge file', async () => {
  let gamePresent = true;
  const game = ninja();
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.vrlightgunhub.ninjaassault';
    if (command === 'shell dumpsys package com.vrlightgunhub.ninjaassault') return 'versionName=1.0.0-gc7a94cd02';
    if (command === 'shell ls -1 /sdcard/Download') return gamePresent ? 'ninjaslt.zip\nnaomi.zip' : 'naomi.zip';
    throw new Error(`Unexpected probe ${command}`);
  } };
  let scan = await inspectDevice(adb, 'QUEST3', [game]);
  assert.equal(scan[game.id]?.packageId, 'com.vrlightgunhub.ninjaassault');
  assert.equal(scan[game.id]?.dataReady, true);
  gamePresent = false;
  scan = await inspectDevice(adb, 'QUEST3', [game]);
  assert.equal(scan[game.id]?.dataReady, false);
});
