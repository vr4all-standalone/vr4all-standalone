const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');

test('PC ports that need original files expose the correct folder inputs', () => {
  const byId = Object.fromEntries(getCatalog().map((game) => [game.id, game]));
  const avp = byId['avp-vr'];
  assert.equal(avp.manualDataSetup, undefined);
  assert.deepEqual(avp.data[0].requiredDirectories, ['avp_rifs', 'fastfile']);
  assert.deepEqual(avp.data[0].requiredEntries, ['language.txt']);
  assert.equal(avp.data[0].destination, '/sdcard/Android/data/com.bassquake.quest.avpvr/files/');
  const source = byId.sourcevr;
  assert.equal(source.manualDataSetup, undefined);
  assert.deepEqual(source.data[0].requiredDirectories, ['hl2', 'platform']);
  assert.equal(source.data[0].destination, '/sdcard/SourceVRPort/common/');
  assert.equal(source.data.find((item) => item.id === 'portal').optional, true);
  const ut = byId['ut99-quest'];
  assert.deepEqual(ut.data[0].requiredDirectories, ['System', 'Maps', 'Textures', 'Sounds', 'Music']);
  assert.equal(ut.data[0].destination, '/sdcard/Android/data/com.ghwstvr.ut99quest/files/UT99/');
  const unreal = byId['unreal-gold-vr'];
  assert.equal(unreal.data[0].optional, true, 'the creator also offers an in-headset download');
  assert.deepEqual(unreal.data[0].requiredDirectories, ['System', 'Maps', 'Textures', 'Sounds', 'Music', 'Help']);
  assert.deepEqual(byId.wolfsharp.data[0].oneOfDirectories, ['WL6', 'M1', 'M2', 'M3', 'N3D']);
});

test('every starter port has a console, genre, and local artwork', () => {
  const games = getCatalog();
  assert.equal(games.length, 100);
  assert.equal(games.filter((game) => !game.variantOf).length, 94);
  assert.equal(new Set(games.filter((game) => !game.variantOf).map((game) => game.art)).size, 94);
  for (const game of games) {
    assert.ok(game.console, `${game.id}: console`);
    assert.ok(game.genre, `${game.id}: genre`);
    assert.match(game.art || '', /^\/art\/[a-z0-9-]+\.(svg|jpg|png|webp)$/, `${game.id}: artwork path`);
    assert.doesNotMatch(game.art, /\.svg$/, `${game.id}: real game artwork`);
    const artwork = path.join(__dirname, '..', 'public', game.art.slice(1));
    assert.ok(fs.statSync(artwork).size > 0, `${game.id}: artwork exists`);
    if (game.art.endsWith('.svg')) {
      const svg = fs.readFileSync(artwork, 'utf8');
      assert.match(svg, /<svg\b/);
      assert.match(svg, /<title\b/);
    }
    assert.ok(game.gameName, `${game.id}: original game name`);
  }
  assert.equal(games.find((game) => game.id === 'fzero-x-virtuavr').art, '/art/fzero-x-vr.jpg');
});

test('18 Wheeler selects the official Quest APK and accepts either owned disc format', () => {
  const game = getCatalog().find((entry) => entry.id === '18-wheeler-vr');
  assert.equal(game.gameName, '18 Wheeler: American Pro Trucker');
  assert.deepEqual([game.console, game.genre], ['Dreamcast', 'Racing']);
  assert.equal(game.source.repo, 'f1nal-b0ss/18-wheeler-decomp');
  assert.deepEqual(game.requireOneOf, ['chd', 'gdi']);
  assert.deepEqual(game.data.find((item) => item.id === 'gdi').requiredExtensions, ['.gdi', '.bin']);
  assert.equal(game.data.find((item) => item.id === 'chd').destination, '/sdcard/Download/18Wheeler/');
  const selected = require('../src/core').selectRelease([{ tag_name: 'v0.1.0', assets: [
    { name: '18wheeler-vr.apk', browser_download_url: 'https://github.com/f1nal-b0ss/18-wheeler-decomp/releases/download/v0.1.0/18wheeler-vr.apk' },
    { name: 'Source-code.zip', browser_download_url: 'https://github.com/f1nal-b0ss/18-wheeler-decomp/archive/v0.1.0.zip' },
  ] }], game.source);
  assert.equal(selected?.assetName, '18wheeler-vr.apk');
});

