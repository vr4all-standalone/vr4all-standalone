const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The vendored 7z.exe only runs on Windows; elsewhere use the system 7-Zip.
function sevenZipBinary() {
  if (process.platform === 'win32') return path.join(__dirname, '..', '..', 'vendor', '7zip', '7z.exe');
  for (const name of ['7zz', '7z', '7za']) if (spawnSync(name, ['i'], { stdio: 'ignore' }).status === 0) return name;
  throw new Error('Install 7-Zip (p7zip) to run these tests');
}
module.exports = { sevenZipBinary };
