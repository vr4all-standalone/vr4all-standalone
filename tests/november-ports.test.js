const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { honeydewRelease } = require('../src/releases');
const { inspectDevice, packages } = require('../src/device-library');
const fs = require('node:fs');
const path = require('node:path');

test('new Quest projects have distinct profiles and creator links', () => {
  const games = getCatalog();
  const ids = [
    'south-park-vr', 'mario64mr', 'lsd-vr-beta', 'bully-vr', 'lba2-quest',
    'xonotic-vr', 'primedgun-echoes', 'urban-terror-vr', 'openarena-vr',
    'project-honeydew-2', 'openmohaa-vr', 'lets-go-jungle-vr', 'hotd4-special-vr',
  ];
  for (const id of ids) {
    const game = games.find((entry) => entry.id === id);
    assert.ok(game, id);
    assert.ok(game.projectUrl, id);
    assert.ok(game.console && game.genre, id);
  }
  assert.equal(new Set(games.map((entry) => entry.id)).size, games.length);
  assert.equal(games.length, 175);
  for (const id of ids) {
    const art = games.find((entry) => entry.id === id).art;
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', art.replace(/^\//, ''))), `${id} artwork`);
  }
});

test('new Quest package identities can be detected after installation', async () => {
  for (const id of ['south-park-vr', 'bully-vr', 'xonotic-vr', 'urban-terror-vr', 'openarena-vr', 'project-honeydew-2', 'openmohaa-vr']) {
    assert.ok(packages[id], id);
    const game = getCatalog().find((entry) => entry.id === id);
    const adb = { run: async (args) => {
      if (args.includes('pm')) return `package:${packages[id]}`;
      if (args.includes('dumpsys')) return 'versionName=1.0.0';
      return '';
    } };
    assert.equal((await inspectDevice(adb, 'Quest', [game]))[id].packageId, packages[id]);
  }
});

test('Lindbergh ports select their own APKs, including older Jungle release', () => {
  const games = getCatalog();
  const releases = [
    { tag_name: 'v0.4.0', published_at: '2026-11-02', assets: [
      { name: 'HouseOfTheDead4SpecialVR-v0.4.0-quest3.apk', browser_download_url: 'https://github.com/lialan/lindbergh-recomp-ports/releases/download/v0.4.0/special.apk' },
    ] },
    { tag_name: 'v0.2.7', published_at: '2026-10-31', assets: [
      { name: 'LetsGoJungleVR-v0.2.7-quest3.apk', browser_download_url: 'https://github.com/lialan/lindbergh-recomp-ports/releases/download/v0.2.7/jungle.apk' },
    ] },
  ];
  assert.equal(selectRelease(releases, games.find((game) => game.id === 'lets-go-jungle-vr').source)?.tag, 'v0.2.7');
  assert.equal(selectRelease(releases, games.find((game) => game.id === 'hotd4-special-vr').source)?.tag, 'v0.4.0');
});

test('Honeydew 2 resolves its own Quest APK and published checksum', () => {
  const hash = 'a'.repeat(64);
  const html = `<li class="platform card released" id="honeydew2-quest"><a href="/downloads/ProjectHoneydew2-0.1.0-quest.apk">Download for Quest</a><code id="honeydew2-sha256-quest">${hash}</code></li>`;
  const release = honeydewRelease(html, 'project-honeydew-2');
  assert.equal(release.assetName, 'ProjectHoneydew2-0.1.0-quest.apk');
  assert.equal(release.digest, `sha256:${hash}`);
});

test('new self-contained shooters install with no extra file choices', () => {
  for (const id of ['xonotic-vr', 'openarena-vr', 'urban-terror-vr']) {
    const game = getCatalog().find((entry) => entry.id === id);
    assert.equal(game.data.length, 0);
    assert.equal(buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\Mods\\port.apk', files: {} })[0].label, 'Install APK');
  }
});
