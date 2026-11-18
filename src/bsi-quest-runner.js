const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { extractZipSafely } = require('./harry-potter-runner');
const { inspectDevice } = require('./device-library');
const { runLogged } = require('./run-logged');

const packageId = 'com.bsiquest.game';

async function validateBSIGame(gamePath) {
  if (typeof gamePath !== 'string' || !path.isAbsolute(gamePath)) throw new Error('Choose your owned BioShock Infinite Steam game folder');
  const root = path.resolve(gamePath);
  const folder = await fs.lstat(root).catch(() => null);
  const exe = await fs.lstat(path.join(root, 'Binaries', 'Win32', 'BioShockInfinite.exe')).catch(() => null);
  const engine = await fs.lstat(path.join(root, 'Engine')).catch(() => null);
  const xgame = await fs.lstat(path.join(root, 'XGame')).catch(() => null);
  if (!folder?.isDirectory() || folder.isSymbolicLink() || !exe?.isFile() || exe.isSymbolicLink()
    || !engine?.isDirectory() || engine.isSymbolicLink() || !xgame?.isDirectory() || xgame.isSymbolicLink()) {
    throw new Error('Choose the original BioShock Infinite Steam folder containing Binaries/Win32/BioShockInfinite.exe, Engine and XGame');
  }
  return root;
}

function checkedRelease(release) {
  if (release?.stale || !/^b\d+$/.test(release?.tag || '') || release.assetName !== 'BSI-Quest-Installer.zip'
    || release.downloadUrl !== `https://github.com/egomortal/bsi-quest/releases/download/${release.tag}/BSI-Quest-Installer.zip`) {
    throw new Error('Choose the official BioShock Infinite Quest installer release');
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(release.digest || '')) throw new Error('The official BioShock Infinite installer ZIP needs a SHA-256 digest');
  if (release.size != null && (!Number.isSafeInteger(release.size) || release.size < 1000000 || release.size > 200000000)) {
    throw new Error('The official BioShock Infinite installer ZIP has an invalid size');
  }
  return release;
}

async function invokeCreatorInstaller(script, gamePath, adbPath, onLog) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = await runLogged(powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Game', gamePath, '-Adb', adbPath, '-Mode', 'VR'],
    { cwd: path.dirname(script), timeoutMs: 4 * 60 * 60 * 1000, onLine: onLog });
  if (result.code !== 0) throw new Error(`Official BioShock Infinite installer failed (exit ${result.code}): ${result.tail.slice(-8).join(' | ')}`);
}

async function installBSIQuest({ gamePath, serial, release, releases, adb, workspaceRoot,
  onLog = () => {}, extract = extractZipSafely, invoke = invokeCreatorInstaller }) {
  const game = await validateBSIGame(gamePath);
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '')) throw new Error('Choose a connected Quest');
  checkedRelease(release);
  if (!releases?.downloadPackage || !adb?.listDevices || !adb?.run || !adb?.getPath) throw new Error('BioShock Infinite installation tools are unavailable');
  const devices = (await adb.listDevices()).filter((device) => device.state === 'device');
  if (devices.length !== 1 || devices[0].serial !== serial) throw new Error('The creator installer needs exactly one authorized Quest connected. Disconnect the other headset and retry.');
  const model = String(await adb.run(['-s', serial, 'shell', 'getprop', 'ro.product.model'])).trim();
  if (!/^Quest 3S?$/i.test(model)) throw new Error('BioShock Infinite Quest currently supports Quest 3; Quest 3S is untested. Quest 2 and Pro are unsupported.');
  const adbPath = adb.getPath();
  if (!adbPath || !path.isAbsolute(adbPath)) throw new Error('ADB executable path is unavailable');
  onLog('Downloading the official BioShock Infinite Quest installer ZIP...');
  const zip = await releases.downloadPackage(release, (bytes, total) => { if (total && bytes === total) onLog('Official installer download complete.'); });
  const workRoot = path.resolve(workspaceRoot || path.join(os.tmpdir(), 'vr4all-bsi-quest'));
  await fs.mkdir(workRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(workRoot, 'bsi-quest-'));
  try {
    const unpacked = path.join(staging, 'unpacked');
    await extract(zip, unpacked, { maxBytes: 200 * 1024 * 1024 });
    const bundle = path.join(unpacked, 'BSI-Quest-Installer');
    for (const filename of ['Install-BSIQuest.ps1', 'Set-Mode.ps1', 'bsi-quest.apk', 'vulkan.ad07xx.so']) {
      const stat = await fs.lstat(path.join(bundle, filename)).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`Official BioShock Infinite installer ZIP is missing ${filename}`);
    }
    onLog('Running the creator installer with your selected Steam folder and the connected Quest...');
    await invoke(path.join(bundle, 'Install-BSIQuest.ps1'), game, adbPath, onLog);
    const device = (await inspectDevice(adb, serial, [{ id: 'bioshock-infinite-vr' }]))['bioshock-infinite-vr'];
    if (device?.packageId !== packageId || !device.dataReady) throw new Error('The creator installer finished, but the Quest APK or required game folders were not found. Check the activity log before retrying.');
    return { tag: release.tag, packageId };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { validateBSIGame, checkedRelease, invokeCreatorInstaller, installBSIQuest };
