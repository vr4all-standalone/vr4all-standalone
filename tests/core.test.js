const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDevices, selectRelease, buildInstallPlan } = require('../src/core');
const { getCatalog } = require('../src/catalog');

test('parseDevices keeps authorization states and distinct headset serials', () => {
  const text = 'List of devices attached\nQ3SERIAL device product:eureka model:Quest_3 device:eureka\nQ3SSERIAL unauthorized usb:1-2\n';
  assert.deepEqual(parseDevices(text), [
    { serial: 'Q3SERIAL', state: 'device', model: 'Quest 3' },
    { serial: 'Q3SSERIAL', state: 'unauthorized', model: 'Quest headset' },
  ]);
});

test('parseDevices names Quest 2, Quest 3, Quest 3S, and Quest Pro', () => {
  const output = 'List of devices attached\nQ2 device model:Quest_2\nQ3 device model:Quest_3\nQ3S device model:Quest_3S\nQPRO device model:Quest_Pro\n';
  assert.deepEqual(parseDevices(output).map(({ model }) => model), ['Quest 2', 'Quest 3', 'Quest 3S', 'Quest Pro']);
});

test('Morrowind transfers only the INI and Data Files to the creator’s Quest folder', () => {
  const game = getCatalog().find((entry) => entry.id === 'tes3mp-vr');
  const plan = buildInstallPlan(game, {
    serial: 'Q3', apkPath: 'C:\\tes3mp.apk', files: { game: 'C:\\Morrowind' },
    directoryEntries: { game: ['Morrowind.ini', 'Data Files', 'Morrowind.exe', 'manual.pdf'] },
  });
  const copied = plan.filter((step) => step.args.includes('push')).map((step) => step.label);
  assert.deepEqual(copied, ['Copy game/Morrowind.ini', 'Copy game/Data Files']);
});

test('selectRelease chooses the matching APK in a shared release repository', () => {
  const releases = [
    { tag_name: 'tc2-v1', name: 'Time Crisis II', html_url: 'https://github.com/a/b/releases/tag/tc2-v1', assets: [{ name: 'TimeCrisis2VR-v1.apk', browser_download_url: 'https://github.com/a/b/releases/download/tc2-v1/TimeCrisis2VR-v1.apk' }] },
    { tag_name: 'cop-v2', name: 'Cop VR', html_url: 'https://github.com/a/b/releases/tag/cop-v2', assets: [{ name: 'Port0r-CopVR-v2-quest3.apk', browser_download_url: 'https://github.com/a/b/releases/download/cop-v2/Port0r-CopVR-v2-quest3.apk' }] },
  ];
  const selected = selectRelease(releases, { assetPattern: '^Port0r-CopVR-.*-quest3\\.apk$' });
  assert.equal(selected.tag, 'cop-v2');
  assert.equal(selected.assetName, 'Port0r-CopVR-v2-quest3.apk');
});

test('selectRelease picks the newest published matching APK even if API order differs', () => {
  const asset = (tag) => ({ name: `Port-v${tag}.apk`, browser_download_url: `https://github.com/a/b/releases/download/${tag}/Port-v${tag}.apk` });
  const releases = [
    { tag_name: '1', published_at: '2026-10-01T12:00:00Z', assets: [asset('1')] },
    { tag_name: '2', published_at: '2026-10-20T12:00:00Z', assets: [asset('2')] },
  ];
  assert.equal(selectRelease(releases, { assetPattern: '^Port-v.*\\.apk$' }).tag, '2');
});

test('selectRelease carries GitHub SHA-256 asset digest for on-headset verification', () => {
  const digest = 'a'.repeat(64);
  const selected = selectRelease([{ tag_name: 'v1', assets: [{ name: 'Quest.apk', browser_download_url: 'https://github.com/owner/port/releases/download/v1/Quest.apk', digest: `sha256:${digest}` }] }], { assetPattern: '^Quest\\.apk$' });
  assert.equal(selected.digest, `sha256:${digest}`);
});

test('selectRelease totals downloads for matching assets across published releases only', () => {
  const asset = (tag, name, download_count) => ({ name, download_count, browser_download_url: `https://github.com/owner/port/releases/download/${tag}/${name}` });
  const selected = selectRelease([
    { tag_name: 'v1', published_at: '2026-10-01T00:00:00Z', assets: [asset('v1', 'Quest.apk', 20), asset('v1', 'Windows.zip', 900)] },
    { tag_name: 'v2', published_at: '2026-10-20T00:00:00Z', assets: [asset('v2', 'Quest.apk', 5)] },
    { tag_name: 'draft', draft: true, assets: [asset('draft', 'Quest.apk', 999)] },
  ], { assetPattern: '^Quest\\.apk$' });
  assert.equal(selected.tag, 'v2');
  assert.equal(selected.downloadCount, 5);
  assert.equal(selected.totalDownloads, 25);
  assert.equal(selectRelease([{ tag_name: 'v1', assets: [asset('v1', 'Quest.apk')] }], { assetPattern: '^Quest\\.apk$' }).totalDownloads, null);
});

