const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { selectRelease } = require('../src/core');

test('WolfSharp selects the creator’s Meta Quest APK for automatic updates', () => {
  const game = getCatalog().find((entry) => entry.id === 'wolfsharp');
  assert.equal(game.projectUrl, 'https://github.com/BenMcLean/WolfSharp');
  assert.equal(game.source.repo, 'BenMcLean/WolfSharp');
  const release = selectRelease([{ tag_name: 'v1.2026.10.03', published_at: '2026-10-04T03:31:00Z', assets: [
    { name: 'BenMcLean.Wolf3D.VR_windows-x64_v1.2026.10.03.zip', browser_download_url: 'https://github.com/BenMcLean/WolfSharp/releases/download/v1.2026.10.03/BenMcLean.Wolf3D.VR_windows-x64_v1.2026.10.03.zip' },
    { name: 'BenMcLean.Wolf3D.VR_android-meta-quest_v1.2026.10.03.apk', browser_download_url: 'https://github.com/BenMcLean/WolfSharp/releases/download/v1.2026.10.03/BenMcLean.Wolf3D.VR_android-meta-quest_v1.2026.10.03.apk' },
  ] }], game.source);
  assert.equal(release.assetName, 'BenMcLean.Wolf3D.VR_android-meta-quest_v1.2026.10.03.apk');
  assert.equal(game.data[0].optional, true);
});
