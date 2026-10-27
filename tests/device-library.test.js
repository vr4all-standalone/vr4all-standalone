const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectDevice } = require('../src/device-library');
const { getCatalog } = require('../src/catalog');

test('Morrowind is ready only after its Data Files folder reaches the Quest', async () => {
  let dataFilesPresent = false;
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:xyz.morrowind.tes3mpvr';
    if (command === 'shell dumpsys package xyz.morrowind.tes3mpvr') return 'versionName=0.9.0';
    if (command === 'shell ls -1 /sdcard/Morrowind/') return dataFilesPresent ? 'Morrowind.ini\nData Files' : 'Morrowind.ini';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'tes3mp-vr');
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, false);
  dataFilesPresent = true;
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, true);
});

test('X-Wing Revival is recognized only after its included missions unpack', async () => {
  let missions = 'rebel0.def\nrebel1.def\nempire0.def';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.bilko.xwingrevivalvr';
    if (command === 'shell dumpsys package com.bilko.xwingrevivalvr') return 'versionName=1.0.3';
    if (command === 'shell ls -1 /sdcard/XWingRevival/Missions/') return missions;
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'xwing-revival-vr');
  const installed = await inspectDevice(adb, 'Q3', [game]);
  assert.equal(installed[game.id]?.packageId, 'com.bilko.xwingrevivalvr');
  assert.equal(installed[game.id]?.dataReady, true);
  missions = 'rebel0.def';
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id]?.dataReady, false);
  missions = '';
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id]?.dataReady, false);
});

test('Time Crisis alternatives and Pokémon/Halo ports retain separate installed identities', async () => {
  const ids = ['time-crisis-vr', 'dr89-time-crisis', 'time-crisis-2-vr', 'dr89-time-crisis-2', 'pokemon-gen1-vr', 'pokemon-gen1-recomp', 'halo-ce', 'mjolnir-vr'];
  const packages = ['io.port0r.timecrisis', 'org.timecrisis.quest', 'io.port0r.timecrisis2', 'org.timecrisis2.arcadevr', 'com.heurazy.gen1pokemonvr.quest', 'com.theboisclub.pokemonred', 'com.halo.decomp.vr', 'io.github.cesarus85.ringfall'];
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return packages.map((id) => `package:${id}`).join('\n');
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0.0';
    if (command === 'shell ls -1 /sdcard/Android/data/io.port0r.timecrisis/files/roms') return 'timecris.zip\nnamcoc71.zip';
    if (command === 'shell ls -1 /sdcard/Android/data/io.port0r.timecrisis2/files/roms') return 'timecrs2.zip';
    if (command === 'shell ls -1 /sdcard/Android/data/com.halo.decomp.vr/files/maps/') return `ui.map\n${Array.from({ length: 23 }, (_, i) => `map${i}.map`).join('\n')}`;
    return '';
  } };
  const result = await inspectDevice(adb, 'Q3', getCatalog().filter((game) => ids.includes(game.id)));
  for (const [index, id] of ids.entries()) assert.equal(result[id]?.packageId, packages[index], id);
  for (const id of ids.slice(0, 4)) assert.equal(result[id].dataReady, true, id);
  assert.equal(result['halo-ce'].dataReady, false, 'unregistered legacy maps do not make the current launcher playable');
  assert.equal(result['mjolnir-vr'].dataReady, false); // Imported private game data cannot be verified over USB.
});

