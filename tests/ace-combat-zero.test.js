const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { getCatalog } = require('../src/catalog');
const { createApp } = require('../server');
const { inspectDevice, packages } = require('../src/device-library');
const { validateAceInput, runAceCombatBuild, prepareAceTools, installerArgs } = require('../src/ace-combat-zero-runner');

const release = {
  tag: 'v0.1.0', assetName: 'ac0oculus-0.1.0-setup.exe',
  downloadUrl: 'https://github.com/kulakovri/ac0oculus/releases/download/v0.1.0/ac0oculus-0.1.0-setup.exe',
  digest: 'sha256:31d14ccc3673742b5b29a57d28f5f0c3215bf7d54ee545354c9ddf1a1c8949e5',
};

function request(app, method, url, payload) {
  return new Promise((resolve) => {
    const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
    req.method = method;
    req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/json', 'x-questdesk-token': app.token };
    app.server.emit('request', req, { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null }); } });
  });
}

test('Ace Combat Zero has a personal Quest build profile and detects both required headset files', async () => {
  const game = getCatalog().find((entry) => entry.id === 'ace-combat-zero-vr');
  assert.ok(game);
  assert.equal(game.console, 'PlayStation 2');
  assert.equal(game.genre, 'Flight combat');
  assert.equal(game.personalBuild.fileOnly, true);
  assert.equal(game.source.repo, 'kulakovri/ac0oculus');
  assert.equal(packages[game.id], 'com.kulakovri.ac0oculus');
  assert.ok(game.art);
  assert.equal((await inspectDevice({ run: async (args) => {
    if (args.includes('pm')) return 'package:com.kulakovri.ac0oculus';
    if (args.includes('dumpsys')) return 'versionName=0.1.0';
    return args.at(-1) === '/sdcard/ac0oculus/' ? 'disc.iso\ngen_zero' : 'ps2_image.bin';
  } }, 'Q3', [game]))[game.id].dataReady, true);
});

