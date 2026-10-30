const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
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
