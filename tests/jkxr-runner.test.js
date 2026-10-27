const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { installJkxr } = require('../src/jkxr-runner');

const repo = 'Team-Beef-Studios/JKXR';
function release(tag, assetName) {
  return { repo, tag, assetName, stale: false,
    downloadUrl: `https://github.com/${repo}/releases/download/${tag}/${assetName}` };
}
async function fixture(t, game = 'jk2') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vr4all-jkxr-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const engineApkPath = path.join(root, 'jkxr-1.2.0.apk');
  const companionApkPath = path.join(root, 'jkxrcompanion_115meta.apk');
  const gamePath = path.join(root, 'owned', 'GameData', 'base');
  await fsp.mkdir(gamePath, { recursive: true });
  await fsp.writeFile(engineApkPath, 'engine fixture');
  await fsp.writeFile(companionApkPath, 'companion fixture');
  for (const number of game === 'jk2' ? [0, 1, 2, 5] : [0, 1, 2, 3]) {
    await fsp.writeFile(path.join(gamePath, `assets${number}.pk3`), `owned asset ${number}`);
  }
  await fsp.writeFile(path.join(gamePath, 'unrelated.exe'), 'not transferred');
  return { root, engineApkPath, companionApkPath, gamePath };
}
function fakeAdb() {
  const calls = [];
  return { calls, run: async (args) => { calls.push(args); return 'Success'; } };
}

test('validates the selected game assets before touching the Quest', async (t) => {
  const paths = await fixture(t);
  await fsp.rm(path.join(paths.gamePath, 'assets5.pk3'));
  const adb = fakeAdb();
  await assert.rejects(installJkxr({ ...paths, game: 'jk2', serial: 'Quest-1', adb,
    engineRelease: release('v1.2.0', 'jkxr-1.2.0.apk'), companionRelease: release('v1.2.0', 'jkxrcompanion_115meta.apk') }), /assets5\.pk3/i);
  assert.equal(adb.calls.length, 0);
});

test('rejects unrelated or stale Quest APK release metadata', async (t) => {
  const paths = await fixture(t);
  const adb = fakeAdb();
  for (const companionRelease of [
    { ...release('v1.2.0', 'jkxrcompanion_115meta.apk'), stale: true },
    { ...release('v1.2.0', 'jkxrcompanion_115meta.apk'), downloadUrl: 'https://github.com/other/repo/releases/download/v1.2.0/jkxrcompanion_115meta.apk' },
  ]) await assert.rejects(installJkxr({ ...paths, game: 'jk2', serial: 'Quest-1', adb,
    engineRelease: release('v1.2.0', 'jkxr-1.2.0.apk'), companionRelease }), /release|official|stale/i);
  assert.equal(adb.calls.length, 0);
});

test('installs both official Quest APKs and JKO assets into JK2/base', async (t) => {
  const paths = await fixture(t);
  const adb = fakeAdb();
  const result = await installJkxr({ ...paths, game: 'jk2', serial: 'Quest-1', adb,
    engineRelease: release('v1.2.0', 'jkxr-1.2.0.apk'), companionRelease: release('v1.2.0', 'jkxrcompanion_115meta.apk') });
  assert.equal(result.game, 'jk2');
  assert.equal(result.filesCopied, 4);
  assert.deepEqual(adb.calls.slice(0, 2), [
    ['-s', 'Quest-1', 'install', '-r', paths.engineApkPath],
    ['-s', 'Quest-1', 'install', '-r', paths.companionApkPath],
  ]);
  const pushes = adb.calls.filter((args) => args[2] === 'push');
  assert.equal(pushes.length, 4);
  assert.ok(pushes.every((args) => args[4].startsWith('/sdcard/JKXR/JK2/base/assets')));
  assert.ok(!pushes.some((args) => args[3].endsWith('.exe')));
});

test('Jedi Academy uses JK3/base and its distinct fourth archive', async (t) => {
  const paths = await fixture(t, 'jk3');
  const adb = fakeAdb();
  await installJkxr({ ...paths, game: 'jk3', serial: 'Quest-1', adb,
    engineRelease: release('v1.2.0', 'jkxr-1.2.0.apk'), companionRelease: release('v1.2.0', 'jkxrcompanion_115meta.apk') });
  const pushes = adb.calls.filter((args) => args[2] === 'push');
  assert.ok(pushes.some((args) => args[4] === '/sdcard/JKXR/JK3/base/assets3.pk3'));
  assert.ok(pushes.every((args) => args[4].startsWith('/sdcard/JKXR/JK3/base/')));
});

test('APK-only update preserves existing game data', async (t) => {
  const paths = await fixture(t);
  const adb = fakeAdb();
  const result = await installJkxr({ ...paths, gamePath: null, game: null, serial: 'Quest-1', adb,
    engineRelease: release('v1.2.0', 'jkxr-1.2.0.apk'), companionRelease: release('v1.2.0', 'jkxrcompanion_115meta.apk') });
  assert.equal(result.filesCopied, 0);
  assert.ok(!adb.calls.some((args) => args[2] === 'push'));
});

test('accepts both GitHub APK cache filenames', async (t) => {
  const paths = await fixture(t);
  const engineRelease = release('v1.2.0', 'jkxr-1.2.0.apk');
  const companionRelease = release('v1.2.0', 'jkxrcompanion_115meta.apk');
  const cachedName = (item) => `${crypto.createHash('sha256').update(item.downloadUrl).digest('hex').slice(0, 16)}-${item.assetName}`;
  const engineApkPath = path.join(paths.root, cachedName(engineRelease));
  const companionApkPath = path.join(paths.root, cachedName(companionRelease));
  await fsp.copyFile(paths.engineApkPath, engineApkPath);
  await fsp.copyFile(paths.companionApkPath, companionApkPath);
  const adb = fakeAdb();
  const result = await installJkxr({ ...paths, engineApkPath, companionApkPath, game: 'jk2', serial: 'Quest-1', adb, engineRelease, companionRelease });
  assert.equal(result.filesCopied, 4);
});
