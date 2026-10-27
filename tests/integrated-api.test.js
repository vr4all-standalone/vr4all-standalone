const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApp } = require('../server');

function request(app, url, payload) {
  return new Promise((resolve) => {
    const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
    req.method = payload === undefined ? 'GET' : 'POST';
    req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/json', 'x-questdesk-token': app.token };
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
    app.server.emit('request', req, res);
  });
}

async function settledJob(app, id) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const job = (await request(app, `/api/jobs/${id}`)).body.job;
    if (job && !['queued', 'running'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Install job did not settle');
}

test('build workspace defaults to AppData path and can be changed or reset', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-workspace-setting-'));
  const selected = path.join(root, 'selected builds');
  const defaultRoot = path.join(root, 'builds');
  await fs.mkdir(selected);
  const options = { settingsPath: path.join(root, 'settings.json'), builderRoots: { cacheRoot: path.join(root, 'source-kits'), workRoot: defaultRoot },
    adb: { listDevices: async () => [] } };
  try {
    const first = createApp(options);
    assert.equal((await request(first, '/api/settings')).body.buildWorkspace, defaultRoot);
    assert.equal((await request(first, '/api/settings', { adbPath: '', sources: {}, buildWorkspace: selected })).status, 200);
    first.server.close();
    const reopened = createApp(options);
    assert.equal((await request(reopened, '/api/settings')).body.buildWorkspace, selected);
    assert.equal((await request(reopened, '/api/settings', { adbPath: '', sources: {}, buildWorkspace: 'relative' })).status, 400);
    assert.equal((await request(reopened, '/api/settings', { adbPath: '', sources: {}, buildWorkspace: '' })).status, 200);
    assert.equal((await request(reopened, '/api/settings')).body.buildWorkspace, defaultRoot);
    reopened.server.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('saved install history cannot authorize an APK-only update after Quest data disappears', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-gate-'));
  const settingsPath = path.join(root, 'settings.json');
  await fs.writeFile(settingsPath, JSON.stringify({ installed: { Q3: { galaxyquest: { packageId: 'com.galaxy.quest', tag: 'v0.1.9' } } } }));
  const adb = { listDevices: async () => [{ serial: 'Q3', state: 'device' }], run: async (args) => {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.galaxy.quest';
    if (command.startsWith('shell dumpsys package ')) return 'versionName=0.1.9';
    return '';
  } };
  const app = createApp({ settingsPath, adb });
  try {
    const response = await request(app, '/api/galaxyquest-install', { gameId: 'galaxyquest', serial: 'Q3' });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /Super Mario Galaxy/);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('GalaxyQuest logs rejected install inputs before a job exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-galaxy-rejected-'));
  const settingsPath = path.join(root, 'settings.json');
  const app = createApp({ settingsPath,
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }], run: async () => '' },
  });
  try {
    const response = await request(app, '/api/galaxyquest-install', { gameId: 'galaxyquest', serial: 'Q3', gamePath: path.join(root, 'missing.rvz') });
    assert.equal(response.status, 400);
    const log = await fs.readFile(path.join(root, 'install-jobs.txt'), 'utf8');
    assert.match(log, /REJECTED.*GalaxyQuest/);
    assert.match(log, /Choose a regular disc image|Choose valid gamePath game files/);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('GalaxyQuest APK-only update does not check or download the unused Windows converter', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-update-'));
  const settingsPath = path.join(root, 'settings.json');
  const apk = path.join(root, 'GalaxyQuest.apk');
  await fs.writeFile(apk, 'test APK');
  const releases = [];
  let installerInput;
  const app = createApp({ settingsPath,
    adb: { listDevices: async () => [{ serial: 'Q3', state: 'device' }], run: async (args) => {
      const command = args.slice(2).join(' ');
      if (command === 'shell pm list packages -3') return 'package:com.galaxy.quest';
      if (command.startsWith('shell dumpsys package ')) return 'versionName=0.1.9';
      if (command === 'shell ls -1 /sdcard/Android/data/com.galaxy.quest/files/game') return 'ObjectData\nvr4all-transfer.complete';
      return '';
    } },
    releases: { latest: async (source) => { releases.push(source); if (source.assetPattern?.includes('windows')) throw new Error('Converter unavailable'); return { tag: 'v0.1.9', url: 'https://example.test/release', assetName: 'GalaxyQuest.apk' }; }, download: async () => apk },
    galaxyQuestInstaller: async (input) => { installerInput = input; return { packageId: 'com.galaxy.quest', updatedOnly: true }; },
  });
  try {
    const response = await request(app, '/api/galaxyquest-install', { gameId: 'galaxyquest', serial: 'Q3' });
    assert.equal(response.status, 202, JSON.stringify(response.body));
    const job = await settledJob(app, response.body.job.id);
    assert.equal(job.status, 'success', job.error);
    assert.equal(releases.length, 1);
    assert.equal(installerInput.converterPath, null);
    assert.match(job.log.join(' '), /APK updated; existing game files/);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});
