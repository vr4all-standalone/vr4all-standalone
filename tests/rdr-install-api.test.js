const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApp } = require('../server');

function request(app, method, url, input) {
  return new Promise((resolve) => {
    const req = Readable.from(input === undefined ? [] : [JSON.stringify(input)]);
    req.method = method; req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'x-questdesk-token': app.token };
    app.server.emit('request', req, { writeHead(status) { this.status = status; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } });
  });
}
async function finished(app, id) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { body } = await request(app, 'GET', `/api/jobs/${id}`);
    if (['success', 'error'].includes(body.job.status)) return body.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('RDR job did not finish');
}

test('RDR API blocks an offline selected Quest before building and permits retry after Wi-Fi connects', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.rdr-network-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const settingsPath = path.join(root, 'settings.json');
  const gamePackage = path.join(root, 'original.apkm'); await fs.writeFile(gamePackage, 'owned');
  let online = false, builds = 0;
  const app = createApp({ settingsPath, adb: {
    listDevices: async () => [{ serial: 'SELECTED', state: 'device' }, { serial: 'PRESERVED', state: 'device' }],
    run: async (args) => {
      assert.deepEqual(args, ['-s', 'SELECTED', 'shell', 'dumpsys', 'connectivity']);
      return online ? 'Active default network: 101\nCurrent Networks:\n  NetworkAgentInfo{network{101} nc{[ Capabilities: INTERNET&VALIDATED ]}}'
        : 'Active default network: none';
    },
  }, personalBuilder: async () => { builds++; return { sha: 'a'.repeat(40) }; } });
  t.after(() => app.server.close());
  const input = { gameId: 'rdr1-vr', serial: 'SELECTED', gamePackage };
  let response = await request(app, 'POST', '/api/personal-build', input);
  assert.equal(response.status, 202);
  const offline = await finished(app, response.body.job.id);
  assert.equal(offline.status, 'error'); assert.match(offline.error, /Wi-Fi/);
  assert.equal(builds, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')).installed, {});
  online = true;
  response = await request(app, 'POST', '/api/personal-build', input);
  const success = await finished(app, response.body.job.id);
  assert.equal(success.status, 'success', success.error);
  assert.equal(success.internetStatus, 'online'); assert.match(success.afterInstall, /Wi-Fi.*Netflix/);
  assert.equal(builds, 1);
  const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.equal(saved.jobHistory[0].afterInstall, success.afterInstall);
  assert.equal(saved.installed.PRESERVED, undefined);
});

test('GTA SA builds without RDR connectivity checks', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.gta-network-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gamePackage = path.join(root, 'original.apk'), audioSource = path.join(root, 'audio.zip');
  await fs.writeFile(gamePackage, 'owned'); await fs.writeFile(audioSource, 'owned audio');
  let builds = 0;
  const app = createApp({ adb: { listDevices: async () => [{ serial: 'QUEST', state: 'device' }], run: async () => { throw new Error('RDR diagnostic must not run'); } },
    personalBuilder: async () => { builds++; return { sha: 'a'.repeat(40) }; } });
  t.after(() => app.server.close());
  const started = await request(app, 'POST', '/api/personal-build', { gameId: 'gta-sa-vr', serial: 'QUEST', gamePackage, audioSource });
  assert.equal((await finished(app, started.body.job.id)).status, 'success');
  assert.equal(builds, 1);
});

test('RDR phone-export API validates, passes and remembers explicit supplemental data', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.rdr-supplement-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const audioSource = path.join(root, 'owned-data.apks'); await fs.writeFile(audioSource, 'resource fixture');
  const app = createApp({ settingsPath: path.join(root, 'settings.json'), phoneExporter: async (gameId, input) => {
    assert.equal(gameId, 'rdr1-vr'); assert.equal(input.audioSource, audioSource);
    const gamePackage = path.join(root, 'fresh-export'); await fs.mkdir(gamePackage); await fs.writeFile(path.join(gamePackage, 'base.apk'), 'fresh phone APK');
    return { gamePackage, edition: 'netflix', packageId: 'com.netflix.NGP.Kamo' };
  } });
  t.after(() => app.server.close());
  const input = { gameId: 'rdr1-vr', serial: 'PHONE', downloadLocation: root, audioSource };
  assert.equal((await request(app, 'POST', '/api/phone-export', { ...input, audioSource: `${audioSource}.missing` })).status, 400);
  const started = await request(app, 'POST', '/api/phone-export', input);
  assert.equal(started.status, 202);
  const result = await finished(app, started.body.job.id);
  assert.equal(result.status, 'success', result.error);
  assert.equal(result.additionalDataSource, audioSource);
  assert.match(result.log.join('\n'), /Additional RDR game data:/);
  const saved = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8'));
  assert.equal(saved.localPaths['rdr1-vr'].audioSource, audioSource);
  assert.equal(saved.localPaths['rdr1-vr'].gamePackage, result.exportPath);
  const preview = await request(app, 'POST', '/api/phone-export/location', { gameId: 'rdr1-vr' });
  assert.equal(preview.body.additionalDataSource, audioSource);
});
