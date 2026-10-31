const { extractSingleFileArchive } = require('./archive-conversion');

const apkInput = { kind: 'file', label: 'Quest APK', extensions: ['.apk'], destination: '/sdcard/Download/' };

async function prepareReleaseApk(game, releases, release, onProgress = () => {}, extract = extractSingleFileArchive) {
  if (game.sourceArchive === 'single-apk') {
    if (!/\.zip$/i.test(release.assetName || '')) throw new Error('The creator release is not a Quest ZIP');
    const archive = await releases.downloadPackage(release, onProgress);
    const extracted = await extract(apkInput, archive);
    return { path: extracted.path, directory: extracted.directory };
  }
  return { path: await releases.download(release, onProgress), directory: null };
}

module.exports = { prepareReleaseApk };
