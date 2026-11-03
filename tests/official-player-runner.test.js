const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { sevenZipBinary } = require('./helpers/seven-zip');
const { spawnSync } = require('node:child_process');
const { requireSingleQuest3Family, allowQuest3SInInstaller, installOfficialPlayer } = require('../src/official-player-runner');

test('Animal Crossing allows one selected Quest 3 even when an Android phone is connected', async () => {
  const adb = { listDevices: async () => [
    { serial: 'QUEST', state: 'device', model: 'Quest 3' },
    { serial: 'PHONE', state: 'device', model: 'SM S911W' },
  ] };
  assert.equal((await requireSingleQuest3Family(adb, 'QUEST')).model, 'Quest 3');
});

test('Animal Crossing accepts one selected Quest 3S alongside an Android phone', async () => {
  const adb = { listDevices: async () => [
    { serial: 'QUEST3S', state: 'device', model: 'Quest 3S' },
    { serial: 'PHONE', state: 'device', model: 'SM S911W' },
  ] };
  assert.equal((await requireSingleQuest3Family(adb, 'QUEST3S')).model, 'Quest 3S');
});

test('Animal Crossing still rejects multiple supported Quests or a different target', async () => {
  const adb = { listDevices: async () => [
    { serial: 'QUEST', state: 'device', model: 'Quest 3' },
    { serial: 'OTHER', state: 'device', model: 'Quest 3S' },
  ] };
  await assert.rejects(requireSingleQuest3Family(adb, 'QUEST'), /exactly one connected Quest 3 or 3S/);
  await assert.rejects(requireSingleQuest3Family({ listDevices: async () => [{ serial: 'QUEST', state: 'device', model: 'Quest 3' }] }, 'OTHER'), /exactly one connected Quest 3 or 3S/);
});

test('Quest 3S adaptation changes only the released installer model check', () => {
  const original = "if ($model.Text.Trim() -eq 'Quest 3') { $quests += $serial }\nWrite-Host 'Installing Animal Crossing on Quest 3'";
  const adapted = allowQuest3SInInstaller(original);
  assert.match(adapted, /if \(\$model\.Text\.Trim\(\) -in @\('Quest 3', 'Quest 3S'\)\) \{ \$quests \+= \$serial \}/);
  assert.match(adapted, /Write-Host 'Installing Animal Crossing on Quest 3'/);
  assert.throws(() => allowQuest3SInInstaller('unexpected author script'), /model check has changed/);
});

