const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findAdb } = require('../src/adb');

test('findAdb finds the desktop app bundled platform tools', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vr4all-adb-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const adbPath = path.join(root, 'platform-tools', exe);
  fs.mkdirSync(path.dirname(adbPath), { recursive: true });
  fs.writeFileSync(adbPath, '');
  assert.equal(findAdb('', { resourcesPath: root }), adbPath);
});
