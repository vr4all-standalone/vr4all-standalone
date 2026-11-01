const path = require('node:path');
const { findOnPath } = require('../../src/find-tool');
const { sevenZipNames } = require('../../src/archive-conversion');

// The vendored 7z.exe only runs on Windows; elsewhere use the system 7-Zip.
function sevenZipBinary() {
  if (process.platform === 'win32') return path.join(__dirname, '..', '..', 'vendor', '7zip', '7z.exe');
  const found = findOnPath(sevenZipNames);
  if (found) return found;
  throw new Error('Install 7-Zip (p7zip) to run these tests');
}
module.exports = { sevenZipBinary };
