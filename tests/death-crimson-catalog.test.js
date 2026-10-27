const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { inspectDevice } = require('../src/device-library');

function deathCrimson() {
  const game = getCatalog().find((entry) => entry.id === 'death-crimson-ox-vr');
  assert.ok(game, 'Death Crimson OX VR has its own library card');
  return game;
}

test('Death Crimson OX is an independent Arcade rail shooter with local project artwork', () => {
  const game = deathCrimson();
  assert.equal(game.title, 'Death Crimson OX VR');
  assert.equal(game.gameName, 'Death Crimson OX');
  assert.deepEqual([game.console, game.genre], ['Arcade', 'Rail shooter']);
  assert.equal(game.variantOf, undefined);
  assert.equal(game.projectUrl, 'https://github.com/vr4all-standalone/death-crimson-ox-vr');
  assert.equal(game.art, '/art/death-crimson-ox-vr.jpg');
  assert.ok(fs.statSync(path.join(__dirname, '..', 'public', game.art.slice(1))).size > 0);
});

test('Death Crimson OX release selects only its standalone Quest APK', () => {
  const game = deathCrimson();
  assert.equal(game.source.repo, 'vr4all-standalone/death-crimson-ox-vr');
  const unrelated = [
    'death-crimson-ox-vr-pcvr.zip', 'death-crimson-ox-vr-quest.zip',
    'VR4ALL-0.3.25-win-x64.exe', 'ninja-assault-vr-quest.apk',
    'death-crimson-ox-vr-quest-debug.apk', 'death-crimson-ox-vr-quest.apk.zip',
  ];
  const release = (names) => [{ tag_name: 'v1.0.0', assets: names.map((name) => ({
    name, browser_download_url: `https://github.com/${game.source.repo}/releases/download/v1.0.0/${name}`,
  })) }];
  assert.equal(selectRelease(release(unrelated), game.source), null);
  assert.equal(selectRelease(release([...unrelated, 'death-crimson-ox-vr-quest.apk']), game.source)?.assetName,
    'death-crimson-ox-vr-quest.apk');
});

test('Death Crimson OX transfers its Japan Rev A ZIP and optional BIOS without a CHD', () => {
  const game = deathCrimson();
  assert.equal(game.fileAccessPackage, 'com.vrlightgunhub.deathcrimsonox');
  assert.deepEqual(game.data.map(({ id, destination, optional }) => [id, destination, Boolean(optional)]), [
    ['game', '/sdcard/Download/deathcoxj.zip', false],
    ['naomi', '/sdcard/Download/naomi.zip', true],
  ]);
  const plan = buildInstallPlan(game, {
    serial: 'QUEST3', apkPath: 'C:\\Downloads\\death-crimson-ox-vr-quest.apk',
    files: { game: 'C:\\Games\\deathcoxj.zip', naomi: 'C:\\Games\\naomi.zip' },
  });
  assert.ok(plan.some((step) => step.args.join(' ').includes('com.vrlightgunhub.deathcrimsonox MANAGE_EXTERNAL_STORAGE allow')));
  assert.ok(plan.some((step) => step.args.at(-1) === '/sdcard/Download/deathcoxj.zip'));
  assert.ok(plan.some((step) => step.args.at(-1) === '/sdcard/Download/naomi.zip'));
  assert.equal(plan.some((step) => /\.chd/i.test(step.args.join(' '))), false);
  const embeddedBiosPlan = buildInstallPlan(game, {
    serial: 'QUEST3', apkPath: 'C:\\Downloads\\death-crimson-ox-vr-quest.apk',
    files: { game: 'C:\\Games\\old-merged-deathcox.zip' },
  });
  assert.ok(embeddedBiosPlan.some((step) => step.args.at(-1) === '/sdcard/Download/deathcoxj.zip'));
  assert.equal(embeddedBiosPlan.some((step) => step.args.at(-1) === '/sdcard/Download/naomi.zip'), false);
});

test('Death Crimson OX rescan recognizes its package and requires only the canonical game ZIP', async () => {
  let names = 'deathcoxj.zip';
  const game = deathCrimson();
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.vrlightgunhub.deathcrimsonox';
    if (command === 'shell dumpsys package com.vrlightgunhub.deathcrimsonox') return 'versionName=1.0.0';
    if (command === 'shell ls -1 /sdcard/Download') return names;
    throw new Error(`Unexpected probe ${command}`);
  } };
  let scan = await inspectDevice(adb, 'QUEST3', [game]);
  assert.equal(scan[game.id]?.packageId, 'com.vrlightgunhub.deathcrimsonox');
  assert.equal(scan[game.id]?.dataReady, true, 'separate BIOS is optional because it may be embedded');
  names = 'deathcoxj.zip\nnaomi.zip';
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id]?.dataReady, true);
  names = 'deathcox.zip\ndeathcoxo.zip\nnaomi.zip';
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id]?.dataReady, false);
});
