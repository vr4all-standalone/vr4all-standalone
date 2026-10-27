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
const sevenZip = path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe');
const winRar = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WinRAR', 'Rar.exe');

function request(app, method, url, payload, authorized = true, headers = {}) {
  return new Promise((resolve) => {
    const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
    req.method = method;
    req.url = url;
    req.headers = { 'content-type': 'application/json', host: '127.0.0.1:4173', ...headers };
    if (authorized) req.headers['x-questdesk-token'] = app.token;
    const res = {
      writeHead(status) { this.status = status; },
      end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null }); },
    };
    app.server.emit('request', req, res);
  });
}

function uploadRaw(app, url, bytes) {
  return new Promise((resolve) => {
    const req = Readable.from([bytes]);
    req.method = 'POST';
    req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/octet-stream', 'content-length': String(bytes.length), 'x-questdesk-token': app.token };
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null }); } };
    app.server.emit('request', req, res);
  });
}

function simulatedTransferAdb(onRun = async () => {}) {
  const remoteSizes = new Map();
  return {
    listDevices: async () => [{ serial: 'Q3-FAKE', state: 'device' }],
    run: async (args) => {
      if (args.includes('push')) {
        const source = args.at(-2);
        const destination = args.at(-1);
        const remote = destination.endsWith('/') ? `${destination}${path.basename(source)}` : destination;
        remoteSizes.set(remote, (await fs.stat(source)).size);
      }
      if (args.includes('stat') && args.includes('%s')) {
        const quoted = args.at(-1);
        return String(remoteSizes.get(quoted.slice(1, -1)) ?? '');
      }
      await onRun(args);
      return '';
    },
  };
}

test('mutating API calls require the local session token', async () => {
  const app = createApp({ adb: { listDevices: async () => [], run: async () => '' }, releases: {}, picker: async () => null });
  const response = await request(app, 'POST', '/api/install', {}, false);
  assert.equal(response.status, 403);
});

test('library shell shows the current app version beside its sidebar actions', async () => {
  const app = createApp({ adb: { listDevices: async () => [] }, releases: {} });
  try {
    const html = await new Promise((resolve) => {
      const req = Readable.from([]);
      req.method = 'GET';
      req.url = '/';
      req.headers = { host: '127.0.0.1:4173' };
      const res = { writeHead() {}, end(body) { resolve(String(body)); } };
      app.server.emit('request', req, res);
    });
    assert.match(html, new RegExp(`VR4ALL v${require('../package.json').version.replaceAll('.', '\\.')}`));
    assert.doesNotMatch(html, /__VR4ALL_VERSION__/);
  } finally { app.server.close(); }
});

