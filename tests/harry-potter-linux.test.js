const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { installHarryPotterLinux, permissionCommands } = require('../src/harry-potter-linux');

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const APK = 'HPVR-Quest-Demo.apk';
const TOOLS = ['hpvr_hp1_package_graph.exe', 'hpvr_hp1_sound_probe.exe', 'hpvr_quest_frontend_probe.exe', 'hpvr_quest_intro_probe.exe', 'hpvr_quest_prepare_assets.exe'];
const FIXED_ON_DISK = ['system/HPBase.u', 'system/HarryPotter.u', 'system/HPMenu.u', 'system/HPParticle.u', 'system/HProps.u', 'system/HPSounds.u',
  'system/hpmenu.int', 'system/hpdialog.int', 'Textures/MenuArt.utx', 'Textures/StoryBookTest.utx', 'Sounds/AllDialog.uax', 'Sounds/Magic_sfx.uax',
  'Sounds/Ambient.uax', 'Sounds/Menu_sfx.uax', 'Sounds/Hub1_sfx.uax', 'Music/JS_HP_Title_Screen_v2.umx', 'Music/JS_StoryBook_v2_mx.umx',
  'Music/JS_Opening_Castle_Fly_Through_mx.umx', 'Music/happy_hogwarts_mxlp1.umx', 'Textures/HP_FX.utx', 'system/pickup.int'];
