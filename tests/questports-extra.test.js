const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { packages } = require('../src/device-library');

const ids = [
  'fate-of-the-galaxy-vr', 'wing-commander-saga-vr', 'wipeout-pure-vr',
  'star-wars-arcade-vr', 'supertuxkart-vr', 'openmw-quest-vr',
  'ankh-vr', 'vpinball-vr', 'armsx2-3d',
];

test('nine creator-backed Quest profiles appear once in the catalog', () => {
  const catalog = getCatalog();
  for (const id of ids) {
    const matches = catalog.filter((game) => game.id === id);
    assert.equal(matches.length, 1, id);
    assert.ok(matches[0].projectUrl, id);
    assert.ok(matches[0].console && matches[0].genre, id);
    assert.ok(packages[id], `${id} package identity`);
  }
  assert.equal(catalog.length, 171);
  assert.equal(catalog.filter((game) => game.catalogGroup === 'emulator').length, 7);
});

test('each profile selects its own current Quest APK asset', () => {
  const names = {
    'fate-of-the-galaxy-vr': 'FotG-VR-v0.3.5-beta.apk',
    'wing-commander-saga-vr': 'WCSaga-VR-v0.1.7-beta.apk',
    'wipeout-pure-vr': 'WipeoutPure-VR-v0.1.0-beta.apk',
    'star-wars-arcade-vr': 'StarWarsQuest.apk',
    'supertuxkart-vr': 'SuperTuxKart-VR-1.0.1.apk',
    'openmw-quest-vr': 'com.openmw.vr-0-51-release.apk',
    'ankh-vr': 'ANHK-VR.apk',
    'vpinball-vr': 'VPinball-VR-Beta-0.40.apk',
    'armsx2-3d': 'ARMSX2-3D-0.3-beta.apk',
  };
  const catalog = getCatalog();
  const releases = [{ tag_name: 'creator-release', published_at: '2026-11-08', assets: Object.values(names).map((name) => ({ name, browser_download_url: `https://github.com/creator/project/releases/download/tag/${name}` })) }];
  for (const [id, name] of Object.entries(names)) {
    const game = catalog.find((entry) => entry.id === id);
    assert.equal(selectRelease(releases, game.source)?.assetName, name, id);
  }
});

test('owned game data goes to creator-specified headset paths', () => {
  const catalog = getCatalog();
  const cases = [
    ['wipeout-pure-vr', 'iso', 'C:\\Games\\Wipeout Pure.iso', '/sdcard/Android/data/online.portroyale.wipeoutpurevr/files/import/Wipeout Pure.iso'],
    ['star-wars-arcade-vr', 'rom', 'C:\\Games\\starwars.zip', '/sdcard/Android/data/com.cyberheater.starwars/files/starwars.zip'],
  ];
  for (const [id, key, file, destination] of cases) {
    const game = catalog.find((entry) => entry.id === id);
    const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Mods\\port.apk', files: { [key]: file } });
    assert.equal(plan.at(-1).args.at(-1), destination, id);
  }
  for (const [id, key, folder, entry, destination] of [
    ['openmw-quest-vr', 'game', 'C:\\Games\\Morrowind', 'Data Files', '/sdcard/Morrowind/'],
    ['ankh-vr', 'game', 'C:\\Games\\Ultima IV', 'AVATAR.EXE', '/sdcard/Android/data/com.SwivelChairGames.ANKHVR/files/u4/'],
  ]) {
    const game = catalog.find((candidate) => candidate.id === id);
    const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Mods\\port.apk', files: { [key]: folder }, directoryEntries: { [key]: [entry] } });
    assert.equal(plan.at(-1).args.at(-1), destination, id);
  }
});
