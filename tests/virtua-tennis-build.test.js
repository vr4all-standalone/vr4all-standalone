const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { getCatalog } = require('../src/catalog');
const { createApp } = require('../server');
const { inspectDevice } = require('../src/device-library');
const { validateVirtuaTennisInput, runVirtuaTennisBuild, updateVirtuaTennisSource } = require('../src/virtua-tennis-runner');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-vt3-'));
  const game = path.join(root, 'Owned Virtua Tennis 3', 'disk0');
  for (const name of ['vt3_Lindbergh', 'shader', 'lib']) await fs.mkdir(path.join(game, name), { recursive: true });
  await fs.writeFile(path.join(game, 'vt3_Lindbergh', 'vt3_Lindbergh_HD'), 'game binary');
  await fs.writeFile(path.join(game, 'lib', 'libCg.so'), 'library');
  await fs.writeFile(path.join(game, 'shader', 'court.bin'), 'shader');
  return { root, game };
}

test('Virtua Tennis 3 card builds in VR4ALL from an owned disk0 folder', () => {
  const game = getCatalog().find((entry) => entry.id === 'virtua-tennis-3-vr');
  assert.equal(game.projectUrl, 'https://github.com/mrchrisster/virtuatennis3-vr');
  assert.equal(game.manualBuild, undefined);
  assert.equal(game.personalBuild.gameLabel, 'Owned Virtua Tennis 3 disk0 folder');
  assert.match(game.personalBuild.processDescription, /builds your personal APK/i);
  assert.deepEqual(game.data, []);
});