test('buildInstallPlan targets one serial and copies required files to their profile destinations', () => {
  const game = { data: [
    { id: 'vcop', kind: 'file', extensions: ['.zip'], destination: '/sdcard/Download/vcop.zip' },
    { id: 'io', kind: 'file', extensions: ['.zip'], destination: '/sdcard/Download/model1io2.zip' },
  ] };
  const plan = buildInstallPlan(game, { serial: 'Q3SERIAL', apkPath: 'C:\\Games\\Cop.apk', files: { vcop: 'C:\\ROMs\\vcop.zip', io: 'C:\\ROMs\\model1io2.zip' } });
  assert.deepEqual(plan, [
    { label: 'Install APK', args: ['-s', 'Q3SERIAL', 'install', '-r', 'C:\\Games\\Cop.apk'] },
    { label: 'Create /sdcard/Download', args: ['-s', 'Q3SERIAL', 'shell', 'mkdir', '-p', '/sdcard/Download'] },
    { label: 'Copy vcop', args: ['-s', 'Q3SERIAL', 'push', 'C:\\ROMs\\vcop.zip', '/sdcard/Download/vcop.zip'] },
    { label: 'Copy io', args: ['-s', 'Q3SERIAL', 'push', 'C:\\ROMs\\model1io2.zip', '/sdcard/Download/model1io2.zip'] },
  ]);
});

test('AvP initializes its app folder before transferring lowercase game assets', () => {
  const game = getCatalog().find((entry) => entry.id === 'avp-vr');
  const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\avp.apk', files: { game: 'C:\\avp' }, directoryEntries: { game: ['avp_rifs', 'fastfile', 'language.txt'] } });
  assert.deepEqual(plan.slice(0, 2).map((step) => step.label), ['Install APK', 'Initialize AvP game folder']);
  assert.deepEqual(plan.filter((step) => step.label.startsWith('Copy ')).map((step) => step.label), ['Copy game/avp_rifs', 'Copy game/fastfile', 'Copy game/language.txt']);
});

test('generic game.iso inputs for separate ports do not overwrite each other in Downloads', () => {
  const catalog = getCatalog();
  const destinations = ['xelee', 'twilight-vr'].map((id) => {
    const game = catalog.find((entry) => entry.id === id);
    const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\port.apk', files: { disc: `C:\\Owned\\${id}\\game.iso` } });
    return plan.find((step) => step.args[2] === 'push').args.at(-1);
  });
  assert.deepEqual(destinations, ['/sdcard/Download/VR4ALL-xelee-disc.iso', '/sdcard/Download/VR4ALL-twilight-vr-disc.iso']);
});

test('18 Wheeler installs the official APK, enables file access, and copies GDI tracks', () => {
  const game = getCatalog().find((entry) => entry.id === '18-wheeler-vr');
  const plan = buildInstallPlan(game, {
    serial: 'Q3', apkPath: 'C:\\Games\\18wheeler-vr.apk',
    files: { gdi: 'C:\\Games\\18 Wheeler' },
    directoryEntries: { gdi: ['18wheeler.gdi', 'track01.bin', 'track02.bin', 'notes.txt'] },
  });
  assert.deepEqual(plan.map(({ args }) => args), [
    ['-s', 'Q3', 'install', '-r', 'C:\\Games\\18wheeler-vr.apk'],
    ['-s', 'Q3', 'shell', 'appops', 'set', 'com.flycast.emulator.wheeler18', 'MANAGE_EXTERNAL_STORAGE', 'allow'],
    ['-s', 'Q3', 'shell', 'mkdir', '-p', '/sdcard/Download/18Wheeler'],
    ['-s', 'Q3', 'push', 'C:\\Games\\18 Wheeler\\18wheeler.gdi', '/sdcard/Download/18Wheeler/'],
    ['-s', 'Q3', 'push', 'C:\\Games\\18 Wheeler\\track01.bin', '/sdcard/Download/18Wheeler/'],
    ['-s', 'Q3', 'push', 'C:\\Games\\18 Wheeler\\track02.bin', '/sdcard/Download/18Wheeler/'],
  ]);
});

