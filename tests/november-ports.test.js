const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { honeydewRelease } = require('../src/releases');
const { inspectDevice, packages } = require('../src/device-library');
const { verifyGameFile } = require('../src/file-verification');
const fs = require('node:fs');
const path = require('node:path');

test('new Quest projects have distinct profiles and creator links', () => {
  const games = getCatalog();
  const ids = [
    'south-park-vr', 'mario64mr', 'lsd-vr-beta', 'bully-vr', 'lba2-quest',
    'xonotic-vr', 'primedgun-echoes', 'urban-terror-vr', 'openarena-vr',
    'project-honeydew-2', 'openmohaa-vr', 'lets-go-jungle-vr', 'hotd4-special-vr',
    'futurama-quest', 'virtua-tennis-3-vr', 'lunacid-vr', 'warioware-twisted-vr', 'skate3-quest-ar', 'silent-hill-1999-vr', 'ace-combat-zero-vr',
  ];
  for (const id of ids) {
    const game = games.find((entry) => entry.id === id);
    assert.ok(game, id);
    assert.ok(game.projectUrl, id);
    assert.ok(game.console && game.genre, id);
  }
  assert.equal(new Set(games.map((entry) => entry.id)).size, games.length);
  assert.equal(games.length, 182);
  for (const id of ids) {
    const art = games.find((entry) => entry.id === id).art;
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', art.replace(/^\//, ''))), `${id} artwork`);
  }
});

test('Silent Hill Quest installs the creator APK with both owned USA disc files', async () => {
  const game = getCatalog().find((entry) => entry.id === 'silent-hill-1999-vr');
  assert.ok(game);
  assert.equal(game.projectUrl, 'https://github.com/renangto15722-arch/Silent-Hill-1999-Quest-Standalone');
  assert.equal(packages[game.id], 'com.sh1vr.quest');
  assert.equal(game.console, 'PlayStation');
  assert.deepEqual(game.data[0].requiredEntries, ['Silent Hill (USA).bin', 'Silent Hill (USA).cue']);
  assert.equal(game.data[1].destination, '/sdcard/SilentHillVR/gamedata/texturemods/');
  assert.equal(game.data[2].destination, '/sdcard/SilentHillVR/gamedata/load/');
  assert.ok(game.data.slice(1).every((item) => item.optional));
  const release = selectRelease([{ tag_name: 'v0.1', published_at: '2026-11-16', assets: [
    { name: 'Install-SilentHillVR.bat', browser_download_url: 'https://github.com/renangto15722-arch/Silent-Hill-1999-Quest-Standalone/releases/download/v0.1/Install-SilentHillVR.bat' },
    { name: 'SilentHillVR-Quest-0.1-source.zip', browser_download_url: 'https://github.com/renangto15722-arch/Silent-Hill-1999-Quest-Standalone/releases/download/v0.1/SilentHillVR-Quest-0.1-source.zip' },
    { name: 'SilentHillVR-Quest-0.1.apk', browser_download_url: 'https://github.com/renangto15722-arch/Silent-Hill-1999-Quest-Standalone/releases/download/v0.1/SilentHillVR-Quest-0.1.apk' },
  ] }], game.source);
  assert.equal(release.assetName, 'SilentHillVR-Quest-0.1.apk');
  assert.throws(() => buildInstallPlan(game, {
    serial: 'Q3', apkPath: 'C:\\Ports\\SilentHillVR-Quest-0.1.apk', files: { disc: 'C:\\Games\\Silent Hill' },
    directoryEntries: { disc: [] },
  }), /folder is empty/);
  const plan = buildInstallPlan(game, {
    serial: 'Q3', apkPath: 'C:\\Ports\\SilentHillVR-Quest-0.1.apk', files: { disc: 'C:\\Games\\Silent Hill' },
    directoryEntries: { disc: ['Silent Hill (USA).bin', 'Silent Hill (USA).cue', 'unrelated.txt'] },
  });
  assert.ok(plan.some((step) => step.args.includes('MANAGE_EXTERNAL_STORAGE')));
  assert.deepEqual(plan.filter((step) => step.label.startsWith('Copy disc/')).map((step) => step.args.at(-1)), [
    '/sdcard/SilentHillVR/gamedata/', '/sdcard/SilentHillVR/gamedata/',
  ]);
  assert.equal(plan.some((step) => step.label.includes('unrelated')), false);
  const apk = { run: async (args) => {
    if (args.includes('pm')) return `package:${packages[game.id]}`;
    if (args.includes('dumpsys')) return 'versionName=0.1';
    return 'Silent Hill (USA).bin\nSilent Hill (USA).cue';
  } };
  assert.equal((await inspectDevice(apk, 'Q3', [game]))[game.id].dataReady, true);
});