test('Virtua Tennis 3 accepts a disk0 folder or its parent and rejects incomplete inputs', async () => {
  const { root, game } = await fixture();
  try {
    assert.equal((await validateVirtuaTennisInput({ gamePackage: game, serial: 'Q3' })).gamePackage, game);
    assert.equal((await validateVirtuaTennisInput({ gamePackage: path.dirname(game), serial: 'Q3' })).gamePackage, game);
    await assert.rejects(validateVirtuaTennisInput({ gamePackage: path.join(root, 'missing'), serial: 'Q3' }), /disk0|folder/i);
    await assert.rejects(validateVirtuaTennisInput({ gamePackage: game, serial: 'bad serial!' }), /Quest/i);
    await fs.rm(path.join(game, 'lib', 'libCg.so'));
    await assert.rejects(validateVirtuaTennisInput({ gamePackage: game, serial: 'Q3' }), /libCg\.so/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Virtua Tennis 3 refreshes only the creator checkout and its recursive submodule', async () => {
  const { root } = await fixture();
  const calls = [];
  try {
    const source = path.join(root, 'builds', 'virtua-tennis-3-vr', 'source');
    const runCommand = async (command, args) => {
      calls.push([command, args]);
      if (args[0] === 'clone') {
        await fs.mkdir(path.join(source, '.git'), { recursive: true });
        await fs.mkdir(path.join(source, 'scripts'), { recursive: true });
        await fs.writeFile(path.join(source, 'scripts', 'build-quest-windows.ps1'), 'param([string]$GamePath,[switch]$Check)');
      }
      if (args.includes('get-url')) return { code: 0, stdout: 'https://github.com/mrchrisster/virtuatennis3-vr.git\n', tail: [] };
      if (args.includes('rev-parse')) return { code: 0, stdout: `${'a'.repeat(40)}\n`, tail: [] };
      return { code: 0, tail: [] };
    };
    const first = await updateVirtuaTennisSource(source, () => {}, { runCommand, platform: 'win32' });
    assert.equal(first.sha, 'a'.repeat(40));
    assert.ok(calls.some(([, args]) => args.includes('--recursive')));
    await updateVirtuaTennisSource(source, () => {}, { runCommand, platform: 'win32' });
    assert.ok(calls.some(([, args]) => args.includes('fetch')));
    assert.ok(calls.some(([, args]) => args.includes('submodule') && args.includes('--recursive')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Virtua Tennis 3 builds, verifies package, and transfers only to the selected Quest', async () => {
  const { root, game } = await fixture();
  const calls = [];
  try {
    const source = path.join(root, 'source');
    await fs.mkdir(path.join(source, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(source, 'scripts', 'build-quest-windows.ps1'), 'script');
    const adb = { getPath: () => path.join(root, 'adb.exe'), run: async (args) => {
      calls.push(args);
      if (args.includes('stat')) return args.at(-1).endsWith('libCg.so') ? '7' : '11';
      return 'Success';
    } };
    const result = await runVirtuaTennisBuild({ gamePackage: game, serial: 'Q3' }, {
      platform: 'win32', workspaceRoot: root, adb,
      sourceKit: async () => ({ directory: source, sha: 'a'.repeat(40) }),
      runCommand: async (_command, args) => {
        assert.ok(args.includes(game));
        const apk = path.join(source, 'quest', 'VirtuaTennis3VR.apk');
        await fs.mkdir(path.dirname(apk), { recursive: true });
        await fs.writeFile(apk, 'personal apk');
        return { code: 0, tail: [] };
      },
      inspectApk: async () => 'org.lindbergh.vt3.vr',
    });
    assert.equal(result.packageId, 'org.lindbergh.vt3.vr');
    assert.equal(calls.filter((args) => args.includes('install')).length, 1);
    assert.ok(calls.some((args) => args.includes('install') && args.includes('Q3')));
    assert.equal(calls.filter((args) => args.includes('push')).length, 3);
    assert.ok(calls.every((args) => args[1] === 'Q3'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Virtua Tennis 3 refuses a mismatched APK before installing anything', async () => {
  const { root, game } = await fixture();
  const calls = [];
  try {
    const source = path.join(root, 'source');
    await fs.mkdir(path.join(source, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(source, 'scripts', 'build-quest-windows.ps1'), 'script');
    await assert.rejects(runVirtuaTennisBuild({ gamePackage: game, serial: 'Q3' }, {
      platform: 'win32', workspaceRoot: root, adb: { run: async (args) => { calls.push(args); return ''; } },
      sourceKit: async () => ({ directory: source, sha: 'a'.repeat(40) }),
      runCommand: async () => {
        const apk = path.join(source, 'quest', 'VirtuaTennis3VR.apk');
        await fs.mkdir(path.dirname(apk), { recursive: true });
        await fs.writeFile(apk, 'personal apk');
        return { code: 0, tail: [] };
      }, inspectApk: async () => 'wrong.package',
    }), /unexpected.*package|expected.*org\.lindbergh/i);
    assert.equal(calls.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Virtua Tennis 3 is ready only when its APK and disk0 folders are on the Quest', async () => {
  const game = getCatalog().find((entry) => entry.id === 'virtua-tennis-3-vr');
  const adb = { run: async (args) => {
    if (args.includes('pm')) return 'package:org.lindbergh.vt3.vr';
    if (args.includes('dumpsys')) return 'versionName=0.1';
    return args.at(-1) === '/sdcard/VirtuaTennis3/' ? 'vt3_Lindbergh\nshader\nlib'
      : args.at(-1) === '/sdcard/VirtuaTennis3/lib/' ? 'libCg.so' : 'vt3_Lindbergh_HD';
  } };
  assert.equal((await inspectDevice(adb, 'Q3', [game]))[game.id].dataReady, true);
  const missing = { run: async (args) => args.includes('pm') ? 'package:org.lindbergh.vt3.vr' : args.includes('dumpsys') ? 'versionName=0.1' : 'vt3_Lindbergh\nshader' };
  assert.equal((await inspectDevice(missing, 'Q3', [game]))[game.id].dataReady, false);
});

test('personal build API queues Virtua Tennis 3 with its remembered disk0 folder', async () => {
  const { root, game } = await fixture();
  const calls = [];
  const app = createApp({ platform: 'win32', settingsPath: path.join(root, 'settings.json'),
    builderRoots: { cacheRoot: path.join(root, 'cache'), workRoot: path.join(root, 'builds') },
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }], run: async () => '' },
    virtuaTennisBuilder: async (input, options) => {
      calls.push({ input, workspaceRoot: options.workspaceRoot });
      return { sha: 'a'.repeat(40), packageId: 'org.lindbergh.vt3.vr' };
    },
  });
  const request = (method, url, payload) => new Promise((resolve) => {
    const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
    req.method = method; req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/json', 'x-questdesk-token': app.token };
    app.server.emit('request', req, { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null }); } });
  });
  try {
    const start = await request('POST', '/api/personal-build', { gameId: 'virtua-tennis-3-vr', gamePackage: game, serial: 'Q3' });
    assert.equal(start.status, 202, JSON.stringify(start.body));
    let job;
    for (let i = 0; i < 50; i++) {
      job = (await request('GET', `/api/jobs/${start.body.job.id}`)).body.job;
      if (job.status === 'success' || job.status === 'error') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'success', job.error);
    assert.equal(calls[0].input.gamePackage, game);
    assert.equal(calls[0].workspaceRoot, path.join(root, 'builds'));
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});
