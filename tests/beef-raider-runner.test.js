const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { packageName, inspectBeefRaiderData, installBeefRaiderApk, transferBeefRaiderData } = require('../src/beef-raider-runner');

async function extractedFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-beef-raider-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ['Audio', 'FMV', 'DATA']) await fs.mkdir(path.join(root, name));
  await fs.writeFile(path.join(root, 'Audio', 'track.ogg'), 'music');
  await fs.writeFile(path.join(root, 'FMV', 'intro.rpl'), 'video');
  await fs.writeFile(path.join(root, 'DATA', 'LEVEL1.PHD'), 'game data');
  return root;
}

function adbFixture({ remoteEntries = '', packagePath = 'package:/data/app/beef/base.apk', devices = [{ serial: 'Quest-1', state: 'device' }] } = {}) {
  const calls = [];
  return {
    calls,
    listDevices: async () => devices,
    run: async (args) => {
      calls.push(args);
      if (args[2] === 'shell' && args[3] === 'pm') return packagePath;
      return args[2] === 'shell' ? remoteEntries : '1 file pushed';
    },
  };
}

async function apkFixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-beef-apk-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const apkPath = path.join(root, 'beefraiderxr-1.0.0.apk');
  const bytes = Buffer.from('504b030466697874757265', 'hex');
  await fs.writeFile(apkPath, bytes);
  const release = {
    repo: 'Team-Beef-Studios/BeefRaiderXR', tag: '1.0.0', assetName: 'beefraiderxr-1.0.0.apk',
    downloadUrl: 'https://github.com/Team-Beef-Studios/BeefRaiderXR/releases/download/1.0.0/beefraiderxr-1.0.0.apk',
    size: bytes.length, digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`, stale: false,
    ...overrides,
  };
  return { apkPath, release };
}

test('inspects the three prepared folders and counts their real files', async (t) => {
  const root = await extractedFixture(t);
  const result = await inspectBeefRaiderData(root);
  assert.equal(result.fileCount, 3);
  assert.deepEqual(result.folders.map((folder) => folder.name), ['Audio', 'FMV', 'DATA']);
});

test('rejects incomplete extracted data before using ADB', async (t) => {
  const root = await extractedFixture(t);
  await fs.rm(path.join(root, 'FMV'), { recursive: true });
  const adb = adbFixture();
  await assert.rejects(transferBeefRaiderData({ extractedPath: root, serial: 'Quest-1', adb }), /FMV/);
  assert.equal(adb.calls.length, 0);
});

test('rejects symbolic links inside prepared data before using ADB', async (t) => {
  const root = await extractedFixture(t);
  try {
    await fs.symlink(path.join(root, 'DATA', 'LEVEL1.PHD'), path.join(root, 'DATA', 'linked.PHD'));
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.skip('Windows sandbox does not permit creating symlinks');
    return;
  }
  const adb = adbFixture();
  await assert.rejects(transferBeefRaiderData({ extractedPath: root, serial: 'Quest-1', adb }), /symbolic link/i);
  assert.equal(adb.calls.length, 0);
});

test('transfers only prepared folders to the selected Quest after preflight', async (t) => {
  const root = await extractedFixture(t);
  const adb = adbFixture({ remoteEntries: 'saves\nconfig.ini' });
  const result = await transferBeefRaiderData({ extractedPath: root, serial: 'Quest-1', adb });
  assert.deepEqual(result, { destination: '/sdcard/BeefraiderXR', foldersCopied: 3, filesCopied: 3 });
  assert.deepEqual(adb.calls, [
    ['-s', 'Quest-1', 'shell', 'pm', 'path', 'com.drbeef.beefraiderxr'],
    ['-s', 'Quest-1', 'shell', 'ls', '-A', '/sdcard/BeefraiderXR'],
    ['-s', 'Quest-1', 'push', path.join(root, 'Audio'), '/sdcard/BeefraiderXR/'],
    ['-s', 'Quest-1', 'push', path.join(root, 'FMV'), '/sdcard/BeefraiderXR/'],
    ['-s', 'Quest-1', 'push', path.join(root, 'DATA'), '/sdcard/BeefraiderXR/'],
  ]);
});

test('requires the official Quest package before transfer', async (t) => {
  const root = await extractedFixture(t);
  const adb = adbFixture({ packagePath: '' });
  await assert.rejects(transferBeefRaiderData({ extractedPath: root, serial: 'Quest-1', adb }), /SideQuest|installed/i);
  assert.equal(adb.calls.filter((args) => args[2] === 'push').length, 0);
});

test('refuses to overwrite existing Quest data', async (t) => {
  const root = await extractedFixture(t);
  const adb = adbFixture({ remoteEntries: 'saves\ndata\n' });
  await assert.rejects(transferBeefRaiderData({ extractedPath: root, serial: 'Quest-1', adb }), /already contains DATA/i);
  assert.equal(adb.calls.filter((args) => args[2] === 'push').length, 0);
});

test('rejects a missing or unauthorized selected Quest', async (t) => {
  const root = await extractedFixture(t);
  const adb = adbFixture({ devices: [{ serial: 'Quest-1', state: 'unauthorized' }] });
  await assert.rejects(transferBeefRaiderData({ extractedPath: root, serial: 'Quest-1', adb }), /authorized|connected/i);
  assert.equal(adb.calls.length, 0);
  await assert.rejects(transferBeefRaiderData({ extractedPath: root, serial: 'Quest-2', adb }), /authorized|connected/i);
  assert.equal(adb.calls.length, 0);
});

test('does not transfer when the headset folder cannot be read', async (t) => {
  const root = await extractedFixture(t);
  const adb = adbFixture();
  const run = adb.run;
  adb.run = async (args) => {
    if (args[3] === 'ls') { adb.calls.push(args); throw new Error('No such file or directory'); }
    return run(args);
  };
  await assert.rejects(transferBeefRaiderData({ extractedPath: root, serial: 'Quest-1', adb }), /start BeefRaiderXR once|cannot read/i);
  assert.equal(adb.calls.filter((args) => args[2] === 'push').length, 0);
});

test('installs the verified official Quest APK without replacing existing apps', async (t) => {
  const { apkPath, release } = await apkFixture(t);
  const adb = adbFixture({ packagePath: '' });
  adb.run = async (args) => {
    adb.calls.push(args);
    if (args[3] === 'pm') return adb.calls.some((call) => call[2] === 'install') ? 'package:/data/app/beef/base.apk' : '';
    if (args[2] === 'install') return 'Success';
    throw new Error('Unexpected ADB command');
  };
  const result = await installBeefRaiderApk({ apkPath, release, serial: 'Quest-1', adb });
  assert.deepEqual(result, { packageName: 'com.drbeef.beefraiderxr', installed: true, launchRequired: true });
  assert.deepEqual(adb.calls, [
    ['-s', 'Quest-1', 'shell', 'pm', 'path', 'com.drbeef.beefraiderxr'],
    ['-s', 'Quest-1', 'install', apkPath],
    ['-s', 'Quest-1', 'shell', 'pm', 'path', 'com.drbeef.beefraiderxr'],
  ]);
  assert.equal(packageName, 'com.drbeef.beefraiderxr');
});

test('leaves an installed BeefRaiderXR app intact', async (t) => {
  const { apkPath, release } = await apkFixture(t);
  const adb = adbFixture();
  const result = await installBeefRaiderApk({ apkPath, release, serial: 'Quest-1', adb });
  assert.deepEqual(result, { packageName: 'com.drbeef.beefraiderxr', installed: false, launchRequired: false });
  assert.equal(adb.calls.filter((args) => args[2] === 'install').length, 0);
});

test('rejects unrelated APK metadata and corrupt bytes before ADB', async (t) => {
  const { apkPath, release } = await apkFixture(t);
  const adb = adbFixture();
  for (const badRelease of [
    { ...release, stale: true },
    { ...release, downloadUrl: 'https://github.com/other/BeefRaiderXR/releases/download/1.0.0/beefraiderxr-1.0.0.apk' },
    { ...release, digest: `sha256:${'0'.repeat(64)}` },
  ]) await assert.rejects(installBeefRaiderApk({ apkPath, release: badRelease, serial: 'Quest-1', adb }), /official|stale|SHA-256/i);
  assert.equal(adb.calls.length, 0);
});

test('refuses to install on another or unauthorized Quest', async (t) => {
  const { apkPath, release } = await apkFixture(t);
  const adb = adbFixture({ devices: [{ serial: 'Quest-1', state: 'unauthorized' }] });
  await assert.rejects(installBeefRaiderApk({ apkPath, release, serial: 'Quest-1', adb }), /authorized|connected/i);
  assert.equal(adb.calls.length, 0);
});

test('accepts official public release metadata without optional size or digest', async (t) => {
  const { apkPath, release } = await apkFixture(t, { size: null, digest: null });
  const adb = adbFixture();
  const result = await installBeefRaiderApk({ apkPath, release, serial: 'Quest-1', adb });
  assert.equal(result.installed, false);
});

test('rejects an APK without ZIP magic even if metadata omits a digest', async (t) => {
  const { apkPath, release } = await apkFixture(t, { size: null, digest: null });
  await fs.writeFile(apkPath, 'not an apk');
  const adb = adbFixture();
  await assert.rejects(installBeefRaiderApk({ apkPath, release, serial: 'Quest-1', adb }), /ZIP archive/i);
  assert.equal(adb.calls.length, 0);
});
