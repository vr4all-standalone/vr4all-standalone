const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { packages } = require('../src/device-library');

test('both Bugdom VR releases install their complete creator APK without a game file', () => {
  const catalog = getCatalog();
  for (const [id, repo, apk, packageId] of [
    ['bugdom-vr', 'SgtBilko76/Bugdom', 'Bugdom-VR-1.3.5-beta1.apk', 'io.jor.bugdom'],
    ['bugdom2-vr', 'SgtBilko76/Bugdom2', 'Bugdom2-VR-4.0.1-beta1.apk', 'io.jor.bugdom2'],
  ]) {
    const matches = catalog.filter((entry) => entry.id === id);
    assert.equal(matches.length, 1, id);
    const game = matches[0];
    assert.equal(game.source.repo, repo);
    assert.equal(game.genre, 'Platformer');
    assert.deepEqual(game.data, []);
    assert.equal(packages[id], packageId);
    assert.ok(fs.statSync(path.join(__dirname, '..', 'public', game.art.slice(1))).size > 0);
    const releases = [{ tag_name: 'vr-beta', prerelease: true, assets: [
      { name: apk, browser_download_url: `https://github.com/${repo}/releases/download/vr-beta/${apk}` },
      { name: `${apk}.sha256`, browser_download_url: 'https://example.invalid/checksum' },
    ] }];
    assert.equal(selectRelease(releases, game.source)?.assetName, apk);
    const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: `C:\\Downloads\\${apk}`, files: {} });
    assert.ok(plan.some((step) => step.args.includes('install')), id);
    assert.ok(!plan.some((step) => step.args.includes('push')), id);
  }
});
