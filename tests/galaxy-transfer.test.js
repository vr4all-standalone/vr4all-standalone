const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { installGalaxyQuest } = require('../src/galaxyquest-runner');

async function fixture(run, onLog = () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-galaxy-transfer-'));
  const source = path.join(root, 'owned.iso');
  const apkPath = path.join(root, 'port.apk');
  const converterPath = path.join(root, 'creator.exe');
  await Promise.all([fs.writeFile(source, 'owned game'), fs.writeFile(apkPath, 'apk'), fs.writeFile(converterPath, 'converter')]);
  try {
    return await run({
      apkPath, converterPath, gamePath: source, serial: 'Q3', workRoot: root,
      adb: { run }, inspectApk: async () => 'com.galaxy.quest', onLog,
      convert: async (_tool, _source, output) => {
        await fs.mkdir(path.join(output, 'files', 'MovieData'), { recursive: true });
        await fs.writeFile(path.join(output, 'files', 'MovieData', 'EndingA.thp'), 'movie');
      },
    });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('GalaxyQuest retries an interrupted ADB transfer without converting again and only marks completion after copy succeeds', async () => {
  const calls = [];
  const logs = [];
  let pushes = 0;
  let conversions = 0;
  const result = await fixture(async (input) => {
    if (typeof input === 'object' && !Array.isArray(input)) {
      const original = input.convert;
      input.convert = async (...args) => { conversions++; return original(...args); };
      return installGalaxyQuest(input);
    }
    calls.push(input);
    if (input.includes('push') && ++pushes === 1) throw new Error('adb: no response: Broken pipe');
    return '';
  }, (line) => logs.push(line));
  assert.equal(result.packageId, 'com.galaxy.quest');
  assert.equal(conversions, 1);
  assert.equal(pushes, 2);
  assert.ok(calls.filter((args) => args.includes('push')).every((args) => args.includes('-Z') && args.at(-1).startsWith('/data/local/tmp/vr4all-galaxy-')));
  assert.equal(calls.filter((args) => args.includes('tar')).length, 1);
  assert.ok(calls.find((args) => args.includes('tar')).includes('/sdcard/Android/data/com.galaxy.quest/files/game'));
  assert.ok(calls.some((args) => args.includes('chmod')));
  assert.equal(calls.filter((args) => args.includes('touch')).length, 1);
  assert.ok(logs.some((line) => /retry/i.test(line)));
});

test('GalaxyQuest leaves the completion marker absent when every ADB transfer attempt breaks', async () => {
  const calls = [];
  await assert.rejects(fixture(async (input) => {
    if (typeof input === 'object' && !Array.isArray(input)) return installGalaxyQuest(input);
    calls.push(input);
    if (input.includes('push')) throw new Error('adb: no response: Broken pipe');
    return '';
  }), /USB transfer failed after 3 attempts/);
  assert.equal(calls.filter((args) => args.includes('push')).length, 3);
  assert.equal(calls.filter((args) => args.includes('tar')).length, 0);
  assert.equal(calls.filter((args) => args.includes('touch')).length, 0);
});
