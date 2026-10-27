const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { installAstroQuest } = require('../src/astroquest-runner');
const { installGalaxyQuest } = require('../src/galaxyquest-runner');
const { installSclerosis } = require('../src/sclerosis-runner');
const runFile = promisify(execFile);
const bundledZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-integrated-'));
  const apk = path.join(root, 'creator.apk');
  await fs.writeFile(apk, 'APK fixture; package identity is supplied by the test inspector');
  const calls = [];
  const adb = { run: async (args) => { calls.push(args); return 'Success'; } };
  return { root, apk, adb, calls, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('AstroQuest validates an extracted owned game tree and transfers only to the selected Quest', async () => {
  const f = await fixture();
  try {
    const game = path.join(f.root, 'CUSA12392');
    await fs.mkdir(path.join(game, 'sce_sys'), { recursive: true });
    await fs.mkdir(path.join(game, 'sce_module'));
    await fs.writeFile(path.join(game, 'eboot.bin'), 'owned fixture');
    const result = await installAstroQuest({ apkPath: f.apk, gamePath: game, serial: 'Q3', adb: f.adb,
      inspectApk: async () => 'com.astrobotquest.vrhost' });
    assert.equal(result.updatedOnly, false);
    assert.ok(f.calls.some((args) => args[0] === '-s' && args[1] === 'Q3'
      && args[2] === 'push' && args.at(-1) === '/data/local/tmp/astro/games/CUSA12392/'));
    assert.ok(f.calls.findIndex((args) => args[2] === 'shell' && args[3] === 'touch') > f.calls.findIndex((args) => args[2] === 'push'));
    assert.ok(f.calls.every((args) => args[1] === 'Q3'));
    f.calls.length = 0;
    await installAstroQuest({ apkPath: f.apk, serial: 'Q3', adb: f.adb,
      inspectApk: async () => 'com.astrobotquest.vrhost' });
    assert.ok(f.calls.every((args) => args[2] !== 'push'));
  } finally { await f.cleanup(); }
});

test('GalaxyQuest uses the packaged converter, then transfers its output and keeps update data', async () => {
  const f = await fixture();
  try {
    const disc = path.join(f.root, 'Galaxy.rvz');
    const converter = path.join(f.root, 'GalaxyQuest-Installer-windows-x86_64.exe');
    await fs.writeFile(disc, 'owned disc fixture');
    await fs.writeFile(converter, 'official tool fixture');
    let converted = false;
    const result = await installGalaxyQuest({ apkPath: f.apk, converterPath: converter, gamePath: disc,
      serial: 'Q3', adb: f.adb, workRoot: f.root, inspectApk: async () => 'com.galaxy.quest',
      convert: async (tool, source, output) => {
        assert.equal(tool, converter);
        assert.equal(source, disc);
        await fs.mkdir(output, { recursive: true });
        await fs.writeFile(path.join(output, 'GameData.bin'), 'converted fixture');
        converted = true;
      } });
    assert.equal(converted, true);
    assert.equal(result.updatedOnly, false);
    assert.ok(f.calls.some((args) => args.includes('push') && args.at(-1).startsWith('/data/local/tmp/vr4all-galaxy-')));
    const unpack = f.calls.findIndex((args) => args[2] === 'shell' && args[3] === 'tar' && args.includes('/sdcard/Android/data/com.galaxy.quest/files/game'));
    const complete = f.calls.findIndex((args) => args[2] === 'shell' && args[3] === 'touch');
    assert.ok(unpack > f.calls.findIndex((args) => args[2] === 'push'));
    assert.ok(complete > unpack);
    assert.ok(f.calls.some((args) => args.includes('--no-incremental')));
    f.calls.length = 0;
    await installGalaxyQuest({ apkPath: f.apk, serial: 'Q3', adb: f.adb,
      inspectApk: async () => 'com.galaxy.quest' });
    assert.ok(f.calls.every((args) => args[2] !== 'push'));
  } finally { await f.cleanup(); }
});

test('Sclerosis saves a creator APK workflow and copies only a complete owned Amnesia folder', async () => {
  const f = await fixture();
  try {
    const game = path.join(f.root, 'Amnesia The Dark Descent');
    for (const folder of ['config', 'maps', 'entities']) await fs.mkdir(path.join(game, folder), { recursive: true });
    await installSclerosis({ apkPath: f.apk, gamePath: game, serial: 'Q3', adb: f.adb,
      inspectApk: async () => 'com.CreaTeam.Sclerosis' });
    assert.ok(f.calls.some((args) => args[2] === 'push' && args.at(-1) === '/sdcard/Amnesia The Dark Descent/'));
    f.calls.length = 0;
    await assert.rejects(installSclerosis({ apkPath: f.apk, gamePath: f.root, serial: 'Q3', adb: f.adb,
      inspectApk: async () => 'com.CreaTeam.Sclerosis' }), /config, maps and entities/);
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

test('Sclerosis extracts owned game ZIP for transfer and rejects an installer ZIP', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    const game = path.join(f.root, 'Amnesia The Dark Descent');
    for (const folder of ['config', 'maps', 'entities']) {
      await fs.mkdir(path.join(game, folder), { recursive: true });
      await fs.writeFile(path.join(game, folder, 'data.bin'), folder);
    }
    const archive = path.join(f.root, 'Amnesia The Dark Descent.zip');
    await runFile(bundledZip, ['a', '-tzip', archive, 'Amnesia The Dark Descent'], { cwd: f.root, windowsHide: true });
    await installSclerosis({ apkPath: f.apk, gamePath: archive, serial: 'Q3', adb: f.adb, inspectApk: async () => 'com.CreaTeam.Sclerosis' });
    const pushed = f.calls.find((args) => args[2] === 'push');
    assert.ok(pushed);
    assert.match(pushed[3], /Amnesia The Dark Descent[\\/]\.$/);
    f.calls.length = 0;
    const installer = path.join(f.root, 'Amnesia installer.zip');
    await fs.writeFile(path.join(f.root, 'setup.exe'), 'installer');
    await runFile(bundledZip, ['a', '-tzip', installer, 'setup.exe'], { cwd: f.root, windowsHide: true });
    await assert.rejects(installSclerosis({ apkPath: f.apk, gamePath: installer, serial: 'Q3', adb: f.adb, inspectApk: async () => 'com.CreaTeam.Sclerosis' }), /missing.*config/i);
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});
