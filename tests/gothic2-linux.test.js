const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { installGothicLinux } = require('../src/gothic2-linux');
const { createApp } = require('../server');

const APP = 'com.gothic2vr.quest';
const FILES = `/sdcard/Android/data/${APP}/files`;
const ARCHIVE_BYTES = Buffer.from('private game zip');
const ARCHIVE_HASH = crypto.createHash('sha256').update(ARCHIVE_BYTES).digest('hex');
const REMOTE_ARCHIVE = `/sdcard/Download/Gothic2VR/game-data-${ARCHIVE_HASH.slice(0, 12)}.zip`;
const APK_BYTES = Buffer.from('apk');
const APK_HASH = crypto.createHash('sha256').update(APK_BYTES).digest('hex');
const findTool = () => '/usr/bin/python3';

async function fixture(run, { apkSha = APK_HASH, kit = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-gothic-linux-'));
  try {
    const release = path.join(root, 'release');
    const quest = path.join(release, 'Quest');
    for (const file of ['tools/package-game-data.py', 'tools/verify-game-data.py', 'engine/android/tools/game_package.py']) {
      if (!kit && file.endsWith('verify-game-data.py')) continue;
      await fs.mkdir(path.dirname(path.join(quest, file)), { recursive: true });
      await fs.writeFile(path.join(quest, file), '# stub');
    }
    await fs.mkdir(path.join(quest, 'config'), { recursive: true });
    await fs.writeFile(path.join(quest, 'config', 'android-toolchain.lock.json'), JSON.stringify({ applicationId: APP, minSdk: 26 }));
    await fs.writeFile(path.join(quest, 'release.json'), JSON.stringify({ version: '0.2.0', applicationId: APP, apk: { file: 'Gothic-II-VR-0.2.0.apk', sha256: apkSha.toUpperCase() } }));
    await fs.writeFile(path.join(quest, 'Gothic-II-VR-0.2.0.apk'), APK_BYTES);
    const game = path.join(root, 'Gothic II');
    await fs.mkdir(game);
    return await run({ root, release, quest, game });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// A fake packager: answers the Python probe, then writes the private archive, manifest and verification like the creator's scripts.
function fakeRunner(record, { code = 0, status = 'passed', tail = [] } = {}) {
  return async (command, args, options) => {
    record.push({ command, args, options });
    if (args[0] === '-c') return { code: 0, tail: [] };
    if (code === 0) {
      const privateDir = path.join(path.dirname(path.dirname(args[1])), 'build', 'private');
      await fs.mkdir(privateDir, { recursive: true });
      await fs.writeFile(path.join(privateDir, 'game-data.zip'), ARCHIVE_BYTES);
      await fs.writeFile(path.join(privateDir, 'game-data.manifest.json'), JSON.stringify({ status: 'packaged', sha256: ARCHIVE_HASH, bytes: 1000, archive_bytes: ARCHIVE_BYTES.length }));
      await fs.writeFile(path.join(privateDir, 'game-data.verification.json'), JSON.stringify({ status, sha256: ARCHIVE_HASH }));
      options.onLine('Compressing Gothic2/Data/Worlds.vdf');
      options.onLine('{');
      options.onLine('"status": "packaged"');
    }
    return { code, tail };
  };
}

// A scripted headset. `remote` maps absolute paths to their SHA-256; `saves` are the existing save/settings files.
function fakeAdb({ model = 'Quest 3', installed = false, saves = {}, freeKb = 10 * 1024 * 1024, remote = {}, partial = false, installOutput = 'Performing Streaming Install\nSuccess', mutateSaves = false, amOutput = 'Starting: Intent\nStatus: ok' } = {}) {
  const calls = [];
  const state = { installed, remote: { ...remote }, saves: { ...saves } };
  const exit = (code) => Promise.reject(new Error(`ADB exited ${code}`));
  return {
    calls,
    listDevices: async () => [{ serial: 'Q3', state: 'device' }],
    run: async (args) => {
      assert.deepEqual(args.slice(0, 2), ['-s', 'Q3']);
      const rest = args.slice(2);
      const line = rest.join(' ');
      calls.push(line);
      if (line === 'shell getprop ro.product.model') return model;
      if (line === 'shell getprop ro.build.version.sdk') return '34';
      if (line === `shell pm path ${APP}`) return state.installed ? 'package:/data/app/gothic/base.apk' : exit(1);
      if (line === `shell ls -1 ${FILES}`) return state.installed ? ['Gothic2', ...Object.keys(state.saves)].join('\n') : exit(1);
      if (line.startsWith('shell sha256sum ')) {
        const file = line.slice('shell sha256sum '.length);
        if (file === '/data/app/gothic/base.apk') return `${APK_HASH}  ${file}`;
        const name = file.startsWith(FILES + '/') ? file.slice(FILES.length + 1) : null;
        if (name in state.saves) return `${state.saves[name]}  ${file}`;
        return `${state.remote[file]}  ${file}`;
      }
      if (line === 'shell df -k /sdcard') return `Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/fuse 1 1 ${freeKb} 1% /sdcard`;
      if (rest[0] === 'install') { state.installed = true; if (mutateSaves) for (const name of Object.keys(state.saves)) state.saves[name] = 'f'.repeat(64); return installOutput; }
      if (line.startsWith('shell mkdir')) return '';
      if (line.startsWith('shell test -f ')) return line.slice(14) in state.remote ? '' : exit(1);
      if (line.startsWith('shell test -e ')) return partial ? '' : exit(1);
      if (line.startsWith('shell test -d ')) return exit(1);
      if (rest[0] === 'push') { state.remote[rest[2]] = crypto.createHash('sha256').update(await fs.readFile(rest[1])).digest('hex'); return '1 file pushed'; }
      if (line.startsWith('shell mv ')) { const [, , from, to] = rest; state.remote[to] = state.remote[from]; delete state.remote[from]; return ''; }
      if (line.startsWith('shell am start')) return amOutput;
      throw new Error('unexpected adb call: ' + line);
    },
  };
}

const args = (ctx, adb, overrides = {}) => ({ release: ctx.release, gamePath: ctx.game, serial: 'Q3', adb, onLog: () => {}, ...overrides });

test('Gothic II on Linux packages with the creator script, installs, transfers the ZIP via a .part file and opens the import screen', async () => {
  await fixture(async (ctx) => {
    const adb = fakeAdb();
    const record = [];
    const logs = [];
    const result = await installGothicLinux(args(ctx, adb, { onLog: (line) => logs.push(line) }), { findTool, runner: fakeRunner(record) });
    assert.deepEqual(result, { importPending: true, archive: REMOTE_ARCHIVE });
    assert.deepEqual(record[0].args, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)']);
    assert.equal(record[1].command, '/usr/bin/python3');
    assert.deepEqual(record[1].args, ['-B', path.join(ctx.quest, 'tools', 'package-game-data.py'), '--game-root', ctx.game]);
    assert.equal(record[1].options.cwd, path.join(ctx.quest, 'tools'));
    assert.equal(record[1].options.env.PYTHONUTF8, '1');
    assert.equal(record[1].options.timeoutMs, 90 * 60 * 1000);
    const partial = `${REMOTE_ARCHIVE}.part`;
    const order = ['install --no-streaming -r', `push ${path.join(ctx.quest, 'build', 'private', 'game-data.zip')} ${partial}`, `shell sha256sum ${partial}`, `shell mv ${partial} ${REMOTE_ARCHIVE}`, 'shell am start'];
    const positions = order.map((prefix) => adb.calls.findIndex((call) => call.startsWith(prefix)));
    assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])), JSON.stringify({ positions, calls: adb.calls }));
    assert.ok(adb.calls.includes('shell am start -W -a com.gothic2vr.quest.IMPORT_GAME_FILES -n com.gothic2vr.quest/org.opengothic.app.SetupActivity'));
    assert.ok(!adb.calls.some((call) => /uninstall|pm clear/.test(call)));
    assert.ok(logs.includes('Compressing Gothic2/Data/Worlds.vdf'));
    assert.ok(!logs.some((line) => line.startsWith('{') || line.startsWith('"')));
    assert.ok(logs.includes('In the headset, select the ZIP under Download/Gothic2VR and wait for the import to finish.'));
  });
});

