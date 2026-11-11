const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { buildInstallPlan, selectRelease } = require('../src/core');
const { packages } = require('../src/device-library');

const byId = Object.fromEntries(getCatalog().map((port) => [port.id, port]));
const games = ['daggerfall-unity-vr', 'star-fox-enhanced-vr', 'questcraft', 'outlaws-vr'];
const emulators = ['age-of-joy', 'citravr', 'dolphinxr', 'ppsspp-vr', 'winlatorxr'];

test('DolphinXR uses the current creator Quest release and its APK package ID', () => {
  const release = selectRelease([
    { tag_name: 'v0.5', published_at: '2026-11-03T00:00:00Z', assets: [{
      name: 'DolphinVR-Redux-v0.5-Quest.apk',
      browser_download_url: 'https://github.com/iChris4/dolphinXR/releases/download/v0.5/DolphinVR-Redux-v0.5-Quest.apk',
    }] },
    { tag_name: 'v0.2', published_at: '2026-05-01T00:00:00Z', assets: [{
      name: 'Dolphin-VR-Redux-app-quest-debug.apk',
      browser_download_url: 'https://github.com/iChris4/dolphinXR/releases/download/v0.2/Dolphin-VR-Redux-app-quest-debug.apk',
    }] },
  ], byId.dolphinxr.source);
  assert.equal(release?.assetName, 'DolphinVR-Redux-v0.5-Quest.apk');
  assert.equal(packages.dolphinxr, 'org.dolphinemu.dolphinemu.quest.debug');
});

test('original creator sources provide four new Quest games and five emulator tools', () => {
  for (const id of [...games, ...emulators]) {
    assert.ok(byId[id], id);
    assert.ok(byId[id].projectUrl, id);
    assert.ok(byId[id].console && byId[id].genre, id);
  }
  for (const id of emulators) assert.equal(byId[id].catalogGroup, 'emulator', id);
  assert.equal(byId['outlaws-vr'].source.repo, 'outlawshub-arch/OutlawsVR');
  assert.equal(byId['outlaws-vr'].sourceArchive, 'single-apk');
  assert.equal(byId['star-fox-enhanced-vr'].sourceArchive, 'single-apk');
});

test('archive releases select the Quest ZIP rather than Android or source packages', () => {
  for (const [id, asset] of [
    ['star-fox-enhanced-vr', 'StarFoxEnhanced-0.0.8.8.2-quest-arm64.zip'],
    ['outlaws-vr', 'OutlawsVR-v0.95-b439f9a.zip'],
  ]) {
    const release = [{ tag_name: 'v1', assets: [
      { name: 'Generic-android-arm64.apk', browser_download_url: 'https://github.com/creator/repo/releases/download/v1/Generic-android-arm64.apk' },
      { name: asset, browser_download_url: `https://github.com/creator/repo/releases/download/v1/${asset}` },
    ] }];
    assert.equal(selectRelease(release, byId[id].source)?.assetName, asset);
  }
});

test('Daggerfall and Outlaws install plans copy owned game data to creator paths', () => {
  for (const [id, destination] of [
    ['daggerfall-unity-vr', '/sdcard/Android/data/com.dfworkshop.dfuquest3/files/Daggerfall/arena2/'],
    ['outlaws-vr', '/sdcard/Android/data/com.outlawsvr.OutlawsUE/files/Outlaws/'],
  ]) {
    const game = byId[id];
    assert.equal(game.data[0].destination, destination);
    assert.ok(game.data[0].requiredEntries.length >= 2);
    const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Mods\\quest.apk', files: { game: 'C:\\Games\\data' }, directoryEntries: { game: game.data[0].requiredEntries } });
    assert.ok(plan.some((step) => step.args.includes('push') && step.args.at(-1) === destination), id);
  }
});
