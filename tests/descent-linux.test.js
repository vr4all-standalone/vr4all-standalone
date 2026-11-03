const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { installDescentLinux } = require('../src/descent-linux');
const { sevenZipBinary } = require('./helpers/seven-zip');
const { installOfficialPlayer } = require('../src/official-player-runner');

const D1 = '/sdcard/Android/data/net.gameordie.descentvr/files';
const D2 = D1 + '/descent2';

async function put(file, size) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.alloc(size, 1));
}

async function fixture(run, { both = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-descent-linux-'));
  try {
    const games = path.join(root, 'games');
    await put(path.join(games, 'Descent', 'DESCENT.HOG'), 10);
    await put(path.join(games, 'Descent', 'descent.pig'), 20);
    await put(path.join(games, 'Descent', 'readme.txt'), 5);
    await put(path.join(games, 'Descent', 'missions', 'X.MSN'), 3);
    await put(path.join(games, 'Descent', 'missions', 'notes.doc'), 3);
    await put(path.join(games, 'Descent', 'VR', 'descent.hog'), 99);
    if (both) {
      await put(path.join(games, 'Descent 2', 'descent2.hog'), 30);
      await put(path.join(games, 'Descent 2', 'descent2.ham'), 40);
    }
    const apk = path.join(root, 'DescentVR.apk');
    await fs.writeFile(apk, 'apk');
    return await run({ root, games, apk });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// Scripted headset: remote files live in a Map keyed by absolute path; `lose` names pushes that arrive truncated.
function fakeAdb({ free = 10 * 1024 * 1024, installResult = 'Performing Streamed Install\nSuccess', installError = null, lose = [], remote = new Map() } = {}) {
  const calls = [];
  return {
    calls, remote,
    async run(args) {
      calls.push(args);
      assert.deepEqual(args.slice(0, 2), ['-s', 'Q3']);
      const [verb, a, b] = args.slice(2);
      if (verb === 'shell' && a.startsWith('df -k')) return `/dev/fuse 100000000 1 ${free} 1% /sdcard`;
      if (verb === 'shell' && a.startsWith('mkdir -p')) return '';
      if (verb === 'shell' && a.startsWith('cd "')) {
        const dir = /^cd "([^"]+)"/.exec(a)[1];
        return [...remote].filter(([file]) => path.posix.dirname(file) === dir || path.posix.dirname(file) === dir + '/missions')
          .map(([file, size]) => `${size}|${file.slice(dir.length + 1)}`).join('\n');
      }
      if (verb === 'install') { if (installError) throw new Error(installError); return installResult; }
      if (verb === 'push') {
        const size = (await fs.stat(a)).size;
        remote.set(b, lose.includes(b) ? size - 1 : size);
        return '1 file pushed';
      }
      throw new Error('unexpected adb call ' + args.join(' '));
    },
  };
}

const pushes = (adb) => adb.calls.filter((args) => args[2] === 'push').map((args) => args[4]);

test('Descent on Linux installs the app and sends both games with lower-cased names and missions', async () => {
  await fixture(async ({ games, apk }) => {
    const adb = fakeAdb();
    const logs = [];
    assert.deepEqual(await installDescentLinux({ apk, gamePath: games, serial: 'Q3', adb, onLog: (line) => logs.push(line) }), {});
    assert.deepEqual(pushes(adb).sort(), [`${D1}/descent.hog`, `${D1}/descent.pig`, `${D1}/missions/x.msn`, `${D2}/descent2.ham`, `${D2}/descent2.hog`].sort());
    assert.deepEqual(adb.calls.find((args) => args[2] === 'install').slice(2), ['install', '-r', apk]);
    assert.ok(adb.calls.some((args) => args[3] === `mkdir -p "${D1}/missions" && chmod 2775 "${D1}/missions" 2>/dev/null; true`));
    assert.ok(!adb.calls.some((args) => args[2] === 'push' && /[\\/]VR[\\/]|readme|notes/.test(args[3])), 'only data extensions, never the VR folder');
    assert.ok(logs.some((line) => /Found Descent: .*Descent \(3 files/.test(line)));
    assert.ok(logs.some((line) => /Game Tome/.test(line)));
    assert.ok(adb.calls.every((args) => args[2] !== 'uninstall' && !/pm clear|uninstall/.test(args.join(' '))));
  });
});

test('Descent on Linux accepts the game folder itself and skips files the headset already holds whole', async () => {
  await fixture(async ({ games, apk }) => {
    const remote = new Map([[`${D1}/descent.hog`, 10], [`${D1}/descent.pig`, 21]]);
    const adb = fakeAdb({ remote });
    await installDescentLinux({ apk, gamePath: path.join(games, 'Descent'), serial: 'Q3', adb });
    assert.deepEqual(pushes(adb).sort(), [`${D1}/descent.pig`, `${D1}/missions/x.msn`]);
    assert.ok(!adb.calls.some((args) => args[3]?.includes('descent2')), 'Descent 2 is not touched when only Descent was chosen');
  });
});

test('Descent on Linux reports when files do not arrive whole', async () => {
  await fixture(async ({ games, apk }) => {
    const adb = fakeAdb({ lose: [`${D2}/descent2.hog`] });
    await assert.rejects(installDescentLinux({ apk, gamePath: games, serial: 'Q3', adb }), /Descent 2: 1 files did not arrive whole \(descent2\.hog\)\. Run the install again\./);
  });
});

test('Descent on Linux refuses a differently signed app without ever uninstalling it', async () => {
  await fixture(async ({ games, apk }) => {
    for (const adb of [fakeAdb({ installError: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]' }), fakeAdb({ installResult: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]' })]) {
      await assert.rejects(installDescentLinux({ apk, gamePath: games, serial: 'Q3', adb }), /differently signed Descent 1 & 2 VR/);
      assert.ok(!adb.calls.some((args) => /uninstall/.test(args.join(' '))));
      assert.deepEqual(pushes(adb), []);
    }
    await assert.rejects(installDescentLinux({ apk, gamePath: games, serial: 'Q3', adb: fakeAdb({ installError: 'device offline' }) }), /The app did not install: device offline/);
    await assert.rejects(installDescentLinux({ apk, gamePath: games, serial: 'Q3', adb: fakeAdb({ installResult: 'Failure [INSTALL_FAILED_OLDER_SDK]' }) }), /The app did not install: Failure/);
  });
});

test('Descent on Linux checks the headset free space before installing anything', async () => {
  await fixture(async ({ games, apk }) => {
    const adb = fakeAdb({ free: 1000 });
    await assert.rejects(installDescentLinux({ apk, gamePath: games, serial: 'Q3', adb }), /needs .* MiB free and has/);
    assert.ok(!adb.calls.some((args) => args[2] === 'install'));
  });
});

test('Descent on Linux names the expected files when neither game is in the folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-descent-empty-'));
  try {
    await put(path.join(root, 'other', 'file.txt'), 1);
    await put(path.join(root, 'apk.apk'), 1);
    const adb = fakeAdb();
    await assert.rejects(installDescentLinux({ apk: path.join(root, 'apk.apk'), gamePath: root, serial: 'Q3', adb }), /Neither Descent nor Descent 2 was found .*descent\.hog and descent\.pig/);
    assert.deepEqual(adb.calls, []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('the official player installer hands Descent to its Linux installer on Linux and never looks for the PowerShell script', async () => {
  await fixture(async ({ root, games }) => {
    const release = path.join(root, 'release');
    await put(path.join(release, 'files', 'DescentVR.apk'), 3);
    const archive = path.join(root, 'player.zip');
    assert.equal(spawnSync(sevenZipBinary(), ['a', '-tzip', archive, 'files'], { cwd: release, windowsHide: true }).status, 0);
    const adbPath = path.join(root, 'adb');
    await fs.writeFile(adbPath, '');
    const seen = [];
    const result = await installOfficialPlayer({
      gameId: 'descent12-vr', gamePath: games, serial: 'Q3', adbPath, zipPath: archive, workRoot: root, platform: 'linux',
      adb: { run: async () => '' },
      linuxInstallers: { 'descent12-vr': async (args) => { seen.push(args); return {}; } },
    });
    assert.equal(result.updatedOnly, false);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].gamePath, games);
    assert.match(seen[0].apk, /DescentVR\.apk$/);
  });
});
