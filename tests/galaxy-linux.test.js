const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { installGalaxyQuest, convertWithCookScript, gamePartition } = require('../src/galaxyquest-runner');
const { sevenZipBinary } = require('./helpers/seven-zip');

const exec = promisify(execFile);
const cookOk = 'cooked 1 disc files in 0.1s';

async function writePartition(folder) {
  await fs.mkdir(path.join(folder, 'sys'), { recursive: true });
  await fs.mkdir(path.join(folder, 'files', 'ObjectData'), { recursive: true });
  await fs.mkdir(path.join(folder, 'files', 'StageData'), { recursive: true });
  await fs.writeFile(path.join(folder, 'sys', 'fst.bin'), 'fst');
  await fs.writeFile(path.join(folder, 'sys', 'main.dol'), 'dol');
}

async function fixture(run, { source = 'folder' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-galaxy-linux-'));
  const staged = path.join(root, 'converter-src', 'GalaxyQuest-converter', 'tools', 'cook');
  await fs.mkdir(staged, { recursive: true });
  await fs.writeFile(path.join(staged, 'cook.py'), '# stub');
  const converterPath = path.join(root, 'GalaxyQuest-converter.zip');
  await exec(sevenZipBinary(), ['a', '-tzip', converterPath, 'GalaxyQuest-converter'], { cwd: path.join(root, 'converter-src') });
  const apkPath = path.join(root, 'port.apk');
  await fs.writeFile(apkPath, 'apk');
  const gamePath = path.join(root, source === 'folder' ? 'disc' : 'owned.iso');
  if (source === 'folder') await writePartition(gamePath);
  else await fs.writeFile(gamePath, 'disc image');
  const calls = [];
  const adb = { run: async (args) => { calls.push(args); return ''; } };
  try {
    return await run({ root, converterPath, apkPath, gamePath, adb, calls });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

function install({ root, converterPath, apkPath, gamePath, adb }, seams) {
  return installGalaxyQuest({
    apkPath, converterPath, gamePath, serial: 'Q3', workRoot: path.join(root, 'work'), adb, inspectApk: async () => 'com.galaxy.quest',
    convert: (zip, source, output, onLog, context) => convertWithCookScript(zip, source, output, onLog, { ...context, ...seams }),
  });
}

// Fakes python: the version probe passes, and cook.py writes `produce` into its output folder.
function fakeRunner(produce, record = []) {
  return async (command, args, options) => {
    record.push({ command, args, options });
    if (args[0] === '-c') return { code: 0, signal: null, stdout: '', tail: [] };
    return produce(args, options);
  };
}

const cooked = async (args) => {
  await fs.mkdir(path.join(args[2], 'sys'), { recursive: true });
  await fs.writeFile(path.join(args[2], 'sys', 'fst.bin'), 'fst');
  await fs.mkdir(path.join(args[2], 'files'), { recursive: true });
  await fs.writeFile(path.join(args[2], 'files', 'a.bin'), 'a');
  return { code: 0, signal: null, stdout: `main.dol: ok\n${cookOk}\n`, tail: [cookOk] };
};
const findTool = (names) => ({ python3: '/usr/bin/python3', 'dolphin-tool': '/usr/bin/dolphin-tool' })[names[0]] || null;

test('GalaxyQuest on Linux cooks an extracted disc folder with cook.py and transfers it', async () => {
  await fixture(async (env) => {
    const record = [];
    const result = await install(env, { findTool, runner: fakeRunner(cooked, record) });
    assert.equal(result.packageId, 'com.galaxy.quest');
    assert.equal(record.length, 2);
    assert.deepEqual(record[0].args, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)']);
    const cook = record[1];
    assert.equal(cook.command, '/usr/bin/python3');
    assert.match(cook.args[0].replaceAll('\\', '/'), /\/converter\/GalaxyQuest-converter\/tools\/cook\/cook\.py$/);
    assert.equal(cook.args[1], env.gamePath);
    assert.match(path.basename(cook.args[2]), /^converted$/);
    assert.deepEqual(cook.args.slice(3), ['--with-movies', '--jobs', String(Math.min(os.cpus().length, 8))]);
    assert.equal(cook.options.cwd, path.dirname(cook.args[0]));
    assert.equal(cook.options.captureStdout, true);
    assert.equal(cook.options.timeoutMs, 2 * 60 * 60 * 1000);
    assert.ok(env.calls.some((args) => args.includes('tar')) && env.calls.some((args) => args.includes('touch')));
  });
});

test('GalaxyQuest on Linux hands cook.py the DATA subfolder of a wrapped disc folder', async () => {
  await fixture(async (env) => {
    const wrapped = path.join(env.root, 'wrapped');
    await writePartition(path.join(wrapped, 'DATA'));
    const record = [];
    await install({ ...env, gamePath: wrapped }, { findTool, runner: fakeRunner(cooked, record) });
    assert.equal(record[1].args[1], path.join(wrapped, 'DATA'));
  });
});

test('GalaxyQuest on Linux extracts a disc image with dolphin-tool into a new folder before cooking', async () => {
  await fixture(async (env) => {
    const record = [];
    const runner = async (command, args, options) => {
      record.push({ command, args, options });
      if (args[0] === 'extract') { await writePartition(args[args.indexOf('-o') + 1]); return { code: 0, tail: [] }; }
      return fakeRunner(cooked)(command, args, options);
    };
    await install(env, { findTool, runner });
    const extract = record.find((call) => call.args[0] === 'extract');
    assert.equal(extract.command, '/usr/bin/dolphin-tool');
    assert.deepEqual(extract.args.slice(0, 3), ['extract', '-i', env.gamePath]);
    assert.equal(extract.args[3], '-o');
    assert.equal(path.basename(extract.args[4]), 'extracted');
    assert.deepEqual(extract.args.slice(5), ['--gameonly', '--quiet']);
    assert.equal(record.at(-1).args[1], extract.args[4]);
  }, { source: 'image' });
});

test('GalaxyQuest on Linux names dolphin-tool when a disc image needs it', async () => {
  await fixture(async (env) => {
    await assert.rejects(install(env, { findTool: (names) => names[0] === 'python3' ? '/usr/bin/python3' : null, runner: fakeRunner(cooked) }), /dolphin-tool.*pacman -S dolphin-emu-tool/);
  }, { source: 'image' });
});

test('GalaxyQuest on Linux reports a failed dolphin-tool extraction', async () => {
  await fixture(async (env) => {
    const runner = async (_command, args) => args[0] === 'extract' ? { code: 1, tail: ['Error: No partitions were extracted.'] } : { code: 0, tail: [] };
    await assert.rejects(install(env, { findTool, runner }), /dolphin-tool could not extract.*No partitions were extracted/);
  }, { source: 'image' });
});

test('GalaxyQuest on Linux surfaces the ERROR lines when cook.py fails', async () => {
  await fixture(async (env) => {
    const failing = fakeRunner(async () => ({ code: 1, signal: null, stdout: '', tail: ['main.dol: ok', 'ERROR x', 'ERROR y', 'note (3x): skipped'] }));
    await assert.rejects(install(env, { findTool, runner: failing }), /GalaxyQuest conversion failed: ERROR x \| ERROR y/);
    assert.equal(env.calls.length, 0);
  });
});

test('GalaxyQuest on Linux rejects a cook.py run that exits 0 without the success line or fst.bin', async () => {
  await fixture(async (env) => {
    const quiet = fakeRunner(async () => ({ code: 0, signal: null, stdout: 'nothing\n', tail: ['nothing'] }));
    await assert.rejects(install(env, { findTool, runner: quiet }), /GalaxyQuest conversion failed: nothing/);
    const noFst = fakeRunner(async () => ({ code: 0, signal: null, stdout: cookOk + '\n', tail: [cookOk] }));
    await assert.rejects(install(env, { findTool, runner: noFst }), /GalaxyQuest conversion failed/);
  });
});

test('GalaxyQuest on Linux refuses a folder that is not a whole disc before running cook.py', async () => {
  await fixture(async (env) => {
    await fs.rm(path.join(env.gamePath, 'files', 'StageData'), { recursive: true });
    const record = [];
    await assert.rejects(install(env, { findTool, runner: fakeRunner(cooked, record) }), /Select the whole extracted disc folder, or its DATA folder\./);
    assert.equal(record.length, 1);
  });
});

test('GalaxyQuest on Linux needs Python 3.8 or newer', async () => {
  await fixture(async (env) => {
    await assert.rejects(install(env, { findTool: () => null, runner: fakeRunner(cooked) }), /Python 3\.8 or newer \(python3\)/);
    const old = async () => ({ code: 1, tail: [] });
    await assert.rejects(install(env, { findTool, runner: old }), /Python 3\.8 or newer/);
  });
});

test('GalaxyQuest refuses a converter that is neither the Windows EXE nor the converter ZIP', async () => {
  await fixture(async (env) => {
    const tarball = path.join(env.root, 'converter.tar');
    await fs.writeFile(tarball, 'x');
    await assert.rejects(installGalaxyQuest({ apkPath: env.apkPath, converterPath: tarball, gamePath: env.gamePath, serial: 'Q3', workRoot: path.join(env.root, 'work'), adb: env.adb, inspectApk: async () => 'com.galaxy.quest' }), /Official GalaxyQuest converter is unavailable/);
  });
});

test('gamePartition accepts the folder itself or its DATA subfolder and nothing else', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-galaxy-partition-'));
  try {
    await writePartition(path.join(root, 'a'));
    await writePartition(path.join(root, 'b', 'DATA'));
    assert.equal(await gamePartition(path.join(root, 'a')), path.join(root, 'a'));
    assert.equal(await gamePartition(path.join(root, 'b')), path.join(root, 'b', 'DATA'));
    await fs.mkdir(path.join(root, 'c', 'sys'), { recursive: true });
    await assert.rejects(gamePartition(path.join(root, 'c')), /Select the whole extracted disc folder/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
