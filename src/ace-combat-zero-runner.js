const fs = require('node:fs/promises');
const path = require('node:path');
const { runLogged } = require('./run-logged');
const { inspectApkPackage } = require('./apk-verification');

const PACKAGE = 'com.kulakovri.ac0oculus';
const SOURCE = Object.freeze({ repo: 'kulakovri/ac0oculus', assetPattern: '^ac0oculus-[0-9.]+-setup\\.exe$' });
const REQUIRED = ['python/python.exe', 'tools/quest_player_build.py', 'quest/package.txt', 'licenses/android-sdk-license.txt'];

async function validateAceInput(input) {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  if (typeof input.gamePackage !== 'string' || !path.isAbsolute(input.gamePackage) || path.extname(input.gamePackage).toLowerCase() !== '.iso') {
    throw new Error('Choose an existing US Ace Combat Zero ISO');
  }
  const local = path.resolve(input.gamePackage);
  const stat = await fs.lstat(local).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Choose an existing regular US Ace Combat Zero ISO');
  return { gamePackage: local, serial: input.serial };
}

function installerArgs(_setup, appDir) {
  return ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', '/NOBUILD=1', `/DIR=${appDir}`];
}

function assertRelease(release) {
  if (!release || release.stale || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(release.tag || '')
    || !/^ac0oculus-[0-9.]+-setup\.exe$/i.test(release.assetName || '')
    || !/^sha256:[a-f0-9]{64}$/i.test(release.digest || '')) throw new Error('Could not verify the official ac0oculus setup release');
  let url;
  try { url = new URL(release.downloadUrl); } catch { throw new Error('Untrusted official setup URL'); }
  if (url.origin !== 'https://github.com' || url.search || url.hash
    || !url.pathname.startsWith(`/kulakovri/ac0oculus/releases/download/${release.tag}/`)
    || decodeURIComponent(url.pathname.split('/').at(-1)) !== release.assetName) throw new Error('Untrusted official setup URL');
}

async function defaultExtract(setup, appDir, onLog) {
  const result = await runLogged(setup, installerArgs(setup, appDir), { timeoutMs: 10 * 60 * 1000, onLine: onLog });
  if (result.code !== 0) throw new Error(`Official ac0oculus setup extraction failed (exit ${result.code}): ${result.tail.slice(-5).join(' | ')}`);
}

async function acquireKit({ workspaceRoot, releases, extractSetup = defaultExtract, onLog = () => {} }) {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) || !releases?.latest || !releases?.downloadTool) {
    throw new Error('Choose a PC build folder for Ace Combat Zero');
  }
  const release = await releases.latest(SOURCE, { force: true });
  assertRelease(release);
  const appDir = path.join(workspaceRoot, 'ac0oculus');
  const marker = path.join(appDir, '.vr4all-setup-digest');
  const complete = await Promise.all(REQUIRED.map(async (name) => (await fs.stat(path.join(appDir, name)).catch(() => null))?.isFile()));
  if ((await fs.readFile(marker, 'utf8').catch(() => '')).trim() !== release.digest || complete.some((ready) => !ready)) {
    onLog(`Downloading the official ac0oculus ${release.tag} setup...`);
    const setup = await releases.downloadTool(release);
    await fs.mkdir(appDir, { recursive: true });
    await extractSetup(setup, appDir, onLog);
    for (const name of REQUIRED) {
      if (!(await fs.stat(path.join(appDir, name)).catch(() => null))?.isFile()) throw new Error(`Official ac0oculus setup is missing ${name}`);
    }
    await fs.writeFile(marker, release.digest);
  }
  if ((await fs.readFile(path.join(appDir, 'quest', 'package.txt'), 'utf8')).trim() !== PACKAGE) throw new Error('Official setup has an unexpected Quest package');
  return { release, appDir, python: path.join(appDir, 'python', 'python.exe'), script: path.join(appDir, 'tools', 'quest_player_build.py') };
}

function scriptArgs(kit, args) { return ['-I', '-B', kit.script, '--app', kit.appDir, ...args]; }

async function checkedScript(runScript, kit, args, onLog, label, timeoutMs = 10 * 60 * 1000) {
  const result = await runScript(kit.python, scriptArgs(kit, args), { cwd: kit.appDir, timeoutMs, onLine: onLog });
  if (result.code !== 0) throw new Error(`${label} failed (exit ${result.code}): ${(result.tail || []).slice(-6).join(' | ').slice(-1000)}`);
  return result;
}

