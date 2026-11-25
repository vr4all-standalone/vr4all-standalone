const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { extractZipSafely } = require('./harry-potter-runner');
const { inspectDevice } = require('./device-library');
const { runLogged } = require('./run-logged');
const { inspectDirectoryArchive, extractDirectoryArchive, removeConversionDirectory } = require('./archive-conversion');

const packageId = 'com.libertyvr.quest';
const requiredFiles = ['data/main.scm', 'data/default.dat', 'data/gta3.dat', 'data/handling.cfg', 'data/weapon.dat',
  'models/gta3.img', 'models/gta3.dir', 'models/frontend.txd', 'models/menu.txd', 'models/fonts.txd',
  'anim/ped.ifp', 'anim/cuts.img', 'anim/cuts.dir', 'text/american.gxt', 'audio/sfx.raw', 'audio/sfx.sdt'];
const gameArchive = {
  label: 'GTA III PC game archive',
  requiredDirectories: ['movies'],
  requiredNestedEntries: Object.fromEntries(['data', 'models', 'anim', 'text', 'audio'].map((folder) =>
    [folder, requiredFiles.filter((name) => name.startsWith(`${folder}/`)).map((name) => name.slice(folder.length + 1))])),
};

async function checkPcFolder(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
  const missing = [];
  if (!byName.get('movies')?.isDirectory() || byName.get('movies').isSymbolicLink()) missing.push('movies/');
  for (const relative of requiredFiles) {
    const parts = relative.split('/');
    const top = byName.get(parts[0]);
    if (!top?.isDirectory() || top.isSymbolicLink()) { missing.push(relative); continue; }
    let current = path.join(folder, top.name);
    let valid = true;
    for (let index = 1; index < parts.length; index++) {
      const child = (await fs.readdir(current, { withFileTypes: true }).catch(() => []))
        .find((entry) => entry.name.toLowerCase() === parts[index]);
      if (!child || child.isSymbolicLink() || (index === parts.length - 1 ? !child.isFile() : !child.isDirectory())) {
        valid = false; break;
      }
      current = path.join(current, child.name);
    }
    if (!valid) missing.push(relative);
  }
  if (missing.length) throw new Error(`GTA III game folder is missing ${missing.join(', ')}. The creator requires the complete PC game, including Audio/sfx.RAW and Audio/sfx.SDT.`);
}

async function validateLibertyInput({ gamePackage, serial, acceptSdkLicenses = false }) {
  if (typeof gamePackage !== 'string' || !path.isAbsolute(gamePackage)) throw new Error('Choose your complete GTA III PC game folder, archive, or original US Xbox ISO');
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '')) throw new Error('Choose a connected Quest');
  const selected = path.resolve(gamePackage);
  const stat = await fs.lstat(selected).catch(() => null);
  if (!stat || stat.isSymbolicLink()) throw new Error('Choose an existing regular GTA III game folder or disc image');
  if (stat.isDirectory()) await checkPcFolder(selected);
  else if (stat.isFile() && /\.(zip|7z|rar)$/i.test(selected)) await inspectDirectoryArchive(gameArchive, selected);
  else if (stat.isFile() && /\.iso$/i.test(selected) && stat.size > 0 && stat.size <= 8 * 1024 ** 3) { /* Creator validates the US Xbox revision. */ }
  else throw new Error('Choose a complete GTA III PC folder, ZIP/7z/RAR archive, or original US Xbox ISO');
  return { gamePackage: selected, serial, variant: /\.iso$/i.test(selected) ? 'xbox' : 'pc', acceptSdkLicenses: acceptSdkLicenses === true };
}

function checkedRelease(release) {
  if (release?.stale || !/^v\d+\.\d+\.\d+-setup\.\d+$/.test(release?.tag || '')) throw new Error('Choose a current official Liberty City VR setup release');
  const assetName = `Liberty-City-VR-${release.tag.slice(1)}-Windows-PCVR-x64.zip`;
  if (release.assetName !== assetName || release.downloadUrl !== `https://github.com/kornacious/liberty-city-vr/releases/download/${release.tag}/${assetName}`)
    throw new Error('The Liberty City VR installer must come from the official creator release');
  if (!/^sha256:[a-f0-9]{64}$/i.test(release.digest || '')) throw new Error('The official Liberty City VR ZIP needs a SHA-256 digest');
  if (release.size != null && (!Number.isSafeInteger(release.size) || release.size < 1000000 || release.size > 300000000)) throw new Error('Invalid official Liberty City VR ZIP size');
  return release;
}

