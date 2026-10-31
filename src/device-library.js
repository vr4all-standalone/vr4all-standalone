// Read-only probes for catalogued ports on the selected Android headset.
const packages = {
  'gunblade-ny-vr': 'com.vrlightgunhub.gunbladeny',
  'hotd-model2-vr': 'com.vrlightgunhub.hotdmodel2',
  'behind-enemy-lines-vr': 'com.vrlightgunhub.bel',
  'rail-chase-2-vr': 'com.vrlightgunhub.rchase2',
  'max-payne-nightmare-vr': 'com.MPQ.HaveliSkywalker',
  'project06-vr': 'com.p06.quest',
  qualyx: 'org.hlvr.quest',
  'project-honeydew': 'org.projecthoneydew.quest',
  'ghost-squad-evolution-vr': 'org.lindbergh.gse.vr',
  'hotd4-vr': 'org.lindbergh.hotd4.vr',
  'daytona-usa-vr': 'io.port0r.daytona',
  'mario-party-4-vr': 'com.mariopartyrd.partyboard',
  'ctr-turbocharged-vr': 'com.bilko.ctrvr',
  'mystical-ninja-vr': 'com.goemon64.recompiled',
  'wwf-no-mercy-vr': 'com.nomercyrecomp.questvr',
  'sin-and-punishment-vr': 'com.sinandpunishment.recompiled',
  'nfl-blitz-2000-vr': 'com.blitz2000.recompiled',
  'bomberman-hero-vr': 'com.bmhero.recompiled',
  'arx-libertatis-vr': 'org.arxlibertatis.vr',
  wakerquest: 'io.github.wakerquest',
  'victory-heat-rally-vr': 'com.segadreamcat.vhrquest',
  'confidential-mission-vr': 'com.vrlightgunhub.confmiss',
  'teraburst-vr': 'com.vrlightgunhub.teraburst',
  'vcop2-vr': 'com.vrlightgunhub.vcop2',
  'vcop-vr': 'com.vrlightgunhub.vcop',
  'gt3-revisited': 'org.gt3revisited.gt3r',
  'bioshock-vr': 'com.winlator.cmod',
  'carnevil-vr': 'com.vrlightgunhub.carnevil',
  'survivor2-code-veronica-vr': 'com.vrlightgunhub.survivor2',
  'lupin-the-third-vr': 'com.vrlightgunhub.lupin',
  'ninja-assault-vr': 'com.vrlightgunhub.ninjaassault',
  'death-crimson-ox-vr': 'com.vrlightgunhub.deathcrimsonox',
  'cop-vr': 'io.port0r.virtuacop',
  'time-crisis-vr': 'io.port0r.timecrisis',
  'time-crisis-2-vr': 'io.port0r.timecrisis2',
  'dirt-dash-vr': 'io.port0r.dirtdash',
  'hotd-vr': 'io.port0r.houseofthedead',
  'dr89-time-crisis': 'org.timecrisis.quest',
  'dr89-time-crisis-2': 'org.timecrisis2.arcadevr',
  'sm64-vr': 'com.fulldivegames.sm64coopdxvr',
  'oot-vr': 'org.oot.vr',
  'mm-vr': 'com.fulldivegames.majorasmaskvr',
  xelee: 'dev.melee.game',
  'twilight-vr': 'com.joeyaw.tpvr',
  'quest-strikers': 'io.github.newcoke.strikers',
  'wii-compiled': 'org.wiicompiled.quest',
  'hotd2-vr': 'com.vrlightgunhub.hotd2arcade',
  'hotd2-dreamcast-vr': 'com.flycast.emulator.vr',
  'mok-vr': 'com.vrlightgunhub.mok',
  'mok-upstream-vr': 'com.flycast.emulator.vr',
  'pokemon-gen1-vr': 'com.heurazy.gen1pokemonvr.quest',
  'pokemon-gen1-recomp': 'com.theboisclub.pokemonred',
  'mjolnir-vr': 'io.github.cesarus85.ringfall',
  csvr: 'com.lvonasek.csvr',
  preyvr: 'com.lvonasek.preyvr',
  questsam: 'com.github.maranone.questsam',
  questcarnage: 'com.github.maranone.questcarnage',
  'wing-commander-1-vr': 'com.bilko.wc1vr',
  'wing-commander-2-vr': 'com.bilko.wc2vr',
  'freespace2-vr': 'com.bilko.fs2vr',
  'strikers-charged-vr': 'io.github.lancesweatpants.strikerscharged',
  'tes3mp-vr': 'xyz.morrowind.tes3mpvr',
  'rave-racer-vr': 'com.virtuavrport.raveracervr',
  'cnc-generals-xr': 'com.generalsx.zerohour.xr',
  jkxr: 'com.drbeef.jkxr',
  doom3quest: 'com.drbeef.doom3quest',
  quake3quest: 'com.drbeef.ioquake3quest',
  'mega-man-64-vr': 'com.megaman64recomp.vr',
  'descent3-vr': 'com.descentdevelopers.descent3',
  'crisis-zone-vr': 'org.crisiszone.vr',
  'halo-ce': 'com.halo.decomp.vr',
  'nfsu-vr': 'org.nfsu1.quest',
  'nfsu2-vr': 'org.nfsu2.quest',
  'revolt-vr': 'com.baywilly.rvglquestlab',
  'mgs-vr': 'org.baywilly.mgsvr',
  'wipeout-vr': 'online.portroyale.wipeoutrewritevr',
  'road-rash-vr': 'com.rrjb.vr',
  'harry-potter-vr': 'io.github.hpvr.quest',
  'goldeneye-vr': 'com.gevr.port',
  'wave-race-vr': 'com.waverace64.questvr',
  'xrkart-64': 'com.n64vr.spaghettikart',
  'avp-vr': 'com.bassquake.quest.avpvr',
  sourcevr: 'com.sourcevrport.hl2vr',
  'ut99-quest': 'com.ghwstvr.ut99quest',
  'perfect-dark-vr': 'com.perfectdark.port',
  'simpsons-hit-run-vr': 'com.simpsonsHitAndRun.vr',
  'vice-city-vr': 'com.miamivr.quest',
  'gta-sa-vr': 'com.rockstargames.gtasa',
  'rdr1-vr': 'com.rockstargames.rdr',
  'crazy-taxi-vr': 'com.baywilly.crazytaxivr',
  'beef-raider-xr': 'com.drbeef.beefraiderxr',
  'fzero-x-virtuavr': 'dev.gdiffuser.quest',
  'primedgun-2': 'org.primedgun.v2',
  'starship-vr': 'com.starship.vr',
  'crash-bandicoot-vr': 'io.github.matteo842.crashlauncher.runtime',
  'forsaken-vr': 'com.bilko.forsakenvr',
  'descent12-vr': 'net.gameordie.descentvr',
  'gothic2-vr': 'com.gothic2vr.quest',
  'gt2-vr': 'io.github.gt2pc.quest',
  'animal-crossing-vr': 'com.liquidazir.animalcrossingquest',
  'magic-carpet-vr': 'technology.master.mc.vr',
  galaxyquest: 'com.galaxy.quest',
  astroquest: 'com.astrobotquest.vrhost',
  'tiberian-dawn-mr': 'org.tiberiandawn.android',
  'sclerosis-vr': 'com.CreaTeam.Sclerosis',
  wolfsharp: 'net.benmclean.wolf3d',
  'dark-forces-vr': 'com.tfe.game',
  '18-wheeler-vr': 'com.flycast.emulator.wheeler18',
  'xwing-revival-vr': 'com.bilko.xwingrevivalvr',
};

