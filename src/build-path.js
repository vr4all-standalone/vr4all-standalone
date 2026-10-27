const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);

async function withShortBuildPath(workDir, operation, log = () => {}, options = {}) {
  if ((options.platform || process.platform) !== 'win32') return operation(workDir);
  const windowsPath = path.win32;
  if (!windowsPath.isAbsolute(workDir)) throw new Error('Build directory must be an absolute Windows path');
  const resolved = windowsPath.resolve(workDir);
  // Map the parent so the game still has its own directory. Cached references
  // cannot accidentally point into another game's files when a drive is reused.
  const parent = windowsPath.dirname(resolved);
  const execute = options.runFile || runFile;
  const commandOptions = { windowsHide: true, timeout: 10000, maxBuffer: 64 * 1024 };
  let drive;
  let lastError;
  for (let letter = 90; letter >= 68; letter--) {
    const candidate = `${String.fromCharCode(letter)}:`;
    try {
      await execute('subst.exe', [candidate, parent], commandOptions);
      drive = candidate;
      break;
    } catch (error) {
      // SUBST refuses occupied drives without changing them.
      lastError = error;
    }
  }
  if (!drive) throw new Error(`Could not create a temporary short build path. Windows needs an available drive letter from D: through Z: and access to ${parent}. ${lastError?.message || ''}`);
  const shortPath = windowsPath.join(`${drive}\\`, windowsPath.basename(resolved));
  try {
    log(`Temporary build path: ${shortPath} (files stay in ${resolved}).`);
    return await operation(shortPath);
  } finally {
    try { await execute('subst.exe', [drive, '/D'], commandOptions); }
    catch (error) { log(`Could not remove temporary build drive ${drive}: ${error.message}`); }
  }
}

module.exports = { withShortBuildPath };