test('Pokémon ports detect a visible Blue ROM, and the original port detects its imported cache', async () => {
  let romNames = 'Pokemon - Blue Version (USA, Europe) (SGB Enhanced).gb\nred-star-2020-08-18.gb';
  let imported = '';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.heurazy.gen1pokemonvr.quest\npackage:com.theboisclub.pokemonred';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0';
    if (command === 'shell ls -1 /sdcard/Download/') return romNames;
    if (command === 'shell ls -1 /sdcard/Android/data/com.heurazy.gen1pokemonvr.quest/files/save/pokemon-love2d') return imported;
    return '';
  } };
  const games = getCatalog().filter((game) => ['pokemon-gen1-vr', 'pokemon-gen1-recomp'].includes(game.id));
  let result = await inspectDevice(adb, 'Q3S', games);
  assert.equal(result['pokemon-gen1-vr'].dataReady, true);
  assert.equal(result['pokemon-gen1-recomp'].dataReady, true);
  romNames = 'red-star-2020-08-18.gb';
  imported = 'blue\noptions.lua';
  result = await inspectDevice(adb, 'Q3S', games);
  assert.equal(result['pokemon-gen1-vr'].dataReady, true, 'the original game remains ready after import even if its ROM is removed');
  assert.equal(result['pokemon-gen1-recomp'].dataReady, false, 'the alternate port has its own data');
  imported = '';
  result = await inspectDevice(adb, 'Q3S', games);
  assert.equal(result['pokemon-gen1-vr'].dataReady, false);
});

test('download-select ports detect their own named input without accepting unrelated files', async () => {
  let romNames = 'Halo Combat Evolved.xiso\nColin McRae Rally 2.0.zip';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:io.github.cesarus85.ringfall\npackage:org.opencmr2.quest';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0';
    if (command === 'shell ls -1 /sdcard/Download/') return romNames;
    return '';
  } };
  const games = getCatalog().filter((game) => ['mjolnir-vr', 'opencmr2-vr'].includes(game.id));
  const result = await inspectDevice(adb, 'Q3S', games, { 'opencmr2-vr': 'org.opencmr2.quest' });
  assert.equal(result['mjolnir-vr'].dataReady, true);
  assert.equal(result['opencmr2-vr'].dataReady, true);
  romNames = 'unrelated.xiso\nunrelated.zip';
  const unrelated = await inspectDevice(adb, 'Q3S', games, { 'opencmr2-vr': 'org.opencmr2.quest' });
  assert.equal(unrelated['mjolnir-vr'].dataReady, false);
  assert.equal(unrelated['opencmr2-vr'].dataReady, false);
});

test('a package learned from an installed APK remains detectable without a built-in package rule', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:org.example.newport';
    if (command === 'shell dumpsys package org.example.newport') return 'versionName=0.1';
    return '';
  } };
  const result = await inspectDevice(adb, 'Q3', [{ id: 'new-port', data: [] }], { 'new-port': 'org.example.newport' });
  assert.equal(result['new-port']?.packageId, 'org.example.newport');
});

test('Dark Forces scan recognizes the Quest package only when the owned game data is present', async () => {
  let files = 'DARK.GOB\nSOUNDS.GOB';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.tfe.game';
    if (command === 'shell dumpsys package com.tfe.game') return 'versionName=v0.9.57-quest';
    if (command === "shell ls -1 '/sdcard/Android/data/com.tfe.game/files/TheForceEngine/Dark Forces/'") return files;
    throw new Error(`Unexpected command ${command}`);
  } };
  const game = getCatalog().find((entry) => entry.id === 'dark-forces-vr');
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id]?.dataReady, true);
  files = 'readme.txt';
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id]?.dataReady, false);
});

