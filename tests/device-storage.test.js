const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeviceStorage } = require('../src/device-storage');

test('reads Quest internal storage from Android df output', () => {
  const output = 'Filesystem     1K-blocks     Used Available Use% Mounted on\n/dev/block/dm-8  112345678 50345678  62000000  45% /data';
  assert.deepEqual(parseDeviceStorage(output), {
    totalBytes: 112345678 * 1024,
    usedBytes: 50345678 * 1024,
    freeBytes: 62000000 * 1024,
  });
});

test('rejects incomplete storage readings instead of showing misleading figures', () => {
  assert.equal(parseDeviceStorage('Filesystem 1K-blocks Used Available Use% Mounted on\n'), null);
  assert.equal(parseDeviceStorage('/dev/block/dm-8 10 20 1 90% /data'), null);
});