test('Gothic II on Linux fails before any transfer when the free space cannot hold the import and a 512 MiB reserve', async () => {
  await fixture(async (ctx) => {
    const adb = fakeAdb({ freeKb: 400 * 1024 });
    await assert.rejects(installGothicLinux(args(ctx, adb), { findTool, runner: fakeRunner([]) }), /Not enough free space for installation\/import and a 512 MiB reserve/);
    assert.ok(!adb.calls.some((call) => call.startsWith('install') || call.startsWith('push')));
  });
});

test('Gothic II on Linux refuses an update that changes an existing save or settings file', async () => {
  await fixture(async (ctx) => {
    const adb = fakeAdb({ installed: true, saves: { 'save1.sav': 'a'.repeat(64), 'opengothic.ini': 'b'.repeat(64) }, mutateSaves: true });
    await assert.rejects(installGothicLinux(args(ctx, adb), { findTool, runner: fakeRunner([]) }), /A save\/settings hash changed during installation/);
    assert.ok(!adb.calls.some((call) => call.startsWith('push')));
  });
});

test('Gothic II on Linux keeps an unchanged save and does not recopy an identical ZIP', async () => {
  await fixture(async (ctx) => {
    const adb = fakeAdb({ installed: true, saves: { 'save1.sav': 'a'.repeat(64) }, remote: { [REMOTE_ARCHIVE]: ARCHIVE_HASH } });
    await installGothicLinux(args(ctx, adb), { findTool, runner: fakeRunner([]) });
    assert.ok(!adb.calls.some((call) => call.startsWith('push')));
  });
});