test('new integrated ports become ready only when their converted headset data exists', async () => {
  const names = {
    '/sdcard/Android/data/net.gameordie.descentvr/files': 'descent.hog\ndescent.pig',
    '/sdcard/Android/data/com.gothic2vr.quest/files/Gothic2': 'Data\nSystem',
    '/sdcard/Android/data/io.github.gt2pc.quest/files/arcade': 'disc.raw2352\nassets',
    '/sdcard/Android/data/io.github.gt2pc.quest/files/arcade/assets': '.carcolor',
    '/sdcard/mgcarpet/baked': 'textures\nlevels\nvr4all-transfer.complete',
    '/sdcard/Android/data/com.galaxy.quest/files/game': 'ObjectData\nAudioRes\nvr4all-transfer.complete',
    '/data/local/tmp/astro/games/CUSA12392': 'eboot.bin\nsce_sys\nsce_module\nvr4all-transfer.complete',
    "'/sdcard/Amnesia The Dark Descent'": 'config\nmaps\nentities',
  };
  const installed = ['net.gameordie.descentvr', 'com.gothic2vr.quest', 'io.github.gt2pc.quest',
    'com.liquidazir.animalcrossingquest', 'technology.master.mc.vr', 'com.galaxy.quest',
    'com.astrobotquest.vrhost', 'com.CreaTeam.Sclerosis'];
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return installed.map((id) => `package:${id}`).join('\n');
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0';
    if (command.startsWith('shell ls -1 ')) return names[command.slice('shell ls -1 '.length)] || '';
    if (command === 'shell run-as com.liquidazir.animalcrossingquest ls -1 files/rom') return 'AnimalCrossing.iso';
    return '';
  } };
  const ids = ['descent12-vr', 'gothic2-vr', 'gt2-vr', 'animal-crossing-vr', 'magic-carpet-vr',
    'galaxyquest', 'astroquest', 'sclerosis-vr'];
  const games = getCatalog().filter((game) => ids.includes(game.id));
  const ready = await inspectDevice(adb, 'Q3', games);
  for (const id of ids) assert.equal(ready[id]?.dataReady, true, id);
  for (const [id, folder] of [['magic-carpet-vr', '/sdcard/mgcarpet/baked'],
    ['galaxyquest', '/sdcard/Android/data/com.galaxy.quest/files/game'],
    ['astroquest', '/data/local/tmp/astro/games/CUSA12392']]) {
    names[folder] = names[folder].replace('\nvr4all-transfer.complete', '');
    assert.equal((await inspectDevice(adb, 'Q3', games))[id]?.dataReady, false, `${id} transfer can be partial`);
    names[folder] += '\nvr4all-transfer.complete';
  }
  delete names['/sdcard/Android/data/io.github.gt2pc.quest/files/arcade/assets'];
  delete names['/data/local/tmp/astro/games/CUSA12392'];
  const incomplete = await inspectDevice(adb, 'Q3', games);
  assert.equal(incomplete['gt2-vr']?.dataReady, false);
  assert.equal(incomplete.astroquest?.dataReady, false);
});

test('Wave Race scan finds the installed Quest APK and transferred ROM', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.waverace64.questvr';
    if (command === 'shell dumpsys package com.waverace64.questvr') return 'versionName=0.1.8';
    if (command === 'shell ls -1 /sdcard/Download/') return 'Wave Race 64 (U) (V1.1) (!).n64';
    throw new Error(`Unexpected command ${command}`);
  } };
  const game = getCatalog().find((entry) => entry.id === 'wave-race-vr');
  const result = await inspectDevice(adb, 'Q3', [game]);
  assert.deepEqual(result['wave-race-vr'], {
    packageId: 'com.waverace64.questvr',
    versionName: '0.1.8',
    dataReady: true,
    versionComparable: true,
  });
});

test('Quest scans recognize unique uploaded disc names and PAL Mario Kart Wii', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return ['dev.melee.game', 'com.joeyaw.tpvr', 'org.wiicompiled.quest'].map((id) => `package:${id}`).join('\n');
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0';
    if (command === 'shell ls -1 /sdcard/Download/') return 'VR4ALL-xelee-disc.iso\nVR4ALL-twilight-vr-disc.iso\nRMCP01.wbfs';
    return '';
  } };
  const games = getCatalog().filter((game) => ['xelee', 'twilight-vr', 'wii-compiled'].includes(game.id));
  const result = await inspectDevice(adb, 'Q3', games);
  for (const game of games) assert.equal(result[game.id]?.dataReady, true, game.id);
});

test('Xelee scan recognizes a named GCM disc accepted by its creator', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:dev.melee.game';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0';
    if (command === 'shell ls -1 /sdcard/Download/') return 'Super Smash Bros Melee.gcm';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'xelee');
  assert.equal((await inspectDevice(adb, 'Q3', [game])).xelee.dataReady, true);
});

