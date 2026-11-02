const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApp } = require('../server');
const { inspectDevice } = require('../src/device-library');
const { getCatalog } = require('../src/catalog');

function request(app, method, url, payload, authorized = true) {
  return new Promise((resolve) => {
    const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
    req.method = method;
    req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/json' };
    if (authorized) req.headers['x-questdesk-token'] = app.token;
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null }); } };
    app.server.emit('request', req, res);
  });
}

test('uninstall removes only the selected Quest package, clears shared install receipts, and keeps PC paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-uninstall-'));
  const settingsPath = path.join(root, 'settings.json');
  await fs.writeFile(settingsPath, JSON.stringify({
    localPaths: { 'hotd2-dreamcast-vr': { disc: 'C:\\Owned\\hotd2.chd' } },
    installed: { QUEST: {
      'hotd2-dreamcast-vr': { packageId: 'com.flycast.emulator.vr', tag: 'v1' },
      'mok-upstream-vr': { packageId: 'com.flycast.emulator.vr', tag: 'v1' },
      'hotd-vr': { packageId: 'io.port0r.houseofthedead', tag: 'v1' },
    } },
  }));
  const calls = [];
  let installed = true;
  const adb = {
    listDevices: async () => [{ serial: 'QUEST', state: 'device' }],
    run: async (args) => {
      calls.push(args);
      if (args[2] === 'uninstall') { installed = false; return 'Success'; }
      if (args.slice(2, 6).join(' ') === 'shell pm list packages') return installed ? 'package:com.flycast.emulator.vr\npackage:io.port0r.houseofthedead' : 'package:io.port0r.houseofthedead';
      if (args.slice(2, 5).join(' ') === 'shell dumpsys package') return 'versionName=1.0';
      return '';
    },
  };
  const app = createApp({ settingsPath, adb });
  try {
    const result = await request(app, 'POST', '/api/uninstall', { gameId: 'hotd2-dreamcast-vr', serial: 'QUEST', packageId: 'com.flycast.emulator.vr' });
    assert.equal(result.status, 200, result.body?.error);
    assert.deepEqual(result.body.removedGameIds.sort(), ['hotd2-dreamcast-vr', 'mok-upstream-vr']);
    assert.ok(calls.some((args) => args.join(' ') === '-s QUEST uninstall com.flycast.emulator.vr'));
    assert.ok(!calls.some((args) => /\brm\b|push|install -r/.test(args.join(' '))));
    const saved = JSON.parse(await fs.readFile(settingsPath));
    assert.deepEqual(Object.keys(saved.installed.QUEST), ['hotd-vr']);
    assert.equal(saved.localPaths['hotd2-dreamcast-vr'].disc, 'C:\\Owned\\hotd2.chd');
    const second = await request(app, 'POST', '/api/uninstall', { gameId: 'hotd2-dreamcast-vr', serial: 'QUEST', packageId: 'com.flycast.emulator.vr' });
    assert.equal(second.status, 400, 'repeat uninstall should not claim success');
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('uninstall rejects missing authorization, other headsets, and a package that differs from the fresh scan', async () => {
  const calls = [];
  const app = createApp({ adb: {
    listDevices: async () => [{ serial: 'QUEST', state: 'device' }],
    run: async (args) => { calls.push(args); return args.includes('packages') ? 'package:io.port0r.houseofthedead' : ''; },
  } });
  try {
    const input = { gameId: 'hotd-vr', serial: 'QUEST', packageId: 'com.other.app' };
    assert.equal((await request(app, 'POST', '/api/uninstall', input, false)).status, 403);
    assert.equal((await request(app, 'POST', '/api/uninstall', { ...input, serial: 'OTHER' })).status, 400);
    assert.equal((await request(app, 'POST', '/api/uninstall', input)).status, 400);
    assert.ok(!calls.some((args) => args.includes('uninstall')));
  } finally { app.server.close(); }
});

test('a fresh headset scan forgets an old install receipt after the app was removed in Quest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-uninstall-scan-'));
  const settingsPath = path.join(root, 'settings.json');
  await fs.writeFile(settingsPath, JSON.stringify({ installed: { QUEST: { 'hotd-vr': { packageId: 'io.port0r.houseofthedead', tag: 'v1' } } } }));
  const app = createApp({ settingsPath, adb: {
    listDevices: async () => [{ serial: 'QUEST', state: 'device' }],
    run: async () => '',
  } });
  try {
    const scan = await request(app, 'GET', '/api/device-library?serial=QUEST');
    assert.equal(scan.status, 200);
    assert.equal(scan.body.games['hotd-vr'], undefined);
    const catalog = await request(app, 'GET', '/api/catalog');
    assert.equal(catalog.body.installed.QUEST['hotd-vr'], undefined);
    const saved = JSON.parse(await fs.readFile(settingsPath));
    assert.equal(saved.installed.QUEST['hotd-vr'], undefined);
  } finally { app.server.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('a saved installed package is recognized when a creator changed the canonical package ID', async () => {
  const game = getCatalog().find((entry) => entry.id === 'hotd-vr');
  const adb = { run: async (args) => args.includes('packages') ? 'package:io.creator.changedhotd' : '' };
  const found = await inspectDevice(adb, 'QUEST', [game], { 'hotd-vr': 'io.creator.changedhotd' });
  assert.equal(found['hotd-vr']?.packageId, 'io.creator.changedhotd');
});