function buildManagerRequest(input, kitRoot, workplace, adbPath) {
  return {
    Settings: { Repository: kitRoot, Workplace: workplace, GameDirectory: input.variant === 'pc' ? input.gamePackage : '', Adb: adbPath, AllowToolDownloads: true },
    Options: { Target: 0, InstallPcVariant: input.variant === 'pc', InstallXboxVariant: input.variant === 'xbox', XboxIsoPath: input.variant === 'xbox' ? input.gamePackage : '',
      AcceptSdkLicenses: input.acceptSdkLicenses === true, CacheAstcTextures: true, ConvertRadioStations: input.variant === 'pc', Release: false, BuildOnly: false },
  };
}

async function invokeCreatorManager(exe, args, onLog, settingsDir) {
  const result = await runLogged(exe, args, { cwd: path.dirname(exe), env: { ...process.env, LCVR_SETTINGS_DIR: settingsDir },
    timeoutMs: 6 * 60 * 60 * 1000, onLine: onLog });
  if (result.code !== 0) throw new Error(`Official Liberty City VR build failed (exit ${result.code}): ${result.tail.slice(-8).join(' | ')}`);
  return result;
}

async function installLibertyCity({ gamePackage, serial, acceptSdkLicenses = false, release, releases, adb, workspaceRoot,
  onLog = () => {}, platform = process.platform, extract = extractZipSafely, invoke = invokeCreatorManager,
  inspect = (adapter, deviceSerial) => inspectDevice(adapter, deviceSerial, [{ id: 'liberty-city-vr', data: [] }]) }) {
  if (platform !== 'win32') throw new Error('Liberty City VR installation currently requires Windows in VR4ALL');
  const input = await validateLibertyInput({ gamePackage, serial, acceptSdkLicenses });
  checkedRelease(release);
  if (!releases?.downloadPackage || !adb?.listDevices || !adb?.run || !adb?.getPath) throw new Error('Liberty City VR installation tools are unavailable');
  const devices = (await adb.listDevices()).filter((device) => device.state === 'device');
  if (devices.length !== 1 || devices[0].serial !== serial) throw new Error('The creator installer needs exactly one authorized Quest connected. Disconnect other headsets and retry.');
  const model = String(await adb.run(['-s', serial, 'shell', 'getprop', 'ro.product.model'])).trim();
  if (!/^Quest 3$/i.test(model)) throw new Error('The creator currently supports Quest 3 only. Quest 3S is not documented as supported.');
  const adbPath = adb.getPath();
  if (!adbPath || !path.isAbsolute(adbPath)) throw new Error('ADB executable path is unavailable');
  const root = path.resolve(workspaceRoot || path.join(os.tmpdir(), 'vr4all-liberty-city-vr'));
  await fs.mkdir(root, { recursive: true });
  const staging = await fs.mkdtemp(path.join(root, 'liberty-city-'));
  let converted = null;
  try {
    if (/\.(zip|7z|rar)$/i.test(input.gamePackage)) {
      onLog('Extracting your owned GTA III game archive...');
      converted = await extractDirectoryArchive(gameArchive, input.gamePackage, { tempRoot: root });
      input.gamePackage = converted.path;
      await checkPcFolder(input.gamePackage);
    }
    onLog('Downloading the verified official Liberty City VR Windows setup kit...');
    const zip = await releases.downloadPackage(release);
    const unpacked = path.join(staging, 'unpacked');
    await extract(zip, unpacked, { maxBytes: 300 * 1024 * 1024 });
    const kit = path.join(unpacked, 'Liberty City VR Setup');
    for (const filename of ['Setup/LibertyManager.exe', 'overlay/android/app/build.gradle.kts']) {
      const entry = await fs.lstat(path.join(kit, ...filename.split('/'))).catch(() => null);
      if (!entry?.isFile() || entry.isSymbolicLink() || !entry.size) throw new Error(`Official Liberty City VR kit is missing ${filename}`);
    }
    const workplace = path.join(root, 'build');
    const settingsDir = path.join(root, 'settings');
    await fs.mkdir(workplace, { recursive: true });
    await fs.mkdir(settingsDir, { recursive: true });
    const requestPath = path.join(staging, 'manager-request.json');
    await fs.writeFile(requestPath, JSON.stringify(buildManagerRequest(input, kit, workplace, adbPath)), { flag: 'wx' });
    onLog('Building and installing your personal Quest 3 APK with the creator’s manager. This may download several GB of build tools.');
    await invoke(path.join(kit, 'Setup', 'LibertyManager.exe'), ['--run', 'BuildAndInstall', requestPath], onLog, settingsDir);
    const device = (await inspect(adb, serial))['liberty-city-vr'];
    if (device?.packageId !== packageId || !device.dataReady) throw new Error('The creator manager finished, but the Quest APK or complete game variant was not found. Check the activity log before retrying.');
    return { tag: release.tag, packageId };
  } finally {
    if (converted) await removeConversionDirectory(converted.directory, root);
    await fs.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { validateLibertyInput, checkedRelease, buildManagerRequest, invokeCreatorManager, installLibertyCity };
