const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateJurassicInput, jurassicBuildSteps, resolvePhysxFolder, bashArgs, runJurassicBuild } = require('../src/jurassic-runner');

test('Jurassic Park requires the exact owned game revision and PhysX libraries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-jp-test-'));
  try {
    const game = path.join(root, 'game');
    const libs = path.join(root, 'libs');
    await fs.mkdir(game); await fs.mkdir(libs);
    await fs.writeFile(path.join(game, 'game'), 'wrong revision');
    await assert.rejects(validateJurassicInput({ serial: 'Q3', gamePackage: game, audioSource: libs }), /v1\.08|SHA-256/i);
    const required = ['g5/dino/data', 'g5/shaders', 'g5/g5engine', 'pmuser', 'programs_dec', 'g5/dino/data/programs_enc'];
    for (const name of required) await fs.mkdir(path.join(game, name), { recursive: true });
    await assert.rejects(validateJurassicInput({ serial: 'Q3', gamePackage: game, audioSource: libs }, { expectedGameHash: 'ignored', hashFile: async () => 'ignored' }), /PhysX/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Jurassic Park can find PhysX inside a supplied game folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-jp-test-'));
  try {
    const nested = path.join(root, 'TeknoParrot', 'ElfLdr2', 'libs');
    await fs.mkdir(nested, { recursive: true });
    assert.equal(await resolvePhysxFolder(root), nested);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Jurassic Park runs the author preparation, build, and selected-headset install scripts', () => {
  const steps = jurassicBuildSteps();
  assert.deepEqual(steps.map((step) => step.script), [
    'tools/setup/fetch_deps.sh', 'tools/setup/prepare_game.sh', 'tools/build_all.sh', 'tools/quest/install.sh',
  ]);
  assert.deepEqual(steps[1].inputs, ['gamePackage', 'audioSource']);
  assert.equal(steps[3].inputs[0], 'gamePackage');
  const args = bashArgs(steps[1], { gamePackage: 'E:\\Owned Games\\Jurassic', audioSource: 'D:\\PhysX libs' });
  assert.equal(args.at(-2), 'E:\\Owned Games\\Jurassic');
  assert.equal(args.at(-1), 'D:\\PhysX libs');
  assert.match(args[1], /cygpath -u "\$1"/);
  assert.match(args[1], /cygpath -u "\$2"/);
});

test('Jurassic Park keeps one source checkout and signs updates with the same build folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-jp-build-'));
  const gamePackage = path.join(root, 'owned-game');
  const workspaceRoot = path.join(root, 'workspace');
  const source = path.join(workspaceRoot, 'jurassic-park-arcade-vr', 'source');
  const calls = [];
  const log = () => {};
  const runProgram = async (program, args) => {
    calls.push([program, ...args]);
    if (args[0] === 'clone') {
      await fs.mkdir(path.join(source, '.git'), { recursive: true });
      for (const step of jurassicBuildSteps()) {
        const file = path.join(source, step.script);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, '#!/bin/sh\n');
      }
    }
    if (args[1]?.includes('tools/build_all.sh')) {
      const apk = path.join(source, 'tools', 'quest', 'out', 'jp2015vr.apk');
      await fs.mkdir(path.dirname(apk), { recursive: true });
      await fs.writeFile(apk, 'test apk');
    }
  };
  const options = { workspaceRoot, adbPath: 'adb.exe', onLog: log, freeBytes: 20 * 1024 ** 3,
    findTools: async () => ({ git: 'git.exe', bash: 'bash.exe', python: 'python.exe', sdk: 'SDK', javaHome: 'JDK', adb: 'adb.exe' }),
    gitExec: async (_program, args) => ({ stdout: args.includes('rev-parse') ? 'a'.repeat(40) : 'https://github.com/Lovecore/jurassic-park-arcade-quest.git' }), runProgram };
  try {
    await fs.mkdir(gamePackage);
    const input = { serial: 'Q3-SELECTED', gamePackage, audioSource: gamePackage };
    assert.equal((await runJurassicBuild(input, options)).packageId, 'com.jp2015.vr');
    assert.equal(calls.filter((call) => call[1] === 'clone').length, 1);
    assert.ok(calls.some((call) => call[0] === 'adb.exe' && call.includes('Q3-SELECTED')));
    calls.length = 0;
    await runJurassicBuild(input, options);
    assert.equal(calls.filter((call) => call[1] === 'clone').length, 0);
    assert.ok(calls.some((call) => call.includes('fetch')));
    assert.ok(calls.some((call) => call.includes('checkout')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
