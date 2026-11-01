const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { sevenZipBinary } = require('./helpers/seven-zip');
const { installMagicCarpet } = require('../src/magic-carpet-runner');

const runFile = promisify(execFile);

async function fixture(t, importerBytes) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-mgc-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pack = path.join(root, 'pack');
  await fs.mkdir(pack);
  await fs.writeFile(path.join(pack, 'mgc-import'), Buffer.concat([Buffer.from(importerBytes, 'latin1'), Buffer.alloc(64)]), { mode: 0o644 });
  await fs.writeFile(path.join(pack, 'LICENSE'), 'license');
  const importerZip = path.join(root, 'mgc-import-linux.zip');
  await runFile(sevenZipBinary(), ['a', '-tzip', importerZip, path.join(pack, 'mgc-import'), path.join(pack, 'LICENSE')]);
  const apkPath = path.join(root, 'mgcarpet-vr.apk');
  await fs.writeFile(apkPath, 'apk');
  const gamePath = path.join(root, 'game');
  await fs.mkdir(gamePath);
  await fs.writeFile(path.join(gamePath, 'GAME.GOG'), 'owned');
  const calls = [];
  const adb = { run: async (args) => { calls.push(args); return 'Success'; } };
  const workRoot = path.join(root, 'work');
  return { root, apkPath, importerZip, gamePath, calls, adb, workRoot };
}

test('Linux runs the official importer then transfers to the selected Quest', async (t) => {
  const f = await fixture(t, '\x7fELF');
  const execs = [];
  let mode;
  const exec = async (importer, args) => {
    mode = (await fs.stat(importer)).mode & 0o777;
    execs.push([path.basename(importer), ...args.map((arg, i) => i === 0 ? arg : path.basename(arg))]);
    if (args[0] === 'bake') { await fs.mkdir(args[2]); await fs.writeFile(path.join(args[2], 'x.mgcl'), 'baked'); }
  };
  const result = await installMagicCarpet({ apkPath: f.apkPath, importerZip: f.importerZip, gamePath: f.gamePath, serial: 'Q3', adb: f.adb,
    workRoot: f.workRoot, platform: 'linux', exec, inspectApk: async () => 'technology.master.mc.vr' });
  assert.deepEqual(result, { packageId: 'technology.master.mc.vr', updatedOnly: false });
  assert.equal(mode, 0o755);
  assert.deepEqual(execs, [['mgc-import', 'scan', 'game'], ['mgc-import', 'bake', 'game', 'baked']]);
  const pushIndex = f.calls.findIndex((args) => args[2] === 'push');
  const installIndex = f.calls.findIndex((args) => args[2] === 'install');
  const touchIndex = f.calls.findIndex((args) => args[3] === 'touch');
  assert.ok(pushIndex >= 0 && pushIndex < installIndex && installIndex < touchIndex);
  assert.equal(f.calls[pushIndex].at(-1), '/sdcard/mgcarpet/');
  assert.equal(f.calls[touchIndex].at(-1), '/sdcard/mgcarpet/baked/vr4all-transfer.complete');
  assert.ok(f.calls.every((args) => args[1] === 'Q3'));
});

test('Linux refuses an importer that is not an ELF executable and transfers nothing', async (t) => {
  const f = await fixture(t, 'MZ00');
  await assert.rejects(installMagicCarpet({ apkPath: f.apkPath, importerZip: f.importerZip, gamePath: f.gamePath, serial: 'Q3', adb: f.adb,
    workRoot: f.workRoot, platform: 'linux', exec: async () => assert.fail('importer must not run'), inspectApk: async () => 'technology.master.mc.vr' }),
  /not a Linux executable/);
  assert.deepEqual(f.calls, []);
});
