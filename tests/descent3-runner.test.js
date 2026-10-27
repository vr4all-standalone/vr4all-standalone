const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { installDescent3 } = require('../src/descent3-runner');

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vr4all-descent3-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const apkPath = path.join(root, 'Descent3-VR-0.3-beta.apk');
  const gamePath = path.join(root, 'owned-game');
  await fsp.writeFile(apkPath, 'test APK');
  await fsp.mkdir(path.join(gamePath, 'missions', 'custom'), { recursive: true });
  await fsp.mkdir(path.join(gamePath, 'movies'), { recursive: true });
  await fsp.writeFile(path.join(gamePath, 'd3.hog'), 'game data');
  await fsp.writeFile(path.join(gamePath, 'extra.hog'), 'expansion data');
  await fsp.writeFile(path.join(gamePath, 'pilot.pld'), 'pilot');
  await fsp.writeFile(path.join(gamePath, 'missions', 'custom', 'level.mn3'), 'mission');
  await fsp.writeFile(path.join(gamePath, 'movies', 'intro.mve'), 'movie');
  await fsp.writeFile(path.join(gamePath, 'descent3.exe'), 'Windows binary');
  return { root, apkPath, gamePath };
}

function fakeAdb() {
  const calls = [];
  return { calls, run: async (args) => { calls.push(args); return 'Success'; } };
}

test('rejects incomplete owned data before installing an APK', async (t) => {
  const { apkPath, gamePath } = await fixture(t);
  const adb = fakeAdb();
  await fsp.rm(path.join(gamePath, 'd3.hog'));
  await assert.rejects(installDescent3({ apkPath, gamePath, serial: 'Quest-1', adb, inspectApk: async () => 'com.descentdevelopers.descent3' }), /d3\.hog/i);
  assert.equal(adb.calls.length, 0);
});

test('rejects an unrelated local APK and a stale or unrelated release', async (t) => {
  const { apkPath, gamePath } = await fixture(t);
  const adb = fakeAdb();
  await assert.rejects(installDescent3({ apkPath, gamePath, serial: 'Quest-1', adb, inspectApk: async () => 'com.other.game' }), /package/i);
  for (const release of [
    { stale: true, repo: 'SgtBilko76/Descent3-VR', tag: 'quest-v0.3-beta', assetName: 'Descent3-VR-0.3-beta.apk' },
    { repo: 'someone/else', tag: 'quest-v0.3-beta', assetName: 'Descent3-VR-0.3-beta.apk', downloadUrl: 'https://github.com/someone/else/releases/download/quest-v0.3-beta/Descent3-VR-0.3-beta.apk' },
  ]) await assert.rejects(installDescent3({ apkPath, gamePath, serial: 'Quest-1', adb, release }), /release|official|stale/i);
  assert.equal(adb.calls.length, 0);
});

test('installs official Quest APK, transfers only required owned files, and sets directory permissions', async (t) => {
  const { apkPath, gamePath } = await fixture(t);
  const adb = fakeAdb();
  const release = {
    repo: 'SgtBilko76/Descent3-VR', tag: 'quest-v0.3-beta', assetName: 'Descent3-VR-0.3-beta.apk', stale: false,
    downloadUrl: 'https://github.com/SgtBilko76/Descent3-VR/releases/download/quest-v0.3-beta/Descent3-VR-0.3-beta.apk',
  };
  const result = await installDescent3({ apkPath, gamePath, serial: 'Quest-1', adb, release });
  assert.equal(result.packageName, 'com.descentdevelopers.descent3');
  assert.ok(adb.calls.every((args) => args[0] === '-s' && args[1] === 'Quest-1'));
  assert.deepEqual(adb.calls[0], ['-s', 'Quest-1', 'install', '-r', apkPath]);
  const pushes = adb.calls.filter((args) => args[2] === 'push');
  assert.equal(pushes.length, 5);
  assert.ok(pushes.some((args) => args[3].endsWith('d3.hog') && args[4].endsWith('/d3.hog')));
  assert.ok(pushes.some((args) => args[3].endsWith('level.mn3') && args[4].endsWith('/missions/custom/level.mn3')));
  assert.ok(!pushes.some((args) => args[3].endsWith('descent3.exe')));
  assert.ok(adb.calls.some((args) => args[2] === 'shell' && args[3] === 'chmod' && args[4] === '2777' && args[5].includes('missions/custom')));
});

test('accepts the official GitHub cache filename with its release URL hash prefix', async (t) => {
  const { root, apkPath, gamePath } = await fixture(t);
  const release = {
    repo: 'SgtBilko76/Descent3-VR', tag: 'quest-v0.3-beta', assetName: 'Descent3-VR-0.3-beta.apk', stale: false,
    downloadUrl: 'https://github.com/SgtBilko76/Descent3-VR/releases/download/quest-v0.3-beta/Descent3-VR-0.3-beta.apk',
  };
  const prefix = crypto.createHash('sha256').update(release.downloadUrl).digest('hex').slice(0, 16);
  const cached = path.join(root, `${prefix}-${release.assetName}`);
  await fsp.copyFile(apkPath, cached);
  const adb = fakeAdb();
  const result = await installDescent3({ apkPath: cached, gamePath, serial: 'Quest-1', adb, release });
  assert.equal(result.filesCopied, 5);
});

test('rejects symlinked owned game data before touching the Quest', async (t) => {
  const { apkPath, gamePath } = await fixture(t);
  const outside = path.join(path.dirname(gamePath), 'outside.hog');
  await fsp.writeFile(outside, 'outside');
  const linked = path.join(gamePath, 'missions', 'custom', 'outside.hog');
  try { await fsp.symlink(outside, linked); } catch (error) {
    if (error.code === 'EPERM') return t.skip('Windows symlink privilege unavailable');
    throw error;
  }
  const adb = fakeAdb();
  await assert.rejects(installDescent3({ apkPath, gamePath, serial: 'Quest-1', adb, inspectApk: async () => 'com.descentdevelopers.descent3' }), /symbolic link/i);
  assert.equal(adb.calls.length, 0);
});
