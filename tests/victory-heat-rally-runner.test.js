const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const path = require('node:path');
const { validateVictoryHeatInput, runVictoryHeatBuild } = require('../src/victory-heat-runner');

test('Victory Heat Rally accepts a game folder with data.win', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-vhr-'));
  try {
    await fs.writeFile(path.join(root, 'data.win'), 'test game data');
    assert.deepEqual(await validateVictoryHeatInput({ gamePackage: root, serial: 'QUEST3' }), { gamePackage: root, serial: 'QUEST3' });
    assert.deepEqual(await validateVictoryHeatInput({ gamePackage: path.join(root, 'data.win'), serial: 'QUEST3' }), { gamePackage: root, serial: 'QUEST3' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Victory Heat Rally runs the official builder in build-only mode then installs to selected Quest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-vhr-'));
  const game = path.join(root, 'owned-game');
  const calls = [];
  try {
    await fs.mkdir(game);
    await fs.writeFile(path.join(game, 'data.win'), 'test game data');
    await fs.writeFile(path.join(root, 'creator.zip'), 'official builder fixture');
    const release = { tag: 'v1.1', assetName: 'VictoryHeatRallyVR-Quest-v1.1.zip', downloadUrl: 'https://github.com/segadreamcat/VictoryHeatRallyVR-Quest/releases/download/v1.1/VictoryHeatRallyVR-Quest-v1.1.zip' };
    let extracts = 0;
    const input = { gamePackage: game, serial: 'QUEST3', workspaceRoot: root,
      releases: { latest: async (source) => { assert.equal(source.repo, 'segadreamcat/VictoryHeatRallyVR-Quest'); return release; }, downloadPackage: async () => path.join(root, 'creator.zip') },
      adb: { run: async (args) => { calls.push(args); return 'Success'; } },
      extract: async (_zip, destination) => {
        extracts++;
        await fs.mkdir(path.join(destination, 'build'), { recursive: true });
        await fs.writeFile(path.join(destination, 'Install-Quest.ps1'), 'author script');
      },
      build: async (script, args) => {
        assert.equal(path.basename(script), 'Install-Quest.ps1');
        assert.deepEqual(args, ['-GameDirectory', game, '-BuildOnly']);
        await fs.mkdir(path.join(path.dirname(script), 'build'), { recursive: true });
        await fs.writeFile(path.join(path.dirname(script), 'build', 'VHRQuest.apk'), 'personal APK');
      },
      inspectApk: async () => 'com.segadreamcat.vhrquest',
    };
    const result = await runVictoryHeatBuild(input);
    assert.equal(result.packageId, 'com.segadreamcat.vhrquest');
    assert.deepEqual(calls[0].slice(0, 5), ['-s', 'QUEST3', 'install', '-r', path.join(result.workDir, 'build', 'VHRQuest.apk')]);
    assert.equal((await fs.stat(path.join(result.workDir, 'build')).catch(() => null)), null, 'personal APK is cleaned after installation');
    const second = await runVictoryHeatBuild(input);
    assert.equal(second.workDir, result.workDir, 'the same verified builder kit is reused');
    assert.equal(extracts, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Victory Heat Rally refuses a substituted GitHub builder URL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-vhr-'));
  try {
    await fs.writeFile(path.join(root, 'data.win'), 'owned fixture');
    await assert.rejects(runVictoryHeatBuild({ gamePackage: root, serial: 'Q3', workspaceRoot: root,
      releases: { latest: async () => ({ tag: 'v1.1', assetName: 'VictoryHeatRallyVR-Quest-v1.1.zip', downloadUrl: 'https://github.com/attacker/repack/releases/download/v1.1/VictoryHeatRallyVR-Quest-v1.1.zip' }), downloadPackage: async () => { throw new Error('must not download'); } },
      adb: { run: async () => {} }, source: { repo: 'attacker/repack', assetPattern: '.*' },
    }), /official.*release|untrusted/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

const { runLinuxBuilder } = require('../src/victory-heat-runner');

async function linuxKit({ withBackupOnly = false, pngs = 65, sha = 'x' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-vhr-linux-'));
  const kit = path.join(root, 'kit');
  const game = path.join(root, 'game');
  for (const file of ['quest/Patch-Quest.csx', 'quest/Build-Apk.csx', 'quest/AndroidManifest-quest.bin', 'runner/gamemaker-runner-2024.8.apk', 'bin/libvhrvr.so', 'bin/VHRQuest.dex']) {
    await fs.mkdir(path.dirname(path.join(kit, file)), { recursive: true });
    await fs.writeFile(path.join(kit, file), file);
  }
  await fs.mkdir(path.join(kit, 'quest', 'art'), { recursive: true });
  for (let i = 0; i < pngs; i++) await fs.writeFile(path.join(kit, 'quest', 'art', `${i}.png`), 'png');
  await fs.mkdir(path.join(kit, 'tools'), { recursive: true });
  const dataDir = withBackupOnly ? path.join(game, '.vhrvr-backup') : game;
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'data.win'), sha);
  if (withBackupOnly) await fs.writeFile(path.join(game, 'data.win'), 'modified by the PC mod');
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const downloads = [];
  const seams = {
    home, dataSha256: crypto.createHash('sha256').update(sha).digest('hex'),
    download: async (spec) => { downloads.push(spec); await fs.writeFile(spec.destination, 'fixture'); return spec.destination; },
    extract: async (_zip, destination) => { await fs.mkdir(destination, { recursive: true }); await fs.writeFile(path.join(destination, 'UndertaleModCli'), Buffer.from('\x7fELFfixture', 'latin1')); },
  };
  return { root, kit, game, home, downloads, seams, script: path.join(kit, 'Install-Quest.ps1') };
}

function fakeRunner(calls, { patchLine = 'Patched', buildLine = 'Built VHRQuest.apk', patchCode = 0, buildCode = 0 } = {}) {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    const patching = args.includes('-o');
    const line = patching ? patchLine : buildLine;
    options.onLine(line);
    if (patching && patchCode === 0) await fs.writeFile(args[args.indexOf('-o') + 1], 'droid');
    if (!patching && buildCode === 0) await fs.writeFile(options.env.VHRQ_OUT, 'apk');
    if (!patching) await fs.writeFile(options.env.VHRQ_KEY, 'key', { mode: 0o644 });
    return { code: patching ? patchCode : buildCode, signal: null, stdout: '', tail: [line] };
  };
}

test('Victory Heat Rally Linux build downloads the pinned CLI and loader then patches and builds with the creator scripts', async () => {
  const f = await linuxKit({ sha: 'verified data.win' });
  const calls = [];
  const logs = [];
  try {
    await runLinuxBuilder(f.script, ['-GameDirectory', f.game, '-BuildOnly'], (line) => logs.push(line), { ...f.seams, runner: fakeRunner(calls) });
    assert.deepEqual(f.downloads.map((d) => [d.name, d.sha256, d.maxBytes]), [
      ['UndertaleModTool CLI 0.9.2.0 (Ubuntu)', 'd182f00c0e5ced8d9252aa1f796374cfee077a3889a658e70b68685f9cd559c7', 80 * 1024 * 1024],
      ['OpenXR loader 1.1.63 for Android', '622419d2f6741c3443a3beb4779af0764318edd01830de967f24c741ebcded73', 20 * 1024 * 1024]]);
    assert.match(f.downloads[0].url, /UTMT_CLI_v0\.9\.2\.0-Ubuntu\.zip$/);
    const cli = path.join(f.kit, 'tools', 'UndertaleModCli', 'UndertaleModCli');
    assert.equal((await fs.stat(cli)).mode & 0o777, 0o755);
    assert.equal(calls.length, 2);
    const droid = path.join(f.kit, 'build', 'game.droid');
    assert.deepEqual([calls[0].command, calls[0].args], [cli, ['load', path.join(f.game, 'data.win'), '-s', path.join(f.kit, 'quest', 'Patch-Quest.csx'), '-o', droid, '-f']]);
    assert.deepEqual([calls[1].command, calls[1].args], [cli, ['load', droid, '-s', path.join(f.kit, 'quest', 'Build-Apk.csx')]]);
    for (const call of calls) {
      assert.equal(call.options.cwd, f.kit);
      assert.equal(call.options.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT, '1');
      assert.equal(call.options.env.VHRVR_PACKAGE, f.kit);
    }
    assert.deepEqual({ data: calls[1].options.env.VHRQ_DATA, game: calls[1].options.env.VHRQ_GAME, loader: calls[1].options.env.VHRQ_LOADER, out: calls[1].options.env.VHRQ_OUT, key: calls[1].options.env.VHRQ_KEY }, {
      data: droid, game: f.game, loader: path.join(f.kit, 'tools', 'openxr_loader_for_android-1.1.63.aar'), out: path.join(f.kit, 'build', 'VHRQuest.apk'), key: path.join(f.home, '.vhrquest-key.pem') });
    assert.equal((await fs.stat(path.join(f.home, '.vhrquest-key.pem'))).mode & 0o777, 0o600);
    assert.match(await fs.readFile(path.join(f.kit, 'build', 'patch.log'), 'utf8'), /Patched/);
    assert.match(await fs.readFile(path.join(f.kit, 'build', 'build.log'), 'utf8'), /Built VHRQuest\.apk/);
    assert.ok(logs.includes('Built VHRQuest.apk'));
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('Victory Heat Rally Linux build uses the PC VR mod backup when data.win was modified', async () => {
  const f = await linuxKit({ withBackupOnly: true, sha: 'original' });
  const calls = [];
  const logs = [];
  try {
    await runLinuxBuilder(f.script, ['-GameDirectory', f.game, '-BuildOnly'], (line) => logs.push(line), { ...f.seams, runner: fakeRunner(calls) });
    assert.equal(calls[0].args[1], path.join(f.game, '.vhrvr-backup', 'data.win'));
    assert.equal(calls[1].options.env.VHRQ_GAME, f.game);
    assert.ok(logs.includes('Using the original data.win saved by the PC VR mod.'));
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('Victory Heat Rally Linux build refuses an unsupported data.win and an incomplete kit before any download', async () => {
  const f = await linuxKit({ sha: 'verified' });
  const short = await linuxKit({ pngs: 64 });
  try {
    await assert.rejects(runLinuxBuilder(f.script, ['-GameDirectory', f.game, '-BuildOnly'], () => {}, { ...f.seams, dataSha256: '0'.repeat(64), runner: fakeRunner([]) }), /Unsupported or modified data\.win/);
    await assert.rejects(runLinuxBuilder(short.script, ['-GameDirectory', short.game, '-BuildOnly'], () => {}, { ...short.seams, runner: fakeRunner([]) }), /64 of 65/);
    await fs.rm(path.join(f.kit, 'bin', 'VHRQuest.dex'));
    await assert.rejects(runLinuxBuilder(f.script, ['-GameDirectory', f.game, '-BuildOnly'], () => {}, { ...f.seams, runner: fakeRunner([]) }), /missing bin\/VHRQuest\.dex/);
    assert.deepEqual([...f.downloads, ...short.downloads], []);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); await fs.rm(short.root, { recursive: true, force: true }); }
});

test('Victory Heat Rally Linux build fails on a nonzero exit, a failure line or a missing output', async () => {
  const cases = [
    [{ patchCode: 1 }, /Patching failed\. See build\/patch\.log/],
    [{ patchLine: 'Script execution failed: boom' }, /Patching failed.*Script execution failed: boom/],
    [{ patchLine: 'Compile errors occurred' }, /Patching failed/],
    [{ buildCode: 1 }, /Building the APK failed\. See build\/build\.log/],
    [{ buildLine: 'System.InvalidOperationException: Missing VHRQ_KEY' }, /Building the APK failed.*Missing VHRQ_KEY/],
  ];
  for (const [behaviour, expected] of cases) {
    const f = await linuxKit({ sha: 'verified' });
    try {
      await assert.rejects(runLinuxBuilder(f.script, ['-GameDirectory', f.game, '-BuildOnly'], () => {}, { ...f.seams, runner: fakeRunner([], behaviour) }), expected, JSON.stringify(behaviour));
    } finally { await fs.rm(f.root, { recursive: true, force: true }); }
  }
});

test('Victory Heat Rally Linux build rejects a CLI archive without a Linux executable', async () => {
  const windows = await linuxKit({ sha: 'verified' });
  const empty = await linuxKit({ sha: 'verified' });
  try {
    await assert.rejects(runLinuxBuilder(windows.script, ['-GameDirectory', windows.game, '-BuildOnly'], () => {}, { ...windows.seams, runner: fakeRunner([]),
      extract: async (_zip, destination) => { await fs.mkdir(destination, { recursive: true }); await fs.writeFile(path.join(destination, 'UndertaleModCli'), 'MZ'); } }), /not a Linux executable/);
    await assert.rejects(runLinuxBuilder(empty.script, ['-GameDirectory', empty.game, '-BuildOnly'], () => {}, { ...empty.seams, runner: fakeRunner([]),
      extract: async (_zip, destination) => { await fs.mkdir(destination, { recursive: true }); } }), /no UndertaleModCli/);
  } finally { await fs.rm(windows.root, { recursive: true, force: true }); await fs.rm(empty.root, { recursive: true, force: true }); }
});
