const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { inspectDevice } = require('../src/device-library');
const { prepareResourcePatch, transferResourcePatch } = require('../src/resource-patch');

test('Bloodlines chooses only the Quest APK and creator patch from its release', () => {
  const game = getCatalog().find((entry) => entry.id === 'vtmb-resource');
  assert.ok(game);
  const assets = ['vtmb-re_source-0-1-1.apk', 'resource-unofficial-patch-11.5-resource.20261031-sidequest.zip', 'openal-source.zip']
    .map((name) => ({ name, browser_download_url: `https://github.com/alex-nax/resource/releases/download/v0.1.1/${name}` }));
  const releases = [{ tag_name: 'v0.1.1', published_at: '2026-10-30T18:08:00Z', assets }];
  assert.equal(selectRelease(releases, game.source).assetName, assets[0].name);
  assert.equal(selectRelease(releases, game.patchSource).assetName, assets[1].name);
  assert.equal(game.fileAccessPackage, 'diy.resource.vtmb.vulkan');
  const plan = buildInstallPlan(game, { serial: 'QUEST', apkPath: 'C:/port.apk', files: { game: 'C:/Vampire' }, directoryEntries: { game: ['pack000.vpk', 'cfg', 'maps'] } });
  assert.ok(plan.some((step) => step.args.at(-1) === '/sdcard/vtmb/Vampire/'));
  assert.ok(plan.some((step) => step.args.join(' ').includes('MANAGE_EXTERNAL_STORAGE allow')));
  assert.equal(plan.filter((step) => step.args[2] === 'push').length, 3);
});

test('Bloodlines is ready only with original game data and the creator patch', async () => {
  const game = getCatalog().find((entry) => entry.id === 'vtmb-resource');
  const directories = {
    '/sdcard/vtmb/Vampire/': 'pack000.vpk\n',
    '/sdcard/vtmb/': 'Vampire\nUnofficial_Patch\npack.json\n',
    '/sdcard/vtmb/Unofficial_Patch/scripts/': 'liblist.gam\n',
  };
  const adb = { async run(args) {
    const command = args.slice(2);
    if (command.join(' ') === 'shell pm list packages -3') return 'package:diy.resource.vtmb.vulkan';
    if (command.slice(0, 3).join(' ') === 'shell dumpsys package') return 'versionName=0.1.1';
    if (command.slice(0, 3).join(' ') === 'shell ls -1') return directories[command[3]] || '';
    throw new Error(command.join(' '));
  } };
  assert.equal((await inspectDevice(adb, 'QUEST', [game]))[game.id].dataReady, true);
  delete directories['/sdcard/vtmb/Unofficial_Patch/scripts/'];
  assert.equal((await inspectDevice(adb, 'QUEST', [game]))[game.id].dataReady, false);
});

test('Bloodlines patch transfer copies only verified creator payloads to the expected root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'resource-patch-test-'));
  try {
    await fs.mkdir(path.join(root, 'Unofficial_Patch', 'scripts'), { recursive: true });
    await fs.writeFile(path.join(root, 'Unofficial_Patch', 'scripts', 'liblist.gam'), 'game');
    await fs.writeFile(path.join(root, 'pack.json'), '{}');
    await fs.mkdir(path.join(root, 'credits'));
    await fs.writeFile(path.join(root, 'credits', 'readme.txt'), 'credits');
    const calls = [];
    const adb = { async run(args) { calls.push(args); return args.join(' ').includes('ls -1 /sdcard/vtmb/Unofficial_Patch/scripts/') ? 'liblist.gam\n' : ''; } };
    await transferResourcePatch(adb, 'QUEST', root);
    assert.deepEqual(calls.filter((args) => args[2] === 'push').map((args) => args.at(-1)), ['/sdcard/vtmb/', '/sdcard/vtmb/', '/sdcard/vtmb/']);
    assert.ok(calls.some((args) => args.join(' ').includes('Vampire/.vtmb-index')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Bloodlines patch uses the ZIP release downloader and rejects stale releases', async () => {
  const game = getCatalog().find((entry) => entry.id === 'vtmb-resource');
  let downloaded = false;
  const releases = {
    latest: async (source) => { assert.deepEqual(source, game.patchSource); return { stale: true }; },
    downloadPackage: async () => { downloaded = true; },
  };
  await assert.rejects(prepareResourcePatch(releases, game.patchSource), /could not be confirmed/);
  assert.equal(downloaded, false);
});