const MAPS = ['Lev_Tut1.unr', 'Lev_Tut1b.unr', 'Lev_Tut2.unr', 'Lev_Tut3.unr', 'Lev_Tut3b.unr'];
const CLIPS = ['111DumbledoreInfo1', '111DumbledoreInfo2', '111DumbledoreInfo3', '111DumbledoreInfo4', 'Dumbledore_01', 'spell_tracing_loop', 'wand_ready_loop', 'spell_cast', 'flipendo_no'];
const FFMPEG = '/fake/bin/ffmpeg';
const WINE = { kind: 'wine', path: '/fake/bin/wine' };
const unixPath = (windows) => windows.slice(2).replaceAll('\\', '/');
const hex8 = (text) => sha(text).slice(0, 8);

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-hpvr-linux-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function writeFile(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

async function bundle(root, { versionCode = 85, mapIds = [0, 1, 2, 3, 4], scenes = true, bom = false, corrupt = false } = {}) {
  const bundleRoot = path.join(root, 'player');
  const entries = { [APK]: 'APK bytes', 'tools/INSTALL-HPVR.ps1': 'param()', ...Object.fromEntries(TOOLS.map((name) => [`tools/${name}`, `MZ ${name}`])) };
  for (const [name, data] of Object.entries(entries)) await writeFile(path.join(bundleRoot, name), data);
  const manifest = { schema: 1, packageName: 'io.github.hpvr.quest', apk: APK, version: '0.1.4.1', versionCode, mapIds,
    ...(scenes ? { preparedSceneVersion: 1 } : {}),
    files: Object.entries(entries).map(([name, data]) => ({ path: name, sha256: (corrupt && name === APK ? sha('other') : sha(data)).toUpperCase(), bytes: data.length })) };
  await writeFile(path.join(bundleRoot, 'release-manifest.json'), (bom ? '\uFEFF' : '') + JSON.stringify(manifest));
  return bundleRoot;
}

// An owned game whose on-disk names differ in case from the names the app asks for.
async function ownedGame(root) {
  const game = path.join(root, 'HP Game');
  const dirs = { system: 'System', Maps: 'maps', Textures: 'Textures', Sounds: 'SOUNDS', Music: 'Music' };
  const put = (relative, name = path.basename(relative)) => {
    const [dir] = relative.split('/');
    return writeFile(path.join(game, dirs[dir], name.toLowerCase()), `data:${relative}`);
  };
  for (const relative of FIXED_ON_DISK) await put(relative);
  for (const map of MAPS) await put(`Maps/${map}`);
  await put('Textures/Extra.utx');
  return game;
}

function fakeAdb({ pmPath = 'package:/data/app/~~x/base.apk', tamper = false, broadcast } = {}) {
  const calls = [];
  const pushed = new Map();
  const apkHash = { value: null };
  return {
    calls, pushed, apkHash,
    run: async (args) => {
      assert.deepEqual(args.slice(0, 2), ['-s', 'Quest-1']);
      const rest = args.slice(2);
      calls.push(rest);
      if (rest[0] === 'install') { apkHash.value = sha(await fs.readFile(rest.at(-1))); return 'Performing Streamed Install\nSuccess'; }
      if (rest[0] === 'push') { pushed.set(rest[3], sha(await fs.readFile(rest[2]))); return '1 file pushed'; }
      if (rest[0] === 'shell' && rest[1] === 'pm') return pmPath;
      if (rest[0] === 'shell') {
        const hash = /^sha256sum '(.+)'$/.exec(rest[1])?.[1];
        if (hash) return `${hash.endsWith('base.apk') ? apkHash.value : tamper ? sha('tampered') : pushed.get(hash)}  ${hash}`;
        if (rest[1].startsWith('am broadcast')) {
          if (broadcast) return broadcast;
          const count = rest[1].split("--es paths '")[1].split('|').length;
          return `Broadcasting: Intent\nBroadcast completed: result=-1, data="HPVR_DATA_ACCESS=PASS files=${count}"`;
        }
      }
      return '';
    },
  };
}

function fakeRunner({ silent = false, usage = true } = {}) {
  const calls = [];
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (command === FFMPEG) {
      await fs.writeFile(args.at(-1), Buffer.alloc(2000, silent ? 0 : 7));
      return { code: 0, signal: null, stdout: '', tail: [] };
    }
    assert.equal(command, WINE.path);
    const [exe, ...rest] = args;
    const name = path.basename(exe);
    const ok = (stdout = '') => ({ code: 0, signal: null, stdout, tail: stdout.split('\n').filter(Boolean) });
    if (name === TOOLS[0]) {
      if (!rest.length) return usage ? { code: 1, signal: null, stdout: '', tail: ['usage: hpvr_hp1_package_graph <data-root> <entry-package>'] } : { code: 0, signal: null, stdout: '', tail: ['err:module:import_dll'] };
      const root = rest[0];
      const map = rest[1];
      // Windows-form paths with CRLF, a lower-case spelling of a fixed-list file, and a dependency outside the fixed list.
      return ok([`graph_status=ok packages=3 dependencies=2 cycle_edges=0 shadowed_candidates=0`,
        `package=m kind=data path=${map} version=1 direct_dependencies=2 native_companion=0`,
        `package=base kind=data path=${root}\\system\\hpbase.u version=1 direct_dependencies=0 native_companion=0`,
        `package=extra kind=data path=${root}\\Textures\\Extra.utx version=1 direct_dependencies=0 native_companion=0`,
        `package=native kind=native path=${root}\\system\\Core.dll`, 'dependency=m->base kind=import'].join('\r\n') + '\r\n');
    }
    if (name === TOOLS[2]) {
      const passRoot = unixPath(rest[1]);
      const pass = rest[3] ?? 'none';
      await fs.mkdir(passRoot, { recursive: true });
      const keys = [...Array.from({ length: 22 }, (_, i) => [`clip${pass}${i}.${hex8(`${pass}${i}`)}.s16`, 1]), ['shared.deadbeef.s16', 1], ['voice.0000abcd.stereo.s16', 2]];
      for (const [key] of keys) await fs.writeFile(path.join(passRoot, `${key}.mp2`), `mp2 ${key}`);
      await fs.writeFile(path.join(passRoot, 'audio-plan.tsv'), `${keys.map(([key, channels]) => `${key}\t${channels}`).join('\r\n')}\r\n`);
      return ok(`FRONT_ASSETS=PASS pages=1 map=${pass}\n`);
    }
    if (name === TOOLS[1]) {
      const object = rest[2];
      await fs.writeFile(unixPath(rest[3]), `mp2 ${object}`);
      return ok(`${object} bytes=3\r\ncache_name=${object}.${hex8(object)}.s16\r\n`);
    }
    if (name === TOOLS[4]) {
      if (!rest.includes('--verify')) await fs.writeFile(path.join(unixPath(rest[2]), `map-${rest[4]}.hpvc`), Buffer.alloc(64, Number(rest[4]) + 1));
      return ok(`PREPARED_SCENE=PASS map=${rest[4]}\n`);
    }
    if (name === TOOLS[3]) return ok('INTRO_CPU_CHECK=PASS\n');
    throw new Error(`unexpected helper ${name}`);
  };
  return { calls, runner };
}

async function setup(t, bundleOptions) {
  const root = await temp(t);
  const staging = path.join(root, 'staging');
  await fs.mkdir(staging);
  return { root, staging, bundleRoot: await bundle(root, bundleOptions), gameRoot: await ownedGame(root), winePrefix: path.join(root, 'prefix') };
}