test('F-Zero X scan requires the creator package and prepared game archives', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:dev.gdiffuser.quest';
    if (command === 'shell dumpsys package dev.gdiffuser.quest') return 'versionName=R10';
    if (command === 'shell ls -1 /sdcard/Android/data/dev.gdiffuser.quest/files') return 'baserom.us.rev0.z64\nfzerox.o2r\ngdiffuser.o2r';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'fzero-x-virtuavr');
  assert.equal(game.variantOf, undefined);
  const result = await inspectDevice(adb, 'Q3', [game]);
  assert.equal(result[game.id].packageId, 'dev.gdiffuser.quest');
  assert.equal(result[game.id].dataReady, true);
});

test('old F-Zero APK alone does not mark the creator port as installed', async () => {
  const adb = { async run(args) {
    if (args.slice(2).join(' ') === 'shell pm list packages -3') return 'package:com.fzerox.vr';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'fzero-x-virtuavr');
  const result = await inspectDevice(adb, 'Q3', [game]);
  assert.equal(result[game.id], undefined);
});

test('Harry Potter scan recognizes the official player package and imported scene and audio', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:io.github.hpvr.quest';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=0.1.4.1';
    if (command.endsWith('/HP/Cache/Scenes')) return 'map-0.hpvc\nmap-1.hpvc';
    if (command.endsWith('/HP/Cache/Audio')) return 'music.pcm';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'harry-potter-vr');
  const result = await inspectDevice(adb, 'Q3', [game]);
  assert.equal(result['harry-potter-vr'].packageId, 'io.github.hpvr.quest');
  assert.equal(result['harry-potter-vr'].dataReady, true);
});

test('Halo scan follows the launchers selected managed game version', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.halo.decomp.vr';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0.37-test70';
    if (command.endsWith('/active-data.txt')) return 'p-864b19fb31a442d995900da1452fe76f';
    if (command.endsWith('/game-versions/p-864b19fb31a442d995900da1452fe76f/maps')) return `ui.map\n${Array.from({ length: 23 }, (_, i) => `map${i}.map`).join('\n')}`;
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'halo-ce');
  const result = await inspectDevice(adb, 'Q3', [game]);
  assert.equal(result['halo-ce'].dataReady, true);
});

test('Halo scan rejects legacy maps and a missing selected game version', async () => {
  const maps = `ui.map\n${Array.from({ length: 23 }, (_, i) => `map${i}.map`).join('\n')}`;
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.halo.decomp.vr';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0.41-test73b';
    if (command === 'shell ls -1 /sdcard/Android/data/com.halo.decomp.vr/files/maps/') return maps;
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'halo-ce');
  assert.equal((await inspectDevice(adb, 'Q3', [game]))['halo-ce'].dataReady, false);
});

test('Dirt Dash scan recognizes the installed Port0r package and arcade ZIPs', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:io.port0r.dirtdash';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=0.1.0';
    if (command === 'shell ls -1 /sdcard/Download') return 'dirtdash.zip\nnamcoc71.zip';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'dirt-dash-vr');
  const result = await inspectDevice(adb, 'Q3', [game]);
  assert.equal(result['dirt-dash-vr']?.dataReady, true);
});

test('headset scan recognizes personally built GTA SA and both supported RDR package names', async () => {
  const games = getCatalog().filter((game) => ['gta-sa-vr', 'rdr1-vr'].includes(game.id));
  const adb = { run: async (args) => args.includes('packages')
    ? 'package:com.rockstargames.gtasa\npackage:com.netflix.NGP.Kamo'
    : args.includes('dumpsys') ? 'versionName=personal-build' : '' };
  const result = await inspectDevice(adb, 'Q3', games);
  assert.equal(result['gta-sa-vr'].packageId, 'com.rockstargames.gtasa');
  assert.equal(result['rdr1-vr'].packageId, 'com.netflix.NGP.Kamo');
  assert.equal(result['gta-sa-vr'].versionComparable, false);
});

test('Mega Man 64 stays ready after the port imports and renames the ROM', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.megaman64recomp.vr';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=0.9.1-vr';
    if (command === 'shell ls -1 /sdcard/Android/data/com.megaman64recomp.vr/files') return 'megaman.n64.us.1.0.z64\nsaves\ncontrols.json';
    return '';
  } };
  const game = getCatalog().find((item) => item.id === 'mega-man-64-vr');
  const result = await inspectDevice(adb, 'Q3', [game]);
  assert.equal(result['mega-man-64-vr'].dataReady, true);
});

