const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getCatalog } = require('../src/catalog');
const { GitHubReleases } = require('../src/releases');
const { installOfficialPlayer } = require('../src/official-player-runner');
const { inspectDevice } = require('../src/device-library');
const { sevenZipBinary } = require('./helpers/seven-zip');

const ports = [
  { id: 'forsaken-gameordie', parent: 'forsaken-vr', repo: 'Forsaken-VR', version: '1.2', apk: 'ForsakenVR.apk', packageId: 'net.gameordie.forsakenvr', files: { 'data/levels': 'levels.dat\nbattle.dat', 'data/levels/ship': 'ship.mxv' } },
  { id: 'unreal-gold-gameordie', parent: 'unreal-gold-vr', repo: 'Unreal-Gold-VR', version: '1.0.3', apk: 'UnrealGoldVR.apk', packageId: 'net.gameordie.unrealgoldvr', game: 'UG', files: { 'UT99/System': 'Core.u\nEngine.u\nUnrealI.u', 'UT99/Unreal/Maps': 'Vortex2.unr' } },
  { id: 'ut99-gameordie', parent: 'ut99-quest', repo: 'Unreal-Tournament-99-VR', version: '1.0.1', apk: 'UT99VR.apk', packageId: 'net.gameordie.ut99vr', game: 'UT', files: { 'UT99/System': 'Core.u\nEngine.u\nBotpack.u', 'UT99/Maps': 'CityIntro.unr' } },
];

for (const port of ports) {
  test(`${port.id}: discovers only the standalone Quest release as an alternate developer choice`, async () => {
    const game = getCatalog().find((entry) => entry.id === port.id);
    assert.ok(game, 'new port is catalogued');
    assert.equal(game.variantOf, port.parent);
    assert.equal(game.art, getCatalog().find((entry) => entry.id === port.parent).art);
    const repo = `GameOrDie007/${port.repo}`;
    const releases = new GitHubReleases();
    releases.publicText = async (url) => ({ finalUrl: url, content: url.includes('expanded_assets')
      ? ['PCVR.zip', 'Quest.zip', 'Installer.exe'].map((suffix) => `<li class="Box-row"><a href="/${repo}/releases/download/v${port.version}/${port.repo}-${port.version}-${suffix}">Download</a></li>`).join('')
      : `<section id="release-v${port.version}"><a href="/${repo}/releases/tag/v${port.version}">Release</a><relative-time datetime="2026-11-01T00:00:00Z"></relative-time></section>` });
    const release = await releases.publicLatest(game.source);
    assert.equal(release.assetName, `${port.repo}-${port.version}-Quest.zip`);
  });

  test(`${port.id}: runs noninteractive creator setup without local data and on repeated installs`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-god-'));
    const bundle = path.join(root, 'Creator release with spaces', 'files');
    const archive = path.join(root, 'creator.zip');
    const adbPath = path.join(__dirname, '..', 'vendor', 'platform-tools', 'adb.exe');
    const commands = [];
    const setups = [];
    try {
      await fs.mkdir(bundle, { recursive: true });
      await fs.writeFile(path.join(bundle, 'setup-quest.ps1'), '# unmodified creator installer fixture');
      await fs.writeFile(path.join(bundle, port.apk), 'creator APK fixture');
      const packed = spawnSync(sevenZipBinary(), ['a', '-tzip', archive, 'Creator release with spaces'], { cwd: root, windowsHide: true });
      assert.equal(packed.status, 0, String(packed.stderr));
      const input = { gameId: port.id, serial: 'QUEST-SELECTED', adbPath, zipPath: archive, workRoot: root, platform: 'win32',
        adb: { run: async (args) => { commands.push(args); return 'Success'; } },
        inspectApk: async (file) => { assert.equal(path.basename(file), port.apk); return port.packageId; },
        runScript: async (script, args) => {
          assert.equal(await fs.readFile(script, 'utf8'), '# unmodified creator installer fixture');
          assert.ok(args.includes('-Quiet') && args.includes('-NoSearch') && args.includes('-Json'));
          assert.equal(args[args.indexOf('-Serial') + 1], 'QUEST-SELECTED');
          assert.equal(args[args.indexOf('-Adb') + 1], adbPath);
          assert.equal(args.includes('-GamePath'), false);
          if (port.game) assert.equal(args[args.indexOf('-Game') + 1], port.game);
          setups.push(args);
        } };
      assert.equal((await installOfficialPlayer(input)).updatedOnly, false);
      assert.equal((await installOfficialPlayer(input)).updatedOnly, false);
      assert.equal(setups.length, 2, 'updates must prepare bundled companion files too');
      assert.deepEqual(commands, [], 'runner must not take the APK-only update shortcut');
      const owned = path.join(root, 'Owned game');
      await fs.mkdir(owned); await fs.writeFile(path.join(owned, 'game.dat'), 'owned fixture');
      if (port.id !== 'ut99-gameordie') {
        await installOfficialPlayer({ ...input, gamePath: owned, runScript: async (_script, args) => {
          assert.equal(args[args.indexOf('-GamePath') + 1], owned);
        } });
      }
      await assert.rejects(installOfficialPlayer({ ...input, inspectApk: async () => 'wrong.creator.app' }), /package|identity/i);
      assert.equal(setups.length, 2, 'wrong APK must not reach creator setup');
      assert.equal((await fs.readdir(root)).some((name) => name.startsWith('vr4all-player-')), false);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  test(`${port.id}: recognizes its own app and real data, not another developer or empty folders`, async () => {
    const game = getCatalog().find((entry) => entry.id === port.id);
    assert.ok(game, 'new port is catalogued');
    const files = new Map();
    let installed = true;
    const adb = { run: async (args) => {
      assert.equal(args[1], 'SELECTED');
      const command = args.slice(2).join(' ');
      if (command === 'shell pm list packages -3') return installed ? `package:${port.packageId}` : 'package:com.bilko.forsakenvr\npackage:com.ghwstvr.ut99quest';
      if (command.startsWith('shell dumpsys package ')) return `versionName=${port.version}`;
      if (command.startsWith('shell ls -1 ')) return files.get(command.slice('shell ls -1 '.length)) || '';
      return '';
    } };
    assert.equal((await inspectDevice(adb, 'SELECTED', [game]))[game.id]?.dataReady, false);
    for (const [dir, listing] of Object.entries(port.files)) files.set(`/sdcard/Android/data/${port.packageId}/files/${dir}`, listing);
    assert.equal((await inspectDevice(adb, 'SELECTED', [game]))[game.id]?.dataReady, true);
    files.clear();
    assert.equal((await inspectDevice(adb, 'SELECTED', [game]))[game.id]?.dataReady, false);
    installed = false;
    assert.equal((await inspectDevice(adb, 'SELECTED', [game]))[game.id], undefined);
  });
}
