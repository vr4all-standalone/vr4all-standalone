const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { directoryRoot } = require('../src/archive-conversion');
const { missingLocalRequiredPaths } = require('../src/required-paths');
const { inspectDevice, packages } = require('../src/device-library');
const { verifyRequiredRemoteFiles } = require('../src/transfer-verification');

const game = getCatalog().find((entry) => entry.id === 'silent-hill-3-quest-vr');

test('Silent Hill 3 selects its creator APK and copies the owned PC game', () => {
  assert.ok(game);
  assert.equal(game.source.repo, 'moistman42069/SilentHill3-Quest-VR');
  assert.equal(packages[game.id], 'dev.sh3quest.vr');
  assert.equal(game.data[0].requiredPaths.length, 80);
  assert.deepEqual(game.data[0].copyEntries, ['sh3.exe', 'data']);
  assert.ok(game.addedAt);
  const release = selectRelease([{ tag_name: 'v0.1.9', published_at: '2026-11-27', assets: [
    { name: 'SH3QuestVR-0.1.9.apk', browser_download_url: 'https://github.com/moistman42069/SilentHill3-Quest-VR/releases/download/v0.1.9/SH3QuestVR-0.1.9.apk' },
    { name: 'source.zip', browser_download_url: 'https://github.com/moistman42069/SilentHill3-Quest-VR/releases/download/v0.1.9/source.zip' },
  ] }], game.source);
  assert.equal(release.assetName, 'SH3QuestVR-0.1.9.apk');
  const plan = buildInstallPlan(game, { serial: 'QUEST3', apkPath: 'C:\\Ports\\SH3QuestVR-0.1.9.apk',
    files: { game: 'C:\\Games\\SILENT HILL 3' }, directoryEntries: { game: ['sh3.exe', 'data', 'readme.txt'] } });
  assert.deepEqual(plan.filter((step) => step.label.startsWith('Copy game/')).map((step) => step.label), ['Copy game/sh3.exe', 'Copy game/data']);
  assert.ok(plan.some((step) => step.args.at(-1) === '/sdcard/Android/data/dev.sh3quest.vr/files/game/'));
});

test('Silent Hill 3 folder and archive checks reject missing nested game files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sh3-'));
  try {
    await fs.writeFile(path.join(root, 'sh3.exe'), 'game');
    await fs.mkdir(path.join(root, 'data', 'sound', 'demo_afs'), { recursive: true });
    await fs.writeFile(path.join(root, 'data', 'arc.arc'), 'arc');
    assert.deepEqual(await missingLocalRequiredPaths(root, ['sh3.exe', 'data/arc.arc']), []);
    assert.deepEqual(await missingLocalRequiredPaths(root, ['SH3.EXE']), ['SH3.EXE']);
    assert.deepEqual(await missingLocalRequiredPaths(root, ['sh3.exe', 'data/sound/demo_afs/wav.afs']), ['data/sound/demo_afs/wav.afs']);
    const entries = game.data[0].requiredPaths.map((name) => ({ name: `SILENT HILL 3/${name}`, directory: false }));
    assert.equal(directoryRoot(entries, game.data[0]), 'SILENT HILL 3');
    assert.throws(() => directoryRoot(entries.slice(0, -1), game.data[0]), /missing one or more required game files/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Silent Hill 3 is ready only with its full game data on the headset', async () => {
  const root = '/sdcard/Android/data/dev.sh3quest.vr/files/game/';
  const allFiles = game.data[0].requiredPaths.map((name) => `${root}${name}`);
  let found = allFiles;
  const adb = { run: async (args) => {
    if (args.includes('pm')) return 'package:dev.sh3quest.vr';
    if (args.includes('dumpsys')) return 'versionName=0.1.9';
    if (args.includes('find')) return found.join('\n');
    return '';
  } };
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id].dataReady, true);
  found = allFiles.slice(0, -1);
  assert.equal((await inspectDevice(adb, 'QUEST3', [game]))[game.id].dataReady, false);
});

test('Silent Hill 3 transfer verification rejects a truncated headset file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sh3-transfer-'));
  try {
    await fs.mkdir(path.join(root, 'data'));
    await fs.writeFile(path.join(root, 'sh3.exe'), 'game');
    await fs.writeFile(path.join(root, 'data', 'arc.arc'), 'assets');
    const names = ['sh3.exe', 'data/arc.arc'];
    const adb = { run: async () => '4\n6' };
    assert.deepEqual(await verifyRequiredRemoteFiles(adb, 'QUEST3', root, '/sdcard/SH3/', names), { files: 2, bytes: 10 });
    adb.run = async () => '4\n3';
    await assert.rejects(verifyRequiredRemoteFiles(adb, 'QUEST3', root, '/sdcard/SH3/', names), /incomplete.*data\/arc\.arc/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
