const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { acquireSourceKit } = require('../src/personal-build');
const { packages, inspectDevice } = require('../src/device-library');
const { validateBalatroInput, runBalatroBuild } = require('../src/balatro-runner');

test('Balatro VR is a source build with an owned game input and two Quest packages', () => {
  const game = getCatalog().find((item) => item.id === 'balatro-vr');
  assert.equal(game.gameName, 'Balatro');
  assert.equal(game.console, 'PC');
  assert.equal(game.genre, 'Card game');
  assert.equal(game.source, undefined);
  assert.equal(game.personalBuild.gameLabel.includes('Balatro.exe'), true);
  assert.equal(packages[game.id], 'io.github.balaurent.balatrovr.host');
  assert.match(game.art, /balatro-vr\.png$/);
});

test('Balatro input must be an owned, regular Balatro.exe path and a selected Quest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-balatro-input-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const exe = path.join(root, 'Balatro.exe');
  await fs.writeFile(exe, 'private owned fixture');
  assert.deepEqual(await validateBalatroInput({ gamePackage: exe, serial: 'Q3' }), { gamePackage: exe, serial: 'Q3' });
  await assert.rejects(() => validateBalatroInput({ gamePackage: exe, serial: 'bad serial' }), /Quest/);
  await assert.rejects(() => validateBalatroInput({ gamePackage: path.join(root, 'missing.exe'), serial: 'Q3' }), /Balatro\.exe/);
  await assert.rejects(() => validateBalatroInput({ gamePackage: path.join(root, 'other.exe'), serial: 'Q3' }), /Balatro\.exe/);
});

test('Balatro source cache pins the official commit and requires all three creator scripts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-balatro-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'a'.repeat(40);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return url.includes('/commits/') ? new Response(JSON.stringify({ sha }), { status: 200 })
      : new Response('zip fixture', { status: 200 });
  };
  let extracts = 0;
  const extract = async (_archive, destination) => {
    extracts++;
    const source = path.join(destination, `BalatroVRMod-Standalone-${sha}`);
    for (const name of ['quest/fetch_deps.sh', 'quest/build_client.sh', 'quest/host/build_host.py']) {
      const file = path.join(source, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'official fixture');
    }
  };
  const first = await acquireSourceKit('balatro-vr', root, () => {}, { fetchImpl, extract, platform: 'win32' });
  const second = await acquireSourceKit('balatro-vr', root, () => {}, { fetchImpl, extract, platform: 'win32' });
  assert.equal(first.sha, sha);
  assert.equal(first.directory, second.directory);
  assert.equal(extracts, 1);
  assert.ok(urls.includes(`https://codeload.github.com/BaLaurent/BalatroVRMod-Standalone/zip/${sha}`));
});

test('Balatro builder runs the creator scripts, verifies both APKs, and installs both', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-balatro-build-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const exe = path.join(root, 'Balatro.exe');
  await fs.writeFile(exe, 'private owned fixture');
  const kitDir = path.join(root, 'source');
  const commands = [];
  const installs = [];
  const result = await runBalatroBuild({ gamePackage: exe, serial: 'Q3' }, {
    platform: 'linux', workspaceRoot: root,
    sourceKit: async () => ({ sha: 'a'.repeat(40), repo: 'BaLaurent/BalatroVRMod-Standalone', directory: kitDir }),
    runCommand: async (command, args) => {
      commands.push([command, ...args]);
      const outputDir = args.at(-2);
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(path.join(outputDir, 'BalatroInVR-Quest.apk'), 'client');
      await fs.writeFile(path.join(outputDir, 'BalatroVRHost.apk'), 'host');
      return { code: 0, tail: [] };
    },
    inspectApk: async (file) => file.endsWith('BalatroInVR-Quest.apk') ? 'io.github.balaurent.balatroinvr' : 'io.github.balaurent.balatrovr.host',
    adb: { run: async (args) => { installs.push(args); return 'Success'; } },
  });
  assert.equal(result.sha, 'a'.repeat(40));
  assert.equal(result.packageId, 'io.github.balaurent.balatrovr.host');
  assert.equal(commands.length, 1);
  assert.match(commands[0].join(' '), /quest\/fetch_deps\.sh/);
  assert.match(commands[0].join(' '), /quest\/build_client\.sh/);
  assert.match(commands[0].join(' '), /quest\/host\/build_host\.py/);
  assert.equal(installs.length, 2);
  assert.equal(installs[0][1], 'Q3');
  assert.match(installs[0].at(-1), /BalatroInVR-Quest\.apk$/);
  assert.match(installs[1].at(-1), /BalatroVRHost\.apk$/);
});

test('Balatro builder refuses a wrong APK identity before touching the headset', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-balatro-wrong-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const exe = path.join(root, 'Balatro.exe');
  await fs.writeFile(exe, 'private owned fixture');
  const kitDir = path.join(root, 'source');
  await fs.mkdir(path.join(kitDir, 'Release'), { recursive: true });
  let installs = 0;
  await assert.rejects(() => runBalatroBuild({ gamePackage: exe, serial: 'Q3' }, {
    platform: 'linux', workspaceRoot: root,
    sourceKit: async () => ({ sha: 'a'.repeat(40), directory: kitDir }),
    runCommand: async (_command, args) => {
      const outputDir = args.at(-2);
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(path.join(outputDir, 'BalatroInVR-Quest.apk'), 'client');
      await fs.writeFile(path.join(outputDir, 'BalatroVRHost.apk'), 'host');
      return { code: 0, tail: [] };
    },
    inspectApk: async () => 'wrong.package',
    adb: { run: async () => { installs++; return 'Success'; } },
  }), /package/);
  assert.equal(installs, 0);
});

test('Balatro on Windows reports missing WSL before downloading source or using ADB', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-balatro-wsl-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const exe = path.join(root, 'Balatro.exe');
  await fs.writeFile(exe, 'private owned fixture');
  let downloads = 0;
  let installs = 0;
  await assert.rejects(() => runBalatroBuild({ gamePackage: exe, serial: 'Q3' }, {
    platform: 'win32', workspaceRoot: root,
    sourceKit: async () => { downloads++; },
    runCommand: async () => ({ code: 1, tail: ['No WSL distribution installed'] }),
    adb: { run: async () => { installs++; return 'Success'; } },
  }), /WSL2.*No WSL distribution installed/);
  assert.equal(downloads, 0);
  assert.equal(installs, 0);
});

test('Balatro is reported installed only when its host and VR client are present', async () => {
  const game = getCatalog().find((item) => item.id === 'balatro-vr');
  const adb = (listed) => ({ run: async (args) => args.includes('packages') ? listed : args.includes('dumpsys') ? 'versionName=1.1' : '' });
  assert.equal((await inspectDevice(adb('package:io.github.balaurent.balatrovr.host\n'), 'Q3', [game]))[game.id], undefined);
  assert.equal((await inspectDevice(adb('package:io.github.balaurent.balatrovr.host\npackage:io.github.balaurent.balatroinvr\n'), 'Q3', [game]))[game.id].dataReady, true);
});
