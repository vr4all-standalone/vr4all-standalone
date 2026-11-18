const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApp } = require('../server');
const { getCatalog } = require('../src/catalog');
const { validateBSIGame, installBSIQuest } = require('../src/bsi-quest-runner');
const { inspectDevice } = require('../src/device-library');

const release = { tag: 'b142', assetName: 'BSI-Quest-Installer.zip',
  downloadUrl: 'https://github.com/egomortal/bsi-quest/releases/download/b142/BSI-Quest-Installer.zip',
  digest: `sha256:${'a'.repeat(64)}`, size: 50116055 };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-bsi-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const game = path.join(root, 'BioShock Infinite');
  await fs.mkdir(path.join(game, 'Binaries', 'Win32'), { recursive: true });
  await fs.mkdir(path.join(game, 'Engine'));
  await fs.mkdir(path.join(game, 'XGame'));
  await fs.writeFile(path.join(game, 'Binaries', 'Win32', 'BioShockInfinite.exe'), 'owned Steam fixture');
  return { root, game };
}

function request(app, method, url, payload) {
  return new Promise((resolve) => {
    const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
    req.method = method; req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'content-type': 'application/json', 'x-questdesk-token': app.token };
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: body ? JSON.parse(body) : null }); } };
    app.server.emit('request', req, res);
  });
}

test('BioShock Infinite is a separate in-app creator installer card', () => {
  const game = getCatalog().find((entry) => entry.id === 'bioshock-infinite-vr');
  assert.equal(game.source.repo, 'egomortal/bsi-quest');
  assert.equal(game.source.assetPattern, '^BSI-Quest-Installer\\.zip$');
  assert.equal(game.personalBuild.specialInstaller, true);
  assert.equal(game.gameName, 'BioShock Infinite');
});

test('BioShock Infinite requires the original Steam game structure', async (t) => {
  const { root, game } = await fixture(t);
  assert.equal(await validateBSIGame(game), game);
  await assert.rejects(validateBSIGame(root), /BioShock Infinite|Binaries/i);
  await fs.rm(path.join(game, 'XGame'), { recursive: true });
  await assert.rejects(validateBSIGame(game), /XGame/i);
});

test('BioShock Infinite accepts only a verified official installer and one selected Quest', async (t) => {
  const { root, game } = await fixture(t);
  const zip = path.join(root, 'release.zip');
  await fs.writeFile(zip, 'zip fixture');
  let invoked = null;
  const invoke = async (script, selectedGame, adbPath, onLog) => { invoked = { script, selectedGame, adbPath }; onLog('Official install complete'); };
  const extract = async (_archive, destination) => {
    const folder = path.join(destination, 'BSI-Quest-Installer');
    await fs.mkdir(folder, { recursive: true });
    for (const name of ['Install-BSIQuest.ps1', 'Set-Mode.ps1', 'bsi-quest.apk', 'vulkan.ad07xx.so']) await fs.writeFile(path.join(folder, name), 'fixture');
  };
  const adb = { getPath: () => 'C:\\adb.exe', listDevices: async () => [{ serial: 'QUEST3', state: 'device', model: 'Quest 3' }],
    run: async (args) => args.includes('getprop') ? 'Quest 3' : args.includes('pm') && args.includes('list') ? 'package:com.bsiquest.game'
      : args.includes('pm') && args.includes('path') ? 'package:/data/app/com.bsiquest.game/base.apk'
        : args.includes('dumpsys') ? 'versionName=b142'
          : args.includes('ls') ? 'Binaries\nEngine\nXGame\nturnip\nBioShockInfinite.exe' : '' };
  const input = { gamePath: game, serial: 'QUEST3', release,
    releases: { downloadPackage: async () => zip }, adb, workspaceRoot: root, invoke, extract };
  await assert.rejects(installBSIQuest({ ...input, release: { ...release, digest: null } }), /SHA-256/i);
  await assert.rejects(installBSIQuest({ ...input, release: { ...release, downloadUrl: 'https://example.com/fake.zip' } }), /official/i);
  await assert.rejects(installBSIQuest({ ...input, adb: { ...adb, listDevices: async () => [...await adb.listDevices(), { serial: 'OTHER', state: 'device' }] } }), /one authorized/i);
  const result = await installBSIQuest(input);
  assert.equal(result.packageId, 'com.bsiquest.game');
  assert.equal(result.tag, 'b142');
  assert.equal(invoked.selectedGame, game);
  assert.equal(invoked.adbPath, 'C:\\adb.exe');
  assert.match(invoked.script, /Install-BSIQuest\.ps1$/);
});

test('BioShock Infinite headset scan needs both APK and copied Steam data', async () => {
  let copied = false;
  const adb = { run: async (args) => {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:com.bsiquest.game';
    if (command === 'shell dumpsys package com.bsiquest.game') return 'versionName=b142';
    if (command.includes('/sdcard/BSI/BioShock Infinite/Binaries/Win32')) return copied ? 'BioShockInfinite.exe' : '';
    if (command.includes('/sdcard/BSI/BioShock Infinite')) return copied ? 'Binaries\nEngine\nXGame' : '';
    return '';
  } };
  const game = getCatalog().find((entry) => entry.id === 'bioshock-infinite-vr');
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id].dataReady, false);
  copied = true;
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id].dataReady, true);
});

test('BioShock Infinite personal install stays inside VR4ALL and remembers the selected Quest', async (t) => {
  const { root, game } = await fixture(t);
  const calls = [];
  const app = createApp({ platform: 'win32', settingsPath: path.join(root, 'settings.json'),
    adb: { listDevices: async () => [{ serial: 'QUEST3', state: 'device' }], run: async () => 'Quest 3', getPath: () => 'C:\\adb.exe' },
    releases: { latest: async () => release },
    bsiInstaller: async (input) => { calls.push(input); return { packageId: 'com.bsiquest.game', tag: 'b142' }; },
  });
  t.after(() => app.server.close());
  const started = await request(app, 'POST', '/api/personal-build', { gameId: 'bioshock-infinite-vr', serial: 'QUEST3', gamePackage: game });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  let job;
  for (let i = 0; i < 50; i++) {
    job = (await request(app, 'GET', `/api/jobs/${started.body.job.id}`)).body.job;
    if (!['queued', 'running'].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(job.status, 'success', job.error);
  assert.equal(calls[0].serial, 'QUEST3');
  assert.equal(calls[0].gamePath, game);
  assert.equal(calls[0].release.tag, 'b142');
});