test('new Quest package identities can be detected after installation', async () => {
  for (const id of ['south-park-vr', 'bully-vr', 'xonotic-vr', 'urban-terror-vr', 'openarena-vr', 'project-honeydew-2', 'openmohaa-vr', 'futurama-quest', 'virtua-tennis-3-vr', 'lunacid-vr', 'skate3-quest-ar']) {
    assert.ok(packages[id], id);
    const game = getCatalog().find((entry) => entry.id === id);
    const adb = { run: async (args) => {
      if (args.includes('pm')) return `package:${packages[id]}`;
      if (args.includes('dumpsys')) return 'versionName=1.0.0';
      return '';
    } };
    assert.equal((await inspectDevice(adb, 'Quest', [game]))[id].packageId, packages[id]);
  }
});

test('WarioWare Quest uses its own APK, validates the USA ROM, and copies it for the headset picker', async (t) => {
  const game = getCatalog().find((entry) => entry.id === 'warioware-twisted-vr');
  assert.ok(game);
  assert.equal(game.console, 'Game Boy Advance');
  assert.equal(packages[game.id], 'com.wariowaretwistedrecomp.quest');
  assert.equal(game.data.length, 1, 'Quest build does not require a GBA BIOS');
  assert.equal(game.data[0].sha1, 'f0102d0d6f7596fe853d5d0a94682718278e083a');
  const release = selectRelease([{ tag_name: 'v0.1.0-quest', published_at: '2026-11-15', assets: [
    { name: 'warioware_twisted-quest-release.apk', browser_download_url: 'https://github.com/mrchrisster/WarioWareTwistedRecomp/releases/download/v0.1.0-quest/warioware_twisted-quest-release.apk' },
    { name: 'warioware_twisted-android-release.apk', browser_download_url: 'https://github.com/mrchrisster/WarioWareTwistedRecomp/releases/download/v0.1.0-quest/warioware_twisted-android-release.apk' },
  ] }], game.source);
  assert.equal(release.assetName, 'warioware_twisted-quest-release.apk');
  const dir = await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(), 'vr4all-warioware-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const wrongRom = path.join(dir, 'wrong.gba');
  await fs.promises.writeFile(wrongRom, Buffer.alloc(16 * 1024 * 1024));
  await assert.rejects(() => verifyGameFile(game, game.data[0], wrongRom), /WarioWare.*SHA-1|ROM.*SHA-1/i);
  const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Ports\\WarioWare.apk', files: { rom: wrongRom } });
  assert.ok(plan.some((step) => step.args.at(-1) === '/sdcard/WarioWareTwisted/warioware_twisted_usa.gba'));
});