test('headset scan distinguishes complete manual installs from missing game files', async () => {
  const calls = [];
  const adb = { async run(args) {
    calls.push(args);
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:io.port0r.virtuacop\npackage:io.port0r.houseofthedead\npackage:org.timecrisis.quest';
    if (command === 'shell ls -1 /sdcard/Download') return 'vcop.zip\nmodel1io2.zip';
    if (command.startsWith('shell dumpsys package ')) return 'versionCode=1 versionName=0.2.2';
    throw new Error(`Unexpected command ${command}`);
  } };
  const games = getCatalog().filter((game) => ['cop-vr', 'hotd-vr', 'dr89-time-crisis', 'rally-vr'].includes(game.id));
  const result = await inspectDevice(adb, 'Q3', games);
  assert.equal(result['cop-vr'].dataReady, true);
  assert.equal(result['hotd-vr'].dataReady, false);
  assert.equal(result['dr89-time-crisis'].dataReady, true);
  assert.equal(result['rally-vr'], undefined);
  assert.ok(calls.every((args) => args[0] === '-s' && args[1] === 'Q3'));
});

test('headset scan recognizes imported files in app storage and additional installed ports', async () => {
  const names = {
    '/sdcard/Android/data/online.portroyale.wipeoutrewritevr/files/wipeout': 'common\ntrack01\ntextures',
    '/sdcard/Android/data/com.rrjb.vr/files': 'disc.bin',
    '/sdcard/Android/data/com.perfectdark.port/files/data': 'pd.ntsc-final.z64',
    '/sdcard/Android/data/com.miamivr.quest/files/gamedata': 'data\nmodels\nTEXT',
    '/sdcard/Android/data/dev.gdiffuser.quest/files': 'baserom.us.rev0.z64\nfzerox.o2r\ngdiffuser.o2r',
    '/sdcard/Android/data/io.port0r.houseofthedead/files/roms': 'hotd.zip',
  };
  const packages = ['online.portroyale.wipeoutrewritevr', 'com.rrjb.vr', 'com.perfectdark.port', 'com.miamivr.quest', 'com.baywilly.crazytaxivr', 'dev.gdiffuser.quest', 'io.port0r.houseofthedead'];
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return packages.map((name) => `package:${name}`).join('\n');
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0.0';
    if (command.startsWith('shell ls -1 ')) return names[command.slice('shell ls -1 '.length)] || '';
    return '';
  } };
  const ids = ['wipeout-vr', 'road-rash-vr', 'perfect-dark-vr', 'vice-city-vr', 'crazy-taxi-vr', 'fzero-x-virtuavr', 'hotd-vr'];
  const result = await inspectDevice(adb, 'Q3', getCatalog().filter((game) => ids.includes(game.id)));
  assert.deepEqual(Object.keys(result).sort(), ids.sort());
  assert.ok(Object.values(result).every((entry) => entry.dataReady));
});

test('Beef Raider scan distinguishes the demo APK from transferred full-game data', async () => {
  let contents = '';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.drbeef.beefraiderxr';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0.0';
    if (command === 'shell ls -1 /sdcard/BeefraiderXR/') return contents;
    throw new Error(`Unexpected command ${command}`);
  } };
  const game = getCatalog().find((entry) => entry.id === 'beef-raider-xr');
  assert.equal((await inspectDevice(adb, 'Q3', [game]))['beef-raider-xr']?.dataReady, false);
  contents = 'Audio\nFMV\nDATA';
  assert.equal((await inspectDevice(adb, 'Q3', [game]))['beef-raider-xr']?.dataReady, true);
});