test('approved additions are distinct games while alternate ports share a card', () => {
  const games = getCatalog();
  const byId = Object.fromEntries(games.map((game) => [game.id, game]));
  const additions = ['questzdoom', 'csvr', 'preyvr', 'razexr', 'hexen2-vr', 'questsam', 'descent12-vr', 'wolfsharp', 'sclerosis-vr', 'wing-commander-1-vr', 'wing-commander-2-vr', 'freespace2-vr', 'tiberian-dawn-mr', 'magic-carpet-vr', 'tes3mp-vr', 'gothic2-vr', 'questcarnage', 'galaxyquest', 'animal-crossing-vr', 'strikers-charged-vr', 'gt2-vr', 'astroquest'];
  assert.equal(additions.length, 22);
  for (const id of additions) assert.ok(byId[id] && !byId[id].variantOf, `${id}: visible game`);
  assert.deepEqual(Object.fromEntries(['dr89-time-crisis', 'dr89-time-crisis-2', 'pokemon-gen1-recomp', 'mjolnir-vr'].map((id) => [id, byId[id].variantOf])), {
    'dr89-time-crisis': 'time-crisis-vr',
    'dr89-time-crisis-2': 'time-crisis-2-vr',
    'pokemon-gen1-recomp': 'pokemon-gen1-vr',
    'mjolnir-vr': 'halo-ce',
  });
  assert.equal(byId['tes3mp-vr'].gameName, 'The Elder Scrolls III: Morrowind');
  assert.equal(byId['halo-ce'].data[0].extensions.includes('.iso'), true);
  assert.equal(byId['halo-ce'].data[0].optional, undefined, 'OpenCE requires an owned Halo image for first install');
  assert.equal(byId['halo-ce'].data.some((item) => item.id === 'maps'), false, 'legacy maps cannot be staged as an import for the current launcher');
  assert.equal(byId['halo-ce'].reuseInstalledData, undefined);
  assert.equal(byId['mjolnir-vr'].reuseInstalledData, undefined);
  assert.equal(byId['fzero-x-vr'], undefined);
  assert.equal(byId['fzero-x-virtuavr'].variantOf, undefined);
  assert.equal(byId['fzero-x-virtuavr'].source, null);
  assert.equal(byId['fzero-x-virtuavr'].projectUrl, 'https://virtuavrport.itch.io/f-zero-x-vr');
});

test('new GitHub sources distinguish Quest APKs from Pico and installer assets', () => {
  const byId = Object.fromEntries(getCatalog().map((game) => [game.id, game]));
  for (const [id, wanted, rejected] of [
    ['questsam', 'questsam.apk', 'SeriousSamAndroid-v1.04.0-pico-release.apk'],
    ['questcarnage', 'QuestCarnage-Meta-Quest-release.apk', 'QuestCarnage-PICO4-release.apk'],
    ['tiberian-dawn-mr', null, 'Tiberian-Dawn-Android-Mobile-Tablet-preview.apk'],
    ['mjolnir-vr', 'MjolnirVR.apk', 'RingfallMjolnirVR.apk'],
    ['pokemon-gen1-recomp', 'Gen1Recomp-VR-Unplugged-v0.1.81-Quest.apk', 'gen1recomp-steam-frame.zip'],
  ]) {
    const source = byId[id].source;
    if (wanted) assert.match(wanted, new RegExp(source.assetPattern, 'i'), id);
    if (source) assert.doesNotMatch(rejected, new RegExp(source.assetPattern, 'i'), id);
    else assert.equal(byId[id].externalInstaller, true, `${id}: honest guide`);
  }
  assert.match('QuestSam b004 b004', new RegExp(byId.questsam.source.releasePattern, 'i'));
  assert.doesNotMatch('Pico test pico-test', new RegExp(byId.questsam.source.releasePattern, 'i'));
});

test('console and genre distinguish ports that used to share broad categories', () => {
  const byId = Object.fromEntries(getCatalog().map((game) => [game.id, game]));
  assert.deepEqual([byId['oot-vr'].console, byId['oot-vr'].genre], ['Nintendo 64', 'Adventure']);
  assert.deepEqual([byId['xelee'].console, byId['xelee'].genre], ['GameCube', 'Fighting']);
  assert.deepEqual([byId['hotd2-vr'].console, byId['hotd2-vr'].genre], ['Arcade', 'Rail shooter']);
  assert.deepEqual([byId['hotd2-dreamcast-vr'].console, byId['hotd2-dreamcast-vr'].genre], ['Dreamcast', 'Rail shooter']);
  assert.deepEqual([byId['nfsu2-vr'].console, byId['nfsu2-vr'].genre], ['Xbox', 'Racing']);
  assert.deepEqual([byId.lambda1vr.console, byId.lambda1vr.genre], ['PC', 'Shooter']);
  assert.equal(byId['rally-vr'].title, 'Rally VR');
  assert.equal(byId['rally-vr'].gameName, 'Sega Rally Championship');
});

