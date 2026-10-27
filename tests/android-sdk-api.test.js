const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { createApp } = require('../server');

function request(app, method, url, data, authenticated = true) {
  return new Promise((resolve) => {
    const req = Readable.from(data === undefined ? [] : [JSON.stringify(data)]);
    req.method = method; req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/json', ...(authenticated ? { 'x-questdesk-token': app.token } : {}) };
    const res = { writeHead(status) { this.status = status; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } };
    app.server.emit('request', req, res);
  });
}

async function waitJob(app, id, predicate = (job) => ['success', 'error'].includes(job.status)) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { body } = await request(app, 'GET', `/api/jobs/${id}`);
    if (predicate(body.job)) return body.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Setup job did not reach the expected state');
}

test('tool setup needs no headset, waits for the exact license decision and never marks the game installed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let decisions = 0;
  const app = createApp({ settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => { throw new Error('Setup must not contact a headset'); } },
    sdkSetup: async (_roots, log, onLicense) => {
      log('Preparing SDK');
      const accepted = await onLicense('Google license terms <text>');
      decisions++;
      assert.equal(accepted, true);
      log('Tools installed');
      return { sha: 'a'.repeat(40) };
    },
  });
  t.after(() => app.server.close());
  assert.equal((await request(app, 'POST', '/api/build-tools', { gameId: 'vice-city-vr' }, false)).status, 403);
  assert.equal((await request(app, 'POST', '/api/build-tools', { gameId: 'crazy-taxi-vr' })).status, 400);
  const started = await request(app, 'POST', '/api/build-tools', { gameId: 'vice-city-vr', downloadLocation: root });
  assert.equal(started.status, 202);
  const job = await waitJob(app, started.body.job.id, (entry) => Boolean(entry.license));
  assert.equal(job.kind, 'build-tools');
  assert.equal(job.license.text, 'Google license terms <text>');
  assert.equal(decisions, 0);
  const route = `/api/build-tools/${job.id}/license`;
  assert.equal((await request(app, 'POST', route, { licenseId: 'stale', accepted: true })).status, 409);
  assert.equal((await request(app, 'POST', route, { licenseId: job.license.id, accepted: true }, false)).status, 403);
  assert.equal(decisions, 0);
  assert.equal((await request(app, 'POST', '/api/build-tools', { gameId: 'vice-city-vr' })).status, 409);
  assert.equal((await request(app, 'POST', '/api/personal-build', { gameId: 'vice-city-vr' })).status, 409);
  assert.equal((await request(app, 'POST', route, { licenseId: job.license.id, accepted: true })).status, 200);
  const completed = await waitJob(app, job.id);
  assert.equal(completed.status, 'success', completed.error);
  assert.equal(completed.license, null);
  assert.equal(decisions, 1);
  const saved = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8'));
  assert.deepEqual(saved.installed, {});
  assert.equal((await request(app, 'POST', route, { licenseId: job.license.id, accepted: true })).status, 409);
});

test('declining a displayed license ends setup and releases the game setup lock', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-decline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const answers = [];
  const app = createApp({ sdkSetup: async (_roots, _log, onLicense) => {
    const accepted = await onLicense('Declinable Google terms');
    answers.push(accepted);
    if (!accepted) throw new Error('License was not accepted');
    return { sha: 'a'.repeat(40) };
  } });
  const started = await request(app, 'POST', '/api/build-tools', { gameId: 'vice-city-vr', downloadLocation: root });
  assert.equal(started.status, 202);
  const job = await waitJob(app, started.body.job.id, (entry) => Boolean(entry.license));
  assert.equal((await request(app, 'POST', `/api/build-tools/${job.id}/license`, { licenseId: job.license.id, accepted: false })).status, 200);
  assert.equal((await waitJob(app, job.id)).status, 'error');
  assert.deepEqual(answers, [false]);
  const restarted = await request(app, 'POST', '/api/build-tools', { gameId: 'vice-city-vr', downloadLocation: root });
  assert.equal(restarted.status, 202);
  const pending = await waitJob(app, restarted.body.job.id, (entry) => Boolean(entry.license));
  await request(app, 'POST', `/api/build-tools/${pending.id}/license`, { licenseId: pending.license.id, accepted: false });
  await waitJob(app, pending.id);
  app.server.close();
});

