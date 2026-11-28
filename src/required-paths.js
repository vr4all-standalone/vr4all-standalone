const fs = require('node:fs/promises');
const path = require('node:path');

async function missingLocalRequiredPaths(root, requiredPaths = []) {
  const cache = new Map();
  const entriesIn = (directory) => {
    if (!cache.has(directory)) cache.set(directory, fs.readdir(directory, { withFileTypes: true }).catch(() => []));
    return cache.get(directory);
  };
  const checks = await Promise.all(requiredPaths.map(async (relative) => {
    if (!relative || relative.startsWith('/') || relative.split('/').some((part) => !part || part === '.' || part === '..')) return relative;
    const parts = relative.split('/');
    let current = root;
    for (const [index, part] of parts.entries()) {
      const entry = (await entriesIn(current)).find((candidate) => candidate.name === part);
      if (!entry) return relative;
      if (index === parts.length - 1) {
        const file = await fs.lstat(path.join(current, part)).catch(() => null);
        return entry.isFile() && file?.size > 0 ? null : relative;
      }
      if (!entry.isDirectory()) return relative;
      current = path.join(current, part);
    }
    return relative;
  }));
  return checks.filter(Boolean);
}

module.exports = { missingLocalRequiredPaths };