test('18 Wheeler GDI folder is accepted only with both the index and BIN tracks', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wheeler-'));
  const app = createApp({ adb: { listDevices: async () => [], run: async () => '' }, releases: {} });
  try {
    await fs.writeFile(path.join(folder, 'disc.gdi'), 'track index');
    const endpoint = '/api/validate-file';
    const input = { gameId: '18-wheeler-vr', itemId: 'gdi', path: folder };
    assert.equal((await request(app, 'POST', endpoint, input)).status, 400);
    await fs.writeFile(path.join(folder, 'track01.bin'), 'track data');
    assert.equal((await request(app, 'POST', endpoint, input)).status, 200);
  } finally {
    app.server.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('discovery reads cached GitHub download totals without refreshing releases', async () => {
  let lookedUp = 0;
  const app = createApp({
    adb: { listDevices: async () => [] },
    releases: { cachedLatest: async (source) => {
      lookedUp++;
      return source.repo === 'fulldivegames/sm64coopdx-VR-Standalone-Physics-based' ? { totalDownloads: 123, publishedAt: '2026-10-20T00:00:00Z', checkedAt: '2026-10-21T00:00:00Z' } : null;
    } },
  });
  const result = await request(app, 'GET', '/api/discovery');
  assert.equal(result.status, 200);
  assert.ok(lookedUp > 0);
  assert.equal(result.body.stats['sm64-vr']?.totalDownloads, 123);
});

test('appearance material and palette are validated and persist across desktop app restarts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-theme-'));
  const options = { settingsPath: path.join(root, 'settings.json'), adb: { listDevices: async () => [] }, releases: {} };
  try {
    const first = createApp(options);
    const defaults = (await request(first, 'GET', '/api/settings')).body;
    assert.equal(defaults.theme, 'graphite');
    assert.equal(defaults.palette, 'blue');
    assert.equal((await request(first, 'POST', '/api/settings', { adbPath: '', sources: {}, theme: 'graphite', palette: 'mint' })).status, 200);
    first.server.close();
    const second = createApp(options);
    const reopened = (await request(second, 'GET', '/api/settings')).body;
    assert.equal(reopened.theme, 'graphite');
    assert.equal(reopened.palette, 'mint');
    assert.equal((await request(second, 'POST', '/api/settings', { adbPath: '', sources: {}, theme: 'frost', palette: 'rose' })).status, 200);
    assert.equal((await request(second, 'POST', '/api/settings', { adbPath: '', sources: {}, theme: 'unknown' })).status, 400);
    assert.equal((await request(second, 'POST', '/api/settings', { adbPath: '', sources: {}, theme: 'y2k', palette: 'unknown' })).status, 400);
    const afterInvalid = (await request(second, 'GET', '/api/settings')).body;
    assert.equal(afterInvalid.theme, 'frost');
    assert.equal(afterInvalid.palette, 'rose');
    assert.equal((await request(second, 'POST', '/api/settings', { adbPath: '', sources: {}, theme: 'classic' })).status, 200);
    const legacy = (await request(second, 'GET', '/api/settings')).body;
    assert.equal(legacy.theme, 'graphite');
    assert.equal(legacy.palette, 'rose');
    second.server.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('release checks persist per-game successes and errors for later diagnosis', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-update-log-'));
  const app = createApp({
    settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [] },
    releases: { latest: async (source) => {
      if (source.repo.includes('perfect_dark')) throw new Error('GitHub timeout');
      return { tag: 'v2', assetName: 'Game-v2.apk', checkedAt: '2026-10-22T10:00:00Z' };
    } },
  });
  try {
    assert.equal((await request(app, 'GET', '/api/releases?gameId=sm64-vr&origin=manual')).status, 200);
    assert.equal((await request(app, 'GET', '/api/releases?gameId=perfect-dark-vr&origin=manual')).status, 400);
    const entries = (await fs.readFile(path.join(root, 'update-checks.log'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(entries.length, 2);
    assert.equal(entries[1].gameId, 'perfect-dark-vr');
    assert.equal(entries[1].status, 'error');
    assert.match(entries[1].message, /GitHub timeout/);
    assert.equal(entries[0].status, 'ok');
    const textLog = await fs.readFile(path.join(root, 'update-checks.txt'), 'utf8');
    assert.match(textLog, /SM64 Co-Op DX VR.*v2/);
    assert.match(textLog, /Perfect Dark.*GitHub timeout/);
    assert.equal((await request(app, 'GET', '/api/update-log')).status, 404);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('release check verifies an installed APK digest even when its manifest version differs', async () => {
  const digest = 'a'.repeat(64);
  const app = createApp({
    adb: {
      listDevices: async () => [{ serial: 'QUEST', state: 'device' }],
      run: async (args) => args.includes('path') ? 'package:/data/app/example/base.apk' : `${digest}  /data/app/example/base.apk`,
    },
    releases: { latest: async () => ({ tag: 'v2.1', digest: `sha256:${digest}`, assetName: 'Perfect_Dark_VR_Standalone_NTSC_v2.1.apk' }) },
  });
  try {
    const response = await request(app, 'GET', '/api/releases?gameId=perfect-dark-vr&serial=QUEST');
    assert.equal(response.status, 200);
    assert.equal(response.body.release.verifiedSerial, 'QUEST');
    assert.equal(response.body.release.installedApkMatchesRelease, true);
  } finally { app.server.close(); }
});

test('Simpsons PC input requires its core asset folders before transfer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-simpsons-'));
  const gamePath = path.join(root, 'SimpsonsHitRun');
  await fs.mkdir(gamePath);
  for (const name of ['ambience.rcf', 'carsound.rcf', 'music00.rcf', 'scripts.rcf', 'soundfx.rcf']) {
    await fs.writeFile(path.join(gamePath, name), 'fixture');
  }
  const app = createApp({ adb: { listDevices: async () => [], run: async () => '' } });
  try {
    const incomplete = await request(app, 'POST', '/api/validate-file', { gameId: 'simpsons-hit-run-vr', itemId: 'game', path: gamePath });
    assert.equal(incomplete.status, 400);
    assert.match(incomplete.body.error, /art/);
    for (const [folder, name] of [['art', 'L1_TERRA.p3d'], ['scripts', 'ss.mfk'], ['movies', 'intro.rmv']]) {
      await fs.mkdir(path.join(gamePath, folder));
      await fs.writeFile(path.join(gamePath, folder, name), 'fixture');
    }
    const valid = await request(app, 'POST', '/api/validate-file', { gameId: 'simpsons-hit-run-vr', itemId: 'game', path: gamePath });
    assert.equal(valid.status, 200, JSON.stringify(valid.body));
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('selected game files keep their original path across restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-paths-'));
  const settingsPath = path.join(root, 'settings.json');
  const rom = path.join(root, 'Super Mario 64.z64');
  const apk = path.join(root, 'sm64-port.apk');
  const wrong = path.join(root, 'Wrong.txt');
  await fs.writeFile(rom, 'owned fixture');
  await fs.writeFile(apk, 'local APK fixture');
  await fs.writeFile(wrong, 'not a ROM');
  const options = { settingsPath, adb: { listDevices: async () => [], run: async () => '' } };
  try {
    const first = createApp(options);
    const imported = await request(first, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'rom', path: rom });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.path, rom);
    const linkedApk = await request(first, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'apkPath', path: apk });
    assert.equal(linkedApk.body.path, apk);
    assert.equal(await fs.readFile(imported.body.path, 'utf8'), 'owned fixture');
    assert.equal((await request(first, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'unknown', path: rom })).status, 400);
    assert.equal((await request(first, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'rom', path: 'relative.z64' })).status, 400);
    first.server.close();
    const reopened = createApp(options);
    const saved = await request(reopened, 'GET', '/api/local-paths');
    assert.equal(saved.body.paths['sm64-vr'].rom, imported.body.path);
    assert.equal(saved.body.paths['sm64-vr'].apkPath, apk);
    assert.equal(saved.body.availability['sm64-vr'].rom, true);
    const notReady = await request(reopened, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'rom', path: wrong });
    assert.equal(notReady.body.available, false);
    await request(reopened, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'rom', path: rom });
    await fs.rm(rom);
    const missing = await request(reopened, 'GET', '/api/local-paths');
    assert.equal(missing.body.paths['sm64-vr'].rom, imported.body.path);
    assert.equal(missing.body.availability['sm64-vr'].rom, false);
    assert.equal((await request(reopened, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'rom', path: '' })).status, 200);
    reopened.server.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('one chosen board or BIOS file fills matching games and Forget clears the shared choice', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-shared-input-'));
  const settingsPath = path.join(root, 'settings.json');
  const sevenZipTool = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  const board = path.join(root, 'namcoc71.zip');
  const bios = path.join(root, 'naomi.zip');
  await fs.writeFile(path.join(root, 'board.bin'), 'board fixture');
  await runFile(sevenZipTool, ['a', '-tzip', board, 'board.bin'], { cwd: root, windowsHide: true });
  await runFile(sevenZipTool, ['a', '-tzip', bios, 'board.bin'], { cwd: root, windowsHide: true });
  const options = { settingsPath, adb: { listDevices: async () => [] }, releases: {} };
  try {
    const first = createApp(options);
    const chosenBoard = await request(first, 'POST', '/api/local-paths', { gameId: 'time-crisis-vr', key: 'namcoc71', path: board });
    assert.equal(chosenBoard.status, 200, JSON.stringify(chosenBoard.body));
    assert.ok(chosenBoard.body.linked.some((entry) => entry.gameId === 'dirt-dash-vr' && entry.key === 'namcoc71' && entry.path === board));
    const chosenBios = await request(first, 'POST', '/api/local-paths', { gameId: 'mok-vr', key: 'naomi', path: bios });
    assert.equal(chosenBios.status, 200, JSON.stringify(chosenBios.body));
    assert.ok(chosenBios.body.linked.some((entry) => entry.gameId === 'ninja-assault-vr' && entry.key === 'naomi' && entry.path === bios));
    first.server.close();

    const reopened = createApp(options);
    const saved = (await request(reopened, 'GET', '/api/local-paths')).body;
    assert.equal(saved.paths['dirt-dash-vr'].namcoc71, board);
    assert.equal(saved.paths['death-crimson-ox-vr'].naomi, bios);
    assert.equal(saved.availability['ninja-assault-vr'].naomi, true);
    assert.equal(saved.paths['rave-racer-vr'], undefined, 'a C71 BIOS BIN is not the Namco board ZIP');
    assert.equal(saved.paths['hotd2-vr'], undefined, 'the special HOTD2 BIOS is not the NAOMI BIOS');
    assert.equal(saved.paths['sm64-vr'], undefined, 'generic ROM fields must not be shared');
    const library = (await request(reopened, 'GET', '/api/library')).body;
    assert.ok(library.scan.matches.some((match) => match.gameId === 'dirt-dash-vr' && match.files.namcoc71 === board));
    assert.ok(library.scan.matches.some((match) => match.gameId === 'ninja-assault-vr' && match.files.naomi === bios));
    const forgotten = await request(reopened, 'POST', '/api/library/remove', { id: 'mok-vr:naomi' });
    assert.equal(forgotten.body.removed, true);
    const afterForget = (await request(reopened, 'GET', '/api/local-paths')).body;
    assert.equal(afterForget.paths['mok-vr']?.naomi, undefined);
    assert.equal(afterForget.paths['ninja-assault-vr']?.naomi, undefined);
    assert.equal(afterForget.paths['time-crisis-vr'].namcoc71, board);
    assert.equal((await fs.stat(bios)).isFile(), true);
    reopened.server.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('an older saved BIOS choice fills matching games when settings are opened', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-shared-migrate-'));
  const settingsPath = path.join(root, 'settings.json');
  const sevenZipTool = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  const bios = path.join(root, 'naomi.zip');
  await fs.writeFile(path.join(root, 'board.bin'), 'board fixture');
  await runFile(sevenZipTool, ['a', '-tzip', bios, 'board.bin'], { cwd: root, windowsHide: true });
  await fs.writeFile(settingsPath, JSON.stringify({ localPaths: { 'mok-vr': { naomi: bios } } }));
  const app = createApp({ settingsPath, adb: { listDevices: async () => [] }, releases: {} });
  try {
    const saved = (await request(app, 'GET', '/api/local-paths')).body;
    assert.equal(saved.paths['mok-vr'].naomi, bios);
    assert.equal(saved.paths['ninja-assault-vr'].naomi, bios);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('saved game choice persists without copying or scanning its source folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-location-'));
  const settingsPath = path.join(root, 'app', 'settings.json');
  const source = path.join(root, 'owned.z64');
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(source, 'owned game fixture');
  const options = { settingsPath, adb: { listDevices: async () => [] }, releases: {} };
  try {
    const first = createApp(options);
    const imported = await request(first, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'rom', path: source });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    const paths = await request(first, 'GET', '/api/local-paths');
    const saved = paths.body.paths['sm64-vr'].rom;
    assert.equal(saved, source);
    assert.equal(await fs.readFile(saved, 'utf8'), 'owned game fixture');
    assert.equal(await fs.readFile(imported.body.path, 'utf8'), 'owned game fixture');
    first.server.close();
    await fs.rm(source);
    const reopened = createApp(options);
    assert.equal((await request(reopened, 'GET', '/api/library/location')).status, 404);
    assert.equal((await request(reopened, 'GET', '/api/local-paths')).body.availability['sm64-vr'].rom, false);
    reopened.server.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Descent 3 one-click setup uses owned folder and cached official APK', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-descent-api-'));
  const gamePath = path.join(root, 'Descent 3');
  const apk = path.join(root, 'Descent3-VR-0.3-beta.apk');
  await fs.mkdir(path.join(gamePath, 'missions'), { recursive: true });
  await fs.mkdir(path.join(gamePath, 'movies'), { recursive: true });
  await fs.writeFile(path.join(gamePath, 'd3.hog'), 'owned fixture');
  await fs.writeFile(apk, 'official fixture');
  const release = { tag: 'quest-v0.3-beta', assetName: path.basename(apk), downloadUrl: 'https://github.com/SgtBilko76/Descent3-VR/releases/download/quest-v0.3-beta/Descent3-VR-0.3-beta.apk', stale: false };
  const calls = [];
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }], run: async () => '' },
    releases: { latest: async () => release, download: async () => apk },
    descent3Installer: async (input) => { calls.push(input); input.onLog('Owned data copied'); },
  });
  try {
    const started = await request(app, 'POST', '/api/descent3-install', { gameId: 'descent3-vr', serial: 'Q3', gamePath });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await request(app, 'GET', `/api/jobs/${started.body.job.id}`);
    assert.equal(result.body.job.status, 'success', result.body.job.error);
    assert.equal(calls[0].gamePath, gamePath);
    assert.equal(calls[0].apkPath, apk);
    assert.equal(await fs.readFile(path.join(calls[0].gamePath, 'd3.hog'), 'utf8'), 'owned fixture');
    assert.equal(await fs.readFile(calls[0].apkPath, 'utf8'), 'official fixture');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('JKXR one-click setup installs both official APKs with owned Jedi data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-jkxr-api-'));
  const gamePath = path.join(root, 'Jedi Outcast', 'GameData', 'base');
  const engine = path.join(root, 'jkxr-1.2.0.apk');
  const companion = path.join(root, 'jkxrcompanion_115meta.apk');
  await fs.mkdir(gamePath, { recursive: true });
  for (const name of ['assets0.pk3', 'assets1.pk3', 'assets2.pk3', 'assets5.pk3']) await fs.writeFile(path.join(gamePath, name), name);
  await fs.writeFile(engine, 'engine');
  await fs.writeFile(companion, 'companion');
  const releases = {
    latest: async (source) => ({ tag: 'v1.2.0', assetName: source.assetPattern.includes('companion') ? path.basename(companion) : path.basename(engine), stale: false }),
    download: async (release) => release.assetName === path.basename(engine) ? engine : companion,
  };
  const calls = [];
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }], run: async () => '' }, releases,
    jkxrInstaller: async (input) => { calls.push(input); input.onLog('Both APKs installed'); } });
  try {
    const started = await request(app, 'POST', '/api/jkxr-install', { gameId: 'jkxr', serial: 'Q3', gamePath: path.join(root, 'Jedi Outcast'), jediGame: 'jk2' });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await request(app, 'GET', `/api/jobs/${started.body.job.id}`);
    assert.equal(result.body.job.status, 'success', result.body.job.error);
    assert.equal(calls[0].game, 'jk2');
    assert.equal(calls[0].gamePath, path.join(root, 'Jedi Outcast'));
    assert.equal(await fs.readFile(calls[0].engineApkPath, 'utf8'), 'engine');
    assert.equal(await fs.readFile(calls[0].companionApkPath, 'utf8'), 'companion');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('failed install activity remains available after the desktop app restarts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-job-history-'));
  const settingsPath = path.join(root, 'settings.json');
  const gamePackage = path.join(root, 'RDR.xapk');
  await fs.writeFile(gamePackage, 'owned fixture');
  const options = { settingsPath, adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }] },
    personalBuilder: async () => { throw new Error('synthetic build failure'); } };
  try {
    const first = createApp(options);
    const started = await request(first, 'POST', '/api/personal-build', { gameId: 'rdr1-vr', serial: 'Q3', gamePackage });
    assert.equal(started.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 30));
    first.server.close();
    const reopened = createApp(options);
    const jobs = await request(reopened, 'GET', '/api/jobs');
    assert.equal(jobs.body.jobs[0].status, 'error');
    assert.match(jobs.body.jobs[0].error, /synthetic build failure/);
    assert.match(await fs.readFile(path.join(root, 'install-jobs.txt'), 'utf8'), /ERROR Red Dead Redemption VR[\s\S]*synthetic build failure/);
    reopened.server.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('personal build accepts a complete RDR export and passes the selected serial to its builder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-rdr-job-'));
  const gamePackage = path.join(root, 'RDR-complete.xapk');
  await fs.writeFile(gamePackage, 'fixture');
  const calls = [];
  const app = createApp({
    adb: { listDevices: async () => [{ serial: 'Q3-ONE', state: 'device' }, { serial: 'Q3-TWO', state: 'device' }] },
    personalBuilder: async (gameId, input, _roots, log) => { calls.push({ gameId, input }); log('Official validation passed'); return { sha: 'a'.repeat(40) }; },
  });
  try {
    const started = await request(app, 'POST', '/api/personal-build', { gameId: 'rdr1-vr', serial: 'Q3-TWO', gamePackage });
    assert.equal(started.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job = await request(app, 'GET', `/api/jobs/${started.body.job.id}`);
    assert.equal(job.body.job.status, 'success');
    assert.equal(job.body.job.serial, 'Q3-TWO');
    assert.equal(calls[0].input.gamePackage, gamePackage);
    assert.equal(await fs.readFile(calls[0].input.gamePackage, 'utf8'), 'fixture');
    assert.equal(calls[0].input.serial, 'Q3-TWO');
    assert.match(job.body.job.log.join(' '), /Official validation passed/);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('F-Zero X VirtuaVRPort personal install uses its own ROM preparation flow and selected Quest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-fzero-api-'));
  const rom = path.join(root, 'F-Zero X (USA).z64');
  const bundle = path.join(root, 'VirtuaVRPort-R10.zip');
  await fs.writeFile(rom, 'test fixture');
  await fs.writeFile(bundle, 'test fixture');
  const calls = [];
  const app = createApp({
    adb: { listDevices: async () => [{ serial: 'Q3-ONE', state: 'device' }, { serial: 'Q3-TWO', state: 'device' }] },
    validateFzeroVirtuaInput: async (input) => input,
    fzeroVirtuaInstaller: async (input) => { calls.push(input); return { packageId: 'dev.gdiffuser.quest', tag: 'R10' }; },
  });
  try {
    const started = await request(app, 'POST', '/api/personal-build', { gameId: 'fzero-x-virtuavr', serial: 'Q3-TWO', gamePackage: rom, audioSource: bundle });
    assert.equal(started.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const job = await request(app, 'GET', `/api/jobs/${started.body.job.id}`);
    assert.equal(job.body.job.status, 'success');
    assert.equal(calls[0].serial, 'Q3-TWO');
    assert.equal(calls[0].gamePackage, rom);
    assert.equal(calls[0].audioSource, bundle);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('personal build rejects missing GTA audio, wrong headset, and conflicting work', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-build-lock-'));
  const gamePackage = path.join(root, 'base.apk');
  const audioSource = path.join(root, 'gta-sa-ps2-style-mod-pack_1786856007_737162.7z');
  await fs.writeFile(gamePackage, 'fixture');
  await fs.writeFile(audioSource, 'fixture');
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const app = createApp({
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }] },
    personalBuilder: async () => { await gate; return { sha: 'b'.repeat(40) }; },
  });
  try {
    const missing = await request(app, 'POST', '/api/personal-build', { gameId: 'gta-sa-vr', serial: 'Q3', gamePackage });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /audio/i);
    const wrong = await request(app, 'POST', '/api/personal-build', { gameId: 'gta-sa-vr', serial: 'OTHER', gamePackage, audioSource });
    assert.equal(wrong.status, 400);
    const started = await request(app, 'POST', '/api/personal-build', { gameId: 'gta-sa-vr', serial: 'Q3', gamePackage, audioSource });
    assert.equal(started.status, 202);
    const conflict = await request(app, 'POST', '/api/personal-build', { gameId: 'gta-sa-vr', serial: 'Q3', gamePackage, audioSource });
    assert.equal(conflict.status, 409);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const done = await request(app, 'GET', `/api/jobs/${started.body.job.id}`);
    assert.equal(done.body.job.status, 'success');
  } finally { finish(); app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Road Rash GitHub ZIP is visible but cannot be passed to the APK installer', async () => {
  const app = createApp({ adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }] }, releases: { latest: async () => ({ tag: 'v0.1.0', assetName: 'RoadRashJailbreak-0.1.0.zip' }) }, picker: async () => null });
  const release = await request(app, 'GET', '/api/releases?gameId=road-rash-vr');
  assert.equal(release.body.release.assetName, 'RoadRashJailbreak-0.1.0.zip');
  const install = await request(app, 'POST', '/api/install', { gameId: 'road-rash-vr', serial: 'Q3', apkMode: 'github', files: {} });
  assert.equal(install.status, 400);
  assert.match(install.body.error, /ZIP|installer/i);
});