const packageAliases = { 'rdr1-vr': ['com.rockstargames.rdr', 'com.netflix.NGP.Kamo'] };

const downloadPatterns = {
  'project-honeydew': /pikmin.*\.(?:iso|gcm)$/i,
  'mario-party-4-vr': /(?:mario.party.4|gmpe01|gmpp01).*\.(?:iso|rvz|wia|gcz)$/i,
  'mystical-ninja-vr': /(?:mystical.ninja|goemon).*\.(?:z64|n64|v64)$/i,
  'wwf-no-mercy-vr': /(?:wwf.no.mercy|no.mercy).*\.(?:z64|n64|v64)$/i,
  'sin-and-punishment-vr': /sin.and.punishment.*\.(?:z64|n64|v64)$/i,
  'nfl-blitz-2000-vr': /nfl.blitz.2000.*\.(?:z64|n64|v64)$/i,
  'bomberman-hero-vr': /bomberman.hero.*\.(?:z64|n64|v64)$/i,
  wakerquest: /(?:wind.waker|gzlp01).*\.iso$/i,
  'sm64-vr': /super mario 64.*\.(z64|n64|v64)$/i,
  'oot-vr': /ocarina of time.*\.(z64|n64|v64)$/i,
  'mm-vr': /majora.?s mask.*\.(z64|n64|v64)$/i,
  xelee: /(?:melee|smash bros).*\.(rvz|iso|gcm|ciso)$/i,
  'twilight-vr': /twilight princess.*\.(iso|gcm|ciso|gcz|rvz|wia|wbfs)$/i,
  'quest-strikers': /(?:mario strikers|super mario strikers).*\.(iso|rvz|wia|gcm|ciso|gcz)$/i,
  'strikers-charged-vr': /(?:mario strikers charged|strikers charged|r4qe01).*\.(iso|rvz|wia)$/i,
  'wii-compiled': /(?:mario kart wii|rmcp01).*\.(iso|wbfs|rvz)$/i,
  'hotd2-dreamcast-vr': /(?:house of the dead 2|hotd2).*\.(chd|cdi)$/i,
  'smash-remix-vr': /(?:smash bros|smash remix).*\.(z64|n64|v64)$/i,
  'wave-race-vr': /wave race.*\.(z64|n64|v64)$/i,
  'goldeneye-vr': /goldeneye.*\.(z64|n64|v64)$/i,
  'xrkart-64': /mario kart 64.*\.(z64|n64|v64)$/i,
  'perfect-dark-vr': /perfect dark.*\.(z64|n64|v64)$/i,
  'primedgun-2': /metroid prime.*\.iso$/i,
  'crash-bandicoot-vr': /crash bandicoot.*\.chd$/i,
  'pokemon-gen1-vr': /pok[eé]mon.*\b(?:red|blue)\b.*\.gb$/i,
  'pokemon-gen1-recomp': /pok[eé]mon.*\b(?:red|blue|yellow)\b.*\.gbc?$/i,
  'mjolnir-vr': /halo.*\.(?:iso|xiso)$/i,
  'opencmr2-vr': /(?:colin.?mcrae|cmr2).*\.zip$/i,
  'gt3-revisited': /(?:gran turismo 3|gt3|scus-97102|pbpx-95503).*\.iso$/i,
};

