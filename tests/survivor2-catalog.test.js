const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { inspectDevice } = require('../src/device-library');

function survivor() {
  const game = getCatalog().find((entry) => entry.id === 'survivor2-code-veronica-vr');
  assert.ok(game, 'Survivor 2 has its own library card');
  return game;
}

test('Survivor 2 is a separate Arcade shooter with local artwork and regular release naming', () => {
  const game = survivor();
  assert.equal(game.title, 'Survivor 2 - Code: Veronica VR');
  assert.equal(game.gameName, 'Resident Evil Survivor 2 - Code: Veronica');
  assert.deepEqual([game.console, game.genre], ['Arcade', 'Shooter']);
  assert.equal(game.variantOf, undefined);
  assert.equal(game.projectUrl, 'https://github.com/vr4all-standalone/survivor2-code-veronica-vr');
  assert.equal(game.art, '/art/survivor2-code-veronica-vr.jpg');
  assert.doesNotMatch(game.description, /preview/i);
  assert.match(game.description, /single.player/i);
  assert.ok(fs.statSync(path.join(__dirname, '..', 'public', game.art.slice(1))).size > 0);
});

test('Survivor 2 selects its preview Quest APK while ignoring PC archives and draft releases', () => {
  const { source } = survivor();
  const release = (names, extras = {}) => ({
    tag_name: 'v1.0.0-preview.1', prerelease: true, ...extras,
    assets: names.map((name) => ({ name,
      browser_download_url: `https://github.com/${source.repo}/releases/download/v1.0.0-preview.1/${name}` })),
  });
  const unrelated = ['survivor2-code-veronica-vr-pcvr.zip', 'ninja-assault-vr-quest.apk',
    'survivor2-code-veronica-vr-quest-debug.apk', 'survivor2-code-veronica-vr-quest.apk.zip'];
  assert.equal(selectRelease([release(unrelated)], source), null);
  assert.equal(selectRelease([release(['survivor2-code-veronica-vr-quest.apk'], { draft: true })], source), null);
  const selected = selectRelease([release([...unrelated, 'survivor2-code-veronica-vr-quest.apk'])], source);
  assert.equal(selected.assetName, 'survivor2-code-veronica-vr-quest.apk');
  assert.equal(selected.prerelease, true);
});

test('Survivor 2 transfers only the packed World cartridge and optional separate BIOS', () => {
  const game = survivor();
  assert.equal(game.fileAccessPackage, 'com.vrlightgunhub.survivor2');
  assert.deepEqual(game.data.map(({ id, destination, optional }) => [id, destination, Boolean(optional)]), [
    ['game', '/sdcard/Download/gunsur2.zip', false],
    ['naomi', '/sdcard/Download/naomi.zip', true],
  ]);
  assert.match(game.guidance, /World BHF2 Ver\. E/);
  assert.match(game.guidance, /CRC metadata/);
  assert.match(game.guidance, /wider view.*unavailable/i);
  for (const withBios of [false, true]) {
    const plan = buildInstallPlan(game, {
      serial: 'QUEST3', apkPath: 'C:\\Downloads\\survivor2-code-veronica-vr-quest.apk',
      files: { game: 'C:\\Games\\gunsur2.zip', ...(withBios ? { naomi: 'C:\\Games\\naomi.zip' } : {}) },
    });
    assert.ok(plan.some((step) => step.args.join(' ').includes('com.vrlightgunhub.survivor2 MANAGE_EXTERNAL_STORAGE allow')));
    assert.ok(plan.some((step) => step.args.at(-1) === '/sdcard/Download/gunsur2.zip'));
    assert.equal(plan.some((step) => step.args.at(-1) === '/sdcard/Download/naomi.zip'), withBios);
    assert.equal(plan.some((step) => /\.chd/i.test(step.args.join(' '))), false);
  }
});

test('Survivor 2 rescan detects its own package and the canonical World cartridge', async () => {
  const game = survivor();
  let names = 'gunsur2.zip';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.vrlightgunhub.survivor2';
    if (command === 'shell dumpsys package com.vrlightgunhub.survivor2') return 'versionName=1.0.0-g24f8cf87f';
    if (command === 'shell ls -1 /sdcard/Download') return names;
    throw new Error(`Unexpected probe ${command}`);
  } };
  let scan = await inspectDevice(adb, 'QUEST3', [game]);
  assert.equal(scan[game.id]?.packageId, 'com.vrlightgunhub.survivor2');
  assert.equal(scan[game.id]?.dataReady, true, 'a supported BIOS may be embedded in the cartridge ZIP');
  names = 'gunsur2.zip\nnaomi.zip';
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id]?.dataReady, true);
  names = 'gunsur2j.zip\nnaomi.zip';
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id]?.dataReady, false);
});
