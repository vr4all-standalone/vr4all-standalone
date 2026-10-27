const path = require('node:path');

function profilePaths(appData) {
  return {
    dataDir: path.join(appData, 'vr4all'),
    electronDir: path.join(appData, 'vr4all-desktop'),
  };
}

module.exports = { profilePaths };
