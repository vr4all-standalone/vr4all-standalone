const { getCatalog } = require('../src/catalog');
const { GitHubReleases } = require('../src/releases');

(async () => {
  const releases = new GitHubReleases();
  let missing = 0;
  for (const game of getCatalog().filter((item) => item.source)) {
    try {
      const release = await releases.latest(game.source);
      console.log(`${game.id}: ${release ? `${release.tag} / ${release.assetName}` : 'NO MATCH'}`);
      if (!release) missing++;
    } catch (error) {
      console.log(`${game.id}: ERROR ${error.message}`);
      missing++;
    }
  }
  process.exitCode = missing ? 1 : 0;
})();