test('new Quest ports distinguish automatic releases from guided installers', () => {
  const byId = Object.fromEntries(getCatalog().map((game) => [game.id, game]));
  assert.equal(byId['pokemon-gen1-vr'].source.repo, 'heurazy/1GenPokemonVr');
  assert.equal(byId['mok-vr'].source.repo, 'vr4all-standalone/mok-vr');
  assert.notEqual(byId['mok-vr'].source.repo, byId['hotd2-vr'].source.repo);
  assert.equal(byId.jkxr.playerInstall, 'jkxr');
  assert.equal(byId.jkxr.source.repo, 'Team-Beef-Studios/JKXR');
  assert.match(byId.jkxr.gameName, /Jedi Academy/);
  assert.match(byId['rave-racer-vr'].projectUrl, /itch\.io/);
  assert.deepEqual([byId['cnc-generals-xr'].console, byId['cnc-generals-xr'].genre], ['PC', 'Strategy']);
  for (const id of ['xwing-revival-vr', 'openxwa-vr', 'opentie-vr', 'openxw-vr', 'openxvt-vr']) {
    assert.match(byId[id].source.assetPattern, /apk/);
    assert.equal(byId[id].genre, 'Space combat');
  }
});

test('official GitHub sources select only installable Quest APK assets', () => {
  const byId = Object.fromEntries(getCatalog().map((game) => [game.id, game]));
  for (const [id, repo, questAsset, excludedAsset] of [
    ['perfect-dark-vr', 'Alex-LeTux/perfect_dark_VR', 'Perfect_Dark_VR_Standalone_NTSC_v2.1.apk', '_Perfect_Dark_VR_Standalone_PAL_v2.1.apk'],
    ['simpsons-hit-run-vr', 'kote2345/The-Simpsons-Hit-and-Run-VR', 'SimpsonsHitRun_1.2.apk', 'Source-code.zip'],
    ['descent3-vr', 'SgtBilko76/Descent3-VR', 'Descent3-VR-0.3-beta.apk', 'Source-code.zip'],
  ]) {
    const source = byId[id].source;
    assert.equal(source?.repo, repo, `${id}: official repository`);
    assert.match(questAsset, new RegExp(source.assetPattern, 'i'), `${id}: current Quest asset`);
    assert.doesNotMatch(excludedAsset, new RegExp(source.assetPattern, 'i'), `${id}: unrelated asset`);
  }
  assert.equal(byId['descent3-vr'].playerInstall, 'descent3');
  assert.equal(byId['descent3-vr'].data[0]?.id, 'gamePath');
  assert.equal(byId['descent3-vr'].data[0]?.kind, 'directory');
  assert.equal(byId['descent3-vr'].data[0]?.destination, '/sdcard/Android/data/com.descentdevelopers.descent3/files/');
  assert.deepEqual(byId['descent3-vr'].data[0]?.requiredEntries, ['d3.hog']);
});

test('build-required inventory excludes ports with a prebuilt Quest APK', () => {
  const games = getCatalog();
  assert.deepEqual(games.filter((game) => game.manualBuild).map((game) => game.id).sort(),
    ['vice-city-vr', 'crazy-taxi-vr', 'gta-sa-vr', 'rdr1-vr', 'fzero-x-virtuavr'].sort());
  const byId = Object.fromEntries(games.map((game) => [game.id, game]));
  assert.equal(byId.doom3quest.source.repo, 'Team-Beef-Studios/Doom3Quest');
  assert.equal(byId.quake3quest.source.repo, 'Team-Beef-Studios/ioq3quest');
  assert.equal(byId.doom3quest.data[0].destination, '/sdcard/Doom3Quest/base/');
  assert.equal(byId.quake3quest.data[0].destination, '/sdcard/ioquake3quest/baseq3/');
  assert.ok(byId.doom3quest.data[0].requiredEntries.includes('pak008.pk4'));
  assert.ok(byId.quake3quest.data[0].requiredEntries.includes('pak0.pk3'));
});

test('GTA SA and RDR expose their exact personal build inputs on their cards', () => {
  const games = getCatalog();
  const gta = games.find((game) => game.id === 'gta-sa-vr');
  const rdr = games.find((game) => game.id === 'rdr1-vr');
  assert.equal(gta.personalBuild.gameLabel, 'Google Play GTA SA export');
  assert.match(gta.personalBuild.audioLabel, /PS2-style audio/i);
  assert.equal(rdr.personalBuild.gameLabel, 'Android RDR APKs or complete export');
  assert.match(rdr.personalBuild.audioLabel, /Additional RDR game data/);
  assert.equal(rdr.personalBuild.audioOptional, true);
  assert.notEqual(gta.personalBuild.audioOptional, true);
  assert.equal(gta.manualBuild, true);
  assert.equal(rdr.manualBuild, true);
});
