const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getCatalog } = require('../src/catalog');
const { createApp } = require('../server');
const { inspectDevice } = require('../src/device-library');
const { sevenZipBinary } = require('./helpers/seven-zip');
const { validateLibertyInput, checkedRelease, buildManagerRequest, installLibertyCity } = require('../src/liberty-city-runner');

async function ownedPcFolder(root) {
  const game = path.join(root, 'GTA III');
  for (const name of ['data', 'TEXT', 'anim', 'models', 'movies', 'Audio']) await fs.mkdir(path.join(game, name), { recursive: true });
  for (const relative of ['data/main.scm', 'data/default.dat', 'data/gta3.dat', 'data/handling.cfg', 'data/weapon.dat',
    'models/gta3.img', 'models/gta3.dir', 'models/frontend.txd', 'models/menu.txd', 'models/fonts.txd',
    'anim/ped.ifp', 'anim/cuts.img', 'anim/cuts.dir', 'TEXT/american.gxt', 'Audio/sfx.RAW', 'Audio/sfx.SDT']) {
    await fs.writeFile(path.join(game, relative), 'owned game file');
  }
  return game;
}

test('Liberty City VR is a buildable GTA III card with the official Windows kit', () => {
  const game = getCatalog().find((entry) => entry.id === 'liberty-city-vr');
  assert.equal(game.gameName, 'Grand Theft Auto III');
  assert.equal(game.personalBuild.specialInstaller, true);
  assert.equal(game.source.repo, 'kornacious/liberty-city-vr');
  assert.match(game.source.assetPattern, /Windows-PCVR/);
  assert.match(game.addedAt, /^2026-/);
});

test('Liberty City accepts a complete PC install or Xbox ISO, but rejects missing audio', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-liberty-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const game = await ownedPcFolder(root);
  assert.deepEqual(await validateLibertyInput({ gamePackage: game, serial: 'Quest-test' }), { gamePackage: game, serial: 'Quest-test', variant: 'pc', acceptSdkLicenses: false });
  const iso = path.join(root, 'owned-us-xbox.iso');
  await fs.writeFile(iso, 'disc');
  assert.equal((await validateLibertyInput({ gamePackage: iso, serial: 'Quest-test' })).variant, 'xbox');
  await fs.rm(path.join(game, 'Audio', 'sfx.SDT'));
  await assert.rejects(validateLibertyInput({ gamePackage: game, serial: 'Quest-test' }), /sfx.RAW.*sfx.SDT/);
});

test('Liberty City accepts an archive wrapping the complete owned PC game', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-liberty-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await ownedPcFolder(root);
  const archive = path.join(root, 'owned-gta3.zip');
  await promisify(execFile)(sevenZipBinary(), ['a', '-tzip', archive, 'GTA III'], { cwd: root, windowsHide: true });
  assert.equal((await validateLibertyInput({ gamePackage: archive, serial: 'QUEST3' })).variant, 'pc');
});

test('Liberty City manager request keeps build files separate and passes explicit SDK consent', () => {
  const request = buildManagerRequest({ gamePackage: 'C:\\Games\\GTA III', variant: 'pc', acceptSdkLicenses: true }, 'C:\\Kit', 'C:\\VR4ALL-build', 'C:\\adb.exe');
  assert.equal(request.Settings.Repository, 'C:\\Kit');
  assert.equal(request.Settings.Workplace, 'C:\\VR4ALL-build');
  assert.equal(request.Settings.GameDirectory, 'C:\\Games\\GTA III');
  assert.equal(request.Options.Target, 0);
  assert.equal(request.Options.InstallPcVariant, true);
  assert.equal(request.Options.AcceptSdkLicenses, true);
  assert.equal(request.Options.BuildOnly, false);
  const xbox = buildManagerRequest({ gamePackage: 'C:\\Games\\GTA3.iso', variant: 'xbox', acceptSdkLicenses: false }, 'C:\\Kit', 'C:\\VR4ALL-build', 'C:\\adb.exe');
  assert.equal(xbox.Options.InstallXboxVariant, true);
  assert.equal(xbox.Options.XboxIsoPath, 'C:\\Games\\GTA3.iso');
  assert.equal(xbox.Options.AcceptSdkLicenses, false);
});

test('Liberty City only runs the official digest-verified Windows kit', () => {
  const release = { tag: 'v0.9.5-setup.2', assetName: 'Liberty-City-VR-0.9.5-setup.2-Windows-PCVR-x64.zip',
    downloadUrl: 'https://github.com/kornacious/liberty-city-vr/releases/download/v0.9.5-setup.2/Liberty-City-VR-0.9.5-setup.2-Windows-PCVR-x64.zip', digest: `sha256:${'a'.repeat(64)}`, size: 105733780 };
  assert.deepEqual(checkedRelease(release), release);
  assert.throws(() => checkedRelease({ ...release, digest: null }), /SHA-256/);
  assert.throws(() => checkedRelease({ ...release, downloadUrl: release.downloadUrl.replace('kornacious', 'someone-else') }), /official/);
});

