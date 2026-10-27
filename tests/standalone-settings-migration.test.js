const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApp } = require('../server');
const { selectRelease } = require('../src/core');

const oldSource = { repo: 'mikermak/hotd2-vr', assetPattern: '^hotd2-vr-quest\\.apk$' };
const ports = [
  ['hotd2-vr', 'hotd2-dreamcast-vr', 'vr4all-standalone/hotd2-arcade-vr', 'hotd2-arcade-vr-quest.apk', 'com.vrlightgunhub.hotd2arcade'],
  ['mok-vr', 'mok-upstream-vr', 'vr4all-standalone/mok-vr', 'mok-vr-quest.apk', 'com.vrlightgunhub.mok'],
];

function request(app, url, method = 'GET', payload) {
  return new Promise((resolve) => {
    const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
    req.method = method; req.url = url; req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/json', 'x-questdesk-token': app.token };
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
    app.server.emit('request', req, res);
  });
}

async function persistedApp(t, settings) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-standalone-settings-'));
  const settingsPath = path.join(root, 'settings.json');
  const apps = [];
  const open = () => {
    const app = createApp({ settingsPath, adb: { listDevices: async () => [] }, releases: { latest: async (source) => selectRelease([{
      tag_name: 'v1.0.0', assets: ['hotd2-vr-quest.apk', 'hotd2-arcade-vr-quest.apk', 'mok-vr-quest.apk'].map((name) => ({ name, browser_download_url: `https://github.com/${source.repo}/releases/download/v1.0.0/${name}` })),
    }], source) } });
    apps.push(app); return app;
  };
  t.after(async () => { for (const app of apps) app.server.close(); await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(settingsPath, JSON.stringify(settings));
  return { root, settingsPath, open };
}

test('startup replaces persisted upstream defaults with standalone releases and preserves legacy file links', async (t) => {
  const fixture = await persistedApp(t, {});
  const { root, settingsPath, open } = fixture;
  const files = Object.fromEntries(['hotd2.chd', 'renamed-old-build.apk', 'hotd2-vr-quest.apk', 'mok.zip', 'gds-0022.chd', 'naomi.zip'].map((name) => [name, path.join(root, name)]));
  for (const [name, file] of Object.entries(files)) await fs.writeFile(file, `original ${name}`);
  const mokFiles = { mok: files['mok.zip'], chd: files['gds-0022.chd'], naomi: files['naomi.zip'] };
  const settings = {
    sources: { 'hotd2-vr': oldSource, 'mok-vr': oldSource },
    localPaths: {
      'hotd2-vr': { disc: files['hotd2.chd'], apkPath: files['renamed-old-build.apk'] },
      'mok-vr': { ...mokFiles, apkPath: files['hotd2-vr-quest.apk'] },
    },
    installed: { QUEST: {
      'hotd2-vr': { packageId: 'com.flycast.emulator.vr', apk: 'renamed-old-build.apk', tag: 'v0.4' },
      'mok-vr': { apk: 'hotd2-vr-quest.apk', tag: 'v0.4' },
    } },
    portChoices: { 'hotd2-vr': 'hotd2-dreamcast-vr', 'mok-vr': 'mok-upstream-vr' },
    unrelated: { keep: true },
  };
  await fs.writeFile(settingsPath, JSON.stringify(settings));
  const app = open();
  for (const [id, variant, repo, apk] of ports) {
    const result = await request(app, `/api/releases?gameId=${id}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.source.repo, repo);
    assert.equal(result.body.release.assetName, apk);
    assert.equal((await request(app, `/api/releases?gameId=${variant}`)).body.release.assetName, 'hotd2-vr-quest.apk');
  }
  const paths = (await request(app, '/api/local-paths')).body;
  assert.deepEqual(paths.paths['hotd2-dreamcast-vr'], { disc: files['hotd2.chd'], apkPath: files['renamed-old-build.apk'] });
  assert.equal(paths.availability['hotd2-dreamcast-vr'].disc, true);
  assert.equal(paths.paths['hotd2-vr']?.hotd2, undefined, 'a Dreamcast disc never becomes a native ZIP');
  assert.equal(paths.paths['hotd2-vr']?.apkPath, undefined);
  assert.deepEqual(paths.paths['mok-vr'], mokFiles);
  assert.deepEqual(paths.paths['mok-upstream-vr'], { ...mokFiles, apkPath: files['hotd2-vr-quest.apk'] });
  const catalog = (await request(app, '/api/catalog')).body;
  assert.equal(catalog.sources['hotd2-vr'], undefined);
  assert.equal(catalog.sources['mok-vr'], undefined);
  for (const [id, variant] of ports) {
    assert.deepEqual(catalog.sources[variant], oldSource);
    assert.equal(catalog.installed.QUEST[id], undefined);
    assert.deepEqual(catalog.installed.QUEST[variant], settings.installed.QUEST[id]);
  }
  const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.deepEqual(saved.portChoices, settings.portChoices);
  assert.deepEqual(saved.unrelated, settings.unrelated);
  app.server.close();
  const reopened = open();
  assert.equal((await request(reopened, '/api/releases?gameId=hotd2-vr')).body.source.repo, 'vr4all-standalone/hotd2-arcade-vr');
  assert.deepEqual((await request(reopened, '/api/local-paths')).body.paths, paths.paths);
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')), saved, 'migration is persisted and idempotent');
  for (const [name, file] of Object.entries(files)) assert.equal(await fs.readFile(file, 'utf8'), `original ${name}`, 'original game files stay in place');
});

test('startup preserves custom root sources and explicitly configured legacy variants', async (t) => {
  for (const custom of [
    { repo: 'player/custom-port', assetPattern: '^custom\\.apk$' },
    { ...oldSource, assetPattern: '^personal-build\\.apk$' },
    { ...oldSource, releasePattern: '^v0\\.4$' },
    { ...oldSource, customFlag: true },
  ]) {
    const rootSources = Object.fromEntries(ports.map(([id]) => [id, custom]));
    const variantSources = Object.fromEntries(ports.map(([, variant]) => [variant, { repo: 'player/legacy-port', assetPattern: '^legacy\\.apk$', releasePattern: 'stable' }]));
    const { settingsPath, open } = await persistedApp(t, { sources: { ...rootSources, ...variantSources } });
    const app = open();
    for (const [id] of ports) assert.deepEqual((await request(app, `/api/releases?gameId=${id}`)).body.source, custom);
    assert.deepEqual((await request(app, '/api/settings')).body.sources, { ...rootSources, ...variantSources });
    assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')).sources, { ...rootSources, ...variantSources });
  }
  const variant = { repo: 'player/legacy-port', assetPattern: '^legacy\\.apk$' };
  const { open } = await persistedApp(t, { sources: { 'hotd2-vr': oldSource, 'mok-vr': oldSource, 'hotd2-dreamcast-vr': variant, 'mok-upstream-vr': variant } });
  const sources = (await request(open(), '/api/settings')).body.sources;
  assert.deepEqual(sources, { 'hotd2-dreamcast-vr': variant, 'mok-upstream-vr': variant });
});

test('startup preserves standalone APK paths and installed records despite stale upstream source settings', async (t) => {
  const { root, settingsPath, open } = await persistedApp(t, {});
  const localPaths = {}; const installed = { QUEST: {} };
  for (const [id, , , apk, packageId] of ports) {
    localPaths[id] = { apkPath: path.join(root, apk) };
    await fs.writeFile(localPaths[id].apkPath, 'standalone APK');
    installed.QUEST[id] = { packageId, apk, tag: 'v1.0.0' };
  }
  await fs.writeFile(settingsPath, JSON.stringify({ sources: { 'hotd2-vr': oldSource, 'mok-vr': oldSource }, localPaths, installed }));
  const app = open();
  assert.deepEqual((await request(app, '/api/local-paths')).body.paths, localPaths);
  assert.deepEqual((await request(app, '/api/catalog')).body.installed, installed);
  const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.deepEqual(saved.localPaths, localPaths);
  assert.deepEqual(saved.installed, installed);
});

test('current standalone source overrides and personal APK links survive unchanged', async (t) => {
  const { root, settingsPath, open } = await persistedApp(t, {});
  const sources = {}; const localPaths = {};
  for (const [id, , repo, apk] of ports) {
    sources[id] = { repo, assetPattern: `^${apk.replace('.', '\\.')}$` };
    localPaths[id] = { apkPath: path.join(root, `${id}-personal.apk`) };
    await fs.writeFile(localPaths[id].apkPath, 'personal standalone APK');
  }
  const settings = { sources, localPaths };
  await fs.writeFile(settingsPath, JSON.stringify(settings));
  const app = open();
  for (const [id] of ports) assert.deepEqual((await request(app, `/api/releases?gameId=${id}`)).body.source, sources[id]);
  assert.deepEqual((await request(app, '/api/local-paths')).body.paths, localPaths);
  const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.deepEqual(saved.sources, settings.sources);
  assert.deepEqual(saved.localPaths, settings.localPaths);
  assert.equal(saved.standalonePortsMigrationVersion, 1, 'an already current settings file is marked migrated too');
});

test('MOK data-only settings retain game links for both ports without source or install metadata', async (t) => {
  const { root, settingsPath, open } = await persistedApp(t, {});
  const native = { mok: path.join(root, 'mok.zip'), chd: path.join(root, 'gds-0022.chd'), naomi: path.join(root, 'naomi.zip') };
  const ownBios = path.join(root, 'personal-naomi.zip');
  for (const file of [...Object.values(native), ownBios]) await fs.writeFile(file, 'owned game file');
  await fs.writeFile(settingsPath, JSON.stringify({ localPaths: { 'mok-vr': native, 'mok-upstream-vr': { naomi: ownBios } } }));
  const app = open();
  const result = (await request(app, '/api/local-paths')).body;
  assert.deepEqual(result.paths['mok-vr'], native);
  assert.deepEqual(result.paths['mok-upstream-vr'], { ...native, naomi: ownBios });
  assert.deepEqual(result.availability['mok-upstream-vr'], { naomi: true, mok: true, chd: true });
  assert.equal((await request(app, '/api/releases?gameId=mok-vr')).body.source.repo, 'vr4all-standalone/mok-vr');
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')).localPaths['mok-upstream-vr'], { ...native, naomi: ownBios });
  for (const file of [...Object.values(native), ownBios]) assert.equal(await fs.readFile(file, 'utf8'), 'owned game file');
});

test('forgetting a migrated Dreamcast disc stays forgotten after restart', async (t) => {
  const { root, settingsPath, open } = await persistedApp(t, {});
  const disc = path.join(root, 'hotd2.chd');
  await fs.writeFile(disc, 'owned Dreamcast disc');
  await fs.writeFile(settingsPath, JSON.stringify({ localPaths: { 'hotd2-vr': { disc } } }));
  const app = open();
  assert.equal((await request(app, '/api/local-paths')).body.paths['hotd2-dreamcast-vr'].disc, disc);
  assert.deepEqual((await request(app, '/api/library/remove', 'POST', { id: 'hotd2-dreamcast-vr:disc' })).body, { removed: true });
  app.server.close();
  const reopened = open();
  assert.equal((await request(reopened, '/api/local-paths')).body.paths['hotd2-dreamcast-vr']?.disc, undefined);
  assert.equal(JSON.parse(await fs.readFile(settingsPath, 'utf8')).localPaths['hotd2-vr']?.disc, undefined);
  assert.equal(await fs.readFile(disc, 'utf8'), 'owned Dreamcast disc');
});

test('forgetting shared MOK media clears both ports while later source choices survive restart', async (t) => {
  const { root, settingsPath, open } = await persistedApp(t, {});
  const mok = path.join(root, 'mok.zip');
  await fs.writeFile(mok, 'owned MOK game files');
  await fs.writeFile(settingsPath, JSON.stringify({ localPaths: { 'mok-vr': { mok } } }));
  const app = open();
  assert.equal((await request(app, '/api/local-paths')).body.paths['mok-upstream-vr'].mok, mok);
  assert.deepEqual((await request(app, '/api/library/remove', 'POST', { id: 'mok-upstream-vr:mok' })).body, { removed: true });
  const choices = { 'hotd2-vr': oldSource, 'mok-vr': { ...oldSource, releasePattern: 'personal-choice' } };
  assert.equal((await request(app, '/api/settings', 'POST', { adbPath: '', sources: choices })).status, 200);
  app.server.close();
  const reopened = open();
  const result = (await request(reopened, '/api/local-paths')).body.paths;
  assert.equal(result['mok-vr']?.mok, undefined);
  assert.equal(result['mok-upstream-vr']?.mok, undefined);
  assert.deepEqual((await request(reopened, '/api/settings')).body.sources, choices, 'later explicit source choices are not reclassified as old defaults');
  assert.equal(JSON.parse(await fs.readFile(settingsPath, 'utf8')).standalonePortsMigrationVersion, 1);
  assert.equal(await fs.readFile(mok, 'utf8'), 'owned MOK game files');
});

test('unambiguous old APK paths migrate without source evidence and keep explicit variant links and records', async (t) => {
  const { root, settingsPath, open } = await persistedApp(t, {});
  const oldApk = path.join(root, 'hotd2-vr-quest.apk');
  const alternate = path.join(root, 'custom-legacy.apk');
  const disc = path.join(root, 'hotd2.cdi'); const otherDisc = path.join(root, 'personal.chd');
  for (const file of [oldApk, alternate, disc, otherDisc]) await fs.writeFile(file, 'original file');
  const variantRecord = { packageId: 'com.flycast.emulator.vr', apk: 'personal.apk', tag: 'keep' };
  await fs.writeFile(settingsPath, JSON.stringify({
    localPaths: {
      'hotd2-vr': { disc, apkPath: oldApk }, 'mok-vr': { apkPath: oldApk },
      'hotd2-dreamcast-vr': { disc: otherDisc, apkPath: alternate },
    },
    installed: {
      OLD: { 'hotd2-vr': { apk: 'hotd2-vr-quest.apk' }, 'mok-vr': { packageId: 'com.flycast.emulator.vr' } },
      EXPLICIT: { 'hotd2-vr': { packageId: 'com.flycast.emulator.vr' }, 'hotd2-dreamcast-vr': variantRecord },
      UNKNOWN: { 'hotd2-vr': { apk: 'personal.apk' }, 'mok-vr': { tag: 'unknown' } },
    },
  }));
  const app = open();
  const paths = (await request(app, '/api/local-paths')).body.paths;
  assert.deepEqual(paths['hotd2-dreamcast-vr'], { disc: otherDisc, apkPath: alternate });
  assert.equal(paths['mok-upstream-vr'].apkPath, oldApk);
  assert.equal(paths['hotd2-vr']?.apkPath, undefined);
  assert.equal(paths['mok-vr']?.apkPath, undefined);
  const installed = (await request(app, '/api/catalog')).body.installed;
  assert.deepEqual(installed.OLD, { 'hotd2-dreamcast-vr': { apk: 'hotd2-vr-quest.apk' }, 'mok-upstream-vr': { packageId: 'com.flycast.emulator.vr' } });
  assert.deepEqual(installed.EXPLICIT, { 'hotd2-dreamcast-vr': variantRecord });
  assert.deepEqual(installed.UNKNOWN, { 'hotd2-vr': { apk: 'personal.apk' }, 'mok-vr': { tag: 'unknown' } });
});
