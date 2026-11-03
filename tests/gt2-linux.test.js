const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { installGt2Linux, WRAPPER } = require('../src/gt2-linux');
const { sevenZipBinary } = require('./helpers/seven-zip');

const manifest = (overrides = {}) => '\uFEFF' + JSON.stringify({ version: '0.9.0', package: 'io.github.gt2pc.quest', files: [{ path: 'GT2-VR-0.9.0.apk', bytes: 3, sha256: 'x' }], ...overrides });
const verified = ['Release files verified.', 'Installation verified. Launch GT2 VR from Unknown Sources on Quest. No PC is needed to play.'];
const findTool = () => '/usr/bin/python3';

async function fixture(run, { manifestText = manifest(), script = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-gt2-linux-'));
  const release = path.join(root, 'release');
  const native = path.join(release, 'GT2-0.9.0', 'native');
  await fs.mkdir(path.join(native, 'scripts'), { recursive: true });
  const apk = path.join(native, 'GT2-VR-0.9.0.apk');
  await fs.writeFile(apk, 'apk');
  await fs.writeFile(path.join(native, 'release-manifest.json'), manifestText);
  if (script) await fs.writeFile(path.join(native, 'scripts', 'install-linux.py'), '# stub');
  const work = path.join(root, 'work');
  await fs.mkdir(work);
  const bin = path.join(root, 'disc.bin');
  await fs.writeFile(bin, 'disc');
  try { return await run({ root, release, native, apk, work, bin, args: { release, apk, gamePath: bin, serial: 'Q3', adbPath: '/opt/adb', work, onLog: () => {} } }); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

// A fake process runner: answers the Python probe, then `installer` answers the wrapped install.
const fakeRunner = (record, installer = async () => ({ code: 0, tail: verified })) => async (command, args, options) => {
  record.push({ command, args, options });
  return args[0] === '-c' ? { code: 0, tail: [] } : installer(args, options);
};

test('GT2 on Linux runs the creator installer through the version wrapper against the selected Quest', async () => {
  await fixture(async ({ args, native, work, bin }) => {
    const record = [];
    const logs = [];
    const result = await installGt2Linux({ ...args, onLog: (line) => logs.push(line) }, { findTool, runner: async (command, runArgs, options) => {
      if (runArgs[0] !== '-c') options.onLine('Release files verified.');
      return fakeRunner(record)(command, runArgs, options);
    } });
    assert.deepEqual(result, {});
    assert.deepEqual(record[0].args, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)']);
    const install = record[1];
    assert.equal(install.command, '/usr/bin/python3');
    assert.deepEqual(install.args, ['-u', '-c', WRAPPER, native, '--disc', bin, '--runtime', path.join(work, 'runtime'), '--adb', '/opt/adb', '--serial', 'Q3', '--no-bios']);
    assert.equal(install.options.cwd, native);
    assert.equal(install.options.env.PYTHONDONTWRITEBYTECODE, '1');
    assert.equal(install.options.timeoutMs, 90 * 60 * 1000);
    assert.deepEqual(logs, ['Release files verified.']);
  });
});

test('the GT2 wrapper sets the manifest version and reproduces the creator error handling', () => {
  assert.match(WRAPPER, /module\.VERSION = manifest\["version"\]/);
  assert.match(WRAPPER, /read_text\(encoding="utf-8-sig"\)/);
  assert.match(WRAPPER, /print\("Installation stopped: " \+ str\(error\), file=sys\.stderr\)/);
});

test('GT2 on Linux unpacks a ZIP disc and passes its single BIN', async () => {
  await fixture(async ({ args, root, work }) => {
    await fs.mkdir(path.join(root, 'zip-src', 'Gran Turismo 2'), { recursive: true });
    await fs.writeFile(path.join(root, 'zip-src', 'Gran Turismo 2', 'GT2.BIN'), 'disc');
    await fs.writeFile(path.join(root, 'zip-src', 'Gran Turismo 2', 'GT2.cue'), 'cue');
    const archive = path.join(root, 'disc.zip');
    assert.equal(spawnSync(sevenZipBinary(), ['a', '-tzip', archive, '.'], { cwd: path.join(root, 'zip-src'), windowsHide: true }).status, 0);
    const record = [];
    await installGt2Linux({ ...args, gamePath: archive }, { findTool, runner: fakeRunner(record) });
    const disc = record[1].args[record[1].args.indexOf('--disc') + 1];
    assert.equal(disc, path.join(work, 'disc', 'Gran Turismo 2', 'GT2.BIN'));
  });
});

test('GT2 on Linux refuses a ZIP with two BIN images before running anything', async () => {
  await fixture(async ({ args, root }) => {
    await fs.mkdir(path.join(root, 'zip-src'), { recursive: true });
    await fs.writeFile(path.join(root, 'zip-src', 'a.bin'), 'a');
    await fs.writeFile(path.join(root, 'zip-src', 'b.BIN'), 'b');
    const archive = path.join(root, 'two.zip');
    assert.equal(spawnSync(sevenZipBinary(), ['a', '-tzip', archive, '.'], { cwd: path.join(root, 'zip-src'), windowsHide: true }).status, 0);
    const record = [];
    await assert.rejects(installGt2Linux({ ...args, gamePath: archive }, { findTool, runner: fakeRunner(record) }), /The ZIP must contain exactly one BIN image \(found 2\)\./);
    assert.equal(record.length, 0);
  });
});

test('GT2 on Linux fails when the installer exits 0 without the verification line', async () => {
  await fixture(async ({ args }) => {
    const record = [];
    const runner = fakeRunner(record, async () => ({ code: 0, tail: ['Prepared 3 files'] }));
    await assert.rejects(installGt2Linux(args, { findTool, runner }), /The GT2 VR Linux installer failed: Prepared 3 files/);
  });
});

test('GT2 on Linux reports the installer error when it exits non-zero', async () => {
  await fixture(async ({ args }) => {
    const runner = fakeRunner([], async () => ({ code: 1, tail: ['Installation stopped: ADB executable not found: /opt/adb'] }));
    await assert.rejects(installGt2Linux(args, { findTool, runner }), /Installation stopped: ADB executable not found/);
  });
});

test('GT2 on Linux needs Python 3.10 or newer', async () => {
  await fixture(async ({ args }) => {
    await assert.rejects(installGt2Linux(args, { findTool: () => null, runner: fakeRunner([]) }), /Python 3\.10 or newer \(python3\)/);
    await assert.rejects(installGt2Linux(args, { findTool, runner: async () => ({ code: 1, tail: [] }) }), /Python 3\.10 or newer/);
  });
});

test('GT2 on Linux rejects a manifest without the APK it names and a release without install-linux.py', async () => {
  await fixture(async ({ args }) => {
    await assert.rejects(installGt2Linux(args, { findTool, runner: fakeRunner([]) }), /release manifest is missing or invalid/);
  }, { manifestText: manifest({ files: [{ path: 'other.apk' }] }) });
  await fixture(async ({ args }) => {
    await assert.rejects(installGt2Linux(args, { findTool, runner: fakeRunner([]) }), /release manifest is missing or invalid/);
  }, { manifestText: manifest({ version: '0.9' }) });
  await fixture(async ({ args }) => {
    await assert.rejects(installGt2Linux(args, { findTool, runner: fakeRunner([]) }), /missing its expected Quest player file: native\/scripts\/install-linux\.py/);
  }, { script: false });
});
