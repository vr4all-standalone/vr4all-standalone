const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease } = require('../src/core');
const { acquireSourceKit } = require('../src/personal-build');
const { validateMarioInput, runMarioBuild } = require('../src/mario64mr-runner');

test('Mario MR rejects an invalid ROM before fetching tools or a release', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-mario-invalid-'));
  try {
    const rom = path.join(root, 'wrong.z64');
    await fs.writeFile(rom, Buffer.alloc(64));
    await assert.rejects(validateMarioInput({ gamePackage: rom, serial: 'Q3' }), /Super Mario 64.*USA/i);
    await assert.rejects(validateMarioInput({ gamePackage: rom, serial: 'bad serial' }), /connected Quest/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Mario MR selects the Quest APK, not Steam Frame or Pico assets', () => {
  const game = getCatalog().find((item) => item.id === 'mario64mr');
  const release = [{ tag_name: 'v1.3', published_at: '2026-11-13T00:00:00Z', assets: [
    { name: 'Mario64MR-SteamFrame.apk', browser_download_url: 'https://github.com/lucas-martinic/mario64mr/releases/download/v1.3/Mario64MR-SteamFrame.apk' },
    { name: 'Mario64MR.apk', browser_download_url: 'https://github.com/lucas-martinic/mario64mr/releases/download/v1.3/Mario64MR.apk' },
  ] }];
  assert.equal(selectRelease(release, game.source).assetName, 'Mario64MR.apk');
});

test('Mario MR source cache accepts only a creator kit with unattended Windows build flags', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-mario-source-'));
  try {
    const sha = 'a'.repeat(40);
    const fetchImpl = async (url) => url.includes('/commits/')
      ? new Response(JSON.stringify({ sha }), { status: 200 }) : new Response('zip fixture', { status: 200 });
    const extract = async (_zip, destination) => {
      const kit = path.join(destination, `mario64mr-${sha}`);
      for (const [name, content] of [
        ['install_mario64mr.py', 'print("creator")'],
        ['windows/make_game.sh', 'echo creator'],
        ['windows/install_mario64mr.ps1', 'param([string]$Rom, [switch]$NoPush)'],
      ]) {
        await fs.mkdir(path.dirname(path.join(kit, name)), { recursive: true });
        await fs.writeFile(path.join(kit, name), content);
      }
    };
    const first = await acquireSourceKit('mario64mr', root, () => {}, { platform: 'win32', fetchImpl, extract });
    const second = await acquireSourceKit('mario64mr', root, () => {}, { platform: 'win32', fetchImpl, extract });
    assert.equal(first.sha, sha);
    assert.equal(first.directory, second.directory);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Mario MR stops before downloads when the selected PC build folder lacks first-build space', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-mario-space-'));
  try {
    let fetched = false;
    await assert.rejects(runMarioBuild({ gamePackage: 'owned.z64', serial: 'Q3' }, {
      workspaceRoot: root, platform: 'win32', availableBytes: async () => 100,
      validateInput: async (input) => input, adb: { run: async () => '' },
      releases: { latest: async () => { fetched = true; return {}; }, download: async () => '' },
      source: { repo: 'lucas-martinic/mario64mr', assetPattern: '^Mario64MR\\.apk$' },
      inspectApk: async () => '',
    }), /4 GB.*PC build folder/i);
    assert.equal(fetched, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Mario MR builds without pushing, then installs and verifies data on the selected Quest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-mario-run-'));
  try {
    const rom = path.join(root, 'mario.z64');
    const apk = path.join(root, 'Mario64MR.apk');
    await fs.writeFile(rom, Buffer.from('owned-rom'));
    await fs.writeFile(apk, Buffer.from('creator-apk'));
    const calls = [];
    const kit = path.join(root, 'source');
    const out = path.join(kit, 'Mario64MRData');
    const files = ['baserom.us.z64', 'sm64/res/base.zip', 'native/libsm64game.so', 'native/libgoddard.so', 'native/libsm64.so'];
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(out, file)), { recursive: true });
      await fs.writeFile(path.join(out, file), Buffer.from(file));
    }
    let dataFolderChecked = false;
    const adb = { run: async (args) => {
      calls.push(args);
      if (args.includes('ls') && args.at(-1) === '/sdcard/Android/data/com.lucasmartinic.mario64mr/files') {
        if (!dataFolderChecked) { dataFolderChecked = true; throw new Error('folder absent'); }
        return 'Mario64MRData';
      }
      if (args.includes('stat')) {
        const remote = String(args.at(-1)).replaceAll("'", '');
        const local = files.find((file) => remote.endsWith(file));
        return String(Buffer.byteLength(local || ''));
      }
      return 'Success';
    }, getPath: () => 'adb.exe' };
    const release = { tag: 'v1.3', assetName: 'Mario64MR.apk' };
    const result = await runMarioBuild({ gamePackage: rom, serial: 'Q3-serial' }, {
      workspaceRoot: root, platform: 'win32', adb,
      availableBytes: async () => 10 * 1024 ** 3,
      validateInput: async (input) => input,
      withBuildPath: async (work, operation) => operation(work),
      sourceKit: async () => ({ sha: 'a'.repeat(40), directory: kit }),
      releases: { latest: async () => release, download: async () => apk },
      source: getCatalog().find((game) => game.id === 'mario64mr').source,
      inspectApk: async () => 'com.lucasmartinic.mario64mr',
      runCommand: async (command, args, options) => {
        calls.push([command, ...args]);
        assert.equal(options.env.LOCALAPPDATA, path.join(root, 'mario64mr'));
        return { code: 0, tail: ['Done.'] };
      },
    });
    assert.equal(result.sha, 'a'.repeat(40));
    assert.equal(result.packageId, 'com.lucasmartinic.mario64mr');
    assert.ok(calls.some((args) => args[0] === 'powershell.exe' && args.includes('-NoPush') && args.includes(rom)));
    assert.ok(calls.some((args) => args.includes('install') && args.includes('Q3-serial') && args.includes(apk)));
    assert.ok(calls.some((args) => args.includes('monkey') && args.includes('com.lucasmartinic.mario64mr')));
    assert.ok(calls.findIndex((args) => args.includes('monkey')) < calls.findIndex((args) => args.includes('push')));
    assert.equal(calls.filter((args) => args.includes('push')).length, 5);
    assert.equal(calls.filter((args) => args.includes('stat')).length, 5);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