test('buildInstallPlan rejects wrong archive format before ADB runs', () => {
  const game = { data: [{ id: 'rom', kind: 'file', extensions: ['.z64'], destination: '/sdcard/Download/game.z64' }] };
  assert.throws(() => buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\port.apk', files: { rom: 'C:\\game.zip' } }), /\.z64/);
});

test('buildInstallPlan keeps existing game data during an APK update', () => {
  const game = { data: [{ id: 'rom', label: 'Super Mario 64 ROM', kind: 'file', extensions: ['.z64'], destination: '/sdcard/Download/' }] };
  const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Port.apk', files: {}, reuseExistingData: true });
  assert.deepEqual(plan.map((step) => step.args), [['-s', 'Q3', 'install', '-r', 'C:\\Port.apk']]);
  assert.throws(() => buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Port.apk', files: {} }), /Select Super Mario 64 ROM/);
});

test('Halo APK cannot be installed as a playable port without its Xbox disc', () => {
  const halo = getCatalog().find((game) => game.id === 'halo-ce');
  assert.throws(() => buildInstallPlan(halo, { serial: 'Q3', apkPath: 'C:\\HaloCE-Quest.apk', files: {} }), /Select Halo CE Xbox disc image/);
  assert.doesNotThrow(() => buildInstallPlan(halo, { serial: 'Q3', apkPath: 'C:\\HaloCE-Quest.apk', files: { disc: 'C:\\Halo.xiso' } }));
});

test('buildInstallPlan rejects unsafe headset destinations', () => {
  const game = { data: [{ id: 'rom', kind: 'file', extensions: ['.zip'], destination: '/sdcard/Download/../../x.zip' }] };
  assert.throws(() => buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\port.apk', files: { rom: 'C:\\game.zip' } }), /destination/i);
});

test('buildInstallPlan rejects shell metacharacters in custom destinations', () => {
  const game = { data: [{ id: 'rom', kind: 'file', extensions: ['.zip'], destination: '/sdcard/Download/;touch.zip' }] };
  assert.throws(() => buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\port.apk', files: { rom: 'C:\\game.zip' } }), /destination/i);
});

test('Dark Forces Quest release installs its APK and owned game folder under the app data path', () => {
  const game = getCatalog().find((entry) => entry.id === 'dark-forces-vr');
  const releases = [
    { tag_name: 'v0.9.57-vr', name: 'Release v0.9.57-vr', published_at: '2026-10-11T16:16:00Z', assets: [{ name: 'the-force-engine-vr.zip', browser_download_url: 'https://github.com/SoVRHere/TheForceEngineVR/releases/download/v0.9.57-vr/the-force-engine-vr.zip' }] },
    { tag_name: 'v0.9.57-quest', name: 'Release v0.9.57-quest', published_at: '2026-10-09T22:34:00Z', assets: [{ name: 'the-force-engine-quest.apk', browser_download_url: 'https://github.com/SoVRHere/TheForceEngineVR/releases/download/v0.9.57-quest/the-force-engine-quest.apk' }] },
  ];
  assert.equal(game.externalInstaller, undefined);
  assert.equal(selectRelease(releases, game.source)?.assetName, 'the-force-engine-quest.apk');
  assert.equal(game.data[0]?.destination, '/sdcard/Android/data/com.tfe.game/files/TheForceEngine/Dark Forces/');
  assert.deepEqual(game.data[0]?.requiredEntries, ['DARK.GOB']);
  const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Games\\the-force-engine-quest.apk', files: { game: 'C:\\Games\\Dark Forces' }, directoryEntries: { game: ['DARK.GOB', 'SOUNDS.GOB'] } });
  assert.deepEqual(plan.map(({ args }) => args), [
    ['-s', 'Q3', 'install', '-r', 'C:\\Games\\the-force-engine-quest.apk'],
    ['-s', 'Q3', 'shell', 'mkdir', '-p', "'/sdcard/Android/data/com.tfe.game/files/TheForceEngine/Dark Forces'"],
    ['-s', 'Q3', 'push', 'C:\\Games\\Dark Forces\\DARK.GOB', '/sdcard/Android/data/com.tfe.game/files/TheForceEngine/Dark Forces/'],
    ['-s', 'Q3', 'push', 'C:\\Games\\Dark Forces\\SOUNDS.GOB', '/sdcard/Android/data/com.tfe.game/files/TheForceEngine/Dark Forces/'],
  ]);
});

test('verified source patterns recognize the published APK names', () => {
  const names = {
    'cop-vr': 'Port0r-CopVR-v0.2.2-quest3.apk',
    'time-crisis-vr': 'Port0r-TimeCrisisVR-v0.2.2-quest3.apk',
    'time-crisis-2-vr': 'Port0r-TimeCrisisIIVR-v0.1.0-quest3.apk',
    'hotd-vr': 'Port0r-HouseOfTheDeadVR-v0.1.1-quest3.apk',
    'rally-vr': 'Port0r-RallyVR-v0.2.6-quest3.apk',
    'dirt-dash-vr': 'Port0r-DirtDashVR-v0.1.2-quest3.apk',
    'dr89-time-crisis': 'TimeCrisisVR-v0.9.0-quest.apk',
    'dr89-time-crisis-2': 'TimeCrisis2VR-v0.3.0-quest3.apk',
    'crisis-zone-vr': 'CrisisZoneVR-v0.1.7-quest3.apk',
    xelee: 'Xelee-Quest-arm64.apk',
    'twilight-vr': 'tpvr-quest-arm64.apk',
    'quest-strikers': 'QuestStrikers-alpha1.13.apk',
    'wii-compiled': 'WiiCompiledVR-Quest-0.6.0.apk',
    'hotd2-vr': 'hotd2-arcade-vr-quest.apk',
    'hotd2-dreamcast-vr': 'hotd2-vr-quest.apk',
    'mok-upstream-vr': 'hotd2-vr-quest.apk',
    'nfsu-vr': 'NFSU-VR-Quest3-v0.3.0-preview.1.apk',
    'revolt-vr': 'ReVolt-QuestVR-0.18-Sin-Juego-ARM64.apk',
    'mgs-vr': 'MGSVR-Quest.apk',
    'wipeout-vr': 'WipeoutRewriteVR-0.1.0-beta1-quest.apk',
    lambda1vr: 'lambda1vr-v1.7.4.apk',
    quakequest: 'quakequest-v1.6.0.apk',
    quake2quest: 'quake2quest-v1.1.1.apk',
    rtcwquest: 'rtcwquest-1.4.1.apk',
    'goldeneye-vr': 'GoldenEye-VR-v0.5.13.apk',
    'avp-vr': 'avpvr-1.2-quest-arm64-v8a-release.apk',
    sourcevr: 'SourceVR-0.1.28.apk',
    'xrkart-64': 'XRKart-64-v0.2.0-Quest.apk',
    'unreal-gold-vr': 'UnrealGoldVR-1.0.0-beta12.apk',
    'primedgun-2': 'PrimedGun-v2.0.0-beta.2-Quest.apk',
    'opencmr2-vr': 'OpenCMR2-VR-Quest-arm64-v0.1.0.apk',
  };
  for (const game of getCatalog()) {
    if (!names[game.id]) continue;
    const filename = names[game.id];
    const selected = selectRelease([{ tag_name: 'test', name: 'test', assets: [{ name: filename, browser_download_url: `https://github.com/example/release/${filename}` }] }], game.source);
    assert.equal(selected?.assetName, filename, game.id);
  }
});

test('Quest APK selectors exclude sibling headset builds', () => {
  const games = Object.fromEntries(getCatalog().map((game) => [game.id, game]));
  const candidates = [
    ['wii-compiled', 'WiiCompiledVR-Quest1-0.6.0.apk'],
    ['mgs-vr', 'MGSVR-Pico.apk'],
    ['wipeout-vr', 'WipeoutRewriteVR-0.1.0-beta1-pico.apk'],
    ['quakequest', 'quakequest-v1.5.3-pico.apk'],
    ['avp-vr', 'avpvr-1.2-android-arm64-v8a-release.apk'],
    ['sourcevr', 'SourceVR-pico-0.1.28.apk'],
    ['sourcevr', 'SourceVRCore-0.1.28.apk'],
    ['primedgun-2', 'PrimedGun-v2.0.0-beta.2-Windows.zip'],
    ['opencmr2-vr', 'OpenCMR2-VR-PCVR-Windows-x64-v0.1.0.zip'],
  ];
  for (const [id, filename] of candidates) {
    const releases = [{ assets: [{ name: filename, browser_download_url: `https://github.com/example/repo/releases/download/v1/${filename}` }] }];
    assert.equal(selectRelease(releases, games[id].source), null, id);
  }
});

test('new Quest selectors match author release asset names', () => {
  const games = Object.fromEntries(getCatalog().map((game) => [game.id, game]));
  const assets = {
    'mok-vr': 'mok-vr-quest.apk',
    'pokemon-gen1-vr': '1GenPokemonVR-Quest3-v0.2.46.apk',
    'cnc-generals-xr': 'Generals-Zero-Hour-XR.apk',
    'xwing-revival-vr': 'X-Wing-Revival-VR-v1.0.3-full.apk',
    'openxwa-vr': 'OpenXWA-VR-v0.1.7-beta.apk',
    'opentie-vr': 'OpenTIE-VR-v0.1.6-beta.apk',
    'openxw-vr': 'OpenXW-VR-v0.1.2-beta.apk',
    'openxvt-vr': 'OpenXvT-VR-v0.1.0-beta.apk',
    'smash-remix-vr': 'SmashRemixVR-Quest-0.8.5.apk',
    'wave-race-vr': 'WaveRace64VR-Quest-0.1.8.apk',
    'mega-man-64-vr': 'MegaMan64RecompiledVR-Quest.apk',
    'ut99-portroyale': 'UnrealTournamentVR-1.0.0-beta12.apk',
    'homeworld-unbound': 'homeworld-unbound-vr.apk',
    'no-one-lives-forevr': 'relith-nolf-quest-0.4.0.apk',
    doom3quest: 'doom3quest148.apk',
    quake3quest: 'ioq3quest-release-1.2.0.apk',
    'starship-vr': 'Starship-VR-1.0-beta1.apk',
    'crash-bandicoot-vr': 'CrashBandicoot-2.0.0-beta.1.apk',
    'forsaken-vr': 'Forsaken-VR-v0.1.1-beta-full.apk',
  };
  for (const [id, name] of Object.entries(assets)) {
    const releases = [{ tag_name: 'verified', assets: [{ name, browser_download_url: `https://github.com/owner/repo/releases/download/verified/${name}` }] }];
    assert.equal(selectRelease(releases, games[id].source)?.assetName, name, id);
  }
  const pcVrOnly = [{ tag_name: 'v0.4.1', assets: [{ name: 'relith-nolf-pcvr-0.4.1.zip', browser_download_url: 'https://github.com/owner/repo/releases/download/v0.4.1/relith-nolf-pcvr-0.4.1.zip' }] }];
  assert.equal(selectRelease(pcVrOnly, games['no-one-lives-forevr'].source), null);
});

test('directory plans copy its contents into the target folder without nesting the source folder', () => {
  const game = { data: [{ id: 'maps', label: 'Halo maps', kind: 'directory', destination: '/sdcard/Android/data/com.halo.decomp.vr/files/maps/' }] };
  const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Halo.apk', files: { maps: 'C:\\HaloDisc\\maps' }, directoryEntries: { maps: ['a.map', 'b.map'] } });
  assert.deepEqual(plan.slice(1), [
    { label: 'Create /sdcard/Android/data/com.halo.decomp.vr/files/maps', args: ['-s', 'Q3', 'shell', 'mkdir', '-p', '/sdcard/Android/data/com.halo.decomp.vr/files/maps'] },
    { label: 'Copy maps/a.map', args: ['-s', 'Q3', 'push', 'C:\\HaloDisc\\maps\\a.map', '/sdcard/Android/data/com.halo.decomp.vr/files/maps/'] },
    { label: 'Copy maps/b.map', args: ['-s', 'Q3', 'push', 'C:\\HaloDisc\\maps\\b.map', '/sdcard/Android/data/com.halo.decomp.vr/files/maps/'] },
  ]);
});

test('guided PC ports copy only the creator-documented game archives', () => {
  const games = Object.fromEntries(getCatalog().map((game) => [game.id, game]));
  const doom = buildInstallPlan(games.doom3quest, { serial: 'Q3', apkPath: 'C:\\doom.apk', files: { base: 'C:\\Doom3\\base' }, directoryEntries: { base: [...games.doom3quest.data[0].requiredEntries, 'config.cfg', 'd3xp'] } });
  assert.equal(doom.filter((step) => step.label.startsWith('Copy ')).length, 13);
  assert.ok(!doom.some((step) => step.label.includes('config.cfg') || step.label.includes('d3xp')));
  const quake = buildInstallPlan(games.quake3quest, { serial: 'Q3', apkPath: 'C:\\quake.apk', files: { baseq3: 'C:\\Quake3\\baseq3' }, directoryEntries: { baseq3: ['pak0.pk3', 'pak1.pk3', 'q3config.cfg'] } });
  assert.deepEqual(quake.filter((step) => step.label.startsWith('Copy ')).map((step) => step.label), ['Copy baseq3/pak0.pk3', 'Copy baseq3/pak1.pk3']);
});
