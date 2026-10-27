const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { GitHubReleases } = require('../src/releases');

test('Halo Quest profile discovers its APK when GitHub serves the renamed repository', async () => {
  const canonical = 'moistman42069/HaloCE-DecompRemix-VR-PC-Android';
  const releases = new GitHubReleases();
  releases.publicText = async (url) => ({
    finalUrl: url,
    content: url.includes('expanded_assets')
      ? `<li class="Box-row"><a href="/${canonical}/releases/download/v1.0.37/HaloCE-Quest-1.0.37.apk">HaloCE-Quest-1.0.37.apk</a></li>`
      : `<section id="release-v1.0.37"><a href="/${canonical}/releases/tag/v1.0.37">Halo CE Quest VR</a><relative-time datetime="2026-10-21T00:00:00Z"></relative-time></section>`,
  });
  const source = getCatalog().find((game) => game.id === 'halo-ce').source;
  const release = await releases.publicLatest(source);
  assert.equal(release.assetName, 'HaloCE-Quest-1.0.37.apk');
  assert.equal(release.downloadUrl, `https://github.com/${canonical}/releases/download/v1.0.37/HaloCE-Quest-1.0.37.apk`);
});