async function prepareAceTools(options) {
  const kit = await acquireKit(options);
  const onLog = options.onLog || (() => {});
  const runScript = options.runScript || runLogged;
  const found = await runScript(kit.python, scriptArgs(kit, ['--find-ndk']), { cwd: kit.appDir, timeoutMs: 60 * 1000, onLine: onLog });
  if (found.code === 0) return { accepted: false, ready: true, tag: kit.release.tag };
  const license = await fs.readFile(path.join(kit.appDir, 'licenses', 'android-sdk-license.txt'), 'utf8');
  if (!options.onLicense || !await options.onLicense(license)) throw new Error('Android SDK license was declined; build tools were not downloaded');
  return { accepted: true, ready: false, tag: kit.release.tag };
}

async function verifiedPush(adb, serial, local, remote, onLog) {
  const bytes = (await fs.stat(local)).size;
  if (!bytes) throw new Error(`Builder produced an empty ${path.basename(local)}`);
  const existing = String(await adb.run(['-s', serial, 'shell', 'stat', '-c', '%s', remote]).catch(() => '')).trim();
  if (existing === String(bytes)) {
    onLog(`${path.basename(local)} is already on the Quest at the expected size.`);
    return;
  }
  const parent = path.posix.dirname(remote);
  const staging = `${remote}.vr4all-upload`;
  await adb.run(['-s', serial, 'shell', 'mkdir', '-p', parent]);
  onLog(`Copying ${path.basename(local)} to the selected Quest...`);
  await adb.run(['-s', serial, 'push', local, staging], undefined, { timeoutMs: 40 * 60 * 1000 });
  const size = String(await adb.run(['-s', serial, 'shell', 'stat', '-c', '%s', staging])).trim();
  if (size !== String(bytes)) throw new Error(`${path.basename(local)} transfer was incomplete: ${size} of ${bytes} bytes arrived`);
  await adb.run(['-s', serial, 'shell', 'mv', staging, remote]);
}

async function headsetFiles(root, relative = '') {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('Official headset data contains an unsupported link');
    const name = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) files.push(...await headsetFiles(root, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error('Official headset data contains an unsupported file type');
    if (files.length > 2000) throw new Error('Official headset data has too many files');
  }
  return files;
}

async function runAceCombatBuild(options) {
  const input = await validateAceInput(options);
  const onLog = options.onLog || (() => {});
  if (!options.adb?.run) throw new Error('Quest ADB connection is unavailable');
  const kit = await acquireKit(options);
  const runScript = options.runScript || runLogged;
  await checkedScript(runScript, kit, ['--disc', input.gamePackage, '--check-disc'], onLog, 'Ace Combat Zero US disc check');
  const ndk = await runScript(kit.python, scriptArgs(kit, ['--find-ndk']), { cwd: kit.appDir, timeoutMs: 60 * 1000, onLine: onLog });
  if (ndk.code !== 0 && !options.licenseAccepted) throw new Error('Set up Ace Combat Zero build tools and accept the Android SDK license in VR4ALL first');
  const buildArgs = ['--disc', input.gamePackage, ...(ndk.code === 0 ? [] : ['--accept-android-sdk-license'])];
  onLog('Building your personal Quest APK from the checked US Ace Combat Zero disc...');
  await checkedScript(runScript, kit, buildArgs, onLog, 'Official Ace Combat Zero build', 2 * 60 * 60 * 1000);
  const apk = path.join(kit.appDir, 'ac0oculus.apk');
  const image = path.join(kit.appDir, 'headset', 'gen_zero', 'ps2_image.bin');
  const inspectApk = options.inspectApk || inspectApkPackage;
  if ((await fs.stat(apk).catch(() => null))?.isFile() !== true || (await fs.stat(image).catch(() => null))?.isFile() !== true) throw new Error('Official builder did not produce the Quest APK and memory image');
  const foundPackage = await inspectApk(apk, options.adb.getPath?.());
  if (foundPackage !== PACKAGE) throw new Error(`Builder APK package was ${foundPackage || 'unknown'}, expected ${PACKAGE}. Nothing was installed.`);
  onLog('Installing ac0oculus on the selected Quest...');
  await options.adb.run(['-s', input.serial, 'install', '-r', '-g', apk], undefined, { timeoutMs: 10 * 60 * 1000 });
  await options.adb.run(['-s', input.serial, 'shell', 'appops', 'set', '--uid', PACKAGE, 'MANAGE_EXTERNAL_STORAGE', 'allow']);
  await verifiedPush(options.adb, input.serial, input.gamePackage, '/sdcard/ac0oculus/disc.iso', onLog);
  const root = path.join(kit.appDir, 'headset');
  for (const relative of await headsetFiles(root)) {
    await verifiedPush(options.adb, input.serial, path.join(root, relative), `/sdcard/ac0oculus/${relative}`, onLog);
  }
  onLog('Ace Combat Zero APK and its required game files are on the selected Quest.');
  return { packageId: PACKAGE, tag: kit.release.tag, sha: kit.release.digest, workDir: kit.appDir };
}

module.exports = { validateAceInput, installerArgs, prepareAceTools, runAceCombatBuild };
