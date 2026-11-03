const fs = require('node:fs/promises');
const path = require('node:path');
const { extractPlayerZip, findRecipeFile } = require('./official-player-runner');
const { findOnPath } = require('./find-tool');
const { runLogged } = require('./run-logged');

// The creator's native/scripts/install-linux.py still pins VERSION = "0.8.0" in 0.9.0, so it rejects its own release
// manifest. This wrapper loads the script as a module, sets VERSION from the shipped manifest, and then runs its
// main() with the same error handling as its __main__ guard (which importing skips).
const WRAPPER = `import importlib.util, json, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
scripts = root / "scripts"
manifest = json.loads((root / "release-manifest.json").read_text(encoding="utf-8-sig"))
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location("gt2_install_linux", scripts / "install-linux.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.VERSION = manifest["version"]
sys.argv = [str(scripts / "install-linux.py")] + sys.argv[2:]
try:
    module.main()
except (OSError, ValueError, RuntimeError, ImportError, module.zlib.error, EOFError, KeyboardInterrupt) as error:
    print("Installation stopped: " + str(error), file=sys.stderr)
    sys.exit(1)
`;

async function readManifest(nativeRoot) {
  const text = await fs.readFile(path.join(nativeRoot, 'release-manifest.json'), 'utf8').catch(() => '');
  let manifest;
  try { manifest = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { manifest = null; }
  const version = manifest?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)
    || !Array.isArray(manifest.files) || !manifest.files.some((file) => file?.path === `GT2-VR-${version}.apk`)) {
    throw new Error('The GT2 VR release manifest is missing or invalid.');
  }
}

// The creator's installer reads a BIN, not a ZIP: unpack a ZIP and require exactly one BIN inside.
async function discImage(gamePath, work) {
  if (path.extname(gamePath).toLowerCase() !== '.zip') return gamePath;
  const folder = path.join(work, 'disc');
  await extractPlayerZip(gamePath, folder);
  const images = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const local = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(local);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.bin') images.push(local);
    }
  }
  await walk(folder);
  if (images.length !== 1) throw new Error(`The ZIP must contain exactly one BIN image (found ${images.length}).`);
  return images[0];
}

async function installGt2Linux({ release, apk, gamePath, serial, adbPath, work, onLog = () => {} }, { findTool = findOnPath, runner = runLogged } = {}) {
  const nativeRoot = path.dirname(apk);
  await readManifest(nativeRoot);
  await findRecipeFile(release, 'native/scripts/install-linux.py');
  const bin = await discImage(gamePath, work);
  const python = findTool(['python3', 'python']);
  const probe = python && await runner(python, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], { timeoutMs: 60000 });
  if (probe?.code !== 0) throw new Error('GT2 VR on Linux needs Python 3.10 or newer (python3).');
  const result = await runner(python, ['-u', '-c', WRAPPER, nativeRoot, '--disc', bin, '--runtime', path.join(work, 'runtime'), '--adb', adbPath, '--serial', serial, '--no-bios'], {
    cwd: nativeRoot, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeoutMs: 90 * 60 * 1000, onLine: onLog,
  });
  if (result.code !== 0 || !result.tail.some((line) => line.includes('Installation verified.'))) {
    throw new Error('The GT2 VR Linux installer failed: ' + result.tail.slice(-5).join(' | '));
  }
  return {};
}

module.exports = { installGt2Linux, WRAPPER };
