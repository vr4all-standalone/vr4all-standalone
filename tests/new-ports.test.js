const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { buildInstallPlan, selectRelease } = require('../src/core');

const expected = [
  'ghost-squad-evolution-vr', 'hotd4-vr', 'daytona-usa-vr', 'mario-party-4-vr',
  'ctr-turbocharged-vr', 'iron-lung-vr', 'victory-heat-rally-vr',
  'mystical-ninja-vr', 'wwf-no-mercy-vr', 'sin-and-punishment-vr',
  'nfl-blitz-2000-vr', 'bomberman-hero-vr', 'arx-libertatis-vr',
  'jurassic-park-arcade-vr', 'wakerquest',
];

test('new Quest ports have distinct cards and actionable source information', () => {
  const catalog = getCatalog();
  for (const id of expected) {
    const game = catalog.find((entry) => entry.id === id);
    assert.ok(game, id);
    assert.ok(game.projectUrl, id);
    assert.ok(game.console && game.genre, id);
    assert.ok(game.source || game.externalInstaller || game.personalBuild || id === 'iron-lung-vr', id);
  }
  assert.equal(new Set(catalog.map((entry) => entry.id)).size, catalog.length);
  assert.equal(catalog.length, 125);
});

test('shared Lindbergh release selects each Quest APK and requires different data', () => {
  const games = getCatalog();
  const release = [{ tag_name: 'v0.2.0', assets: [
    { name: 'GhostSquadEvolutionVR-v0.2.0-quest3.apk', browser_download_url: 'https://github.com/lialan/lindbergh-recomp-ports/releases/download/v0.2.0/ghost.apk' },
    { name: 'HouseOfTheDead4VR-v0.2.0-quest3.apk', browser_download_url: 'https://github.com/lialan/lindbergh-recomp-ports/releases/download/v0.2.0/hotd4.apk' },
  ] }];
  for (const [id, asset, destination] of [
    ['ghost-squad-evolution-vr', 'GhostSquadEvolutionVR-v0.2.0-quest3.apk', '/sdcard/GhostSquadEvolution/vsg_l/'],
    ['hotd4-vr', 'HouseOfTheDead4VR-v0.2.0-quest3.apk', '/sdcard/HouseOfTheDead4/'],
  ]) {
    const game = games.find((entry) => entry.id === id);
    assert.equal(selectRelease(release, game.source)?.assetName, asset);
    assert.equal(game.data[0].destination, destination);
    assert.ok(game.data[0].requiredEntries?.length || game.data[0].requiredDirectories?.length);
  }
});

test('Daytona selects its own release and requires both arcade sets', () => {
  const game = getCatalog().find((entry) => entry.id === 'daytona-usa-vr');
  assert.equal(game.source.releasePattern, 'daytona-v');
  const release = [{ tag_name: 'daytona-v0.1.11', assets: [
    { name: 'Port0r-DaytonaUSAVR-v0.1.11-quest3.apk', browser_download_url: 'https://github.com/jacquesdupontd/port0r/releases/download/daytona-v0.1.11/daytona.apk' },
    { name: 'Port0r-TimeCrisisIIVR.apk', browser_download_url: 'https://github.com/jacquesdupontd/port0r/releases/download/daytona-v0.1.11/tc.apk' },
  ] }];
  assert.equal(selectRelease(release, game.source)?.assetName, release[0].assets[0].name);
  assert.deepEqual(game.data.map((item) => item.destination), ['/sdcard/Download/daytona.zip', '/sdcard/Download/model1io.zip']);
});

test('Jurassic Park cannot be mistaken for a downloadable APK', () => {
  const game = getCatalog().find((entry) => entry.id === 'jurassic-park-arcade-vr');
  assert.equal(game.source, undefined);
  assert.equal(game.externalInstaller, true);
  assert.match(game.guidance, /source|build/i);
});

test('new picker-based ports use a stable headset filename even for arbitrary local names', () => {
  for (const [id, local, remote] of [
    ['wakerquest', 'C:\\Games\\Zelda.iso', '/sdcard/Download/VR4ALL-wakerquest-disc.iso'],
    ['mario-party-4-vr', 'C:\\Games\\MP4.iso', '/sdcard/Download/VR4ALL-mario-party-4-vr-disc.iso'],
    ['mystical-ninja-vr', 'C:\\Games\\N64 Game.z64', '/sdcard/Download/VR4ALL-mystical-ninja-vr-rom.z64'],
  ]) {
    const game = getCatalog().find((entry) => entry.id === id);
    const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Mods\\port.apk', files: { [game.data[0].id]: local } });
    assert.equal(plan.find((step) => step.args.includes('push')).args.at(-1), remote);
  }
});