test('Ace Combat Zero accepts only an existing ISO and an authorized serial', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-ac0-'));
  try {
    const iso = path.join(root, 'Ace Combat Zero.iso');
    await fs.writeFile(iso, 'fixture');
    assert.deepEqual(await validateAceInput({ gamePackage: iso, serial: 'QUEST3' }), { gamePackage: iso, serial: 'QUEST3' });
    await assert.rejects(validateAceInput({ gamePackage: path.join(root, 'missing.iso'), serial: 'QUEST3' }), /existing.*ISO/i);
    await assert.rejects(validateAceInput({ gamePackage: iso, serial: 'bad serial!' }), /Quest/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Ace Combat Zero extracts the official setup without accepting a license or installing to a Quest', () => {
  const args = installerArgs('C:\\Official\\ac0oculus-0.1.0-setup.exe', 'C:\\Builds\\ac0oculus');
  assert.ok(args.includes('/NOBUILD=1'));
  assert.ok(args.some((part) => part.startsWith('/DIR=')));
  assert.equal(args.some((part) => /ACCEPTANDROIDLICENSE|\/DISC=/.test(part)), false);
});

test('Ace Combat Zero builds from the selected ISO, installs on the selected Quest and verifies transfer sizes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-ac0-'));
  const calls = [];
  try {
    const iso = path.join(root, 'owned.iso');
    await fs.writeFile(iso, 'disc');
    const adb = { run: async (args) => {
      calls.push(args);
      if (args.includes('stat')) return args.at(-1).endsWith('.vr4all-upload') ? args.at(-1).includes('ps2_image') ? '6' : args.at(-1).includes('cockpit') ? '7' : '4' : '';
      if (args.includes('appops') && args.includes('get')) return 'MANAGE_EXTERNAL_STORAGE: allow';
      return 'Success';
    } };
    const result = await runAceCombatBuild({ gamePackage: iso, serial: 'QUEST3', workspaceRoot: root,
      releases: { latest: async (source) => { assert.equal(source.repo, 'kulakovri/ac0oculus'); return release; }, downloadTool: async () => path.join(root, 'creator.exe') },
      extractSetup: async (_setup, appDir) => {
        for (const name of ['python/python.exe', 'tools/quest_player_build.py', 'quest/package.txt', 'licenses/android-sdk-license.txt']) {
          const file = path.join(appDir, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, name === 'quest/package.txt' ? 'com.kulakovri.ac0oculus' : 'fixture');
        }
      },
      runScript: async (_python, args) => {
        if (args.includes('--find-ndk')) return { code: 0, tail: [] };
        if (args.includes('--check-disc')) return { code: 0, tail: [] };
        assert.equal(args.includes('--accept-android-sdk-license'), false);
        const appDir = args[args.indexOf('--app') + 1];
        await fs.writeFile(path.join(appDir, 'ac0oculus.apk'), 'apk');
        const image = path.join(appDir, 'headset', 'gen_zero', 'ps2_image.bin');
        await fs.mkdir(path.dirname(image), { recursive: true }); await fs.writeFile(image, 'memory');
        const texture = path.join(appDir, 'headset', 'textures', 'cockpit.bin');
        await fs.mkdir(path.dirname(texture), { recursive: true }); await fs.writeFile(texture, 'cockpit');
        return { code: 0, tail: [] };
      },
      inspectApk: async () => 'com.kulakovri.ac0oculus', adb,
    });
    assert.equal(result.packageId, 'com.kulakovri.ac0oculus');
    assert.equal(result.tag, 'v0.1.0');
    assert.ok(calls.some((args) => args.includes('install') && args.includes('QUEST3')));
    assert.equal(calls.filter((args) => args.includes('push')).length, 3);
    assert.ok(calls.some((args) => args.includes('push') && args.at(-1) === '/sdcard/ac0oculus/textures/cockpit.bin.vr4all-upload'));
    assert.ok(calls.some((args) => args.includes('MANAGE_EXTERNAL_STORAGE')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Ace Combat Zero rejects a substituted setup release before download', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-ac0-'));
  try {
    await fs.writeFile(path.join(root, 'owned.iso'), 'disc');
    await assert.rejects(runAceCombatBuild({ gamePackage: path.join(root, 'owned.iso'), serial: 'Q3', workspaceRoot: root,
      releases: { latest: async () => ({ ...release, downloadUrl: 'https://github.com/other/repo/releases/download/v0.1.0/ac0oculus-0.1.0-setup.exe' }), downloadTool: async () => { throw new Error('must not download'); } }, adb: { run: async () => {} },
    }), /official.*setup|untrusted/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Ace Combat Zero build tools request the official Android license only when NDK r29 is absent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-ac0-'));
  try {
    let shown = '';
    const result = await prepareAceTools({ workspaceRoot: root,
      releases: { latest: async () => release, downloadTool: async () => path.join(root, 'creator.exe') },
      extractSetup: async (_setup, appDir) => {
        for (const [name, value] of [['python/python.exe', 'python'], ['tools/quest_player_build.py', 'script'], ['quest/package.txt', 'com.kulakovri.ac0oculus'], ['licenses/android-sdk-license.txt', 'Android SDK license text']]) {
          const file = path.join(appDir, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value);
        }
      },
      runScript: async () => ({ code: 1, tail: [] }),
      onLicense: async (text) => { shown = text; return true; },
    });
    assert.equal(shown, 'Android SDK license text');
    assert.equal(result.accepted, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Ace Combat Zero card sets up a separate build folder and queues only the chosen Quest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-ac0-api-'));
  const iso = path.join(root, 'owned.iso');
  await fs.writeFile(iso, 'owned fixture');
  const calls = [];
  const app = createApp({ platform: 'win32', settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }, { serial: 'Q3S', state: 'device' }] },
    aceToolsSetup: async (options) => { calls.push(['tools', options.workspaceRoot]); return { accepted: false, sha: 'v0.1.0' }; },
    aceCombatBuilder: async (options) => { calls.push(['build', options.serial, options.gamePackage, options.workspaceRoot]); return { packageId: 'com.kulakovri.ac0oculus', tag: 'v0.1.0', sha: release.digest }; },
  });
  try {
    const setup = await request(app, 'POST', '/api/build-tools', { gameId: 'ace-combat-zero-vr', gamePackage: iso, downloadLocation: root });
    assert.equal(setup.status, 202, JSON.stringify(setup.body));
    let tools;
    for (let i = 0; i < 30; i++) {
      tools = (await request(app, 'GET', `/api/jobs/${setup.body.job.id}`)).body.job;
      if (tools.status !== 'queued' && tools.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(tools.status, 'success', tools.error);
    const queued = await request(app, 'POST', '/api/personal-build', { gameId: 'ace-combat-zero-vr', serial: 'Q3S', gamePackage: iso });
    assert.equal(queued.status, 202, JSON.stringify(queued.body));
    let job;
    for (let i = 0; i < 30; i++) {
      job = (await request(app, 'GET', `/api/jobs/${queued.body.job.id}`)).body.job;
      if (job.status !== 'queued' && job.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'success', job.error);
    assert.deepEqual(calls[0], ['tools', path.join(root, 'VR4ALL-build-tools', 'builds')]);
    assert.deepEqual(calls[1], ['build', 'Q3S', iso, path.join(root, 'VR4ALL-build-tools', 'builds')]);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Ace Combat Zero update check does not compare the setup EXE digest to the installed APK', async () => {
  const app = createApp({ platform: 'win32',
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }], run: async () => { throw new Error('APK pull must not run'); } },
    releases: { latest: async () => release },
  });
  try {
    const checked = await request(app, 'GET', '/api/releases?gameId=ace-combat-zero-vr&serial=Q3');
    assert.equal(checked.status, 200, JSON.stringify(checked.body));
    assert.equal(checked.body.release.tag, 'v0.1.0');
    assert.equal(checked.body.release.installedApkMatchesRelease, undefined);
  } finally { app.server.close(); }
});