test('Road Rash player install accepts an owned disc and targets only the selected Quest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-road-player-'));
  const discImage = path.join(root, 'disc.bin');
  await fs.writeFile(discImage, 'owned disc fixture');
  const calls = [];
  const release = { tag: 'v0.1.0', assetName: 'RoadRashJailbreak-0.1.0.zip', downloadUrl: 'https://github.com/dubrovskiy-yevhen-stakelogic/road-rash-jailbreak/releases/download/v0.1.0/RoadRashJailbreak-0.1.0.zip', digest: `sha256:${'a'.repeat(64)}`, stale: false };
  const app = createApp({
    adb: { listDevices: async () => [{ serial: 'QUEST-ONE', state: 'device' }, { serial: 'QUEST-TWO', state: 'device' }], getPath: () => 'C:\\adb.exe' },
    releases: { latest: async () => release },
    roadRashInstaller: async (input) => { calls.push(input); input.onLog('Official disc validation passed'); return { exitCode: 0, tag: release.tag }; },
  });
  try {
    const started = await request(app, 'POST', '/api/road-rash-install', { gameId: 'road-rash-vr', serial: 'QUEST-TWO', discImage });
    assert.equal(started.status, 202, started.body?.error);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job = await request(app, 'GET', `/api/jobs/${started.body.job.id}`);
    assert.equal(job.body.job.status, 'success');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].serial, 'QUEST-TWO');
    assert.equal(calls[0].discImage, discImage);
    assert.equal(await fs.readFile(calls[0].discImage, 'utf8'), 'owned disc fixture');
    assert.equal(calls[0].release.downloadUrl, release.downloadUrl);
    assert.match(job.body.job.log.join(' '), /Official disc validation passed/);
    const invalid = await request(app, 'POST', '/api/road-rash-install', { gameId: 'road-rash-vr', serial: 'UNKNOWN', discImage });
    assert.equal(invalid.status, 400);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Harry Potter player install hands an owned game folder and selected Quest to the official runner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-hp-player-'));
  const gamePath = path.join(root, 'Harry Potter');
  await fs.mkdir(gamePath);
  await fs.writeFile(path.join(gamePath, 'System.u'), 'owned fixture');
  const release = { tag: 'v0.1.4.1', assetName: 'HPVR-Quest-0.1.4.1.zip', downloadUrl: 'https://github.com/dubrovskiy-yevhen-stakelogic/harry-potter-vr/releases/download/v0.1.4.1/HPVR-Quest-0.1.4.1.zip', digest: `sha256:${'a'.repeat(64)}`, stale: false };
  const calls = [];
  const app = createApp({
    adb: { listDevices: async () => [{ serial: 'QUEST-ONE', state: 'device' }, { serial: 'QUEST-TWO', state: 'device' }], getPath: () => 'C:\\adb.exe' },
    releases: { latest: async () => release },
    harryPotterInstaller: async (input) => { calls.push(input); input.onLog('INSTALL=PASS DATA_IMPORT=PASS'); return { exitCode: 0 }; },
  });
  try {
    const started = await request(app, 'POST', '/api/harry-potter-install', { gameId: 'harry-potter-vr', serial: 'QUEST-TWO', gamePath });
    assert.equal(started.status, 202, started.body?.error);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job = await request(app, 'GET', `/api/jobs/${started.body.job.id}`);
    assert.equal(job.body.job.status, 'success');
    assert.equal(calls[0].serial, 'QUEST-TWO');
    assert.equal(calls[0].gamePath, gamePath);
    assert.equal(await fs.readFile(path.join(calls[0].gamePath, 'System.u'), 'utf8'), 'owned fixture');
    assert.equal(calls[0].release.downloadUrl, release.downloadUrl);
    assert.match(job.body.job.log.join(' '), /INSTALL=PASS DATA_IMPORT=PASS/);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('release check verifies a cached HOTD2 APK installed on the selected headset', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-release-match-'));
  const apk = path.join(root, 'hotd2-vr-quest.apk');
  await fs.writeFile(apk, 'latest HOTD2 APK');
  const digest = require('node:crypto').createHash('sha256').update('latest HOTD2 APK').digest('hex');
  const app = createApp({
    adb: {
      listDevices: async () => [{ serial: 'Q3', state: 'device' }],
      run: async (args) => args.includes('pm') ? 'package:/data/app/hotd2/base.apk' : `${digest}  /data/app/hotd2/base.apk`,
    },
    releases: {
      latest: async () => ({ tag: 'v0.4-test1', assetName: 'hotd2-vr-quest.apk', downloadUrl: 'https://github.com/mikermak/hotd2-vr/releases/download/v0.4-test1/hotd2-vr-quest.apk' }),
      cachedFile: async () => apk,
    },
  });
  try {
    const result = await request(app, 'GET', '/api/releases?gameId=hotd2-vr&serial=Q3');
    assert.equal(result.status, 200);
    assert.equal(result.body.release.installedApkMatchesRelease, true);
    assert.equal(result.body.release.verifiedSerial, 'Q3');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('release check verifies TPVR directly against its official GitHub SHA-256 digest', async () => {
  const digest = 'e'.repeat(64);
  const app = createApp({
    adb: {
      listDevices: async () => [{ serial: 'Q3', state: 'device' }],
      run: async (args) => args.includes('pm') ? 'package:/data/app/tpvr/base.apk' : `${digest}  /data/app/tpvr/base.apk`,
    },
    releases: { latest: async () => ({ tag: '2.4.0', digest: `sha256:${digest}`, assetName: 'tpvr-quest-arm64.apk' }) },
  });
  const result = await request(app, 'GET', '/api/releases?gameId=twilight-vr&serial=Q3');
  assert.equal(result.status, 200);
  assert.equal(result.body.release.installedApkMatchesRelease, true);
  app.server.close();
});

test('Doom3Quest folder validation rejects incomplete game data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-doom3-data-'));
  const app = createApp({ adb: { listDevices: async () => [] }, releases: {}, picker: async () => null });
  try {
    await fs.writeFile(path.join(root, 'pak000.pk4'), 'fixture');
    const result = await request(app, 'POST', '/api/validate-file', { gameId: 'doom3quest', itemId: 'base', path: root });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /game00\.pk4/i);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('ZIP field accepts a folder, remembers its source path, and installs the ZIP contents', { skip: process.platform !== 'win32' }, async () => {
  if (!(await fs.stat(sevenZip).catch(() => null))?.isFile()) return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-folder-api-'));
  const source = path.join(root, 'timecris');
  const boardSource = path.join(root, 'namcoc71');
  const apkPath = path.join(root, 'port.apk');
  const settingsPath = path.join(root, 'settings.json');
  const calls = [];
  const options = {
    settingsPath,
    adb: simulatedTransferAdb(async (args) => { calls.push(args); }),
    releases: {}, inspectApkPackage: async () => 'io.port0r.timecrisis',
  };
  const app = createApp(options);
  try {
    await fs.mkdir(source);
    await fs.mkdir(boardSource);
    await fs.writeFile(path.join(source, 'game.bin'), 'owned fixture');
    await fs.writeFile(path.join(boardSource, 'board.bin'), 'owned board');
    await fs.writeFile(apkPath, 'APK fixture');
    const validated = await request(app, 'POST', '/api/validate-file', { gameId: 'time-crisis-vr', itemId: 'timecris', path: source });
    assert.equal(validated.status, 200, validated.body?.error);
    assert.equal(validated.body.path, source);
    assert.match(validated.body.verification.message, /folder.*ZIP/i);
    const remembered = await request(app, 'POST', '/api/local-paths', { gameId: 'time-crisis-vr', key: 'timecris', path: source });
    assert.equal(remembered.body.available, true);
    const started = await request(app, 'POST', '/api/install', { gameId: 'time-crisis-vr', serial: 'Q3-FAKE', apkMode: 'local', apkPath, files: { timecris: source, namcoc71: boardSource } });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 20; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (job.status !== 'running' && job.status !== 'queued') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, 'success', job.error);
    assert.equal(calls.some((args) => args.includes('push') && args.some((arg) => /timecris\.zip$/i.test(arg))), true);
    const reopened = createApp(options);
    try {
      const saved = await request(reopened, 'GET', '/api/local-paths');
      assert.equal(saved.body.paths['time-crisis-vr'].timecris, source);
      assert.equal(path.basename(saved.body.paths['time-crisis-vr'].timecris), 'timecris');
      assert.equal(saved.body.availability['time-crisis-vr'].timecris, true);
    } finally { reopened.server.close(); }
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Rave Racer accepts archived c71.bin and transfers the extracted BIOS file', { skip: process.platform !== 'win32' }, async () => {
  const bundledZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-c71-bios-'));
  const calls = [];
  let transferredBios = null;
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb: simulatedTransferAdb(async (args) => {
      calls.push(args);
      if (args.includes('push') && args.at(-1)?.endsWith('/c71.bin')) transferredBios = await fs.readFile(args.at(-2), 'utf8');
    }), releases: {}, inspectApkPackage: async () => null });
  try {
    await fs.mkdir(path.join(root, 'bios'));
    await fs.writeFile(path.join(root, 'bios', 'c71.bin'), 'owned BIOS fixture');
    await fs.writeFile(path.join(root, 'unrelated.bin'), 'wrong BIOS fixture');
    const zip = path.join(root, 'c71.zip');
    const seven = path.join(root, 'c71.7z');
    const rar = path.join(root, 'c71.rar');
    const wrong = path.join(root, 'wrong.zip');
    await runFile(bundledZip, ['a', '-tzip', zip, 'bios'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-t7z', seven, 'bios'], { cwd: root, windowsHide: true });
    if ((await fs.stat(winRar).catch(() => null))?.isFile()) await runFile(winRar, ['a', '-idq', rar, 'bios'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-tzip', wrong, 'unrelated.bin'], { cwd: root, windowsHide: true });
    for (const archive of [zip, seven, ...(await fs.stat(rar).catch(() => null) ? [rar] : [])]) {
      const checked = await request(app, 'POST', '/api/validate-file', { gameId: 'rave-racer-vr', itemId: 'bios', path: archive });
      assert.equal(checked.status, 200, checked.body?.error);
      assert.equal(checked.body.path, archive, 'remember the original archive path');
    }
    const rejected = await request(app, 'POST', '/api/validate-file', { gameId: 'rave-racer-vr', itemId: 'bios', path: wrong });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /c71\.bin/i);
    const race = path.join(root, 'raverace.zip');
    const board = path.join(root, 'namcoc74.zip');
    await runFile(bundledZip, ['a', '-tzip', race, 'unrelated.bin'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-tzip', board, 'unrelated.bin'], { cwd: root, windowsHide: true });
    const apkPath = path.join(root, 'rave.apk');
    await fs.writeFile(apkPath, 'APK fixture');
    const started = await request(app, 'POST', '/api/install', { gameId: 'rave-racer-vr', serial: 'Q3-FAKE', apkMode: 'local', apkPath, files: { race, board, bios: (await fs.stat(rar).catch(() => null)) ? rar : seven } });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 30; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (!['queued', 'running'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, 'success', job.error);
    const biosPush = calls.find((args) => args.includes('push') && args.at(-1)?.endsWith('/c71.bin'));
    assert.ok(biosPush, 'push the BIOS to its required Quest path');
    assert.equal(path.basename(biosPush.at(-2)).toLowerCase(), 'c71.bin');
    assert.equal(transferredBios, 'owned BIOS fixture');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('single-file game fields accept ZIP, 7z, and RAR wrappers and reject ambiguous archives', { skip: process.platform !== 'win32' }, async () => {
  const bundledZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wrapped-rom-'));
  const calls = [];
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb: simulatedTransferAdb(async (args) => { calls.push(args); }), releases: {}, inspectApkPackage: async () => null });
  try {
    const rom = Buffer.alloc(128);
    rom.writeUInt32BE(0x80371240, 0);
    rom.write('NSME', 0x3b, 'ascii');
    await fs.mkdir(path.join(root, 'owned'));
    await fs.writeFile(path.join(root, 'owned', 'Mario.z64'), rom);
    await fs.writeFile(path.join(root, 'owned', 'Mario copy.z64'), rom);
    const zip = path.join(root, 'Super Mario 64.zip');
    const seven = path.join(root, 'Super Mario 64.7z');
    const rar = path.join(root, 'Super Mario 64.rar');
    const ambiguous = path.join(root, 'ambiguous.zip');
    await runFile(bundledZip, ['a', '-tzip', zip, 'owned/Mario.z64'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-t7z', seven, 'owned/Mario.z64'], { cwd: root, windowsHide: true });
    if ((await fs.stat(winRar).catch(() => null))?.isFile()) await runFile(winRar, ['a', '-idq', rar, 'owned/Mario.z64'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-tzip', ambiguous, 'owned'], { cwd: root, windowsHide: true });
    for (const archive of [zip, seven, ...(await fs.stat(rar).catch(() => null) ? [rar] : [])]) {
      const checked = await request(app, 'POST', '/api/validate-file', { gameId: 'sm64-vr', itemId: 'rom', path: archive });
      assert.equal(checked.status, 200, checked.body?.error);
      assert.equal(checked.body.path, archive);
    }
    const rejected = await request(app, 'POST', '/api/validate-file', { gameId: 'sm64-vr', itemId: 'rom', path: ambiguous });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /multiple|more than one|ambiguous/i);
    const apkPath = path.join(root, 'sm64.apk');
    await fs.writeFile(apkPath, 'APK fixture');
    const started = await request(app, 'POST', '/api/install', { gameId: 'sm64-vr', serial: 'Q3-FAKE', apkMode: 'local', apkPath, files: { rom: zip } });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 30; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (!['queued', 'running'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, 'success', job.error);
    const romPush = calls.find((args) => args.includes('push') && args.at(-1)?.endsWith('/Mario.z64'));
    assert.ok(romPush);
    assert.equal(path.basename(romPush.at(-2)), 'Mario.z64');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('a local port APK can be selected from a ZIP wrapper without keeping an extracted copy', { skip: process.platform !== 'win32' }, async () => {
  const bundledZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wrapped-apk-'));
  const calls = [];
  let installedBytes = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb: simulatedTransferAdb(async (args) => {
    calls.push(args);
    if (args.includes('install')) installedBytes = await fs.readFile(args.at(-1), 'utf8');
  }), releases: {}, inspectApkPackage: async () => null });
  try {
    await fs.writeFile(path.join(root, 'port.apk'), 'owned APK fixture');
    const archive = path.join(root, 'MGS VR.zip');
    await runFile(bundledZip, ['a', '-tzip', archive, 'port.apk'], { cwd: root, windowsHide: true });
    const checked = await request(app, 'POST', '/api/validate-apk', { gameId: 'mgs-vr', path: archive });
    assert.equal(checked.status, 200, checked.body?.error);
    const files = {};
    for (const disc of [1, 2]) {
      files[`disc${disc}Bin`] = path.join(root, `disc${disc}.bin`);
      files[`disc${disc}Cue`] = path.join(root, `disc${disc}.cue`);
      await fs.writeFile(files[`disc${disc}Bin`], `disc ${disc} binary`);
      await fs.writeFile(files[`disc${disc}Cue`], `FILE "disc${disc}.bin" BINARY\n  TRACK 01 MODE2/2352\n`);
    }
    const started = await request(app, 'POST', '/api/install', { gameId: 'mgs-vr', serial: 'Q3-FAKE', apkMode: 'local', apkPath: archive, files });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 30; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (!['queued', 'running'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, 'success', job.error);
    assert.equal(installedBytes, 'owned APK fixture');
    assert.equal(path.extname(calls.find((args) => args.includes('install')).at(-1)), '.apk');
    assert.equal(calls.filter((args) => args.includes('push') && args.at(-1).startsWith('/sdcard/MGSVR/roms/en/')).length, 4);
    const saved = await request(app, 'GET', '/api/local-paths');
    assert.equal(saved.body.paths['mgs-vr'].apkPath, archive);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Wipeout install packages selected game data in the configured PC build folder and transfers a TAR', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wipeout-api-'));
  const buildFolder = path.join(root, 'selected builds');
  const gameFolder = path.join(root, 'wipeout');
  const apk = path.join(root, 'Wipeout.apk');
  const calls = [];
  let tarEntries = '';
  const adb = simulatedTransferAdb(async (args) => {
    calls.push(args);
    if (args.includes('push') && args.at(-1).endsWith('/wipeout.tar')) {
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      tarEntries = (await runFile(tar, ['-tf', args.at(-2)])).stdout;
      assert.ok(args.at(-2).startsWith(buildFolder + path.sep));
    }
  });
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb, releases: {}, inspectApkPackage: async () => null });
  try {
    await fs.mkdir(buildFolder);
    for (const folder of ['common', 'textures', 'track01']) {
      await fs.mkdir(path.join(gameFolder, folder), { recursive: true });
      await fs.writeFile(path.join(gameFolder, folder, 'fixture.dat'), folder);
    }
    await fs.writeFile(apk, 'test port APK');
    const setting = await request(app, 'POST', '/api/settings', { adbPath: '', sources: {}, buildWorkspace: buildFolder });
    assert.equal(setting.status, 200, setting.body?.error);
    const started = await request(app, 'POST', '/api/install', { gameId: 'wipeout-vr', serial: 'Q3-FAKE', apkMode: 'local', apkPath: apk, files: { gameData: gameFolder } });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 60; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (!['queued', 'running'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, 'success', job.error);
    assert.match(tarEntries, /wipeout\/track01\/fixture\.dat/);
    assert.ok(calls.some((args) => args.includes('push') && args.at(-1).endsWith('/wipeout.tar')));
    assert.ok(!calls.some((args) => args.includes('push') && args.at(-1).endsWith('/track01/')));
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('a ZIP game set inside a 7z wrapper is unwrapped and its original path is remembered', { skip: process.platform !== 'win32' }, async () => {
  const bundledZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-nested-zip-'));
  let transferredListing = '';
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb: simulatedTransferAdb(async (args) => {
      if (args.includes('push') && args.at(-1)?.endsWith('/timecris.zip')) {
        transferredListing = (await runFile(bundledZip, ['l', args.at(-2)], { windowsHide: true })).stdout;
      }
    }), releases: {}, inspectApkPackage: async () => null });
  try {
    await fs.writeFile(path.join(root, 'game.bin'), 'arcade fixture');
    const inner = path.join(root, 'timecris.zip');
    const wrapper = path.join(root, 'Time Crisis files.7z');
    const wrapperZip = path.join(root, 'Time Crisis files.zip');
    const board = path.join(root, 'namcoc71.zip');
    await runFile(bundledZip, ['a', '-tzip', inner, 'game.bin'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-t7z', wrapper, 'timecris.zip'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-tzip', wrapperZip, 'timecris.zip'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-tzip', board, 'game.bin'], { cwd: root, windowsHide: true });
    for (const input of [wrapper, wrapperZip]) {
      const checked = await request(app, 'POST', '/api/validate-file', { gameId: 'time-crisis-vr', itemId: 'timecris', path: input });
      assert.equal(checked.status, 200, checked.body?.error);
      assert.equal(checked.body.path, input);
    }
    const apkPath = path.join(root, 'port.apk');
    await fs.writeFile(apkPath, 'APK fixture');
    const started = await request(app, 'POST', '/api/install', { gameId: 'time-crisis-vr', serial: 'Q3-FAKE', apkMode: 'local', apkPath, files: { timecris: wrapper, namcoc71: board } });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 30; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (!['queued', 'running'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, 'success', job.error);
    assert.match(transferredListing, /game\.bin/);
    assert.doesNotMatch(transferredListing, /\s+timecris\.zip\r?\n/);
    const saved = await request(app, 'GET', '/api/local-paths');
    assert.equal(saved.body.paths['time-crisis-vr'].timecris, wrapper);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('F-Zero X personal setup accepts a wrapped ROM and creator ZIP', { skip: process.platform !== 'win32' }, async () => {
  const bundledZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  const winRarTool = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WinRAR', 'Rar.exe');
  if (!(await fs.stat(winRarTool).catch(() => null))?.isFile()) return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-fzero-wrapped-'));
  let installed = null;
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb: {
    listDevices: async () => [{ serial: 'Q3-FAKE', state: 'device' }],
  }, validateFzeroVirtuaInput: async (input) => {
    assert.equal(path.extname(input.gamePackage), '.z64');
    assert.equal(path.extname(input.audioSource), '.zip');
    return input;
  }, fzeroVirtuaInstaller: async (input) => {
    installed = { rom: await fs.readFile(input.gamePackage, 'utf8'), bundle: (await runFile(bundledZip, ['l', input.audioSource])).stdout };
    return { packageId: 'dev.gdiffuser.quest', tag: 'R10' };
  } });
  try {
    await fs.writeFile(path.join(root, 'F-Zero X.z64'), 'owned ROM fixture');
    await fs.writeFile(path.join(root, 'creator.dat'), 'creator fixture');
    const romArchive = path.join(root, 'F-Zero X.zip');
    const creatorZip = path.join(root, 'Quest R10.zip');
    const creatorRar = path.join(root, 'Quest R10.rar');
    await runFile(bundledZip, ['a', '-tzip', romArchive, 'F-Zero X.z64'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-tzip', creatorZip, 'creator.dat'], { cwd: root, windowsHide: true });
    await runFile(winRarTool, ['a', '-idq', creatorRar, 'Quest R10.zip'], { cwd: root, windowsHide: true });
    const started = await request(app, 'POST', '/api/personal-build', { gameId: 'fzero-x-virtuavr', serial: 'Q3-FAKE', gamePackage: romArchive, audioSource: creatorRar });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 30; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (!['queued', 'running'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, 'success', job.error);
    assert.equal(installed.rom, 'owned ROM fixture');
    assert.match(installed.bundle, /creator\.dat/);
    const saved = await request(app, 'GET', '/api/local-paths');
    assert.equal(saved.body.paths['fzero-x-virtuavr'].gamePackage, romArchive);
    assert.equal(saved.body.paths['fzero-x-virtuavr'].audioSource, creatorRar);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('directory field accepts a ZIP and transfers extracted game files while remembering the archive', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-dir-archive-api-'));
  const bundledZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
  const archive = path.join(root, 'Quake id1.zip');
  const apkPath = path.join(root, 'port.apk');
  const calls = [];
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb: {
    listDevices: async () => [{ serial: 'Q3-FAKE', state: 'device' }],
    run: async (args) => { calls.push(args); return ''; },
  }, releases: {}, inspectApkPackage: async () => null });
  try {
    await fs.mkdir(path.join(root, 'id1'));
    await fs.writeFile(path.join(root, 'id1', 'pak0.pak'), 'owned fixture');
    await fs.writeFile(apkPath, 'APK fixture');
    await runFile(bundledZip, ['a', '-tzip', archive, 'id1'], { cwd: root, windowsHide: true });
    const validated = await request(app, 'POST', '/api/validate-file', { gameId: 'quakequest', itemId: 'id1', path: archive });
    assert.equal(validated.status, 200, validated.body?.error);
    assert.equal(validated.body.path, archive);
    const started = await request(app, 'POST', '/api/install', { gameId: 'quakequest', serial: 'Q3-FAKE', apkMode: 'local', apkPath, files: { id1: archive } });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 50; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (!['running', 'queued'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, 'success', job.error);
    assert.equal(calls.some((args) => args[2] === 'push' && args[3].endsWith('pak0.pak')), true, JSON.stringify(calls));
    assert.equal((await request(app, 'GET', '/api/local-paths')).body.paths.quakequest.id1, archive);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('multiple uploaded game files package into one ZIP at its root', { skip: process.platform !== 'win32' }, async () => {
  if (!(await fs.stat(sevenZip).catch(() => null))?.isFile()) return;
  const app = createApp({ adb: { listDevices: async () => [] }, releases: {} });
  try {
    const session = await request(app, 'POST', '/api/bulk-sessions', {});
    const id = encodeURIComponent(session.body.id);
    assert.equal((await uploadRaw(app, `/api/bulk-upload?session=${id}&path=game.bin`, Buffer.from('owned game'))).status, 200);
    assert.equal((await uploadRaw(app, `/api/bulk-upload?session=${id}&path=board.bin`, Buffer.from('owned board'))).status, 200);
    const packaged = await request(app, 'POST', '/api/package-uploaded', { gameId: 'time-crisis-vr', itemId: 'timecris', session: session.body.id });
    assert.equal(packaged.status, 200, packaged.body?.error);
    assert.match(packaged.body.path, /timecris\.zip$/i);
    const listing = await runFile(sevenZip, ['l', '-slt', packaged.body.path], { windowsHide: true });
    assert.match(listing.stdout, /Path = game\.bin/);
    assert.match(listing.stdout, /Path = board\.bin/);
    assert.doesNotMatch(listing.stdout, /Path = vr4all-bulk-/);
    const second = await request(app, 'POST', '/api/package-uploaded', { gameId: 'time-crisis-vr', itemId: 'timecris', session: session.body.id });
    assert.equal(second.status, 400);
  } finally { app.server.close(); }
});

test('per-game ZIP drop accepts nested files and rejects path traversal', { skip: process.platform !== 'win32' }, async () => {
  const app = createApp({ adb: { listDevices: async () => [] }, releases: {}, picker: async () => null });
  try {
    const session = await request(app, 'POST', '/api/bulk-sessions', {});
    assert.equal(session.status, 200);
    const id = encodeURIComponent(session.body.id);
    const uploaded = await uploadRaw(app, `/api/bulk-upload?session=${id}&path=${encodeURIComponent('My ROMs/game.bin')}`, Buffer.from('owned game'));
    assert.equal(uploaded.status, 200);
    const rejected = await uploadRaw(app, `/api/bulk-upload?session=${id}&path=${encodeURIComponent('../escape.bin')}`, Buffer.from('bad'));
    assert.equal(rejected.status, 400);
    assert.equal((await request(app, 'GET', `/api/bulk-upload-scan?session=${id}`)).status, 404);
    const packaged = await request(app, 'POST', '/api/package-uploaded', { gameId: 'time-crisis-vr', itemId: 'timecris', session: session.body.id });
    assert.equal(packaged.status, 200, packaged.body?.error);
    const listing = await runFile(sevenZip, ['l', '-slt', packaged.body.path], { windowsHide: true });
    assert.match(listing.stdout, /Path = My ROMs\\game\.bin|Path = My ROMs\/game\.bin/);
  } finally { app.server.close(); }
});

test('chosen game paths persist across restart and Forget leaves the original untouched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-bulk-managed-'));
  const settingsPath = path.join(root, 'settings.json');
  const original = path.join(root, 'Mario.z64');
  const rom = Buffer.alloc(128);
  rom.writeUInt32BE(0x80371240, 0);
  rom.write('NSME', 0x3b, 'ascii');
  await fs.writeFile(original, rom);
  const options = { settingsPath, adb: { listDevices: async () => [] }, releases: {} };
  try {
    const first = createApp(options);
    const imported = await request(first, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'rom', path: original });
    assert.equal(imported.status, 200, imported.body?.error);
    first.server.close();
    const reopened = createApp(options);
    try {
      const saved = await request(reopened, 'GET', '/api/library');
      assert.equal(saved.status, 200, saved.body?.error);
      assert.equal(saved.body.items.length, 1);
      assert.equal(saved.body.scan.matches.find((match) => match.gameId === 'sm64-vr').files.rom.endsWith('Mario.z64'), true);
      assert.equal(saved.body.items[0].path, original);
      assert.equal((await request(reopened, 'POST', '/api/library/remove', { id: saved.body.items[0].id })).body.removed, true);
      assert.equal((await fs.stat(original)).isFile(), true);
      assert.equal(await fs.readFile(original).then((bytes) => bytes.length), rom.length);
    } finally { reopened.server.close(); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('per-game F-Zero choices appear as saved build inputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-build-scan-'));
  const rom = path.join(root, 'F-Zero X (U).z64');
  const bundle = path.join(root, 'FZeroXVR-Public-Quest-R10.zip');
  await fs.writeFile(rom, 'ROM fixture');
  await fs.mkdir(bundle);
  await fs.writeFile(path.join(bundle, 'creator-file'), 'creator fixture');
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), downloadsPath: root,
    adb: { listDevices: async () => [] }, releases: {}, validateFzeroInput: async (input) => input });
  try {
    assert.equal((await request(app, 'POST', '/api/local-paths', { gameId: 'fzero-x-virtuavr', key: 'gamePackage', path: rom })).status, 200);
    assert.equal((await request(app, 'POST', '/api/local-paths', { gameId: 'fzero-x-virtuavr', key: 'audioSource', path: bundle })).status, 200);
    const saved = await request(app, 'GET', '/api/local-paths');
    assert.deepEqual(saved.body.paths['fzero-x-virtuavr'], { gamePackage: rom, audioSource: bundle });
    const library = await request(app, 'GET', '/api/library');
    assert.equal(library.body.scan.matches.find((entry) => entry.gameId === 'fzero-x-virtuavr').buildInputs.gamePackage, rom);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('a browsed ROM with a generic filename appears under its chosen game in the saved bulk library', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-browse-bulk-'));
  const romPath = path.join(root, 'backup.z64');
  const rom = Buffer.alloc(128);
  rom.writeUInt32BE(0x80371240, 0);
  rom.write('NSME', 0x3b, 'ascii');
  await fs.writeFile(romPath, rom);
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb: { listDevices: async () => [] }, releases: {} });
  try {
    const imported = await request(app, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'rom', path: romPath });
    assert.equal(imported.status, 200, imported.body?.error);
    const library = await request(app, 'GET', '/api/library');
    assert.equal(library.status, 200, library.body?.error);
    assert.equal(library.body.scan.matches.find((match) => match.gameId === 'sm64-vr').files.rom, imported.body.path);
    const saved = library.body.items.find((item) => item.path === imported.body.path);
    assert.equal((await request(app, 'POST', '/api/library/remove', { id: saved.id })).body.removed, true);
    assert.equal((await request(app, 'GET', '/api/local-paths')).body.paths['sm64-vr'], undefined);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('saved library ignores an unselected Downloads ROM and uses only the game card choice', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-manual-library-'));
  const downloads = path.join(root, 'Downloads');
  const settingsPath = path.join(root, 'settings.json');
  const romPath = path.join(downloads, 'Mario.z64');
  await fs.mkdir(downloads);
  const rom = Buffer.alloc(128);
  rom.writeUInt32BE(0x80371240, 0);
  rom.write('NSME', 0x3b, 'ascii');
  await fs.writeFile(romPath, rom);
  const options = { settingsPath, downloadsPath: downloads, adb: { listDevices: async () => [] }, releases: {} };
  try {
    const first = createApp(options);
    const before = await request(first, 'GET', '/api/library');
    assert.equal(before.status, 200, before.body?.error);
    assert.equal(before.body.scan.matches.length, 0);
    assert.equal(before.body.items.length, 0);
    assert.equal((await request(first, 'POST', '/api/library/scan', {})).status, 404);
    const chosen = await request(first, 'POST', '/api/local-paths', { gameId: 'sm64-vr', key: 'rom', path: romPath });
    assert.equal(chosen.status, 200, chosen.body?.error);
    first.server.close();
    const reopened = createApp(options);
    const after = await request(reopened, 'GET', '/api/library');
    assert.equal(after.body.scan.matches.find((match) => match.gameId === 'sm64-vr')?.files.rom, romPath);
    assert.equal(after.body.items.find((item) => item.gameId === 'sm64-vr')?.path, romPath);
    reopened.server.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('7z drop converts to a verified ZIP for a game file field', { skip: process.platform !== 'win32' }, async () => {
  if (!(await fs.stat(sevenZip).catch(() => null))?.isFile()) return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-archive-test-'));
  const app = createApp({ adb: { listDevices: async () => [] }, releases: {}, picker: async () => null });
  try {
    await fs.writeFile(path.join(root, 'game.bin'), 'arcade game fixture');
    const archive = path.join(root, 'timecris.7z');
    await runFile(sevenZip, ['a', '-t7z', archive, 'game.bin'], { cwd: root, windowsHide: true });
    const bytes = await fs.readFile(archive);
    const single = await uploadRaw(app, '/api/upload?gameId=time-crisis-vr&itemId=timecris&name=timecris.7z', bytes);
    assert.equal(single.status, 200, single.body?.error);
    assert.match(single.body.path, /timecris\.7z$/i);
    assert.match(single.body.verification.message, /Converted \.7Z to ZIP/);
    const listing = await runFile(sevenZip, ['l', single.body.path], { windowsHide: true });
    assert.match(listing.stdout, /game\.bin/);

  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('invalid RAR drop is rejected before it can be staged', async () => {
  const app = createApp({ adb: { listDevices: async () => [] }, releases: {}, picker: async () => null });
  const response = await uploadRaw(app, '/api/upload?gameId=time-crisis-vr&itemId=timecris&name=timecris.rar', Buffer.from('not a RAR archive'));
  assert.equal(response.status, 400);
  assert.match(response.body.error, /archive|7-zip|convert/i);
  app.server.close();
});

test('real RAR drop converts to a verified ZIP', { skip: process.platform !== 'win32' }, async () => {
  if (!(await fs.stat(winRar).catch(() => null))?.isFile() || !(await fs.stat(sevenZip).catch(() => null))?.isFile()) return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-rar-test-'));
  const app = createApp({ adb: { listDevices: async () => [] }, releases: {}, picker: async () => null });
  try {
    await fs.writeFile(path.join(root, 'game.bin'), 'real RAR fixture');
    const archive = path.join(root, 'timecris.rar');
    await runFile(winRar, ['a', '-ep', archive, 'game.bin'], { cwd: root, windowsHide: true });
    const response = await uploadRaw(app, '/api/upload?gameId=time-crisis-vr&itemId=timecris&name=timecris.rar', await fs.readFile(archive));
    assert.equal(response.status, 200, response.body?.error);
    assert.match(response.body.path, /timecris\.rar$/i);
    assert.match(response.body.verification.message, /Converted \.RAR to ZIP/);
    const listing = await runFile(sevenZip, ['l', response.body.path], { windowsHide: true });
    assert.match(listing.stdout, /game\.bin/);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('installs on one headset queue and run without overlapping', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'questdesk-test-'));
  const firstApk = path.join(temp, 'first.apk');
  const secondApk = path.join(temp, 'second.apk');
  await fs.writeFile(firstApk, 'first apk fixture');
  await fs.writeFile(secondApk, 'second apk fixture');
  let releaseFirst;
  const firstInstall = new Promise((resolve) => { releaseFirst = resolve; });
  const calls = [];
  const app = createApp({
    adb: {
      listDevices: async () => [{ serial: 'QUEST3', state: 'device' }],
      run: async (args) => {
        if (args.includes('install')) {
          calls.push(args.at(-1));
          if (args.at(-1) === firstApk) await firstInstall;
        }
        return 'Success';
      },
    },
    releases: {}, picker: async () => null,
    inspectApkPackage: async (apk) => apk === firstApk ? 'org.timecrisis.quest' : 'org.timecrisis2.arcadevr',
  });
  try {
    const first = await request(app, 'POST', '/api/install', { gameId: 'dr89-time-crisis', serial: 'QUEST3', apkMode: 'local', apkPath: firstApk, files: {} });
    assert.equal(first.status, 202, first.body?.error);
    for (let attempt = 0; attempt < 100 && !calls.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(calls, [firstApk]);
    const second = await request(app, 'POST', '/api/install', { gameId: 'dr89-time-crisis-2', serial: 'QUEST3', apkMode: 'local', apkPath: secondApk, files: {} });
    assert.equal(second.status, 202, second.body?.error);
    assert.equal(second.body.job.status, 'queued');
    assert.equal((await request(app, 'GET', `/api/jobs/${second.body.job.id}`)).body.job.status, 'queued');
    assert.deepEqual(calls, [firstApk]);
    assert.equal(app.getActiveInstallJobs().length, 2);
    releaseFirst();
    for (let attempt = 0; attempt < 100 && calls.length < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(calls, [firstApk, secondApk]);
    for (let attempt = 0; attempt < 100 && app.getActiveInstallJobs().length; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(app.getActiveInstallJobs().length, 0);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('a failed headset install releases the next queued game', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'questdesk-test-'));
  const firstApk = path.join(temp, 'first.apk');
  const secondApk = path.join(temp, 'second.apk');
  await Promise.all([fs.writeFile(firstApk, 'first apk fixture'), fs.writeFile(secondApk, 'second apk fixture')]);
  let releaseFirst;
  const firstInstall = new Promise((resolve) => { releaseFirst = resolve; });
  const calls = [];
  const app = createApp({
    adb: {
      listDevices: async () => [{ serial: 'QUEST3', state: 'device' }],
      run: async (args) => {
        if (args.includes('install')) {
          calls.push(args.at(-1));
          if (args.at(-1) === firstApk) { await firstInstall; throw new Error('Disconnected'); }
        }
        return 'Success';
      },
    },
    releases: {}, picker: async () => null,
    inspectApkPackage: async (apk) => apk === firstApk ? 'org.timecrisis.quest' : 'org.timecrisis2.arcadevr',
  });
  try {
    const first = await request(app, 'POST', '/api/install', { gameId: 'dr89-time-crisis', serial: 'QUEST3', apkMode: 'local', apkPath: firstApk, files: {} });
    assert.equal(first.status, 202, first.body?.error);
    for (let attempt = 0; attempt < 100 && !calls.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await request(app, 'POST', '/api/install', { gameId: 'dr89-time-crisis-2', serial: 'QUEST3', apkMode: 'local', apkPath: secondApk, files: {} });
    assert.equal(second.status, 202, second.body?.error);
    releaseFirst();
    for (let attempt = 0; attempt < 100 && app.getActiveInstallJobs().length; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(calls, [firstApk, secondApk]);
    assert.equal((await request(app, 'GET', `/api/jobs/${first.body.job.id}`)).body.job.status, 'error');
    assert.equal((await request(app, 'GET', `/api/jobs/${second.body.job.id}`)).body.job.status, 'success');
  } finally { releaseFirst(); await fs.rm(temp, { recursive: true, force: true }); }
});

test('local API rejects foreign hosts and origins', async () => {
  const app = createApp({ adb: { listDevices: async () => [], run: async () => '' }, releases: {}, picker: async () => null });
  const host = await request(app, 'GET', '/', undefined, true, { host: 'foreign.example' });
  assert.equal(host.status, 403);
  const origin = await request(app, 'POST', '/api/custom-games', { title: 'Malicious' }, true, { origin: 'https://foreign.example' });
  assert.equal(origin.status, 403);
});

test('desktop server accepts its assigned loopback port and rejects another port', async () => {
  const app = createApp({ adb: { listDevices: async () => [] }, releases: {}, picker: async () => null });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const port = app.server.address().port;
    const accepted = await request(app, 'GET', '/api/catalog', undefined, true, { host: `127.0.0.1:${port}` });
    assert.equal(accepted.status, 200);
    const rejected = await request(app, 'GET', '/api/catalog', undefined, true, { host: `127.0.0.1:${port === 4173 ? 4174 : 4173}` });
    assert.equal(rejected.status, 403);
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
});

test('install API refuses an unconnected serial before launching ADB', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'questdesk-test-'));
  const apkPath = path.join(temp, 'port.apk');
  await fs.writeFile(apkPath, 'apk fixture');
  let runs = 0;
  const app = createApp({ adb: { listDevices: async () => [{ serial: 'REAL', state: 'device', model: 'Quest 3' }], run: async () => { runs++; return 'Success'; } }, releases: {}, picker: async () => null });
  try {
    const response = await request(app, 'POST', '/api/install', { gameId: 'hotd-vr', serial: 'OTHER', apkMode: 'local', apkPath, files: {} });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /connected/i);
    assert.equal(runs, 0);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('install API sends a local APK only to the selected headset', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'questdesk-test-'));
  const apkPath = path.join(temp, 'port.apk');
  await fs.writeFile(apkPath, 'apk fixture');
  const calls = [];
  const app = createApp({
    adb: {
      listDevices: async () => [{ serial: 'QUEST3', state: 'device' }, { serial: 'QUEST3S', state: 'device' }],
      run: async (args) => { calls.push(args); return 'Success'; },
    },
    releases: {}, picker: async () => null, inspectApkPackage: async () => 'org.timecrisis2.arcadevr',
  });
  try {
    const started = await request(app, 'POST', '/api/install', { gameId: 'dr89-time-crisis-2', serial: 'QUEST3S', apkMode: 'local', apkPath, files: {} });
    assert.equal(started.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const status = await request(app, 'GET', `/api/jobs/${started.body.job.id}`);
    assert.equal(status.body.job.status, 'success');
    const installs = calls.filter((args) => args.includes('install'));
    assert.equal(installs.length, 1);
    assert.deepEqual(installs[0].slice(0, 4), ['-s', 'QUEST3S', 'install', '-r']);
    assert.equal(installs[0][4], apkPath);
    assert.equal(await fs.readFile(installs[0][4], 'utf8'), 'apk fixture');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('install job does not report success when ADB push leaves the owned disc absent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-missing-transfer-'));
  const apkPath = path.join(root, 'port.apk');
  const disc = path.join(root, 'game.iso');
  const bytes = Buffer.alloc(64);
  bytes.write('GZ2E01');
  await fs.writeFile(apkPath, 'APK fixture');
  await fs.writeFile(disc, bytes);
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }], run: async (args) => {
      if (args.slice(2).join(' ') === 'shell pm list packages -3') return '';
      if (args[2] === 'shell' && args[3] === 'stat') throw new Error('No such file or directory');
      return 'Success';
    } },
    releases: {}, inspectApkPackage: async () => 'com.joeyaw.tpvr',
  });
  try {
    const started = await request(app, 'POST', '/api/install', { gameId: 'twilight-vr', serial: 'Q3', apkMode: 'local', apkPath, files: { disc } });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 30; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (!['queued', 'running'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, 'error');
    assert.match(job.error, /disc|transfer|headset/i);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('removed F-Zero alternate cannot be installed through the API', async () => {
  const calls = [];
  const app = createApp({
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }], run: async (args) => { calls.push(args); return 'Success'; } },
    releases: {},
  });
  try {
    const result = await request(app, 'POST', '/api/install', { gameId: 'fzero-x-vr', serial: 'Q3', apkMode: 'local', apkPath: 'C:\\old-port.apk', files: {} });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /game|catalog|unknown/i);
    assert.equal(calls.some((args) => args.includes('install')), false);
  } finally { app.server.close(); }
});

test('dropped game file is checked before it is accepted for install', async () => {
  const app = createApp({ adb: { listDevices: async () => [], run: async () => '' }, releases: {}, picker: async () => null });
  async function upload(bytes) {
    return new Promise((resolve) => {
      const req = Readable.from([bytes]);
      req.method = 'POST';
      req.url = '/api/upload?gameId=sm64-vr&itemId=rom&name=Super%20Mario%2064.z64';
      req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/octet-stream', 'x-questdesk-token': app.token };
      const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
      app.server.emit('request', req, res);
    });
  }
  const wrong = Buffer.alloc(64);
  wrong.writeUInt32BE(0x80371240, 0);
  wrong.write('NZSE', 0x3b);
  assert.match((await upload(wrong)).body.error, /does not match Super Mario 64/);
  wrong.write('NSME', 0x3b);
  const good = await upload(wrong);
  assert.equal(good.status, 200);
  assert.equal(good.body.verification.level, 'title');
  assert.deepEqual(await fs.readFile(good.body.path), wrong);
  await fs.rm(good.body.path, { force: true });
});

test('APK drop accepts the selected port and rejects an unrelated package', async () => {
  let packageId = 'com.some.other.game';
  const app = createApp({ adb: { listDevices: async () => [] }, inspectApkPackage: async () => packageId });
  const url = '/api/upload-apk?gameId=xrkart-64&name=XRKart-64-v0.2.0-Quest.apk';
  try {
    const wrong = await uploadRaw(app, url, Buffer.from('APK fixture'));
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /not XrKart 64/);
    packageId = 'com.n64vr.spaghettikart';
    const right = await uploadRaw(app, url, Buffer.from('APK fixture'));
    assert.equal(right.status, 200);
    assert.equal(right.body.verification.packageId, packageId);
    assert.deepEqual(await fs.readFile(right.body.path), Buffer.from('APK fixture'));
    await fs.rm(path.dirname(right.body.path), { recursive: true, force: true });
  } finally { app.server.close(); }
});

test('local game folder is staged only when it exists and contains files', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-stage-test-'));
  const app = createApp({ adb: { listDevices: async () => [], run: async () => '' }, releases: {}, picker: async () => null });
  const payload = { gameId: 'revolt-vr', itemId: 'game', path: temp };
  try {
    const empty = await request(app, 'POST', '/api/validate-file', payload);
    assert.equal(empty.status, 400);
    await fs.writeFile(path.join(temp, 'a.map'), 'map fixture');
    const valid = await request(app, 'POST', '/api/validate-file', payload);
    assert.equal(valid.status, 200);
    assert.equal(valid.body.verification.level, 'directory');
    const missing = await request(app, 'POST', '/api/validate-file', { ...payload, path: path.join(temp, 'missing') });
    assert.equal(missing.status, 400);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('AvP and UT99 reject incomplete retail folders before an install starts', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-pc-data-test-'));
  const app = createApp({ adb: { listDevices: async () => [], run: async () => '' }, releases: {}, picker: async () => null });
  try {
    const avp = path.join(temp, 'avp');
    await fs.mkdir(path.join(avp, 'AVP_RIFS'), { recursive: true });
    await fs.mkdir(path.join(avp, 'FASTFILE'));
    await fs.writeFile(path.join(avp, 'LANGUAGE.TXT'), 'gold fixture');
    await fs.writeFile(path.join(avp, 'AVP_RIFS', 'data.rif'), 'data');
    await fs.writeFile(path.join(avp, 'FASTFILE', 'data.ffl'), 'data');
    assert.equal((await request(app, 'POST', '/api/validate-file', { gameId: 'avp-vr', itemId: 'game', path: avp })).status, 200);
    const avpZip = path.join(temp, 'avp.zip');
    await runFile(path.join(__dirname, '..', 'vendor', '7zip', '7z.exe'), ['a', '-tzip', avpZip, '.'], { cwd: avp });
    assert.equal((await request(app, 'POST', '/api/validate-file', { gameId: 'avp-vr', itemId: 'game', path: avpZip })).status, 200);
    const ut = path.join(temp, 'ut');
    for (const folder of ['System', 'Maps', 'Textures', 'Sounds', 'Music']) {
      await fs.mkdir(path.join(ut, folder), { recursive: true });
      await fs.writeFile(path.join(ut, folder, 'placeholder'), 'data');
    }
    const input = { gameId: 'ut99-quest', itemId: 'game', path: ut };
    assert.match((await request(app, 'POST', '/api/validate-file', input)).body.error, /System\/Core.u/);
    for (const file of ['Core.u', 'Engine.u', 'Botpack.u']) await fs.writeFile(path.join(ut, 'System', file), 'package');
    assert.equal((await request(app, 'POST', '/api/validate-file', input)).status, 200);
    const utZip = path.join(temp, 'ut.zip');
    await runFile(path.join(__dirname, '..', 'vendor', '7zip', '7z.exe'), ['a', '-tzip', utZip, '.'], { cwd: ut });
    assert.equal((await request(app, 'POST', '/api/validate-file', { ...input, path: utZip })).status, 200);
    const wolf = path.join(temp, 'wolf');
    await fs.mkdir(wolf);
    assert.equal((await request(app, 'POST', '/api/validate-file', { gameId: 'wolfsharp', itemId: 'retail', path: wolf })).status, 400);
    await fs.mkdir(path.join(wolf, 'WL6'));
    await fs.writeFile(path.join(wolf, 'WL6', 'GAMEMAPS.WL6'), 'game');
    assert.equal((await request(app, 'POST', '/api/validate-file', { gameId: 'wolfsharp', itemId: 'retail', path: wolf })).status, 200);
  } finally { app.server.close(); await fs.rm(temp, { recursive: true, force: true }); }
});

test('AvP install unpacks a TAR of owned assets into its app folder when nested ADB pushes are blocked', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-avp-install-'));
  const quest = path.join(root, 'quest');
  const onQuest = (remote) => path.join(quest, remote);
  const appFiles = '/sdcard/Android/data/com.bassquake.quest.avpvr/files';
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const calls = [];
  async function remoteFiles(base, relative, lines) {
    const stat = await fs.stat(path.join(base, relative));
    if (stat.isFile()) { lines.push(`${stat.size} ${relative}`); return; }
    for (const name of await fs.readdir(path.join(base, relative))) await remoteFiles(base, `${relative}/${name}`, lines);
  }
  // Simulates the Quest: adb push into Android/data fails like secure_mkdirs does, while the shell can unpack there.
  const adb = {
    listDevices: async () => [{ serial: 'Q3-FAKE', state: 'device' }],
    run: async (args) => {
      calls.push(args);
      const [command, ...rest] = args.slice(3);
      if (args[2] === 'push') {
        const [source, destination] = args.slice(-2);
        if (destination.startsWith('/sdcard/Android/data/')) throw new Error(`adb: error: failed to copy '${source}' to '${destination}': remote secure_mkdirs() failed: Operation not permitted`);
        await fs.mkdir(path.dirname(onQuest(destination)), { recursive: true });
        await fs.copyFile(source, onQuest(destination));
      } else if (command === 'stat') return String((await fs.stat(onQuest(rest.at(-1).slice(1, -1)))).size);
      else if (command === 'mkdir') await fs.mkdir(onQuest(rest.at(-1)), { recursive: true });
      else if (command === 'tar') await runFile(tar, ['-xf', onQuest(rest[1]), '-C', onQuest(rest[3]), ...rest.slice(4)]);
      else if (command === 'rm') await fs.rm(onQuest(rest.at(-1)), { force: true });
      else if (command === 'cd') {
        const lines = [];
        for (const entry of rest.slice(3, rest.indexOf('-type'))) await remoteFiles(onQuest(rest[0].slice(1, -1)), entry.slice(1, -1), lines);
        return lines.join('\n');
      }
      return '';
    },
  };
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb, releases: {},
    builderRoots: { cacheRoot: path.join(root, 'cache'), workRoot: path.join(root, 'builds') },
    inspectApkPackage: async () => 'com.bassquake.quest.avpvr' });
  try {
    const source = path.join(root, 'owned');
    for (const folder of ['AVP_RIFS', 'FASTFILE']) {
      await fs.mkdir(path.join(source, folder, 'SUB'), { recursive: true });
      await fs.writeFile(path.join(source, folder, 'SUB', 'ASSET.DAT'), 'owned');
    }
    await fs.mkdir(path.join(source, 'User_Profiles'));
    await fs.writeFile(path.join(source, 'User_Profiles', 'PLAYER.PRF'), 'pc save');
    await fs.writeFile(path.join(source, 'AvP.exe'), 'windows exe');
    await fs.writeFile(path.join(source, 'default.cfg'), 'pc defaults');
    await fs.writeFile(path.join(source, 'LANGUAGE.TXT'), 'gold');
    const installed = onQuest(appFiles);
    await fs.mkdir(path.join(installed, 'user_profiles'), { recursive: true });
    await fs.writeFile(path.join(installed, 'user_profiles', 'player.prf'), 'quest save');
    await fs.writeFile(path.join(installed, 'default.cfg'), 'quest settings');
    const archive = path.join(root, 'game.zip');
    await runFile(path.join(__dirname, '..', 'vendor', '7zip', '7z.exe'), ['a', '-tzip', archive, '.'], { cwd: source });
    const apk = path.join(root, 'avp.apk');
    await fs.writeFile(apk, 'APK fixture');
    const started = await request(app, 'POST', '/api/install', { gameId: 'avp-vr', serial: 'Q3-FAKE', apkMode: 'local', apkPath: apk, files: { game: archive } });
    assert.equal(started.status, 202, started.body?.error);
    let job;
    for (let attempt = 0; attempt < 100; attempt++) {
      job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
      if (!['queued', 'running'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(job.status, 'success', job.error);
    const pushes = calls.filter((args) => args[2] === 'push');
    assert.equal(pushes.length, 1);
    const remoteArchive = pushes[0].at(-1);
    assert.match(remoteArchive, /^\/data\/local\/tmp\/vr4all-avp-[0-9a-f-]+\.tar$/);
    const step = (predicate) => calls.findIndex(predicate);
    const order = [step((args) => args.includes('monkey')), calls.indexOf(pushes[0]), step((args) => args[3] === 'tar'),
      step((args) => args[3] === 'cd' && args.includes('find')), step((args) => args[3] === 'rm' && args.at(-1) === remoteArchive)];
    assert.ok(order[0] > -1 && order.every((value, index) => index === 0 || value > order[index - 1]), JSON.stringify(order));
    assert.deepEqual(calls[order[2]].slice(3), ['tar', '-xf', remoteArchive, '-C', appFiles, '--exclude', 'default.cfg']);
    assert.deepEqual((await fs.readdir(installed)).sort(), ['avp_rifs', 'default.cfg', 'fastfile', 'language.txt', 'user_profiles']);
    assert.equal(await fs.readFile(path.join(installed, 'avp_rifs', 'sub', 'asset.dat'), 'utf8'), 'owned');
    assert.equal(await fs.readFile(path.join(installed, 'fastfile', 'sub', 'asset.dat'), 'utf8'), 'owned');
    assert.equal(await fs.readFile(path.join(installed, 'language.txt'), 'utf8'), 'gold');
    assert.deepEqual(await fs.readdir(path.join(installed, 'user_profiles')), ['player.prf']);
    assert.equal(await fs.readFile(path.join(installed, 'user_profiles', 'player.prf'), 'utf8'), 'quest save');
    assert.equal(await fs.readFile(path.join(installed, 'default.cfg'), 'utf8'), 'quest settings');
    assert.deepEqual(await fs.readdir(onQuest('/data/local/tmp')), []);
    assert.equal(await fs.readFile(path.join(source, 'LANGUAGE.TXT'), 'utf8'), 'gold');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('custom game appears in the library with its own destination', async () => {
  const app = createApp({ adb: { listDevices: async () => [], run: async () => '' }, releases: {}, picker: async () => null });
  const response = await request(app, 'POST', '/api/custom-games', {
    title: 'My Port', repo: '', assetPattern: '', console: 'PC', genre: 'Adventure', dataLabel: 'Game archive', extensions: '.zip', destination: '/sdcard/Download/',
  });
  assert.equal(response.status, 201);
  const library = await request(app, 'GET', '/api/catalog');
  const game = library.body.games.find((item) => item.id === response.body.game.id);
  assert.equal(game.title, 'My Port');
  assert.equal(game.console, 'PC');
  assert.equal(game.genre, 'Adventure');
  assert.equal(game.art, '/art/custom.svg');
  assert.deepEqual(game.data[0].extensions, ['.zip']);
  assert.equal(game.data[0].destination, '/sdcard/Download/');
});

test('installed Super Mario 64 accepts an APK update without another ROM, but a fresh install does not', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-update-test-'));
  const apkPath = path.join(temp, 'port.apk');
  await fs.writeFile(apkPath, 'apk fixture');
  let installed = true;
  const calls = [];
  const app = createApp({ adb: {
    listDevices: async () => [{ serial: 'QUEST3', state: 'device' }],
    run: async (args) => {
      calls.push(args);
      if (args.includes('packages')) return installed ? 'package:com.fulldivegames.sm64coopdxvr' : '';
      if (args.includes('dumpsys')) return 'versionName=1.0.0';
      if (args.includes('ls')) return 'Super Mario 64.z64';
      return 'Success';
    },
  }, releases: {}, picker: async () => null, inspectApkPackage: async () => 'com.fulldivegames.sm64coopdxvr' });
  try {
    const payload = { gameId: 'sm64-vr', serial: 'QUEST3', apkMode: 'local', apkPath, files: {} };
    const update = await request(app, 'POST', '/api/install', payload);
    assert.equal(update.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const installs = calls.filter((args) => args.includes('install'));
    assert.equal(installs.length, 1);
    assert.deepEqual(installs[0].slice(0, 4), ['-s', 'QUEST3', 'install', '-r']);
    assert.equal(installs[0][4], apkPath);
    assert.equal(await fs.readFile(installs[0][4], 'utf8'), 'apk fixture');
    installed = false;
    const fresh = await request(app, 'POST', '/api/install', payload);
    assert.equal(fresh.status, 400);
    assert.match(fresh.body.error, /Select Super Mario 64 USA ROM/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
