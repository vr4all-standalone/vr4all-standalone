const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareReleaseApk } = require('../src/release-apk');

test('Quest ZIP releases use package download and extract their single APK', async () => {
  const calls = [];
  const result = await prepareReleaseApk({ sourceArchive: 'single-apk' }, {
    download: async () => { throw new Error('APK downloader must not receive a ZIP'); },
    downloadPackage: async () => { calls.push('package'); return 'C:\\cache\\quest.zip'; },
  }, { assetName: 'quest.zip' }, () => {}, async (item, archive) => {
    assert.equal(item.destination, '/sdcard/Download/');
    assert.equal(archive, 'C:\\cache\\quest.zip');
    calls.push('extract');
    return { path: 'C:\\temp\\quest.apk', directory: 'C:\\temp' };
  });
  assert.deepEqual(calls, ['package', 'extract']);
  assert.deepEqual(result, { path: 'C:\\temp\\quest.apk', directory: 'C:\\temp' });
});

test('ordinary creator APK releases retain direct download', async () => {
  const result = await prepareReleaseApk({}, {
    download: async () => 'C:\\cache\\quest.apk',
    downloadPackage: async () => { throw new Error('unexpected package download'); },
  }, { assetName: 'quest.apk' });
  assert.deepEqual(result, { path: 'C:\\cache\\quest.apk', directory: null });
});
