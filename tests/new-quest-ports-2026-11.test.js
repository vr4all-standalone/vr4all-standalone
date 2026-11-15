const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { verifyGameFile } = require('../src/file-verification');
const { packages, inspectDevice } = require('../src/device-library');

const game = (id) => getCatalog().find((entry) => entry.id === id);

test('Umbrella Chronicles selects its Quest APK and transfers both required owned inputs', () => {
  const port = game('umbrella-chronicles-vr');
  assert.ok(port);
  assert.equal(packages[port.id], 'org.uc.umbrellachronicles.vr');
  const release = [{ name: 'Umbrella Chronicles VR 0.1.5 (Quest 3)', tag_name: 'quest-v0.1.5', assets: [
    { name: 'UmbrellaChroniclesVR-0.1.5.apk', browser_download_url: 'https://github.com/lialan/reuc-vr/releases/download/quest-v0.1.5/UmbrellaChroniclesVR-0.1.5.apk' },
  ] }];
  assert.equal(selectRelease(release, port.source)?.assetName, 'UmbrellaChroniclesVR-0.1.5.apk');
  assert.deepEqual(port.data.map((entry) => entry.destination), ['/sdcard/UmbrellaChronicles/', '/sdcard/UmbrellaChronicles/common-key.bin']);
  assert.throws(() => buildInstallPlan(port, { serial: 'Q3', apkPath: 'C:\\Mods\\reuc.apk', files: { disc: 'C:\\Games\\RBUE08.wbfs' } }), /common.key/i);
  const steps = buildInstallPlan(port, { serial: 'Q3', apkPath: 'C:\\Mods\\reuc.apk', files: { disc: 'C:\\Games\\RBUE08.wbfs', key: 'C:\\Keys\\common-key.bin' } });
  assert.equal(steps.find((step) => step.label === 'Copy disc').args.at(-1), '/sdcard/UmbrellaChronicles/RBUE08.wbfs');
  assert.equal(steps.find((step) => step.label === 'Copy key').args.at(-1), '/sdcard/UmbrellaChronicles/common-key.bin');
});

test('Umbrella Chronicles rejects other Wii discs and wrong-size common keys', async () => {
  const port = game('umbrella-chronicles-vr');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-reuc-'));
  try {
    const disc = path.join(root, 'game.iso');
    await fs.writeFile(disc, Buffer.from('RMCP01'));
    await assert.rejects(verifyGameFile(port, port.data[0], disc), /RBUE08/i);
    await fs.writeFile(disc, Buffer.from('RBUE08'));
    assert.match((await verifyGameFile(port, port.data[0], disc)).message, /RBUE08/i);
    const key = path.join(root, 'common-key.bin');
    await fs.writeFile(key, Buffer.alloc(15));
    await assert.rejects(verifyGameFile(port, port.data[1], key), /16.byte/i);
    await fs.writeFile(key, Buffer.alloc(16, 1));
    assert.match((await verifyGameFile(port, port.data[1], key)).message, /16.byte/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Umbrella Chronicles headset status requires both image and key', async () => {
  const port = game('umbrella-chronicles-vr');
  let keyPresent = false;
  const adb = { run: async (args) => {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:org.uc.umbrellachronicles.vr';
    if (command.includes('dumpsys')) return 'versionName=0.1.5';
    if (command.includes('ls -1 /sdcard/UmbrellaChronicles')) return keyPresent ? 'RBUE08.wbfs\ncommon-key.bin' : 'RBUE08.wbfs';
    return '';
  } };
  assert.equal((await inspectDevice(adb, 'Q3', [port]))[port.id].dataReady, false);
  keyPresent = true;
  assert.equal((await inspectDevice(adb, 'Q3', [port]))[port.id].dataReady, true);
});

test('Diorama MR is a separate Jedi Academy card with its own release APK', () => {
  const port = game('jedi-academy-diorama-mr');
  assert.ok(port);
  assert.equal(port.title, 'Star Wars Jedi Knight: Jedi Academy MR');
  assert.equal(port.variantOf, undefined);
  assert.equal(port.artId, 'jkxr');
  assert.equal(port.data[0].kind, 'directory');
  assert.deepEqual(port.data[0].requiredEntries, ['assets0.pk3', 'assets1.pk3', 'assets2.pk3', 'assets3.pk3']);
  const release = [{ name: 'Jedi Academy Diorama MR v0.1.0-alpha.3', tag_name: 'jedi-academy-v0.1.0-alpha.3', assets: [
    { name: 'JKXR-Diorama-MR-0.1.0-alpha.3-Installer.exe', browser_download_url: 'https://github.com/galateainteractive/Diorama-MR-Mods-Releases/releases/download/jedi-academy-v0.1.0-alpha.3/Installer.exe' },
    { name: 'JKXR-Diorama-MR-0.1.0-alpha.3.apk', browser_download_url: 'https://github.com/galateainteractive/Diorama-MR-Mods-Releases/releases/download/jedi-academy-v0.1.0-alpha.3/JKXR-Diorama-MR-0.1.0-alpha.3.apk' },
  ] }];
  assert.equal(selectRelease(release, port.source)?.assetName, 'JKXR-Diorama-MR-0.1.0-alpha.3.apk');
});

test('Mario 64 MR uses its own card and creator artwork', () => {
  const port = game('mario64mr');
  assert.ok(port);
  assert.equal(port.title, 'Super Mario 64 MR');
  assert.equal(port.variantOf, undefined);
  assert.equal(port.artId, 'mario64mr');
  assert.equal(port.externalInstaller, undefined);
  assert.ok(port.personalBuild);
  assert.match(port.source.assetPattern, /Mario64MR/);
});

test('Mario 64 MR is ready only when the APK and generated game data are on the Quest', async () => {
  const port = game('mario64mr');
  let complete = false;
  const adb = { run: async (args) => {
    const request = args.join(' ');
    if (request.includes('pm list packages')) return 'package:com.lucasmartinic.mario64mr';
    if (request.includes('dumpsys')) return 'versionName=1.3';
    if (request.includes('/sm64/res')) return complete ? 'base.zip' : '';
    if (request.includes('/native')) return 'libsm64game.so\nlibgoddard.so\nlibsm64.so';
    if (request.includes('/files')) return 'baserom.us.z64';
    return '';
  } };
  assert.equal((await inspectDevice(adb, 'Q3', [port]))[port.id].dataReady, false);
  complete = true;
  assert.equal((await inspectDevice(adb, 'Q3', [port]))[port.id].dataReady, true);
});
