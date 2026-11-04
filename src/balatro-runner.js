const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { acquireSourceKit } = require('./personal-build');
const { inspectApkPackage } = require('./apk-verification');
const { runLogged } = require('./run-logged');

const CLIENT = 'io.github.balaurent.balatroinvr';
const HOST = 'io.github.balaurent.balatrovr.host';
const REPO = 'BaLaurent/BalatroVRMod-Standalone';

async function validateBalatroInput(input) {
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  if (typeof input.gamePackage !== 'string' || !path.isAbsolute(input.gamePackage)
    || path.basename(input.gamePackage).toLowerCase() !== 'balatro.exe') throw new Error('Choose your owned Steam Balatro.exe (version 1.0.1o)');
  const stat = await fs.lstat(input.gamePackage).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Choose an existing regular Balatro.exe file');
  return { gamePackage: path.resolve(input.gamePackage), serial: input.serial };
}

// Paths are positional Bash parameters, never interpolated into shell code.
const buildScript = `set -euo pipefail
source_dir="$1"
game_file="$2"
output_dir="$3"
revision="$4"
for tool in godot java keytool git python3 curl unzip; do
  command -v "$tool" >/dev/null || { echo "Missing Linux build tool: $tool" >&2; exit 2; }
done
if [ -z "\${ANDROID_HOME:-}" ] && [ ! -d /opt/android-sdk ]; then
  echo "Android SDK not found. Set ANDROID_HOME inside Linux/WSL and configure Godot's Android SDK and JDK 17 paths." >&2
  exit 2
fi
if [ "\${VR4ALL_BALATRO_WSL:-0}" = 1 ]; then
  work="$HOME/.cache/vr4all/balatro-vr/$revision"
  mkdir -p "$work"
  if [ ! -f "$work/quest/build_client.sh" ]; then cp -a "$source_dir/." "$work/"; fi
else
  work="$source_dir"
fi
cd "$work"
bash quest/fetch_deps.sh
bash quest/build_client.sh
python3 quest/host/build_host.py --balatro "$game_file"
mkdir -p "$output_dir"
cp Release/BalatroInVR-Quest.apk Release/BalatroVRHost.apk "$output_dir/"
`;

async function checkedCommand(runCommand, command, args, options, description) {
  const result = await runCommand(command, args, options);
  if (result.code !== 0) {
    const tail = (result.tail || []).slice(-8).join(' ').slice(-1000);
    throw new Error(`${description} failed (exit ${result.code})${tail ? `: ${tail}` : ''}`);
  }
  return result;
}

async function runBalatroBuild(rawInput, options = {}) {
  const input = await validateBalatroInput(rawInput);
  const platform = options.platform || process.platform;
  if (!['win32', 'linux'].includes(platform)) throw new Error('Balatro VR creator build supports Linux or Windows with WSL2');
  const workspaceRoot = options.workspaceRoot;
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) throw new Error('Choose a PC build folder');
  const onLog = options.onLog || (() => {});
  const runCommand = options.runCommand || ((command, args, settings) => runLogged(command, args, { ...settings, onLine: onLog }));
  const sourceKit = options.sourceKit || acquireSourceKit;
  const inspectApk = options.inspectApk || inspectApkPackage;
  const adb = options.adb;
  if (!adb?.run) throw new Error('Quest ADB connection is unavailable');
  if (platform === 'win32') {
    try { await checkedCommand(runCommand, 'wsl.exe', ['--exec', 'true'], {}, 'WSL2'); }
    catch (error) { throw new Error(`Balatro VR needs WSL2 Ubuntu before downloading its build source: ${error.message}`); }
  }

  const root = path.join(workspaceRoot, 'balatro-vr');
  await fs.mkdir(root, { recursive: true });
  const kit = await sourceKit('balatro-vr', path.join(root, 'source-kits'), onLog, { platform });
  if (!/^[a-f0-9]{40}$/i.test(kit.sha || '')) throw new Error('Official Balatro source revision is invalid');
  const outputDir = path.join(root, 'output', `${kit.sha.slice(0, 12)}-${crypto.randomUUID()}`);
  await fs.mkdir(outputDir, { recursive: true });
  const args = [kit.directory, input.gamePackage, outputDir];
  if (platform === 'win32') {
    // Build in the WSL Linux filesystem, then copy the APKs to the selected
    // Windows folder for verification and the Windows ADB transfer.
    for (let i = 0; i < args.length; i++) {
      let result;
      try { result = await checkedCommand(runCommand, 'wsl.exe', ['--exec', 'wslpath', '-u', args[i]], { captureStdout: true }, 'WSL path conversion'); }
      catch (error) { throw new Error(`Balatro VR requires a configured WSL2 Linux distribution: ${error.message}`); }
      args[i] = String(result.stdout || '').trim();
      if (!args[i].startsWith('/')) throw new Error('WSL could not access the selected Balatro or build folder');
    }
  }
  onLog(`Building Balatro VR from official ${REPO} commit ${kit.sha.slice(0, 12)}.`);
  const command = platform === 'win32' ? 'wsl.exe' : 'bash';
  const commandArgs = platform === 'win32'
    ? ['--exec', 'env', 'VR4ALL_BALATRO_WSL=1', 'bash', '-lc', buildScript, 'vr4all-balatro', ...args, kit.sha]
    : ['-lc', buildScript, 'vr4all-balatro', ...args, kit.sha];
  await checkedCommand(runCommand, command, commandArgs, { cwd: kit.directory, timeoutMs: 2 * 60 * 60 * 1000 }, 'Official Balatro build');

  const clientApk = path.join(outputDir, 'BalatroInVR-Quest.apk');
  const hostApk = path.join(outputDir, 'BalatroVRHost.apk');
  for (const [file, expected] of [[clientApk, CLIENT], [hostApk, HOST]]) {
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`Official build did not produce ${path.basename(file)}`);
    const actual = await inspectApk(file, adb.getPath?.());
    if (actual !== expected) throw new Error(`${path.basename(file)} has package ${actual}; expected ${expected}. Nothing was installed.`);
  }
  for (const apk of [clientApk, hostApk]) {
    onLog(`Installing ${path.basename(apk)} on the selected Quest...`);
    const result = await adb.run(['-s', input.serial, 'install', '-r', apk]);
    if (!/^Success\b/m.test(result)) throw new Error(`Quest did not confirm ${path.basename(apk)} installation: ${result || 'no response'}`);
  }
  return { sha: kit.sha, packageId: HOST, clientPackageId: CLIENT, outputDir };
}

module.exports = { validateBalatroInput, runBalatroBuild, CLIENT, HOST };
