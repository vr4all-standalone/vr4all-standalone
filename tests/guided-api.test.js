const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createApp } = require('../server');
const runFile = promisify(execFile);

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
  for (let tries = 0; tries < 40; tries++) {
    const response = await request(app, 'GET', `/api/jobs/${id}`);
    if (!['queued', 'running'].includes(response.body?.job?.status)) return response.body.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Job did not settle');
}

test('Vice City accepts one owned game folder and builds only for the selected Quest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-vc-api-'));
  const gamePackage = path.join(root, 'Grand Theft Auto Vice City');
  await fs.mkdir(path.join(gamePackage, 'data'), { recursive: true });
  await fs.mkdir(path.join(gamePackage, 'TEXT'));
  await fs.mkdir(path.join(gamePackage, 'anim'));
  await fs.mkdir(path.join(gamePackage, 'txd'));
  await fs.mkdir(path.join(gamePackage, 'models'));
  await fs.mkdir(path.join(gamePackage, 'Audio'));
  await fs.mkdir(path.join(gamePackage, 'movies'));
  await fs.mkdir(path.join(gamePackage, 'mp3'));
  await fs.mkdir(path.join(gamePackage, 'skins'));
  await fs.writeFile(path.join(gamePackage, 'models', 'gta3.img'), 'owned fixture');
  await fs.writeFile(path.join(gamePackage, 'data', 'gta.dat'), 'owned fixture');
  const calls = [];
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ buildToolsLocations: { 'vice-city-vr': root } }));
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device' }, { serial: 'Q3B', state: 'device' }] },
    viceCityBuilder: async (input, _roots, log) => { calls.push(input); log('Official Vice City builder finished'); return { sha: 'a'.repeat(40) }; },
  });
  try {
    const wrong = await request(app, 'POST', '/api/personal-build', { gameId: 'vice-city-vr', serial: 'OTHER', gamePackage });
    assert.equal(wrong.status, 400);
    const started = await request(app, 'POST', '/api/personal-build', { gameId: 'vice-city-vr', serial: 'Q3B', gamePackage });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    const job = await settledJob(app, started.body.job.id);
    assert.equal(job.status, 'success', job.error);
    assert.equal(calls[0].serial, 'Q3B');
    assert.equal(calls[0].gamePackage, gamePackage);
    assert.equal(await fs.readFile(path.join(calls[0].gamePackage, 'models', 'gta3.img'), 'utf8'), 'owned fixture');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Vice City accepts a RAR export and remembers the archive while building from a temporary ZIP', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-vc-rar-'));
  const rarTool = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WinRAR', 'Rar.exe');
  if (!(await fs.stat(rarTool).catch(() => null))?.isFile()) { await fs.rm(root, { recursive: true, force: true }); return; }
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  let receivedListing = '';
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ buildToolsLocations: { 'vice-city-vr': root } }));
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device' }] },
    viceCityBuilder: async (input) => { receivedListing = (await runFile(sevenZip, ['l', input.gamePackage])).stdout; return { sha: 'a'.repeat(40) }; },
  });
  try {
    await fs.writeFile(path.join(root, 'owned.dat'), 'owned game fixture');
    const archive = path.join(root, 'Vice City files.rar');
    await runFile(rarTool, ['a', '-idq', archive, 'owned.dat'], { cwd: root, windowsHide: true });
    const started = await request(app, 'POST', '/api/personal-build', { gameId: 'vice-city-vr', serial: 'Q3A', gamePackage: archive });
    assert.equal(started.status, 202, started.body?.error);
    assert.equal((await settledJob(app, started.body.job.id)).status, 'success');
    assert.match(receivedListing, /owned\.dat/);
    const saved = await request(app, 'GET', '/api/local-paths');
    assert.equal(saved.body.paths['vice-city-vr'].gamePackage, archive);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('Beef Raider installs the official APK, then copies extracted data after first launch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-beef-api-'));
  const apk = path.join(root, 'beefraiderxr-1.0.0.apk');
  await fs.writeFile(apk, Buffer.from('PK\u0003\u0004fixture'));
  const extractedPath = path.join(root, 'extracted');
  for (const name of ['Audio', 'FMV', 'DATA']) {
    await fs.mkdir(path.join(extractedPath, name), { recursive: true });
    await fs.writeFile(path.join(extractedPath, name, 'owned.dat'), 'fixture');
  }
  const release = { tag: '1.0.0', assetName: 'beefraiderxr-1.0.0.apk',
    downloadUrl: 'https://github.com/Team-Beef-Studios/BeefRaiderXR/releases/download/1.0.0/beefraiderxr-1.0.0.apk' };
  const calls = [];
  let fresh = true;
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device' }] },
    releases: { latest: async () => release, download: async () => apk },
    beefRaiderInstaller: async (input) => { calls.push({ step: 'apk', input }); return { installed: fresh, launchRequired: fresh }; },
    beefRaiderTransfer: async (input) => { calls.push({ step: 'data', input }); return { filesCopied: 3 }; },
  });
  try {
    const first = await request(app, 'POST', '/api/beef-raider-install', { gameId: 'beef-raider-xr', serial: 'Q3A', gamePath: extractedPath });
    assert.equal(first.status, 202, JSON.stringify(first.body));
    const firstJob = await settledJob(app, first.body.job.id);
    assert.equal(firstJob.status, 'success', firstJob.error);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.serial, 'Q3A');
    fresh = false;
    const second = await request(app, 'POST', '/api/beef-raider-install', { gameId: 'beef-raider-xr', serial: 'Q3A', gamePath: extractedPath });
    assert.equal(second.status, 202, JSON.stringify(second.body));
    const secondJob = await settledJob(app, second.body.job.id);
    assert.equal(secondJob.status, 'success', secondJob.error);
    assert.equal(calls[2].step, 'data');
    assert.equal(calls[2].input.extractedPath, extractedPath);
    assert.equal(await fs.readFile(path.join(calls[2].input.extractedPath, 'DATA', 'owned.dat'), 'utf8'), 'fixture');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Crazy Taxi accepts one owned Android package and patches only for the selected Quest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-taxi-api-'));
  const gamePackage = path.join(root, 'com.sega.CrazyTaxiplayhaven_6.0-80_2arch_7dpi_24lang_1feat_017e8b1c582569ff9682193551b7e22c_apkmirror.com.apkm');
  await fs.writeFile(gamePackage, Buffer.from('PK\u0003\u0004owned fixture'));
  const calls = [];
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device' }, { serial: 'Q3B', state: 'device' }] },
    crazyTaxiInstaller: async (input) => { calls.push(input); await fs.writeFile(input.outputPath, Buffer.from('PK\u0003\u0004personal APK')); input.onLog('Patched Crazy Taxi APK installed'); return { tag: 'v0.1-beta', apkPath: input.outputPath }; },
  });
  try {
    const wrong = await request(app, 'POST', '/api/personal-build', { gameId: 'crazy-taxi-vr', serial: 'OTHER', gamePackage });
    assert.equal(wrong.status, 400);
    const started = await request(app, 'POST', '/api/personal-build', { gameId: 'crazy-taxi-vr', serial: 'Q3B', gamePackage });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    const job = await settledJob(app, started.body.job.id);
    assert.equal(job.status, 'success', job.error);
    assert.equal(calls[0].serial, 'Q3B');
    assert.equal(calls[0].originalPath, gamePackage);
    assert.deepEqual(await fs.readFile(calls[0].originalPath), Buffer.from('PK\u0003\u0004owned fixture'));
    const saved = await request(app, 'GET', '/api/local-paths');
    assert.equal(saved.body.paths['crazy-taxi-vr'].gamePackage, gamePackage);
    assert.equal(saved.body.paths['crazy-taxi-vr'].apkPath, undefined);
    const apkPath = path.join(root, 'already-patched-crazy-taxi.apk');
    await fs.copyFile(gamePackage, apkPath);
    const direct = await request(app, 'POST', '/api/personal-build', { gameId: 'crazy-taxi-vr', serial: 'Q3A', gamePackage: apkPath });
    assert.equal(direct.status, 202, JSON.stringify(direct.body));
    assert.equal((await settledJob(app, direct.body.job.id)).status, 'success');
    assert.equal(calls[1].originalPath, apkPath);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Crazy Taxi accepts an APK inside a ZIP and keeps the archive as the remembered source', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-taxi-wrapped-'));
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  let received = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device' }] },
    crazyTaxiInstaller: async (input) => {
      received = await fs.readFile(input.originalPath, 'utf8');
      await fs.writeFile(input.outputPath, 'patched fixture');
      return { tag: null, kind: 'vr-apk', apkPath: input.outputPath };
    },
  });
  try {
    await fs.writeFile(path.join(root, 'Crazy Taxi VR.apk'), 'provided VR APK fixture');
    const archive = path.join(root, 'Crazy Taxi package.zip');
    await runFile(sevenZip, ['a', '-tzip', archive, 'Crazy Taxi VR.apk'], { cwd: root, windowsHide: true });
    const started = await request(app, 'POST', '/api/personal-build', { gameId: 'crazy-taxi-vr', serial: 'Q3A', gamePackage: archive });
    assert.equal(started.status, 202, started.body?.error);
    assert.equal((await settledJob(app, started.body.job.id)).status, 'success');
    assert.equal(received, 'provided VR APK fixture');
    const saved = await request(app, 'GET', '/api/local-paths');
    assert.equal(saved.body.paths['crazy-taxi-vr'].gamePackage, archive);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('special installer inputs accept a RAR and pass a temporary ZIP to the creator workflow', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-special-rar-'));
  const rarTool = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WinRAR', 'Rar.exe');
  if (!(await fs.stat(rarTool).catch(() => null))?.isFile()) { await fs.rm(root, { recursive: true, force: true }); return; }
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  const calls = [];
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device' }] },
    releases: { latest: async () => ({ tag: '1.0.0', url: 'https://example.test/release', assetName: 'player.zip' }) },
    roadRashInstaller: async (input) => { calls.push({ kind: 'road', path: input.discImage, listing: (await runFile(sevenZip, ['l', input.discImage])).stdout }); return { tag: '1.0.0' }; },
    harryPotterInstaller: async (input) => { calls.push({ kind: 'potter', path: input.gamePath, listing: (await runFile(sevenZip, ['l', input.gamePath])).stdout }); },
  });
  try {
    await fs.writeFile(path.join(root, 'game.bin'), 'owned disc fixture');
    const archive = path.join(root, 'owned-game.rar');
    await runFile(rarTool, ['a', '-idq', archive, 'game.bin'], { cwd: root, windowsHide: true });
    for (const [gameId, field] of [['road-rash-vr', 'discImage'], ['harry-potter-vr', 'gamePath']]) {
      const started = await request(app, 'POST', gameId === 'road-rash-vr' ? '/api/road-rash-install' : '/api/harry-potter-install', { gameId, serial: 'Q3A', [field]: archive });
      assert.equal(started.status, 202, started.body?.error);
      assert.equal((await settledJob(app, started.body.job.id)).status, 'success');
    }
    assert.deepEqual(calls.map((call) => call.kind), ['road', 'potter']);
    for (const call of calls) { assert.equal(path.extname(call.path), '.zip'); assert.match(call.listing, /game\.bin/); }
    const saved = await request(app, 'GET', '/api/local-paths');
    assert.equal(saved.body.paths['road-rash-vr'].discImage, archive);
    assert.equal(saved.body.paths['harry-potter-vr'].gamePath, archive);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('official player setup accepts an archive containing one disc and remembers its source', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-official-archive-'));
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  let received = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device', model: 'Quest 3' }], run: async (args) => args.includes('pm') ? 'package:com.liquidazir.animalcrossingquest' : '' },
    releases: { latest: async () => ({ tag: 'v1', assetName: 'creator.zip' }), downloadPackage: async () => path.join(root, 'creator.zip') },
    officialPlayerInstaller: async (input) => { received = await fs.readFile(input.gamePath, 'utf8'); },
  });
  try {
    await fs.writeFile(path.join(root, 'game.iso'), 'owned Animal Crossing disc');
    const archive = path.join(root, 'Animal Crossing.zip');
    await runFile(sevenZip, ['a', '-tzip', archive, 'game.iso'], { cwd: root, windowsHide: true });
    const started = await request(app, 'POST', '/api/official-player-install', { gameId: 'animal-crossing-vr', serial: 'Q3A', gamePath: archive });
    assert.equal(started.status, 202, started.body?.error);
    const job = await settledJob(app, started.body.job.id);
    assert.equal(job.status, 'error');
    assert.match(job.error, /game files|disc|rom/i);
    assert.equal(received, 'owned Animal Crossing disc');
    const saved = await request(app, 'GET', '/api/local-paths');
    assert.equal(saved.body.paths['animal-crossing-vr'].gamePath, archive);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('AstroQuest setup accepts a ZIP of the extracted game tree', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-astro-archive-'));
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  let received = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device', model: 'Quest 3' }], run: async () => '' },
    releases: { latest: async () => ({ tag: 'v1', assetName: 'creator.apk' }), download: async () => path.join(root, 'creator.apk') },
    astroQuestInstaller: async (input) => { received = await fs.readFile(path.join(input.gamePath, 'eboot.bin'), 'utf8'); },
  });
  try {
    const game = path.join(root, 'CUSA12392');
    await fs.mkdir(path.join(game, 'sce_sys'), { recursive: true });
    await fs.mkdir(path.join(game, 'sce_module'));
    await fs.writeFile(path.join(game, 'eboot.bin'), 'owned Astro game');
    const archive = path.join(root, 'Astro Bot.zip');
    await runFile(sevenZip, ['a', '-tzip', archive, 'CUSA12392'], { cwd: root, windowsHide: true });
    const started = await request(app, 'POST', '/api/astroquest-install', { gameId: 'astroquest', serial: 'Q3A', gamePath: archive });
    assert.equal(started.status, 202, started.body?.error);
    await settledJob(app, started.body.job.id);
    assert.equal(received, 'owned Astro game');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('GalaxyQuest setup accepts a 7z containing its disc image', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-galaxy-archive-'));
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  let received = '';
  let workspaceCandidate = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device', model: 'Quest 3' }], run: async (args) => args.includes('pm') ? 'package:com.galaxy.quest' : '' },
    releases: { latest: async () => ({ tag: 'v1', assetName: 'creator.apk' }), download: async () => path.join(root, 'creator.apk'), downloadTool: async () => path.join(root, 'converter.exe') },
    galaxyWorkspacePicker: async (_gamePath, candidate) => { workspaceCandidate = candidate; return root; },
    galaxyQuestInstaller: async (input) => { received = await fs.readFile(input.gamePath, 'utf8'); return { packageId: 'com.galaxy.quest' }; },
  });
  try {
    await fs.writeFile(path.join(root, 'Galaxy.rvz'), 'owned Galaxy disc');
    const archive = path.join(root, 'Super Mario Galaxy.7z');
    await runFile(sevenZip, ['a', '-t7z', archive, 'Galaxy.rvz'], { cwd: root, windowsHide: true });
    const builds = path.join(root, 'my build folder');
    await fs.mkdir(builds);
    assert.equal((await request(app, 'POST', '/api/settings', { adbPath: '', sources: {}, buildWorkspace: builds })).status, 200);
    const started = await request(app, 'POST', '/api/galaxyquest-install', { gameId: 'galaxyquest', serial: 'Q3A', gamePath: archive });
    assert.equal(started.status, 202, started.body?.error);
    const job = await settledJob(app, started.body.job.id);
    assert.equal(job.status, 'error');
    assert.match(job.error, /game files|disc|conversion/i);
    assert.equal(received, 'owned Galaxy disc');
    assert.equal(workspaceCandidate, path.join(builds, 'galaxyquest'));
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('Descent 3 setup accepts a ZIP of the owned game folder', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-descent-archive-'));
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  let received = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device', model: 'Quest 3' }], run: async () => '' },
    releases: { latest: async () => ({ tag: 'v1', assetName: 'creator.apk' }), download: async () => path.join(root, 'creator.apk') },
    descent3Installer: async (input) => { received = await fs.readFile(path.join(input.gamePath, 'd3.hog'), 'utf8'); },
  });
  try {
    const game = path.join(root, 'Descent 3');
    await fs.mkdir(game);
    await fs.writeFile(path.join(game, 'd3.hog'), 'owned Descent data');
    const archive = path.join(root, 'Descent 3.zip');
    await runFile(sevenZip, ['a', '-tzip', archive, 'Descent 3'], { cwd: root, windowsHide: true });
    const started = await request(app, 'POST', '/api/descent3-install', { gameId: 'descent3-vr', serial: 'Q3A', gamePath: archive });
    assert.equal(started.status, 202, started.body?.error);
    await settledJob(app, started.body.job.id);
    assert.equal(received, 'owned Descent data');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('Beef Raider transfers creator-extracted data from a ZIP', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-beef-archive-'));
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  let received = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device', model: 'Quest 3' }], run: async () => '' },
    releases: { latest: async () => ({ tag: 'v1', assetName: 'creator.apk' }), download: async () => path.join(root, 'creator.apk') },
    beefRaiderInstaller: async () => ({ launchRequired: false }),
    beefRaiderTransfer: async (input) => { received = await fs.readFile(path.join(input.extractedPath, 'DATA', 'game.dat'), 'utf8'); },
  });
  try {
    const game = path.join(root, 'Tomb Raider');
    for (const folder of ['Audio', 'FMV', 'DATA']) {
      await fs.mkdir(path.join(game, folder), { recursive: true });
      await fs.writeFile(path.join(game, folder, 'part.dat'), 'owned game part');
    }
    await fs.writeFile(path.join(game, 'DATA', 'game.dat'), 'owned Tomb Raider data');
    const archive = path.join(root, 'Beef Raider data.zip');
    await runFile(sevenZip, ['a', '-tzip', archive, 'Tomb Raider'], { cwd: root, windowsHide: true });
    const started = await request(app, 'POST', '/api/beef-raider-install', { gameId: 'beef-raider-xr', serial: 'Q3A', gamePath: archive });
    assert.equal(started.status, 202, started.body?.error);
    await settledJob(app, started.body.job.id);
    assert.equal(received, 'owned Tomb Raider data');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('Magic Carpet setup accepts an archived owned game folder', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-magic-archive-'));
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  let received = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device', model: 'Quest 3' }], run: async () => '' },
    releases: { latest: async () => ({ tag: 'v1', assetName: 'creator.apk' }), download: async () => path.join(root, 'creator.apk'), downloadPackage: async () => path.join(root, 'importer.zip') },
    magicCarpetInstaller: async (input) => { received = await fs.readFile(path.join(input.gamePath, 'CARPET.DAT'), 'utf8'); return { packageId: 'com.mgcarpet.vr' }; },
  });
  try {
    const game = path.join(root, 'Magic Carpet');
    await fs.mkdir(game);
    await fs.writeFile(path.join(game, 'CARPET.DAT'), 'owned Magic Carpet data');
    const archive = path.join(root, 'Magic Carpet.zip');
    await runFile(sevenZip, ['a', '-tzip', archive, 'Magic Carpet'], { cwd: root, windowsHide: true });
    const started = await request(app, 'POST', '/api/magic-carpet-install', { gameId: 'magic-carpet-vr', serial: 'Q3A', gamePath: archive });
    assert.equal(started.status, 202, started.body?.error);
    await settledJob(app, started.body.job.id);
    assert.equal(received, 'owned Magic Carpet data');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('JKXR setup passes a ZIP of Jedi game files to the creator installer', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-jkxr-archive-'));
  const sevenZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  let received = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3A', state: 'device', model: 'Quest 3' }], run: async () => '' },
    releases: { latest: async () => ({ tag: 'v1', assetName: 'creator.apk' }), download: async () => path.join(root, 'creator.apk') },
    jkxrInstaller: async (input) => { received = await fs.readFile(path.join(input.gamePath, 'base', 'assets0.pk3'), 'utf8'); },
  });
  try {
    const game = path.join(root, 'Jedi Outcast');
    await fs.mkdir(path.join(game, 'base'), { recursive: true });
    await fs.writeFile(path.join(game, 'base', 'assets0.pk3'), 'owned Jedi data');
    const archive = path.join(root, 'Jedi Outcast.zip');
    await runFile(sevenZip, ['a', '-tzip', archive, 'Jedi Outcast'], { cwd: root, windowsHide: true });
    const started = await request(app, 'POST', '/api/jkxr-install', { gameId: 'jkxr', serial: 'Q3A', jediGame: 'jk2', gamePath: archive });
    assert.equal(started.status, 202, started.body?.error);
    await settledJob(app, started.body.job.id);
    assert.equal(received, 'owned Jedi data');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
