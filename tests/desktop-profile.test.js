const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('desktop keeps saved VR4All games while giving Electron a separate instance profile', () => {
  const { profilePaths } = require('../desktop/profile-paths');
  const paths = profilePaths(path.join('C:', 'Users', 'Player', 'AppData', 'Roaming'));
  assert.equal(path.basename(paths.dataDir), 'vr4all');
  assert.equal(path.basename(paths.electronDir), 'vr4all-desktop');
  assert.notEqual(paths.dataDir, paths.electronDir);
  const buildFiles = require('../package.json').build.files;
  assert.ok(buildFiles.includes('desktop/profile-paths.js'), 'packaged app must include its profile helper');
});