test('location preview defaults to the game folder or archive parent without starting downloads', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-location-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const game = path.join(root, 'Vice City');
  const archive = path.join(root, 'Vice City.zip');
  await fs.mkdir(game);
  await fs.writeFile(archive, 'fixture');
  const app = createApp({ sdkSetup: async () => { throw new Error('Preview must not download'); } });
  t.after(() => app.server.close());
  for (const [gamePackage, expected] of [[game, game], [archive, root], ['', '']]) {
    const preview = await request(app, 'POST', '/api/build-tools/location', { gameId: 'vice-city-vr', gamePackage });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.downloadLocation, expected);
    assert.equal(preview.body.configured, false);
  }
  assert.deepEqual((await request(app, 'GET', '/api/jobs')).body.jobs, []);
  assert.deepEqual((await fs.readdir(root)).sort(), ['Vice City', 'Vice City.zip']);
});

test('setup requires an existing absolute download folder before it can queue work', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-invalid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'not-a-folder');
  await fs.writeFile(file, 'fixture');
  const app = createApp({ sdkSetup: async () => { throw new Error('Invalid path must not download'); } });
  t.after(() => app.server.close());
  for (const downloadLocation of [undefined, '', 'relative', path.join(root, 'missing'), file]) {
    const result = await request(app, 'POST', '/api/build-tools', { gameId: 'vice-city-vr', downloadLocation });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /folder|location/i);
  }
  assert.deepEqual((await request(app, 'GET', '/api/jobs')).body.jobs, []);
});

test('Browse can recover from an unavailable saved drive without blocking the picker', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-picker-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let selectedDefault = 'not called';
  const app = createApp({ picker: async (kind, defaultPath) => { assert.equal(kind, 'directory'); selectedDefault = defaultPath; return root; } });
  t.after(() => app.server.close());
  const result = await request(app, 'POST', '/api/pick', { kind: 'directory', defaultPath: path.join(root, 'disconnected-drive') });
  assert.equal(result.status, 200);
  assert.equal(result.body.path, root);
  assert.equal(selectedDefault, undefined);
});

test('the chosen location is reused by Vice City builds after restarting the app', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-remember-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const location = path.join(root, 'Other drive');
  const game = path.join(root, 'Owned');
  await fs.mkdir(location);
  for (const name of ['data', 'TEXT', 'anim', 'txd', 'skins', 'mp3', 'movies', 'models', 'Audio']) await fs.mkdir(path.join(game, name), { recursive: true });
  const settingsPath = path.join(root, 'profile', 'settings.json');
  const expected = { cacheRoot: path.join(location, 'VR4ALL-build-tools', 'source-kits'), workRoot: path.join(location, 'VR4ALL-build-tools', 'builds') };
  let setupRoots;
  const app = createApp({ settingsPath, sdkSetup: async (roots) => { setupRoots = roots; return { sha: 'a'.repeat(40) }; } });
  t.after(() => app.server.close());
  const started = await request(app, 'POST', '/api/build-tools', { gameId: 'vice-city-vr', downloadLocation: location });
  assert.equal(started.status, 202);
  assert.equal((await waitJob(app, started.body.job.id)).status, 'success');
  assert.deepEqual(setupRoots, expected);
  let buildRoots;
  const restarted = createApp({ settingsPath,
    adb: { listDevices: async () => [{ serial: 'Quest-1', state: 'device' }] },
    viceCityBuilder: async (_input, roots) => { buildRoots = roots; return { sha: 'a'.repeat(40) }; },
  });
  t.after(() => restarted.server.close());
  const preview = await request(restarted, 'POST', '/api/build-tools/location', { gameId: 'vice-city-vr', gamePackage: game });
  assert.equal(preview.body.downloadLocation, location);
  assert.equal(preview.body.configured, true);
  const built = await request(restarted, 'POST', '/api/personal-build', { gameId: 'vice-city-vr', gamePackage: game, serial: 'Quest-1' });
  assert.equal(built.status, 202);
  assert.equal((await waitJob(restarted, built.body.job.id)).status, 'success');
  assert.deepEqual(buildRoots, expected);
});

