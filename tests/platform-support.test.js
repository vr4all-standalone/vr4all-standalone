const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { platformSupport, EXPERIMENTAL_NOTE } = require('../src/platform-support');
const { getCatalog } = require('../src/catalog');
const { createApp } = require('../server');

const byId = (id) => getCatalog().find((entry) => entry.id === id);

// Ports without a Linux install path. Each port task removes its id from this list.
const LINUX_REFUSED = ['gta-sa-vr', 'bioshock-vr', 'vice-city-vr', 'rdr1-vr', 'fzero-x-virtuavr', 'victory-heat-rally-vr',
  'road-rash-vr', 'harry-potter-vr', 'gothic2-vr'];

// Ports with a Linux path that needs an x86-64 host. Each port task adds its id.
const LINUX_EXPERIMENTAL = ['crazy-taxi-vr', 'magic-carpet-vr'];

// Ports with a Linux path that runs on any architecture (Node or Python). Each port task adds its id.
const LINUX_EXPERIMENTAL_ANY_ARCH = ['galaxyquest', 'gt2-vr', 'descent12-vr', 'animal-crossing-vr'];

test('Windows runs every port', () => {
  for (const game of getCatalog()) assert.equal(platformSupport(game, 'win32').supported, true, game.id);
});

test('Linux refuses ports that need PowerShell kits or Windows executables, with a reason', () => {
  for (const id of LINUX_REFUSED) {
    const game = byId(id);
    assert.ok(game, id);
    const result = platformSupport(game, 'linux');
    assert.equal(result.supported, false, id);
    assert.match(result.reason, /Windows/);
  }
});

test('Linux enables the ports that have a Linux install path, as experimental', () => {
  for (const id of LINUX_EXPERIMENTAL) {
    assert.deepEqual(platformSupport(byId(id), 'linux', { arch: 'x64' }), { supported: true, experimental: true, note: EXPERIMENTAL_NOTE }, id);
    const arm = platformSupport(byId(id), 'linux', { arch: 'arm64' });
    assert.equal(arm.supported, false, id);
    assert.match(arm.reason, /x64/, id);
  }
});

test('Linux enables the architecture-independent ports as experimental on every host', () => {
  for (const id of LINUX_EXPERIMENTAL_ANY_ARCH) {
    for (const arch of ['x64', 'arm64']) assert.deepEqual(platformSupport(byId(id), 'linux', { arch }), { supported: true, experimental: true, note: EXPERIMENTAL_NOTE }, `${id} ${arch}`);
  }
});

test('BioShock VR stays unsupported on Linux with its own reason', () => {
  const result = platformSupport(byId('bioshock-vr'), 'linux');
  assert.equal(result.supported, false);
  assert.match(result.reason, /BioShock/);
});

test('Linux accepts a plain creator-APK port', () => {
  const plain = getCatalog().find((game) => !game.personalBuild && !game.playerInstall && !game.externalInstaller && !game.manualBuild && !game.releaseKind);
  assert.ok(plain);
  assert.deepEqual(platformSupport(plain, 'linux'), { supported: true });
});

test('Linux accepts Node-only player installs and link-only external installers', () => {
  for (const id of ['jkxr', 'descent3-vr', 'beef-raider-xr', 'astroquest', 'sclerosis-vr', 'deus-ex-quest-vr', 'jurassic-park-arcade-vr']) {
    assert.ok(byId(id), id);
    assert.deepEqual(platformSupport(byId(id), 'linux'), { supported: true }, id);
  }
});

test('every catalog game carries its support state for this platform', () => {
  for (const game of getCatalog()) assert.equal(typeof game.support.supported, 'boolean', game.id);
});

function request(app, url, payload) {
  return new Promise((resolve) => {
    const req = Readable.from([JSON.stringify(payload)]);
    req.method = 'POST';
    req.url = url;
    req.headers = { 'content-type': 'application/json', host: '127.0.0.1:4173', 'x-questdesk-token': app.token };
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
    app.server.emit('request', req, res);
  });
}

test('Linux server refuses an enabled port on a non-x64 host before any device work', async () => {
  const touched = [];
  const app = createApp({ platform: 'linux', arch: 'arm64', adb: { listDevices: async () => { touched.push('adb'); return []; } } });
  const response = await request(app, '/api/magic-carpet-install', { gameId: 'magic-carpet-vr', serial: 'Q3' });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /x64/);
  assert.deepEqual(touched, []);
});

test('Linux server refuses Windows-only installs before any device, download or spawn', async () => {
  const touched = [];
  const app = createApp({ platform: 'linux', adb: { listDevices: async () => { touched.push('adb'); return []; } },
    releases: { latest: async () => { touched.push('releases'); return null; } },
    personalBuilder: async () => { touched.push('build'); }, sdkSetup: async () => { touched.push('sdk'); } });
  const attempts = [['/api/personal-build', { gameId: 'gta-sa-vr', serial: 'Q3' }], ['/api/personal-build', { gameId: 'bioshock-vr', serial: 'Q3' }],
    ['/api/install', { gameId: 'bioshock-vr', serial: 'Q3', apkMode: 'github' }],
    ['/api/road-rash-install', { gameId: 'road-rash-vr', serial: 'Q3' }],
    ['/api/harry-potter-install', { gameId: 'harry-potter-vr', serial: 'Q3' }],
    ['/api/build-tools', { gameId: 'vice-city-vr', downloadLocation: '/tmp' }]];
  for (const [url, payload] of attempts) {
    const response = await request(app, url, payload);
    assert.equal(response.status, 400, `${url} ${payload.gameId}`);
    assert.match(response.body.error, /Windows-only/, `${url} ${payload.gameId}`);
  }
  assert.deepEqual(touched, []);
});
