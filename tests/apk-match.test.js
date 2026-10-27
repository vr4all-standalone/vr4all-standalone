const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { matchesInstalledApk, matchesInstalledDigest } = require('../src/apk-match');

test('matchesInstalledApk checks the installed APK bytes, not its internal versionName', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-apk-match-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const apk = path.join(directory, 'latest.apk');
  await fs.writeFile(apk, 'release APK bytes');
  const digest = crypto.createHash('sha256').update('release APK bytes').digest('hex');
  const adb = { run: async (args) => args.includes('pm')
    ? 'package:/data/app/example/base.apk'
    : `${digest}  /data/app/example/base.apk` };
  assert.equal(await matchesInstalledApk(adb, 'Q3', 'com.example.vr', apk), true);
  assert.equal(await matchesInstalledApk({ run: async (args) => args.includes('pm') ? 'package:/data/app/example/base.apk' : `${'0'.repeat(64)}  /data/app/example/base.apk` }, 'Q3', 'com.example.vr', apk), false);
});

test('matchesInstalledDigest compares a GitHub asset digest without downloading its APK', async () => {
  const digest = 'f'.repeat(64);
  const adb = { run: async (args) => args.includes('pm') ? 'package:/data/app/example/base.apk' : `${digest}  /data/app/example/base.apk` };
  assert.equal(await matchesInstalledDigest(adb, 'Q3', 'com.example.vr', `sha256:${digest}`), true);
  assert.equal(await matchesInstalledDigest(adb, 'Q3', 'com.example.vr', `sha256:${'0'.repeat(64)}`), false);
});