test('headset scan recognizes Doom3Quest and Quake3Quest with their owned game data', async () => {
  const games = getCatalog().filter((game) => ['doom3quest', 'quake3quest'].includes(game.id));
  let doomFiles = games.find((game) => game.id === 'doom3quest').data[0].requiredEntries;
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.drbeef.doom3quest\npackage:com.drbeef.ioquake3quest';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.4.8';
    if (command === 'shell ls -1 /sdcard/Doom3Quest/base/') return doomFiles.join('\n');
    if (command === 'shell ls -1 /sdcard/ioquake3quest/baseq3/') return 'pak0.pk3\npak1.pk3';
    return '';
  } };
  const result = await inspectDevice(adb, 'Q3', games);
  assert.equal(result.doom3quest?.dataReady, true);
  assert.equal(result.quake3quest?.dataReady, true);
  doomFiles = ['pak000.pk4'];
  const incomplete = await inspectDevice(adb, 'Q3', games);
  assert.equal(incomplete.doom3quest?.dataReady, false);
});

test('XrKart scan finds the installed APK and an existing Mario Kart 64 ROM', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.n64vr.spaghettikart';
    if (command === 'shell dumpsys package com.n64vr.spaghettikart') return 'versionName=0.2.0-on-device-extraction';
    if (command === 'shell ls -1 /sdcard/Download/') return 'Mario Kart 64 (U) ___.z64';
    throw new Error(`Unexpected command ${command}`);
  } };
  const game = getCatalog().find((entry) => entry.id === 'xrkart-64');
  const result = await inspectDevice(adb, 'Q3', [game]);
  assert.equal(result['xrkart-64']?.packageId, 'com.n64vr.spaghettikart');
  assert.equal(result['xrkart-64']?.dataReady, true);
});

test('PrimedGun scan recognizes the installed native port and Metroid Prime ISO', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:org.primedgun.v2';
    if (command === 'shell dumpsys package org.primedgun.v2') return 'versionName=2.0.0-beta.3';
    if (command === 'shell ls -1 /sdcard/Download/') return 'Metroid Prime (USA) (Rev 2).iso';
    throw new Error(`Unexpected command ${command}`);
  } };
  const game = getCatalog().find((entry) => entry.id === 'primedgun-2');
  const result = await inspectDevice(adb, 'Q3', [game]);
  assert.equal(result['primedgun-2']?.packageId, 'org.primedgun.v2');
  assert.equal(result['primedgun-2']?.versionName, '2.0.0-beta.3');
  assert.equal(result['primedgun-2']?.dataReady, true);
});

test('new Port Royale releases are recognized by their Android package and required files', async () => {
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return [
      'package:com.starship.vr',
      'package:io.github.matteo842.crashlauncher.runtime',
      'package:com.bilko.forsakenvr',
    ].join('\n');
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0.0';
    if (command === 'shell ls -1 /sdcard/Android/data/com.starship.vr/files') return 'sf64.o2r';
    if (command === 'shell ls -1 /sdcard/Download/') return 'Crash Bandicoot (USA).chd';
    throw new Error(`Unexpected command ${command}`);
  } };
  const games = getCatalog().filter((entry) => ['starship-vr', 'crash-bandicoot-vr', 'forsaken-vr'].includes(entry.id));
  const result = await inspectDevice(adb, 'Q3', games);
  assert.deepEqual(Object.keys(result).sort(), games.map((game) => game.id).sort());
  assert.ok(Object.values(result).every((entry) => entry.dataReady));
});

test('Maze of the Kings uses its own app and requires its arcade files independently of HOTD2', async () => {
  const names = { '/sdcard/Download': 'mok.zip', '/sdcard/Download/mok': 'gds-0022.chd' };
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.flycast.emulator.vr\npackage:com.vrlightgunhub.hotd2arcade\npackage:com.vrlightgunhub.mok';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=1.0.0';
    if (command.startsWith('shell ls -1 ')) return names[command.slice('shell ls -1 '.length)] || '';
    return '';
  } };
  const games = getCatalog().filter((game) => ['mok-vr', 'hotd2-vr'].includes(game.id));
  const result = await inspectDevice(adb, 'Q3', games);
  assert.equal(result['mok-vr'].dataReady, true);
  assert.equal(result['hotd2-vr'].dataReady, false);
});