for (const [gameId, title] of [['rdr1-vr', 'Red Dead Redemption'], ['gta-sa-vr', 'GTA: San Andreas']]) {
test(`${title} setup displays its license, locks builds, and reuses its chosen tools folder`, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-rdr-sdk-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gamePackage = path.join(root, 'owned.xapk');
  await fs.writeFile(gamePackage, 'owned fixture');
  const audioSource = path.join(root, 'audio.7z');
  await fs.writeFile(audioSource, 'audio fixture');
  let setupRoots;
  let setupGame;
  let buildRoots;
  const app = createApp({
    settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'Quest-1', state: 'device' }] },
    sdkSetup: async (roots, _log, onLicense, options) => {
      setupRoots = roots; setupGame = options.gameId;
      assert.equal(await onLicense('RDR SDK license terms'), true);
      return { sha: 'a'.repeat(40) };
    },
    personalBuilder: async (selectedId, input, roots) => { assert.equal(selectedId, gameId); if (gameId === 'gta-sa-vr') assert.equal(input.audioSource, audioSource); buildRoots = roots; return { sha: 'a'.repeat(40) }; },
  });
  t.after(() => app.server.close());
  const preview = await request(app, 'POST', '/api/build-tools/location', { gameId, gamePackage });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.downloadLocation, root);
  const started = await request(app, 'POST', '/api/build-tools', { gameId, downloadLocation: root });
  assert.equal(started.status, 202);
  const job = await waitJob(app, started.body.job.id, (entry) => Boolean(entry.license));
  assert.equal(job.gameId, gameId);
  assert.ok(job.title.includes(title));
  assert.equal((await request(app, 'POST', '/api/personal-build', { gameId, gamePackage, audioSource, serial: 'Quest-1' })).status, 409);
  assert.equal((await request(app, 'POST', `/api/build-tools/${job.id}/license`, { licenseId: job.license.id, accepted: true })).status, 200);
  assert.equal((await waitJob(app, job.id)).status, 'success');
  const built = await request(app, 'POST', '/api/personal-build', { gameId, gamePackage, audioSource, serial: 'Quest-1' });
  assert.equal(built.status, 202);
  assert.equal((await waitJob(app, built.body.job.id)).status, 'success');
  assert.equal(setupGame, gameId);
  assert.deepEqual(setupRoots, { cacheRoot: path.join(root, 'VR4ALL-build-tools', 'source-kits'), workRoot: path.join(root, 'VR4ALL-build-tools', 'builds') });
  assert.deepEqual(buildRoots, setupRoots);
});
}

test('a saved shared tools folder becomes the default for the other games after restart', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-shared-location-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const settingsPath = path.join(root, 'settings.json');
  const game = path.join(root, 'another game');
  await fs.mkdir(game);
  const app = createApp({ settingsPath, sdkSetup: async () => ({ sha: 'a'.repeat(40) }) });
  t.after(() => app.server.close());
  const start = await request(app, 'POST', '/api/build-tools', { gameId: 'rdr1-vr', downloadLocation: root });
  assert.equal((await waitJob(app, start.body.job.id)).status, 'success');
  const restarted = createApp({ settingsPath });
  t.after(() => restarted.server.close());
  for (const gameId of ['vice-city-vr', 'gta-sa-vr']) {
    const preview = await request(restarted, 'POST', '/api/build-tools/location', { gameId, gamePackage: game });
    assert.equal(preview.body.downloadLocation, root, 'reuse the existing tools folder instead of starting another cache beside this game');
    assert.equal(preview.body.configured, true);
  }
});