const run = (env, adb, fake, overrides = {}) => installHarryPotterLinux(
  { bundleRoot: env.bundleRoot, gameRoot: env.gameRoot, serial: 'Quest-1', adb, staging: env.staging, winePrefix: env.winePrefix, onLog: env.logs?.push.bind(env.logs) || (() => {}) },
  { findWine: () => WINE, findTool: () => FFMPEG, runner: fake.runner, ...overrides },
);

test('Linux install runs every helper under Wine with Z: paths and imports the verified data', { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, async (t) => {
  const env = await setup(t);
  env.logs = [];
  const adb = fakeAdb();
  const fake = fakeRunner();
  const result = await run(env, adb, fake);
  assert.deepEqual(result, { exitCode: 0 });

  const owned = await fs.realpath(env.gameRoot);
  const wine = fake.calls.filter((call) => call.command === WINE.path);
  const names = wine.map((call) => path.basename(call.args[0]));
  assert.deepEqual(names.slice(0, 7), [TOOLS[0], TOOLS[0], TOOLS[0], TOOLS[0], TOOLS[0], TOOLS[0], TOOLS[2]]);
  assert.deepEqual(wine[0].args, [path.join(env.bundleRoot, 'tools', TOOLS[0])]);
  assert.equal(wine[0].options.env.WINEPREFIX, path.join(env.winePrefix, 'wine'));
  assert.equal(wine[0].options.env.WINEDEBUG, '-all');
  // The scan gets the owned root and the real on-disk map path, both Windows-form.
  assert.deepEqual(wine[1].args.slice(1), [`Z:${owned.replaceAll('/', '\\')}`, `Z:${path.join(owned, 'maps', 'lev_tut1.unr').replaceAll('/', '\\')}`]);
  const frontend = wine.filter((call) => path.basename(call.args[0]) === TOOLS[2]);
  assert.equal(frontend.length, 5);
  frontend.forEach((call, pass) => {
    assert.match(call.args[1], /^Z:\\.*\\HP$/);
    assert.match(call.args[2], new RegExp(`encoded-map-${pass}$`));
    assert.deepEqual(call.args.slice(3), ['--map', String(pass)]);
  });
  const sound = wine.filter((call) => path.basename(call.args[0]) === TOOLS[1]);
  assert.deepEqual(sound.map((call) => call.args[3]), CLIPS);
  assert.match(sound[0].args[1], /^Z:\\.*\\HP\\Sounds\\AllDialog\.uax$/);
  assert.equal(sound[0].args[2], '--export-mpeg');
  const prepare = wine.filter((call) => path.basename(call.args[0]) === TOOLS[4]);
  assert.equal(prepare.length, 10);
  assert.deepEqual(prepare[0].args.slice(2, 3), ['--output']);
  assert.deepEqual(prepare[1].args.slice(-1), ['--verify']);
  const intro = wine.at(-1);
  assert.equal(path.basename(intro.args[0]), TOOLS[3]);
  assert.match(intro.args[2], /\\HP\\Cache\\Audio$/);

  const decode = fake.calls.filter((call) => call.command === FFMPEG);
  assert.deepEqual(decode[0].args.slice(0, 6), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i']);
  assert.deepEqual(decode[0].args.slice(7, 12), ['-f', 's16le', '-acodec', 'pcm_s16le', '-ac']);
  assert.deepEqual(decode[0].args.slice(13, 15), ['-ar', '48000']);
  assert.ok(decode.some((call) => call.args[12] === '2' && call.args.at(-1).endsWith('voice.0000abcd.stereo.s16')));
  assert.ok(decode.some((call) => call.args[12] === '1' && !call.args.at(-1).includes('.stereo.')));

  // Shared keys are deduplicated across passes: 5 x 22 unique clips + shared + stereo + 9 supplemental.
  assert.equal(decode.length, 5 * 22 + 2 + CLIPS.length);

  // adb order: install, pm path, hash, force-stop, mkdir, pushes, permissions, broadcast. Never uninstall or clear data.
  const verbs = adb.calls.map((call) => (call[0] === 'shell' ? call[1].split(' ')[0] : call[0]));
  assert.equal(verbs[0], 'install');
  assert.deepEqual(adb.calls[0].slice(0, 3), ['install', '--no-incremental', '-r']);
  assert.deepEqual(adb.calls[1], ['shell', 'pm', 'path', 'io.github.hpvr.quest']);
  assert.ok(verbs.indexOf('am') < verbs.indexOf('mkdir'));
  assert.ok(verbs.indexOf('mkdir') < verbs.indexOf('push'));
  assert.ok(verbs.lastIndexOf('push') < verbs.findIndex((verb) => verb === 'test'));
  assert.ok(verbs.findIndex((verb) => verb === 'test') < verbs.findLastIndex((verb) => verb === 'am'));
  assert.ok(!adb.calls.some((call) => call.includes('uninstall') || call.join(' ').includes('pm clear')));
  assert.ok(adb.calls.some((call) => call[0] === 'shell' && call[1] === "mkdir -p '/sdcard/Android/data/io.github.hpvr.quest/files/HP/Cache/Scenes'"));

  // Staged names: the fixed list spelling wins over the scan's lower-case spelling, level files keep the app's spelling.
  const remote = [...adb.pushed.keys()].map((file) => file.replace('/sdcard/Android/data/io.github.hpvr.quest/files/HP/', ''));
  assert.ok(remote.includes('system/HPBase.u'));
  assert.ok(!remote.includes('system/hpbase.u'));
  assert.ok(remote.includes('Maps/Lev_Tut1.unr'));
  assert.ok(remote.includes('Textures/Extra.utx'));
  assert.ok(remote.includes('Cache/Scenes/map-4.hpvc'));
  assert.ok(remote.includes('Cache/Audio/voice.0000abcd.stereo.s16'));
  assert.ok(!remote.some((file) => /\.(dll|exe|ini|sav)$/i.test(file)));

  const permissions = adb.calls.filter((call) => call[0] === 'shell' && call[1].startsWith("test ! -L '/storage/emulated/0/Android/data/io.github.hpvr.quest'"));
  assert.ok(permissions.length >= 2);
  assert.ok(permissions.every((call) => !call[1].includes('stat -c %a')));
  const broadcasts = adb.calls.filter((call) => call[1]?.startsWith('am broadcast'));
  assert.equal(broadcasts.length, Math.ceil(remote.length / 24));
  assert.ok(broadcasts[0][1].includes('-n io.github.hpvr.quest/.ImportAccessReceiver -a io.github.hpvr.quest.VERIFY_DATA --es paths '));

  const final = env.logs.find((line) => line.startsWith('INSTALL=PASS DATA_IMPORT=PASS'));
  assert.equal(final, `INSTALL=PASS DATA_IMPORT=PASS files=${remote.length} audio_clips=${5 * 22 + 2 + CLIPS.length} prepared_scenes=5 device=Quest-1`);
  assert.ok(env.logs.some((line) => line.startsWith('APP_LAUNCH=NOT_PERFORMED')));
  assert.ok(env.logs.includes('Staged ' + (remote.filter((file) => !file.startsWith('Cache/')).length) + ' required game-data files; no EXE, DLL, user config, or save was copied.'));
});

test('Linux install accepts a manifest with a BOM', async (t) => {
  const env = await setup(t, { bom: true });
  await run(env, fakeAdb(), fakeRunner());
});

test('an older app version uses mode-bit permission checks, no app read probe and no scenes', async (t) => {
  const env = await setup(t, { versionCode: 57, mapIds: [0, 1, 2], scenes: false });
  env.logs = [];
  const adb = fakeAdb();
  const fake = fakeRunner();
  await run(env, adb, fake);
  const wine = fake.calls.filter((call) => call.command === WINE.path);
  assert.deepEqual(wine.filter((call) => path.basename(call.args[0]) === TOOLS[2]).map((call) => call.args.slice(3)), [['--map', '0'], ['--map', '1'], ['--map', '2']]);
  assert.ok(!wine.some((call) => path.basename(call.args[0]) === TOOLS[4]));
  assert.ok(!adb.calls.some((call) => call[1]?.startsWith('am broadcast')));
  const modeChecks = adb.calls.filter((call) => call[1]?.includes('stat -c %a'));
  assert.ok(modeChecks.some((call) => call[1].includes('case "$mode" in *[57])')));
  assert.ok(modeChecks.some((call) => call[1].includes('case "$mode" in *[4567])')));
  assert.ok(env.logs.some((line) => line.startsWith('DATA_PERMISSIONS=PASS verifier=MODE_BITS')));
  assert.match(env.logs.find((line) => line.startsWith('INSTALL=PASS')), /prepared_scenes=0/);
});

test('a challenge-only release runs one frontend pass with --challenge', async (t) => {
  const env = await setup(t, { versionCode: 38, mapIds: [0, 1], scenes: false });
  const fake = fakeRunner();
  await run(env, fakeAdb(), fake);
  const frontend = fake.calls.filter((call) => call.command === WINE.path && path.basename(call.args[0]) === TOOLS[2]);
  assert.equal(frontend.length, 1);
  assert.deepEqual(frontend[0].args.slice(3), ['--challenge']);
});

test('when Wine cannot run the helpers the error names the VC++ runtime and the prefix, and nothing else runs', async (t) => {
  const env = await setup(t);
  const fake = fakeRunner({ usage: false });
  const adb = fakeAdb();
  await assert.rejects(run(env, adb, fake), (error) => {
    assert.match(error.message, /Wine could not run the Harry Potter helper tools/);
    assert.ok(error.message.includes(`WINEPREFIX="${path.join(env.winePrefix, 'wine')}" winetricks vcrun2022`));
    return true;
  });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(adb.calls, []);
});

test('Linux install names the missing tool when Wine or ffmpeg is absent', async (t) => {
  const env = await setup(t);
  await assert.rejects(run(env, fakeAdb(), fakeRunner(), { findWine: () => null }), /needs Wine/);
  await assert.rejects(run(env, fakeAdb(), fakeRunner(), { findTool: () => null }), /needs ffmpeg/);
});

test('a missing game file stops before any helper scan', async (t) => {
  const env = await setup(t);
  await fs.rm(path.join(env.gameRoot, 'maps', 'lev_tut3b.unr'));
  const fake = fakeRunner();
  await assert.rejects(run(env, fakeAdb(), fake), /missing a required file: Maps\/Lev_Tut3b\.unr/);
  assert.equal(fake.calls.length, 1);
});

test('a release file that differs from its manifest hash is rejected before Wine runs', async (t) => {
  const env = await setup(t, { corrupt: true });
  const fake = fakeRunner();
  await assert.rejects(run(env, fakeAdb(), fake), /failed verification: HPVR-Quest-Demo\.apk/);
  assert.equal(fake.calls.length, 0);
});

test('entirely silent decoded audio is rejected', async (t) => {
  const env = await setup(t);
  const adb = fakeAdb();
  await assert.rejects(run(env, adb, fakeRunner({ silent: true })), /entirely silent/);
  assert.deepEqual(adb.calls, []);
});

test('a dependency scan that lists too few packages is rejected', async (t) => {
  const env = await setup(t);
  const fake = fakeRunner();
  const runner = async (command, args, options) => {
    if (path.basename(args[0] || '') === TOOLS[0] && args.length > 1) return { code: 0, signal: null, stdout: 'graph_status=ok\n', tail: [] };
    return fake.runner(command, args, options);
  };
  await assert.rejects(run(env, fakeAdb(), { runner }), /did not list its packages/);
});

test('pm path must be exactly one base.apk path', async (t) => {
  const env = await setup(t);
  await assert.rejects(run(env, fakeAdb({ pmPath: 'package:/data/app/x/base.apk\npackage:/data/app/x/split.apk' }), fakeRunner()), /exactly one installed/);
  await assert.rejects(run(env, fakeAdb({ pmPath: 'package:/system/app/base.apk' }), fakeRunner()), /exactly one installed/);
});

test('a headset hash that differs from the pushed file fails with the creator message', async (t) => {
  const env = await setup(t);
  await assert.rejects(run(env, fakeAdb({ tamper: true }), fakeRunner()), /Installed APK hash verification failed|Headset data verification failed/);
});

test('the app read probe reply must confirm every batch', async (t) => {
  const env = await setup(t);
  await assert.rejects(run(env, fakeAdb({ broadcast: 'Broadcast completed: result=0' }), fakeRunner()), /cannot read the imported files/);
});

test('permission commands guard links, cover parent folders and batch 24 paths', () => {
  const paths = Array.from({ length: 30 }, (_, index) => `Cache/Audio/clip${index}.s16`);
  const commands = permissionCommands(['system/a.u', ...paths], true);
  const root = '/storage/emulated/0/Android/data/io.github.hpvr.quest/files/HP';
  assert.equal(commands.length, 3);
  assert.ok(commands[0].startsWith("test ! -L '/storage/emulated/0/Android/data/io.github.hpvr.quest' && test ! -L '/storage/emulated/0/Android/data/io.github.hpvr.quest/files' || exit 1; for p in "));
  assert.ok(commands[0].includes(`'${root}' '${root}/Cache' '${root}/system' '${root}/Cache/Audio'`));
  assert.ok(commands[0].endsWith('; do test ! -L "$p" && test -d "$p" && chmod o+rx "$p" || exit 1; done'));
  assert.equal(commands[1].match(/'[^']+'/g).length - 2, 24);
  assert.ok(commands[2].includes('test -f "$p" && chmod o+r "$p" || exit 1; done'));
});