test('18 Wheeler scan requires the creator package and a complete CHD or GDI track set', async () => {
  const files = { '/sdcard/Download/18Wheeler/': 'game.gdi' };
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.flycast.emulator.wheeler18';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=0.1.0';
    if (command.startsWith('shell ls -1 ')) return files[command.slice('shell ls -1 '.length)] || '';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === '18-wheeler-vr');
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, false);
  files['/sdcard/Download/18Wheeler/'] = 'game.gdi\ntrack01.bin';
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, true);
  files['/sdcard/Download/18Wheeler/'] = '18 Wheeler USA.chd';
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, true);
});

test('scan does not call documented game data complete from placeholder folders', async () => {
  const cases = [
    ['descent3-vr', {}],
    ['halo-ce', { '/sdcard/Android/data/com.halo.decomp.vr/files/maps/': 'garbage.txt' }],
    ['revolt-vr', { '/sdcard/ReVoltVR/': 'garbage.txt' }],
    ['simpsons-hit-run-vr', { '/sdcard/SimpsonsHitRun/': 'garbage.txt' }],
    ['cnc-generals-xr', { '/sdcard/Download/GeneralsZH/': 'INIZH.big' }],
    ['ut99-quest', { '/sdcard/Android/data/com.ghwstvr.ut99quest/files/UT99': 'System\nMaps\nTextures' }],
    ['mgs-vr', { '/sdcard/MGSVR/roms/en': 'disc1.bin' }],
    ['wipeout-vr', { '/sdcard/Android/data/online.portroyale.wipeoutrewritevr/files/wipeout': 'common\ntrack1' }],
  ];
  for (const [id, directoryContents] of cases) {
    const game = getCatalog().find((entry) => entry.id === id);
    const packageId = require('../src/device-library').packages[id];
    const adb = { async run(args) {
      const command = args.slice(2);
      if (command.join(' ') === 'shell pm list packages -3') return `package:${packageId}`;
      if (command[0] === 'shell' && command[1] === 'dumpsys') return 'versionName=1.0.0';
      if (command[0] === 'shell' && command[1] === 'ls') return directoryContents[command[3]] || '';
      return '';
    } };
    const result = await inspectDevice(adb, 'Q3', [game]);
    assert.equal(result[id].dataReady, false, `${id} must remain incomplete`);
  }
});

test('Simpsons scan recognizes the original PC assets on the Quest', async () => {
  const root = '/sdcard/SimpsonsHitRun/';
  const names = {
    [root]: 'ambience.rcf\ncarsound.rcf\nmusic00.rcf\nscripts.rcf\nsoundfx.rcf\nart\nscripts\nmovies',
    [`${root}art`]: 'L1_TERRA.p3d',
    [`${root}scripts`]: 'missions\nss.mfk',
    [`${root}movies`]: 'intro.rmv',
  };
  const adb = { async run(args) {
    const command = args.slice(2);
    if (command.join(' ') === 'shell pm list packages -3') return 'package:com.simpsonsHitAndRun.vr';
    if (command[0] === 'shell' && command[1] === 'dumpsys') return 'versionName=0.93';
    if (command[0] === 'shell' && command[1] === 'ls') return names[command[3]] || '';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'simpsons-hit-run-vr');
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, true);
  delete names[`${root}scripts`];
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, false);
});

test('Need for Speed scans imported files in the app private folder after the original archive is removed', async () => {
  const games = getCatalog().filter((entry) => ['nfsu-vr', 'nfsu2-vr'].includes(entry.id));
  const adb = { async run(args) {
    const command = args.slice(2);
    if (command.join(' ') === 'shell pm list packages -3') return 'package:org.nfsu1.quest\npackage:org.nfsu2.quest';
    if (command[0] === 'shell' && command[1] === 'dumpsys') return 'versionName=0.3.0';
    if (command.join(' ') === 'shell run-as org.nfsu1.quest ls -1 files/game') return 'default.xbe\nCARS\nFRONTEND\nGLOBAL\nTRACKS';
    if (command.join(' ') === 'shell run-as org.nfsu2.quest ls -1 files/game') return 'default.xbe\nNFSUNDER\nTDATA\nUDATA';
    if (command[0] === 'shell' && command[1] === 'ls') throw new Error('No external game folder');
    return '';
  } };
  const result = await inspectDevice(adb, 'Q3', games);
  assert.equal(result['nfsu-vr'].dataReady, true);
  assert.equal(result['nfsu2-vr'].dataReady, true);
});

