const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApp } = require('../server');

function request(app, method, url, input, authenticated = true) {
  return new Promise((resolve) => {
    const req = Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
    req.method = method; req.url = url;
    req.headers = { host: '127.0.0.1:4173', ...(authenticated ? { 'x-questdesk-token': app.token } : {}) };
    app.server.emit('request', req, { writeHead(status) { this.status = status; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } });
  });
}
async function finished(app, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { body } = await request(app, 'GET', `/api/jobs/${id}`);
    if (['success', 'error'].includes(body.job.status)) return body.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Phone export did not finish');
}

test('RDR readiness is authenticated, read-only and blocked while its phone is busy', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.readiness-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let release;
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), downloadsPath: root,
    phoneChecker: async (gameId, input) => {
      assert.equal(gameId, 'rdr1-vr'); assert.equal(input.edition, 'netflix');
      return { status: 'additional-data-required', canExport: false, apkCount: 3, missing: ['assets/game/audio_android.rpf'] };
    },
    phoneExporter: async () => { await new Promise((resolve) => { release = resolve; }); throw new Error('fixture stopped'); },
  });
  t.after(() => app.server.close());
  const input = { gameId: 'rdr1-vr', serial: 'PHONE', edition: 'netflix' };
  assert.equal((await request(app, 'POST', '/api/phone-export/check', input, false)).status, 403);
  assert.equal((await request(app, 'POST', '/api/phone-export/check', { ...input, gameId: 'gta-sa-vr' })).status, 400);
  const checked = await request(app, 'POST', '/api/phone-export/check', input);
  assert.equal(checked.status, 200);
  assert.equal(checked.body.readiness.canExport, false);
  assert.equal((await request(app, 'GET', '/api/jobs')).body.jobs.length, 0);
  assert.deepEqual(await fs.readdir(root), []);
  const started = await request(app, 'POST', '/api/phone-export', { ...input, downloadLocation: root });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await request(app, 'POST', '/api/phone-export/check', input)).status, 409);
  release(); await finished(app, started.body.job.id);
});

test('phones appear in the export list while Quest alone remains an install target', async (t) => {
  const app = createApp({ adb: {
    listDevices: async () => [{ serial: 'QUEST', state: 'device', model: 'Quest 3' }, { serial: 'PHONE', state: 'device', model: 'Pixel 8' }],
    run: async (args) => args[1] === 'QUEST' ? args.at(-1).endsWith('model') ? 'Quest 3' : 'Oculus' : args.at(-1).endsWith('model') ? 'Pixel 8' : 'Google',
  } });
  t.after(() => app.server.close());
  const phones = await request(app, 'GET', '/api/phone-export/devices');
  assert.equal(phones.status, 200);
  assert.deepEqual(phones.body.devices.map((device) => device.serial), ['PHONE']);
  const headsets = await request(app, 'GET', '/api/devices');
  assert.deepEqual(headsets.body.devices.map((device) => device.serial), ['QUEST']);
});

for (const gameId of ['rdr1-vr', 'gta-sa-vr']) {
  test(`${gameId} export is token protected, locks its source and remembers the result without marking it installed`, async (t) => {
    const root = await fs.mkdtemp(path.join(__dirname, '.phone-api-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let release;
    const app = createApp({ settingsPath: path.join(root, 'settings.json'), downloadsPath: root,
      adb: { listDevices: async () => [] },
      phoneExporter: async (selectedGameId, input) => {
        assert.equal(selectedGameId, gameId);
        assert.equal(input.serial, 'PHONE');
        assert.equal(input.downloadLocation, root);
        await new Promise((resolve) => { release = resolve; });
        const gamePackage = path.join(root, 'exported game');
        await fs.mkdir(gamePackage); await fs.writeFile(path.join(gamePackage, 'base.apk'), 'owned fixture');
        return { gamePackage };
      },
    });
    t.after(() => app.server.close());
    const input = { gameId, serial: 'PHONE', downloadLocation: root };
    assert.equal((await request(app, 'POST', '/api/phone-export', input, false)).status, 403);
    assert.equal((await request(app, 'POST', '/api/phone-export', { ...input, gameId: 'vice-city-vr' })).status, 400);
    const started = await request(app, 'POST', '/api/phone-export', input);
    assert.equal(started.status, 202);
    assert.equal(started.body.job.kind, 'phone-export');
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await request(app, 'POST', '/api/phone-export', input)).status, 409);
    release();
    const job = await finished(app, started.body.job.id);
    assert.equal(job.status, 'success', job.error);
    assert.equal(job.exportPath, path.join(root, 'exported game'));
    const settings = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8'));
    assert.equal(settings.localPaths[gameId].gamePackage, job.exportPath);
    assert.deepEqual(settings.installed, {});
    const location = await request(app, 'POST', '/api/phone-export/location', { gameId });
    assert.equal(location.body.downloadLocation, root);
  });
}

test('failed export keeps an existing game path and can be retried', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-api-fail-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previous = path.join(root, 'owned.apk'); await fs.writeFile(previous, 'owned');
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ localPaths: { 'rdr1-vr': { gamePackage: previous } } }));
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), adb: { listDevices: async () => [] }, phoneExporter: async () => { throw new Error('The phone needs to finish downloading the game'); } });
  t.after(() => app.server.close());
  const input = { gameId: 'rdr1-vr', serial: 'PHONE', downloadLocation: root };
  const preview = await request(app, 'POST', '/api/phone-export/location', { gameId: 'rdr1-vr', gamePackage: previous });
  assert.equal(preview.body.downloadLocation, root);
  const started = await request(app, 'POST', '/api/phone-export', input);
  const job = await finished(app, started.body.job.id);
  assert.equal(job.status, 'error'); assert.match(job.error, /finish downloading/);
  const settings = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8'));
  assert.equal(settings.localPaths['rdr1-vr'].gamePackage, previous);
  const retry = await request(app, 'POST', '/api/phone-export', input);
  assert.equal(retry.status, 202);
  await finished(app, retry.body.job.id);
});

test('RDR edition choice reaches the exporter and unsupported editions never start work', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.phone-edition-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let selected;
  const app = createApp({ phoneExporter: async (_gameId, input) => {
    selected = input.edition;
    const gamePackage = path.join(root, 'netflix-export');
    await fs.mkdir(gamePackage); await fs.writeFile(path.join(gamePackage, 'base.apk'), 'fixture');
    return { gamePackage, edition: 'netflix', packageId: 'com.netflix.NGP.Kamo' };
  } });
  t.after(() => app.server.close());
  const input = { gameId: 'rdr1-vr', serial: 'PHONE', downloadLocation: root, edition: 'netflix' };
  assert.equal((await request(app, 'POST', '/api/phone-export', { ...input, edition: 'other-package' })).status, 400);
  assert.equal((await request(app, 'POST', '/api/phone-export', { ...input, gameId: 'gta-sa-vr' })).status, 400);
  assert.equal(selected, undefined);
  const started = await request(app, 'POST', '/api/phone-export', input);
  const job = await finished(app, started.body.job.id);
  assert.equal(job.status, 'success', job.error);
  assert.equal(selected, 'netflix');
  assert.equal(job.edition, 'netflix');
  assert.equal(job.sourceEdition, 'netflix');
});