test('Futurama selects the Quest APK and requires the owned Xbox ISO at its documented path', () => {
  const game = getCatalog().find((entry) => entry.id === 'futurama-quest');
  const release = selectRelease([{ tag_name: 'v0.1.2', published_at: '2026-11-15', assets: [
    { name: 'futurama-quest-v0.1.2.apk', browser_download_url: 'https://github.com/mrchrisster/futurama-quest/releases/download/v0.1.2/futurama-quest-v0.1.2.apk' },
  ] }], game.source);
  assert.equal(release.assetName, 'futurama-quest-v0.1.2.apk');
  assert.throws(() => buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Ports\\Futurama.apk', files: {} }), /Select Owned Futurama Xbox disc image/);
  const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Ports\\Futurama.apk', files: { disc: 'C:\\Games\\Futurama.iso' } });
  assert.ok(plan.some((step) => step.args.includes('/sdcard/Android/data/com.futuramarecomp.app/files/futurama.iso')));
});

test('source-only Quest ports explain their creator build requirements', () => {
  const catalog = getCatalog();
  const vt3 = catalog.find((entry) => entry.id === 'virtua-tennis-3-vr');
  const lunacid = catalog.find((entry) => entry.id === 'lunacid-vr');
  assert.equal(vt3.manualBuild, true);
  assert.ok(vt3.data.some((item) => item.requiredDirectories?.includes('vt3_Lindbergh')));
  const plan = buildInstallPlan(vt3, {
    serial: 'Q3', apkPath: 'C:\\Ports\\VirtuaTennis3VR.apk',
    files: { game: 'C:\\Games\\VT3\\disk0' },
    directoryEntries: { game: ['vt3_Lindbergh', 'shader', 'lib', 'unrelated'] },
  });
  assert.deepEqual(plan.filter((step) => step.args.includes('push')).map((step) => step.args.at(-1)), [
    '/sdcard/VirtuaTennis3/', '/sdcard/VirtuaTennis3/', '/sdcard/VirtuaTennis3/',
  ]);
  assert.equal(plan.some((step) => step.args.some((arg) => String(arg).includes('unrelated'))), false);
  assert.equal(lunacid.externalInstaller, true);
  assert.ok(lunacid.guidance.includes('40 GB'));
});

test('new Quest ports require their game data before showing ready', async () => {
  const ids = ['futurama-quest', 'virtua-tennis-3-vr', 'lunacid-vr'];
  const games = getCatalog().filter((game) => ids.includes(game.id));
  const files = new Map([
    ['/sdcard/Android/data/com.futuramarecomp.app/files', 'futurama.iso'],
    ['/sdcard/VirtuaTennis3/', 'vt3_Lindbergh\nshader\nlib'],
    ['/sdcard/Android/obb/com.AkumaKira.LunacidVR', 'main.1.com.AkumaKira.LunacidVR.obb'],
  ]);
  const adb = { run: async (args) => {
    if (args.includes('pm')) return ids.map((id) => `package:${packages[id]}`).join('\n');
    if (args.includes('dumpsys')) return 'versionName=0.1.2';
    return files.get(args.at(-1)) || '';
  } };
  const ready = await inspectDevice(adb, 'Quest', games);
  for (const id of ids) assert.equal(ready[id].dataReady, true, id);
  files.clear();
  const missing = await inspectDevice(adb, 'Quest', games);
  for (const id of ids) assert.equal(missing[id].dataReady, false, id);
});

test('Bully selects the newer public test APK rather than the old Recovery build', () => {
  const port = getCatalog().find((entry) => entry.id === 'bully-vr');
  const asset = (name, tag, publishedAt) => ({ tag_name: tag, published_at: publishedAt, assets: [
    { name, browser_download_url: `https://github.com/crtx01/BullyVR/releases/download/${tag}/${name}` },
  ] });
  const latest = selectRelease([
    asset('BullyVR-Recovery-Test-r20.apk', 'v0.0.1-pre-alpha', '2026-11-05T20:17:00Z'),
    asset('BullyVR-0.0.1-test.apk', 'v0.0.1-test', '2026-11-13T19:52:00Z'),
  ], port.source);
  assert.equal(latest.assetName, 'BullyVR-0.0.1-test.apk');
});

test('Lindbergh ports select their own APKs, including older Jungle release', () => {
  const games = getCatalog();
  const releases = [
    { tag_name: 'v0.4.0', published_at: '2026-11-02', assets: [
      { name: 'HouseOfTheDead4SpecialVR-v0.4.0-quest3.apk', browser_download_url: 'https://github.com/lialan/lindbergh-recomp-ports/releases/download/v0.4.0/special.apk' },
    ] },
    { tag_name: 'v0.2.7', published_at: '2026-10-31', assets: [
      { name: 'LetsGoJungleVR-v0.2.7-quest3.apk', browser_download_url: 'https://github.com/lialan/lindbergh-recomp-ports/releases/download/v0.2.7/jungle.apk' },
    ] },
  ];
  assert.equal(selectRelease(releases, games.find((game) => game.id === 'lets-go-jungle-vr').source)?.tag, 'v0.2.7');
  assert.equal(selectRelease(releases, games.find((game) => game.id === 'hotd4-special-vr').source)?.tag, 'v0.4.0');
});

test('Honeydew 2 resolves its own Quest APK and published checksum', () => {
  const hash = 'a'.repeat(64);
  const html = `<li class="platform card released" id="honeydew2-quest"><a href="/downloads/ProjectHoneydew2-0.1.0-quest.apk">Download for Quest</a><code id="honeydew2-sha256-quest">${hash}</code></li>`;
  const release = honeydewRelease(html, 'project-honeydew-2');
  assert.equal(release.assetName, 'ProjectHoneydew2-0.1.0-quest.apk');
  assert.equal(release.digest, `sha256:${hash}`);
});

test('new self-contained shooters install with no extra file choices', () => {
  for (const id of ['xonotic-vr', 'openarena-vr', 'urban-terror-vr']) {
    const game = getCatalog().find((entry) => entry.id === id);
    assert.equal(game.data.length, 0);
    assert.equal(buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Mods\\port.apk', files: {} })[0].label, 'Install APK');
  }
});

test('Skate 3 AR installs its official Quest APK without requiring original game data', async () => {
  const game = getCatalog().find((entry) => entry.id === 'skate3-quest-ar');
  assert.ok(game);
  assert.equal(game.projectUrl, 'https://github.com/andrewnakas/skate3-quest-ar');
  assert.equal(game.gameName, 'Skate 3');
  assert.equal(packages[game.id], 'com.andrewnakas.skate3ar');
  assert.ok(game.data.every((item) => item.optional));
  const release = selectRelease([{ tag_name: 'v0.1.0', published_at: '2026-10-27', assets: [
    { name: 'skate3ar.apk', browser_download_url: 'https://github.com/andrewnakas/skate3-quest-ar/releases/download/v0.1.0/skate3ar.apk' },
    { name: 'make-bundle.ps1', browser_download_url: 'https://github.com/andrewnakas/skate3-quest-ar/releases/download/v0.1.0/make-bundle.ps1' },
  ] }], game.source);
  assert.equal(release.assetName, 'skate3ar.apk');
  assert.equal(buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Ports\\skate3ar.apk', files: {} })[0].label, 'Install APK');
  const retailPlan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Ports\\skate3ar.apk', files: { retail: 'C:\\Games\\Skate3-Quest.zip' } });
  assert.ok(retailPlan.some((step) => step.args.at(-1) === '/sdcard/Download/Skate3/Skate3-Quest.zip'));
  const adb = { run: async (args) => args.includes('pm') ? `package:${packages[game.id]}` : 'versionName=0.1.0' };
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, true);
});