test('Liberty City runs the creator manager for one selected Quest 3 and checks installed data', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-liberty-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gamePackage = await ownedPcFolder(root);
  const release = { tag: 'v0.9.5-setup.2', assetName: 'Liberty-City-VR-0.9.5-setup.2-Windows-PCVR-x64.zip',
    downloadUrl: 'https://github.com/kornacious/liberty-city-vr/releases/download/v0.9.5-setup.2/Liberty-City-VR-0.9.5-setup.2-Windows-PCVR-x64.zip', digest: `sha256:${'a'.repeat(64)}`, size: 105733780 };
  let request;
  const result = await installLibertyCity({ gamePackage, serial: 'Quest-test', acceptSdkLicenses: true, release,
    releases: { downloadPackage: async () => path.join(root, 'official.zip') },
    adb: { listDevices: async () => [{ serial: 'Quest-test', state: 'device' }], run: async () => 'Quest 3', getPath: () => 'C:\\adb.exe' },
    workspaceRoot: path.join(root, 'workspace'), platform: 'win32',
    extract: async (_archive, dest) => {
      const kit = path.join(dest, 'Liberty City VR Setup');
      await fs.mkdir(path.join(kit, 'Setup'), { recursive: true });
      await fs.mkdir(path.join(kit, 'overlay', 'android', 'app'), { recursive: true });
      await fs.writeFile(path.join(kit, 'Setup', 'LibertyManager.exe'), 'binary');
      await fs.writeFile(path.join(kit, 'overlay', 'android', 'app', 'build.gradle.kts'), 'source');
    },
    invoke: async (_exe, args) => { request = JSON.parse(await fs.readFile(args[2], 'utf8')); return { code: 0, tail: [] }; },
    inspect: async () => ({ 'liberty-city-vr': { packageId: 'com.libertyvr.quest', dataReady: true } }) });
  assert.equal(request.Options.AcceptSdkLicenses, true);
  assert.equal(request.Settings.GameDirectory, gamePackage);
  assert.equal(result.packageId, 'com.libertyvr.quest');
  assert.equal(result.tag, release.tag);
});

test('Liberty City rejects Quest 3S before downloading or building', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-liberty-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gamePackage = await ownedPcFolder(root);
  const release = { tag: 'v0.9.5-setup.2', assetName: 'Liberty-City-VR-0.9.5-setup.2-Windows-PCVR-x64.zip',
    downloadUrl: 'https://github.com/kornacious/liberty-city-vr/releases/download/v0.9.5-setup.2/Liberty-City-VR-0.9.5-setup.2-Windows-PCVR-x64.zip', digest: `sha256:${'a'.repeat(64)}` };
  let downloads = 0;
  await assert.rejects(installLibertyCity({ gamePackage, serial: 'QUEST3S', release,
    releases: { downloadPackage: async () => { downloads++; } },
    adb: { listDevices: async () => [{ serial: 'QUEST3S', state: 'device' }], run: async () => 'Quest 3S', getPath: () => 'C:\\adb.exe' },
    workspaceRoot: path.join(root, 'work'), platform: 'win32' }), /Quest 3 only/);
  assert.equal(downloads, 0);
});

test('Liberty City card queues its own installer and records the official build tag', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-liberty-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gamePackage = await ownedPcFolder(root);
  const calls = [];
  const app = createApp({ platform: 'win32', settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'QUEST3', state: 'device' }] },
    releases: { latest: async () => ({ tag: 'v0.9.5-setup.2' }) },
    libertyInstaller: async (input) => { calls.push(input); return { packageId: 'com.libertyvr.quest', tag: input.release.tag }; },
  });
  t.after(() => app.server.close());
  const request = (method, url, payload) => new Promise((resolve) => {
    const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
    req.method = method; req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/json', 'x-questdesk-token': app.token };
    app.server.emit('request', req, { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null }); } });
  });
  const started = await request('POST', '/api/personal-build', { gameId: 'liberty-city-vr', serial: 'QUEST3', gamePackage, acceptSdkLicenses: true });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  let job;
  for (let i = 0; i < 50; i++) {
    job = (await request('GET', `/api/jobs/${started.body.job.id}`)).body.job;
    if (!['queued', 'running'].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(job.status, 'success', job.error);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].serial, 'QUEST3');
  assert.equal(calls[0].acceptSdkLicenses, true);
  assert.equal(calls[0].workspaceRoot, path.join(root, 'builds', 'liberty-city-vr'));
});

test('Liberty City is ready only when the Quest has a complete PC or Xbox variant', async () => {
  let hasVariant = false;
  const adb = { run: async (args) => {
    if (args.includes('pm')) return 'package:com.libertyvr.quest';
    if (args.includes('dumpsys')) return 'versionName=0.9.5';
    if (args.includes('ls')) return hasVariant && args.at(-1).endsWith('/pc') ? 'VARIANT_INFO.txt' : '';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'liberty-city-vr');
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id].dataReady, false);
  hasVariant = true;
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id].dataReady, true);
});
