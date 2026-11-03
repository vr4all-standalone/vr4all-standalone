const fs = require('node:fs');
const path = require('node:path');

// First executable regular file named `names[n]` on PATH; names are tried in order per directory.
function findOnPath(names, env = process.env) {
  for (const directory of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

module.exports = { findOnPath };
