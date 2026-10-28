const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { validateBioShockGame, driveBioShockInstaller, installBioShock } = require('../src/bioshock-runner');

async function gameFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-bioshock-test-'));
  const game = path.join(root, 'BioShock');
  await fs.mkdir(path.join(game, 'Builds', 'Release'), { recursive: true });
  await fs.mkdir(path.join(game, 'Content'));
  await fs.writeFile(path.join(game, 'Builds', 'Release', 'Bioshock.exe'), 'owned fixture');
  return { root, game };
}

function fakeInstaller({ selectedGame, selectedSerial = 'QUEST3S', status = 'installed' }) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => { queueMicrotask(() => child.emit('close', 1)); };
  const replies = [];
  child.stdin.on('data', (chunk) => {
    const reply = String(chunk).trim(); replies.push(reply);
    if (replies.length === 1) child.stdout.write('   1. Meta Quest 3  [OTHER]\n   2. Meta Quest 3S  [QUEST3S]\nDevice number; R — refresh: ');
    else if (replies.length === 2) child.stdout.write(`Game: ${selectedGame}\n`);
  });
  queueMicrotask(() => child.stdout.write('Headset number [1]: '));
  return { child, replies, status, selectedSerial };
}

test('BioShock accepts only an original installed game folder structure', async (t) => {
  const f = await gameFixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  assert.equal(await validateBioShockGame(f.game), f.game);
  await assert.rejects(validateBioShockGame(f.root), /BioShock 2007|Builds/i);
});

test('BioShock driver chooses the specified Quest 3S and rejects a different game folder', async (t) => {
  const f = await gameFixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const good = fakeInstaller({ selectedGame: f.game });
  setTimeout(() => good.child.emit('close', 0), 30);
  await driveBioShockInstaller('BioShockVR-Setup.exe', f.game, 'QUEST3S', 'Quest 3S', f.root, { spawnImpl: () => good.child });
  assert.deepEqual(good.replies, ['2', '2']);
  const wrong = fakeInstaller({ selectedGame: path.join(f.root, 'Different') });
  await assert.rejects(driveBioShockInstaller('BioShockVR-Setup.exe', f.game, 'QUEST3S', 'Quest 3S', f.root, { spawnImpl: () => wrong.child }), /different BioShock folder/i);
});

test('BioShock install checks the official digest and author receipt before success', async (t) => {
  const f = await gameFixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const release = { tag: 'initial-release', assetName: 'BioShockVR-Setup.exe', digest: `sha256:${'a'.repeat(64)}`, downloadUrl: 'https://github.com/terx1232/BioShock-Quest-VR/releases/download/initial-release/BioShockVR-Setup.exe' };
  await assert.rejects(installBioShock({ gamePath: f.game, serial: 'QUEST3S', model: 'Quest 3S', release: { ...release, digest: null }, releases: {} }), /SHA-256/i);
  let downloads = 0;
  const result = await installBioShock({ gamePath: f.game, serial: 'QUEST3S', model: 'Quest 3S', release,
    releases: { downloadTool: async () => { downloads++; return path.join(f.root, 'BioShockVR-Setup.exe'); } }, workspaceRoot: f.root,
    runInstaller: async (_exe, _game, _serial, _model, workspace) => {
      await fs.writeFile(path.join(workspace, 'last-install.json'), JSON.stringify({ status: 'installed', serial: 'QUEST3S', version: 'initial-release' }));
    }, adb: { run: async () => 'package:/data/app/com.winlator.cmod/base.apk' } });
  assert.equal(downloads, 1);
  assert.equal(result.packageId, 'com.winlator.cmod');
  assert.equal(result.tag, 'initial-release');
});