test('Need for Speed scan keeps Underground 1 incomplete when only Underground 2 was imported', async () => {
  const games = getCatalog().filter((entry) => ['nfsu-vr', 'nfsu2-vr'].includes(entry.id));
  const adb = { async run(args) {
    const command = args.slice(2);
    if (command.join(' ') === 'shell pm list packages -3') return 'package:org.nfsu1.quest\npackage:org.nfsu2.quest';
    if (command[0] === 'shell' && command[1] === 'dumpsys') return 'versionName=0.3.0';
    if (command.join(' ') === 'shell run-as org.nfsu1.quest ls -1 files/game') throw new Error('No Underground 1 files');
    if (command.join(' ') === 'shell run-as org.nfsu2.quest ls -1 files/game') return 'default.xbe\nNFSUNDER\nTDATA\nUDATA';
    if (command[0] === 'shell' && command[1] === 'ls') throw new Error('No external game folder');
    return '';
  } };
  const result = await inspectDevice(adb, 'Q3', games);
  assert.equal(result['nfsu-vr'].dataReady, false);
  assert.equal(result['nfsu2-vr'].dataReady, true);
});

test('scan recognizes documented game-data markers when present', async () => {
  const haloMaps = ['ui.map', ...Array.from({ length: 23 }, (_, index) => `map${index}.map`)].join('\n');
  const cases = [
    ['descent3-vr', { '/sdcard/Android/data/com.descentdevelopers.descent3/files/': 'd3.hog\nmissions\nmovies' }],
    ['halo-ce', { '/sdcard/Android/data/com.halo.decomp.vr/files/game-versions/p-864b19fb31a442d995900da1452fe76f/maps': haloMaps, '/sdcard/Android/data/com.halo.decomp.vr/files/active-data.txt': 'p-864b19fb31a442d995900da1452fe76f' }],
    ['revolt-vr', { '/sdcard/ReVoltVR/': 'cars\ngfx\nlevels\nmodels\nstrings\nwavs' }],
    ['cnc-generals-xr', { '/sdcard/Download/GeneralsZH/': 'INIZH.big\nTerrain.big\nTextures.big\nW3D.big' }],
    ['cnc-generals-xr', { '/sdcard/Download/GeneralsZH/': 'INIZH.big', '/sdcard/Download/GeneralsBase/': 'Terrain.big\nTextures.big\nW3D.big' }],
    ['ut99-quest', { '/sdcard/Android/data/com.ghwstvr.ut99quest/files/UT99': 'System\nMaps\nTextures\nSounds\nMusic' }],
    ['mgs-vr', { '/sdcard/MGSVR/roms/en': 'disc1.bin\ndisc1.cue\ndisc2.bin\ndisc2.cue' }],
    ['wipeout-vr', { '/sdcard/Android/data/online.portroyale.wipeoutrewritevr/files/wipeout': 'common\ntrack1\ntextures' }],
  ];
  for (const [id, directoryContents] of cases) {
    const game = getCatalog().find((entry) => entry.id === id);
    const packageId = require('../src/device-library').packages[id];
    const adb = { async run(args) {
      const command = args.slice(2);
      if (command.join(' ') === 'shell pm list packages -3') return `package:${packageId}`;
      if (command[0] === 'shell' && command[1] === 'dumpsys') return 'versionName=1.0.0';
      if (command[0] === 'shell' && command[1] === 'cat') return directoryContents[command[2]] || '';
      if (command[0] === 'shell' && command[1] === 'ls') return directoryContents[command[3]] || '';
      return '';
    } };
    const result = await inspectDevice(adb, 'Q3', [game]);
    assert.equal(result[id].dataReady, true, `${id} has documented markers`);
  }
});