// Some upstream release tags use unrelated build numbering. Leave these neutral
// until the project exposes a reliable installed-to-release version mapping.
const incomparableVersions = new Set(['wii-compiled', 'nfsu2-vr', 'revolt-vr', 'mgs-vr', 'sourcevr', 'hotd2-dreamcast-vr', 'mok-upstream-vr', 'twilight-vr', 'gta-sa-vr', 'rdr1-vr', 'crazy-taxi-vr', 'bioshock-vr']);

async function inspectDevice(adb, serial, games, knownPackages = {}) {
  const result = {};
  const installedText = await adb.run(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3']);
  const installedPackages = new Set(installedText.split(/\r?\n/).map((line) => line.trim().replace(/^package:/, '')));
  const listCache = new Map();
  async function list(directory) {
    if (!listCache.has(directory)) {
      listCache.set(directory, adb.run(['-s', serial, 'shell', 'ls', '-1', directory.includes(' ') ? `'${directory}'` : directory])
        .then((output) => output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
        .catch(() => []));
    }
    return listCache.get(directory);
  }
  async function hasData(game) {
    if (game.id === 'max-payne-nightmare-vr') {
      const base = '/sdcard/Android/data/com.MPQ.HaveliSkywalker/files';
      const staged = await list(base);
      if (staged.some((name) => /\.apk$/i.test(name))
        && staged.some((name) => /^main\.\d+\.com\.rockstar\.maxpayne\.obb$/i.test(name))) return true;
      for (const directory of [base, `${base}/maxpayne`, `${base}/game`, `${base}/data`]) {
        const files = await list(directory);
        if (files.includes('x_data.ras') && files.some((name) => /^x_level\d+\.ras$/i.test(name))) return true;
      }
      return false;
    }
    if (game.id === 'qualyx') {
      const base = '/sdcard/Qualyx/game';
      return (await list(`${base}/hlvr`)).includes('pak01_dir.vpk')
        && (await list(`${base}/core`)).includes('pak01_dir.vpk');
    }
    if (game.id === 'gt3-revisited') {
      return (await list('/sdcard/Download')).some((name) => downloadPatterns['gt3-revisited'].test(name));
    }
    if (game.id === 'bioshock-vr') {
      const root = await list('/sdcard/BioshockMQ2');
      const release = await list('/sdcard/BioshockMQ2/Builds/Release');
      return root.includes('Content') && release.includes('Bioshock.exe');
    }
    if (game.id === 'pokemon-gen1-vr') {
      const imported = await list('/sdcard/Android/data/com.heurazy.gen1pokemonvr.quest/files/save/pokemon-love2d');
      if (imported.includes('red') || imported.includes('blue')) return true;
    }
    if (game.id === 'xwing-revival-vr') {
      const missions = await list('/sdcard/XWingRevival/Missions/');
      return ['rebel0.def', 'empire0.def'].every((name) => missions.includes(name));
    }
    if (game.id === '18-wheeler-vr') {
      const names = await list('/sdcard/Download/18Wheeler/');
      return names.some((name) => /\.chd$/i.test(name))
        || names.some((name) => /\.gdi$/i.test(name)) && names.some((name) => /\.bin$/i.test(name));
    }
    if (game.id === 'descent12-vr') {
      const root = await list('/sdcard/Android/data/net.gameordie.descentvr/files');
      const d2 = await list('/sdcard/Android/data/net.gameordie.descentvr/files/descent2');
      return root.includes('descent.hog') && root.includes('descent.pig')
        || d2.includes('descent2.hog') && d2.includes('descent2.ham');
    }
    if (game.id === 'gothic2-vr') {
      const root = await list('/sdcard/Android/data/com.gothic2vr.quest/files/Gothic2');
      return root.includes('Data') && root.includes('System');
    }
    if (game.id === 'gt2-vr') {
      for (const mode of ['arcade', 'simulation']) {
        const root = `/sdcard/Android/data/io.github.gt2pc.quest/files/${mode}`;
        if ((await list(root)).includes('disc.raw2352') && (await list(`${root}/assets`)).length) return true;
      }
      return false;
    }
    if (game.id === 'animal-crossing-vr') {
      const privateFiles = await adb.run(['-s', serial, 'shell', 'run-as', 'com.liquidazir.animalcrossingquest', 'ls', '-1', 'files/rom']).catch(() => '');
      return /(?:^|\n)AnimalCrossing\.(?:iso|gcm|ciso)(?:\r?\n|$)/i.test(privateFiles);
    }
    if (game.id === 'magic-carpet-vr') {
      const baked = await list('/sdcard/mgcarpet/baked');
      return baked.includes('vr4all-transfer.complete') && baked.some((name) => name !== 'vr4all-transfer.complete');
    }
    if (game.id === 'fzero-x-virtuavr') {
      const files = await list('/sdcard/Android/data/dev.gdiffuser.quest/files');
      return ['baserom.us.rev0.z64', 'fzerox.o2r', 'gdiffuser.o2r'].every((name) => files.includes(name));
    }
    if (game.id === 'galaxyquest') {
      const files = await list('/sdcard/Android/data/com.galaxy.quest/files/game');
      return files.includes('vr4all-transfer.complete') && files.some((name) => name !== 'vr4all-transfer.complete');
    }
    if (game.id === 'astroquest') {
      const root = await list('/data/local/tmp/astro/games/CUSA12392');
      return ['eboot.bin', 'sce_sys', 'sce_module', 'vr4all-transfer.complete'].every((name) => root.includes(name));
    }
    if (game.id === 'sclerosis-vr') {
      const root = await list('/sdcard/Amnesia The Dark Descent');
      return ['config', 'maps', 'entities'].every((name) => root.includes(name));
    }
    if (game.id === 'beef-raider-xr') {
      const names = await list('/sdcard/BeefraiderXR/');
      return ['Audio', 'FMV', 'DATA'].every((name) => names.includes(name));
    }
    if (game.id === 'descent3-vr') {
      const names = await list('/sdcard/Android/data/com.descentdevelopers.descent3/files/');
      return ['d3.hog', 'missions', 'movies'].every((name) => names.includes(name));
    }
    if (game.id === 'halo-ce') {
      const root = '/sdcard/Android/data/com.halo.decomp.vr/files';
      const active = (await adb.run(['-s', serial, 'shell', 'cat', `${root}/active-data.txt`]).catch(() => '')).trim();
      if (!/^p-[a-f0-9]{32}$/i.test(active)) return false;
      const names = await list(`${root}/game-versions/${active}/maps`);
      return names.includes('ui.map') && names.filter((name) => /\.map$/i.test(name)).length >= 24;
    }
    if (game.id === 'revolt-vr') {
      const names = await list('/sdcard/ReVoltVR/');
      return ['cars', 'gfx', 'levels', 'models', 'strings', 'wavs'].every((name) => names.includes(name));
    }
    if (game.id === 'simpsons-hit-run-vr') {
      const root = '/sdcard/SimpsonsHitRun/';
      const names = await list(root);
      if (!['ambience.rcf', 'carsound.rcf', 'music00.rcf', 'scripts.rcf', 'soundfx.rcf', 'art', 'scripts', 'movies']
        .every((name) => names.includes(name))) return false;
      const [art, scripts, movies] = await Promise.all(['art', 'scripts', 'movies'].map((name) => list(`${root}${name}`)));
      return art.some((name) => /\.p3d$/i.test(name))
        && scripts.includes('missions') && scripts.some((name) => /\.mfk$/i.test(name))
        && movies.some((name) => /\.rmv$/i.test(name));
    }
    if (game.id === 'cnc-generals-xr') {
      const zeroHour = await list('/sdcard/Download/GeneralsZH/');
      if (!zeroHour.includes('INIZH.big')) return false;
      const base = await list('/sdcard/Download/GeneralsBase/');
      return ['Terrain.big', 'Textures.big', 'W3D.big'].every((name) => zeroHour.includes(name) || base.includes(name));
    }
    if (game.id === 'goldeneye-vr') {
      const imported = await list('/sdcard/Android/data/com.gevr.port/files/data');
      if (imported.includes('ge.z64')) return true;
    }
    if (game.id === 'avp-vr') {
      const names = await list('/sdcard/Android/data/com.bassquake.quest.avpvr/files');
      return ['avp_rifs', 'fastfile', 'language.txt'].every((name) => names.includes(name));
    }
    if (game.id === 'sourcevr') {
      const names = await list('/sdcard/SourceVRPort/common');
      return names.includes('hl2') && names.includes('platform')
        || ['portal2', 'update', 'portal2_platform'].every((entry) => names.includes(entry));
    }
    if (game.id === 'unreal-gold-vr') {
      const names = await list('/sdcard/SurrealEngine');
      return ['System', 'Maps', 'Textures', 'Sounds', 'Music', 'Help'].every((name) => names.includes(name));
    }
    if (game.id === 'ut99-quest') {
      const names = await list('/sdcard/Android/data/com.ghwstvr.ut99quest/files/UT99');
      return ['System', 'Maps', 'Textures', 'Sounds', 'Music'].every((entry) => names.includes(entry));
    }
    if (game.id === 'wipeout-vr') {
      const names = await list('/sdcard/Android/data/online.portroyale.wipeoutrewritevr/files/wipeout');
      return names.includes('common') && names.includes('textures') && names.some((name) => /^track\d+/i.test(name));
    }
    if (game.id === 'road-rash-vr') return (await list('/sdcard/Android/data/com.rrjb.vr/files')).includes('disc.bin');
    if (game.id === 'harry-potter-vr') {
      const scenes = await list('/sdcard/Android/data/io.github.hpvr.quest/files/HP/Cache/Scenes');
      const audio = await list('/sdcard/Android/data/io.github.hpvr.quest/files/HP/Cache/Audio');
      return scenes.some((name) => /^map-\d+\.hpvc$/i.test(name)) && audio.length > 0;
    }
    if (game.id === 'hotd-vr') return (await list('/sdcard/Android/data/io.port0r.houseofthedead/files/roms')).includes('hotd.zip') || (await list('/sdcard/Download')).includes('hotd.zip');
    if (game.id === 'time-crisis-vr') {
      const imported = await list('/sdcard/Android/data/io.port0r.timecrisis/files/roms');
      const waiting = await list('/sdcard/Download');
      return ['timecris.zip', 'namcoc71.zip'].every((name) => imported.includes(name) || waiting.includes(name));
    }
    if (game.id === 'time-crisis-2-vr') {
      const imported = await list('/sdcard/Android/data/io.port0r.timecrisis2/files/roms');
      return imported.includes('timecrs2.zip') || (await list('/sdcard/Download')).includes('timecrs2.zip');
    }
    if (game.id === 'perfect-dark-vr') return (await list('/sdcard/Android/data/com.perfectdark.port/files/data')).some((name) => /^pd\..*\.z64$/i.test(name));
    if (game.id === 'vice-city-vr') {
      const names = await list('/sdcard/Android/data/com.miamivr.quest/files/gamedata');
      return ['data', 'models', 'TEXT'].every((name) => names.includes(name));
    }
    if (game.id === 'mgs-vr') {
      const discs = await list('/sdcard/MGSVR/roms/en');
      return discs.filter((entry) => /\.bin$/i.test(entry)).length >= 2
        && discs.filter((entry) => /\.cue$/i.test(entry)).length >= 2;
    }
    if (game.id === 'mega-man-64-vr') {
      const names = await list('/sdcard/Android/data/com.megaman64recomp.vr/files');
      return names.includes('MegaMan64.us.rev1.z64') || names.includes('megaman.n64.us.1.0.z64');
    }
    if (game.id === 'nfsu-vr' || game.id === 'nfsu2-vr') {
      const packageId = game.id === 'nfsu-vr' ? 'org.nfsu1.quest' : 'org.nfsu2.quest';
      const privateText = await adb.run(['-s', serial, 'shell', 'run-as', packageId, 'ls', '-1', 'files/game']).catch(() => '');
      const privateFiles = new Set(privateText.split(/\r?\n/).map((name) => name.trim()).filter(Boolean));
      if (game.id === 'nfsu-vr' && ['default.xbe', 'CARS', 'FRONTEND', 'GLOBAL', 'TRACKS'].every((name) => privateFiles.has(name))) return true;
      if (game.id === 'nfsu2-vr' && ['default.xbe', 'NFSUNDER'].every((name) => privateFiles.has(name))) return true;
      const folder = game.id === 'nfsu-vr' ? '/sdcard/Android/data/org.nfsu1.quest/files/game' : '/sdcard/Android/data/org.nfsu2.quest/files/game';
      return (await list(folder)).length > 0;
    }
    if (game.id === 'jkxr') {
      const outcast = await list('/sdcard/JKXR/JK2/base');
      const academy = await list('/sdcard/JKXR/JK3/base');
      return outcast.includes('assets0.pk3') || academy.includes('assets0.pk3');
    }
    if (!game.data.length) return true; // Release APK embeds the playable data.
    for (const item of game.data.filter((entry) => !entry.optional)) {
      if (item.kind === 'directory') {
        const names = await list(item.destination);
        if (!names.length || [...(item.requiredEntries || []), ...(item.requiredDirectories || [])].some((name) => !names.includes(name))) return false;
      } else if (item.destination.endsWith('/')) {
        const names = await list(item.destination);
        if (!names.some((name) => downloadPatterns[game.id]?.test(name)
          || (item.extensions || []).some((extension) => name.toLowerCase() === `vr4all-${game.id}-${item.id}${extension}`.toLowerCase()))) return false;
      } else {
        const separator = item.destination.lastIndexOf('/');
        const names = await list(item.destination.slice(0, separator));
        if (!names.includes(item.destination.slice(separator + 1))) return false;
      }
    }
    return true;
  }
  for (const game of games) {
    const packageId = packageAliases[game.id]?.find((candidate) => installedPackages.has(candidate)) || packages[game.id] || knownPackages[game.id];
    if (!packageId || !installedPackages.has(packageId)) continue;
    const dump = await adb.run(['-s', serial, 'shell', 'dumpsys', 'package', packageId]).catch(() => '');
    const versionName = dump.match(/\bversionName=([^\s]+)/)?.[1] || null;
    result[game.id] = { packageId, versionName, dataReady: await hasData(game), versionComparable: !incomparableVersions.has(game.id) };
  }
  return result;
}

module.exports = { inspectDevice, packages };
