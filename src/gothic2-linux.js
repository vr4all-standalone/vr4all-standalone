const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { findRecipeFile } = require('./official-player-runner');
const { findOnPath } = require('./find-tool');
const { runLogged } = require('./run-logged');

// Port of the creator's Windows flow (Quest/tools/install-release.ps1, install-quest.ps1, open-data-import.ps1):
// the creator's Python packager builds the private game ZIP, then the steps the PowerShell scripts run through adb
// happen here in Node. The game files themselves are imported inside the headset by the app, not by this installer.
const REMOTE_DIR = '/sdcard/Download/Gothic2VR';
const MIN_FREE_RESERVE = 512 * 1024 ** 2;
const SETUP_ACTIVITY = 'com.gothic2vr.quest/org.opengothic.app.SetupActivity';
const KIT_FILES = ['tools/package-game-data.py', 'tools/verify-game-data.py', 'engine/android/tools/game_package.py', 'release.json', 'config/android-toolchain.lock.json'];

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function readJson(file, what) {
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new Error(`${what} is missing or unreadable.`); }
}

async function installGothicLinux({ release, gamePath, serial, adb, onLog = () => {} }, { findTool = findOnPath, runner = runLogged } = {}) {
  const S = ['-s', serial];
  const script = await findRecipeFile(release, 'Quest/tools/package-game-data.py');
  const questRoot = path.dirname(path.dirname(script));
  for (const required of KIT_FILES) {
    if (!(await fs.stat(path.join(questRoot, ...required.split('/'))).catch(() => null))?.isFile()) {
      throw new Error(`Official release is missing its expected Quest player file: Quest/${required}`);
    }
  }
  const lock = await readJson(path.join(questRoot, 'config', 'android-toolchain.lock.json'), 'The Gothic II VR toolchain lock');
  const releaseInfo = await readJson(path.join(questRoot, 'release.json'), 'The Gothic II VR release manifest');
  if (typeof releaseInfo.apk?.file !== 'string' || !/^[A-Za-z0-9_.-]+\.apk$/.test(releaseInfo.apk.file) || releaseInfo.applicationId !== lock.applicationId) {
    throw new Error('Invalid release manifest.');
  }
  const app = lock.applicationId;
  const apk = path.join(questRoot, releaseInfo.apk.file);
  const apkHash = (await fs.stat(apk).catch(() => null))?.isFile() ? await sha256File(apk) : null;
  if (apkHash !== String(releaseInfo.apk.sha256).toLowerCase()) throw new Error('APK checksum mismatch. Extract a fresh copy of the release archive.');

  // Select-Quest: the serial must be online and a Quest. Checked before the long packaging step and again before the import screen.
  async function selectQuest() {
    if (!(await adb.listDevices()).some((device) => device.serial === serial && device.state === 'device')) throw new Error('Selected Quest is not connected and authorized.');
    const model = (await adb.run([...S, 'shell', 'getprop', 'ro.product.model'])).trim();
    if (!/^Quest/.test(model)) throw new Error(`Selected device is not a Quest: ${model}`);
  }
  // adb propagates the remote exit status; an empty-output failure rejects with 'ADB exited N'. Other failures are real errors.
  async function exitCode(args) {
    try { await adb.run([...S, ...args]); return 0; }
    catch (error) {
      const code = /^ADB exited (\d+)$/.exec(error.message)?.[1];
      if (code === undefined) throw error;
      return Number(code);
    }
  }
  const remoteHash = async (file) => (await adb.run([...S, 'shell', 'sha256sum', file])).trim().split(/\s+/)[0].toLowerCase();

  await selectQuest();
  const python = findTool(['python3', 'python']);
  const probe = python && await runner(python, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], { timeoutMs: 60000 });
  if (probe?.code !== 0) throw new Error('Gothic II VR on Linux needs Python 3.10 or newer (python3).');

  onLog('Packaging your Gothic II game data. This can take several minutes...');
  // The packager prints a pretty-printed JSON report after its progress lines; only the progress is worth showing.
  const packaged = await runner(python, ['-B', script, '--game-root', gamePath], {
    cwd: path.dirname(script), env: { ...process.env, PYTHONUTF8: '1' }, timeoutMs: 90 * 60 * 1000, onLine: (line) => { if (!/^[{}[\]"]/.test(line)) onLog(line); },
  });
  if (packaged.code !== 0) throw new Error('Game data packaging failed. No game files were transferred. ' + packaged.tail.slice(-3).join(' | '));

  const privateDir = path.join(questRoot, 'build', 'private');
  const archive = path.join(privateDir, 'game-data.zip');
  const data = await readJson(path.join(privateDir, 'game-data.manifest.json'), 'The packaged game-data manifest');
  const verified = await readJson(path.join(privateDir, 'game-data.verification.json'), 'The game-data verification report');
  const dataHash = (await fs.stat(archive).catch(() => null))?.isFile() ? await sha256File(archive) : null;
  if (data.status !== 'packaged' || verified.status !== 'passed' || dataHash !== String(data.sha256).toLowerCase() || dataHash !== String(verified.sha256).toLowerCase()) {
    throw new Error('Current private game-data verification is required.');
  }
  const remoteArchive = `${REMOTE_DIR}/game-data-${dataHash.slice(0, 12)}.zip`;

  await selectQuest();
  if (Number((await adb.run([...S, 'shell', 'getprop', 'ro.build.version.sdk'])).trim()) < lock.minSdk) throw new Error('Device Android API is below the APK minimum.');
  const existing = await adb.run([...S, 'shell', 'pm', 'path', app]).then((output) => output, async (error) => {
    if (error.message === 'ADB exited 1') return '';
    throw new Error('Could not query existing application.');
  });
  const files = `/sdcard/Android/data/${app}/files`;
  const before = {};
  if (/^package:/.test(existing)) {
    const listing = await adb.run([...S, 'shell', 'ls', '-1', files]).then((output) => output, () => null);
    if (listing !== null) {
      const names = listing.split(/\r?\n/).map((line) => line.trim()).filter((name) => /^[A-Za-z0-9_.-]+\.(sav|ini)$/.test(name)).sort();
      for (const name of names) before[name] = await remoteHash(`${files}/${name}`);
    } else if (await exitCode(['shell', 'test', '-d', files]) === 0) {
      throw new Error('Existing save/settings directory cannot be read; update stopped before installation.');
    }
  }

  const required = MIN_FREE_RESERVE + Number(data.bytes) + Number(data.archive_bytes);
  const df = (await adb.run([...S, 'shell', 'df', '-k', '/sdcard'])).trim().split(/\r?\n/).pop().trim().split(/\s+/);
  if (!Number.isFinite(required) || !(Number(df[3]) * 1024 >= required)) throw new Error('Not enough free space for installation/import and a 512 MiB reserve.');

  onLog('Installing the Gothic II VR app (your saves and settings are kept)...');
  const installed = await adb.run([...S, 'install', '--no-streaming', '-r', apk]).catch((error) => error.message);
  if (!/^Success\s*$/m.test(installed)) throw new Error(`Installer did not report Success: ${installed}`);
  const remotePackage = /^package:([^\r\n]+)$/.exec((await adb.run([...S, 'shell', 'pm', 'path', app])).trim())?.[1];
  if (!remotePackage) throw new Error('Expected one installed APK path.');
  if (await remoteHash(remotePackage) !== apkHash) throw new Error('Installed APK hash differs from the verified build.');
  for (const [name, hash] of Object.entries(before)) {
    if (await remoteHash(`${files}/${name}`) !== hash) throw new Error('A save/settings hash changed during installation. Inspect the deployment report.');
  }

  await adb.run([...S, 'shell', 'mkdir', '-p', REMOTE_DIR]);
  if (await exitCode(['shell', 'test', '-f', remoteArchive]) === 0) {
    if (await remoteHash(remoteArchive) !== dataHash) throw new Error('Existing destination differs; preserved without replacement.');
    onLog('The game ZIP on the headset is already identical; not copied again.');
  } else {
    const partial = `${remoteArchive}.part`;
    if (await exitCode(['shell', 'test', '-e', partial]) === 0) throw new Error(`A previous partial transfer is preserved: ${partial}. Inspect it before retrying.`);
    onLog(`Copying the game ZIP (${(Number(data.archive_bytes) / 1024 ** 2).toFixed(0)} MiB) to the headset...`);
    await adb.run([...S, 'push', archive, partial]);
    if (await remoteHash(partial) !== dataHash) throw new Error('Transferred archive hash mismatch; partial file retained.');
    await adb.run([...S, 'shell', 'mv', partial, remoteArchive]);
  }
  onLog('Game ZIP is ready in Download/Gothic2VR.');

  await selectQuest();
  const started = await adb.run([...S, 'shell', 'am', 'start', '-W', '-a', 'com.gothic2vr.quest.IMPORT_GAME_FILES', '-n', SETUP_ACTIVITY]).catch((error) => error.message);
  if (!/Status: ok/.test(started)) throw new Error(`Could not open the import screen: ${started}`);
  onLog('In the headset, select the ZIP under Download/Gothic2VR and wait for the import to finish.');
  return { importPending: true, archive: remoteArchive };
}

module.exports = { installGothicLinux };