test('Gothic II on Linux preserves a different destination ZIP and a previous partial transfer', async () => {
  await fixture(async (ctx) => {
    await assert.rejects(installGothicLinux(args(ctx, fakeAdb({ remote: { [REMOTE_ARCHIVE]: 'c'.repeat(64) } })), { findTool, runner: fakeRunner([]) }), /Existing destination differs; preserved without replacement/);
    await assert.rejects(installGothicLinux(args(ctx, fakeAdb({ partial: true })), { findTool, runner: fakeRunner([]) }), /A previous partial transfer is preserved: .*\.part/);
  });
});

test('Gothic II on Linux requires Status: ok from the import screen', async () => {
  await fixture(async (ctx) => {
    await assert.rejects(installGothicLinux(args(ctx, fakeAdb({ amOutput: 'Error: Activity class does not exist.' })), { findTool, runner: fakeRunner([]) }), /Could not open the import screen: Error: Activity class does not exist\./);
  });
});

test('Gothic II on Linux stops on packaging failure, an unverified archive, a non-Quest device, a bad APK hash or a missing kit file', async () => {
  await fixture(async (ctx) => {
    const adb = fakeAdb();
    await assert.rejects(installGothicLinux(args(ctx, adb), { findTool, runner: fakeRunner([], { code: 1, tail: ['Traceback', 'ValueError: Select the installation root containing Data and _work, not its System folder.'] }) }),
      /Game data packaging failed\. No game files were transferred\..*Select the installation root containing Data and _work/);
    await assert.rejects(installGothicLinux(args(ctx, adb), { findTool, runner: fakeRunner([], { status: 'failed' }) }), /Current private game-data verification is required/);
    assert.ok(!adb.calls.some((call) => call.startsWith('install') || call.startsWith('push')));
    await assert.rejects(installGothicLinux(args(ctx, fakeAdb({ model: 'Pixel 7' })), { findTool, runner: fakeRunner([]) }), /Selected device is not a Quest: Pixel 7/);
    await assert.rejects(installGothicLinux(args(ctx, fakeAdb()), { findTool: () => null, runner: fakeRunner([]) }), /needs Python 3\.10 or newer/);
  });
  await fixture(async (ctx) => {
    await assert.rejects(installGothicLinux(args(ctx, fakeAdb()), { findTool, runner: fakeRunner([]) }), /APK checksum mismatch/);
  }, { apkSha: '0'.repeat(64) });
  await fixture(async (ctx) => {
    await assert.rejects(installGothicLinux(args(ctx, fakeAdb()), { findTool, runner: fakeRunner([]) }), /missing its expected Quest player file: Quest\/tools\/verify-game-data\.py/);
  }, { kit: false });
});

function request(app, method, url, payload) {
  return new Promise((resolve) => {
    const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
    req.method = method;
    req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/json', 'x-questdesk-token': app.token };
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null }); } };
    app.server.emit('request', req, res);
  });
}

async function settledJob(app, id) {
  for (let tries = 0; tries < 100; tries++) {
    const response = await request(app, 'GET', `/api/jobs/${id}`);
    if (!['queued', 'running'].includes(response.body?.job?.status)) return response.body.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Job did not settle');
}

async function runServerJob(installerResult) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-gothic-server-'));
  let received;
  const app = createApp({ platform: 'linux', settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device', model: 'Quest 3' }], run: async (args) => args.includes('pm') ? `package:${APP}` : '', getPath: () => '/usr/bin/adb' },
    releases: { latest: async () => ({ tag: 'v0.2.0', assetName: 'Gothic-II-VR-0.2.0-PCVR-and-Quest.zip' }), downloadPackage: async () => path.join(root, 'creator.zip') },
    officialPlayerInstaller: async (input) => { received = input; return installerResult; } });
  try {
    const game = path.join(root, 'Gothic II');
    await fs.mkdir(path.join(game, 'Data'), { recursive: true });
    const started = await request(app, 'POST', '/api/official-player-install', { gameId: 'gothic2-vr', serial: 'Q3', gamePath: game });
    assert.equal(started.status, 202, started.body?.error);
    const job = await settledJob(app, started.body.job.id);
    const settings = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8').catch(() => '{}'));
    return { job, received, installed: settings.installed?.Q3?.['gothic2-vr'] };
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}

test('server passes the platform to the installer and treats an in-headset import as pending, not as a missing disc', async () => {
  const { job, received, installed } = await runServerJob({ importPending: true, archive: REMOTE_ARCHIVE });
  assert.equal(received.platform, 'linux');
  assert.equal(job.status, 'success', job.error);
  assert.ok(job.log.some((line) => /waiting for the in-headset import/.test(line)));
  assert.equal(installed?.packageId, APP);
});

test('server still fails an official player install whose game data is not on the headset when no import is pending', async () => {
  const { job, installed } = await runServerJob({});
  assert.equal(job.status, 'error');
  assert.match(job.error, /game disc was not found on the selected headset/);
  assert.equal(installed, undefined);
});