test('Animal Crossing adapts only its extracted installer for Quest 3S before running it', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-animal-3s-'));
  const adbPath = path.join(__dirname, '..', 'vendor', 'platform-tools', 'adb.exe');
  const sevenZip = sevenZipBinary();
  const archive = path.join(root, 'creator.zip');
  const bundle = path.join(root, 'bundle');
  const gamePath = path.join(root, 'game.iso');
  const original = "if ($model.Text.Trim() -eq 'Quest 3') { $quests += $serial }";
  let executedScript = '';
  const messages = [];
  try {
    await fs.mkdir(path.join(bundle, 'AnimalCrossing-Quest'), { recursive: true });
    await fs.writeFile(path.join(bundle, 'AnimalCrossing-Quest', 'Install-Quest.ps1'), original);
    await fs.writeFile(path.join(bundle, 'AnimalCrossing-Quest', 'AnimalCrossing-Quest.apk'), 'test APK');
    await fs.writeFile(gamePath, 'owned game file');
    const packed = spawnSync(sevenZip, ['a', '-tzip', archive, 'AnimalCrossing-Quest'], { cwd: bundle, windowsHide: true });
    assert.equal(packed.status, 0, String(packed.stderr));
    await installOfficialPlayer({
      gameId: 'animal-crossing-vr', gamePath, serial: 'QUEST3S', adbPath, zipPath: archive, workRoot: root,
      adb: { listDevices: async () => [{ serial: 'QUEST3S', state: 'device', model: 'Quest 3S' }, { serial: 'PHONE', state: 'device', model: 'SM S911W' }], run: async () => '' },
      onLog: (message) => messages.push(message),
      runScript: async (script, args) => {
        executedScript = await fs.readFile(script, 'utf8');
        assert.equal(args[args.indexOf('-RomPath') + 1], gamePath);
      },
    });
    assert.match(executedScript, /'Quest 3S'/);
    assert.doesNotMatch(executedScript, /-eq 'Quest 3'/);
    assert.equal(await fs.readFile(path.join(bundle, 'AnimalCrossing-Quest', 'Install-Quest.ps1'), 'utf8'), original);
    assert.ok(messages.some((message) => /Quest 3S is unverified/.test(message)));
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function gt2Release(root) {
  const bundle = path.join(root, 'bundle');
  await fs.mkdir(path.join(bundle, 'GT2-0.9.0', 'native', 'scripts'), { recursive: true });
  await fs.writeFile(path.join(bundle, 'GT2-0.9.0', 'native', 'GT2-VR-0.9.0.apk'), 'apk');
  await fs.writeFile(path.join(bundle, 'GT2-0.9.0', 'native', 'scripts', 'install-linux.py'), '# stub');
  const archive = path.join(root, 'GT2-0.9.0.zip');
  const packed = spawnSync(sevenZipBinary(), ['a', '-tzip', archive, 'GT2-0.9.0'], { cwd: bundle, windowsHide: true });
  assert.equal(packed.status, 0, String(packed.stderr));
  return archive;
}

test('official-zip installs on Linux go to the port Linux installer, never to a PowerShell script', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-official-linux-'));
  try {
    const zipPath = await gt2Release(root);
    const adbPath = path.join(root, 'adb');
    const gamePath = path.join(root, 'game.bin');
    await Promise.all([fs.writeFile(adbPath, 'adb'), fs.writeFile(gamePath, 'disc')]);
    const received = [];
    const messages = [];
    const result = await installOfficialPlayer({
      gameId: 'gt2-vr', gamePath, serial: 'Q3', adbPath, zipPath, workRoot: root, platform: 'linux', adb: { run: async () => '' },
      onLog: (message) => messages.push(message),
      runScript: async () => { throw new Error('PowerShell must not run on Linux'); },
      linuxInstallers: { 'gt2-vr': async (args) => { received.push(args); return { importPending: true }; } },
    });
    assert.equal(received.length, 1);
    assert.match(received[0].apk.replaceAll('\\', '/'), /\/release\/GT2-0\.9\.0\/native\/GT2-VR-0\.9\.0\.apk$/);
    assert.equal(path.basename(received[0].release), 'release');
    assert.equal(received[0].gamePath, gamePath);
    assert.equal(received[0].serial, 'Q3');
    assert.equal(received[0].adbPath, adbPath);
    assert.equal(result.updatedOnly, false);
    assert.equal(result.importPending, true);
    assert.ok(messages.some((message) => /Linux installer/.test(message)));
  } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('an APK-only update on Linux does not need the Linux installer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-official-linux-update-'));
  try {
    const zipPath = await gt2Release(root);
    const adbPath = path.join(root, 'adb');
    await fs.writeFile(adbPath, 'adb');
    const calls = [];
    const result = await installOfficialPlayer({
      gameId: 'gt2-vr', gamePath: null, serial: 'Q3', adbPath, zipPath, workRoot: root, platform: 'linux', adb: { run: async (args) => { calls.push(args); return ''; } },
      linuxInstallers: { 'gt2-vr': async () => { throw new Error('not for updates'); } },
    });
    assert.equal(result.updatedOnly, true);
    assert.deepEqual(calls[0].slice(0, 3), ['-s', 'Q3', 'install']);
  } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('a port without a Linux installer fails closed on Linux instead of looking for a PowerShell script', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-official-linux-none-'));
  try {
    const zipPath = await gt2Release(root);
    const adbPath = path.join(root, 'adb');
    const gamePath = path.join(root, 'game.bin');
    await Promise.all([fs.writeFile(adbPath, 'adb'), fs.writeFile(gamePath, 'disc')]);
    await assert.rejects(installOfficialPlayer({
      gameId: 'gt2-vr', gamePath, serial: 'Q3', adbPath, zipPath, workRoot: root, platform: 'linux', adb: { run: async () => '' },
      linuxInstallers: {}, runScript: async () => { throw new Error('PowerShell must not run on Linux'); },
    }), /no Linux installer yet/);
  } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
