const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { inspectApkPackage } = require('./apk-verification');
const { inspectListing, runSevenZip, sevenZipPath } = require('./archive-conversion');

const packageId = 'com.segadreamcat.vhrquest';
const officialSource = Object.freeze({ repo: 'segadreamcat/VictoryHeatRallyVR-Quest', assetPattern: '^VictoryHeatRallyVR-Quest-v[0-9.]+\\.zip$' });

async function validateVictoryHeatInput(input) {
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  if (typeof input.gamePackage !== 'string' || !path.isAbsolute(input.gamePackage)) throw new Error('Choose your Victory Heat Rally game folder or data.win');
  const local = path.resolve(input.gamePackage);
  const stat = await fs.lstat(local).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error('Victory Heat Rally game path does not exist');
  if (stat.isFile() && path.basename(local).toLowerCase() !== 'data.win') throw new Error('Choose data.win or its game folder');
  const folder = stat.isFile() ? path.dirname(local) : local;
  const game = await fs.stat(path.join(folder, 'data.win')).catch(() => null);
  const backup = await fs.stat(path.join(folder, '.vhrvr-backup', 'data.win')).catch(() => null);
  if (!game?.isFile() && !backup?.isFile()) throw new Error('Victory Heat Rally folder needs data.win or the PC VR mod’s .vhrvr-backup/data.win');
  return { gamePackage: folder, serial: input.serial };
}

async function extractOfficialZip(archive, destination) {
  const binary = await sevenZipPath();
  const { stdout } = await runSevenZip(binary, ['l', '-slt', '-p-', archive]);
  inspectListing(stdout);
  await runSevenZip(binary, ['x', '-y', '-p-', `-o${destination}`, archive]);
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

function assertOfficialRelease(release) {
  if (!release || release.stale || !/^[A-Za-z0-9._-]{1,60}$/.test(release.tag || '')
    || !/^VictoryHeatRallyVR-Quest-v[0-9.]+\.zip$/i.test(release.assetName || '')) throw new Error('Could not confirm the current official Victory Heat Rally builder ZIP');
  let url;
  try { url = new URL(release.downloadUrl); } catch { throw new Error('Untrusted official Victory Heat Rally release URL'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.search || url.hash
    || !/^\/segadreamcat\/VictoryHeatRallyVR-Quest\/releases\/download\/[^/]+\//i.test(url.pathname)
    || decodeURIComponent(url.pathname.split('/').at(-1)) !== release.assetName) throw new Error('Untrusted official Victory Heat Rally release URL');
}

async function preparedKit(archive, release, workspaceRoot, extract) {
  const digest = await sha256(archive);
  const root = path.join(workspaceRoot, 'victory-heat-rally');
  const workDir = path.join(root, `kit-${release.tag}-${digest.slice(0, 16)}`);
  const script = path.join(workDir, 'Install-Quest.ps1');
  const marker = path.join(workDir, '.vr4all-kit-ready');
  await fs.mkdir(root, { recursive: true });
  if ((await fs.stat(script).catch(() => null))?.isFile() && (await fs.readFile(marker, 'utf8').catch(() => '')) === digest) return workDir;
  const staging = await fs.mkdtemp(path.join(root, 'extract-'));
  try {
    await extract(archive, staging);
    if (!(await fs.stat(path.join(staging, 'Install-Quest.ps1')).catch(() => null))?.isFile()) throw new Error('Official builder ZIP is missing Install-Quest.ps1');
    await fs.writeFile(path.join(staging, '.vr4all-kit-ready'), digest);
    // Only replace this app-owned kit path under the chosen workspace.
    if (!workDir.startsWith(`${root}${path.sep}`) || path.dirname(workDir) !== root) throw new Error('Unsafe builder cache path');
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rename(staging, workDir);
    return workDir;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function runAuthorBuilder(script, args, onLog = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
      cwd: path.dirname(script), windowsHide: true,
    });
    let tail = '';
    const report = (chunk) => {
      const lines = String(chunk).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) { tail = `${tail}\n${line}`.slice(-3000); onLog(line.slice(0, 500)); }
    };
    child.stdout.on('data', report);
    child.stderr.on('data', report);
    const timer = setTimeout(() => child.kill(), 2 * 60 * 60 * 1000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Victory Heat Rally builder exited ${code}: ${tail.slice(-900)}`)); });
  });
}

async function runVictoryHeatBuild(input) {
  const { serial, releases, adb, workspaceRoot, onLog = () => {},
    extract = extractOfficialZip, build = runAuthorBuilder, inspectApk = inspectApkPackage } = input;
  const validated = await validateVictoryHeatInput(input);
  if (!releases?.latest || !releases?.downloadPackage || !adb?.run || !workspaceRoot || !path.isAbsolute(workspaceRoot)) throw new Error('Victory Heat Rally build services are unavailable');
  const release = await releases.latest(officialSource, { force: true });
  assertOfficialRelease(release);
  onLog(`Downloading official Victory Heat Rally builder ${release.tag}...`);
  const archive = await releases.downloadPackage(release, (bytes, total) => {
    if (total && bytes === total) onLog('Official builder download complete.');
  });
  const workDir = await preparedKit(archive, release, workspaceRoot, extract);
  onLog(`Building from your owned game in ${workDir}...`);
  const script = path.join(workDir, 'Install-Quest.ps1');
  await build(script, ['-GameDirectory', validated.gamePackage, '-BuildOnly'], onLog);
  const apkPath = path.join(workDir, 'build', 'VHRQuest.apk');
  if (!(await fs.stat(apkPath).catch(() => null))?.isFile()) throw new Error('Official builder did not produce VHRQuest.apk');
  const actualPackage = await inspectApk(apkPath, adb.getPath?.());
  if (actualPackage !== packageId) throw new Error(`Builder produced an unexpected APK package (${actualPackage || 'unknown'})`);
  onLog('Installing your personal Victory Heat Rally APK on the selected Quest...');
  await adb.run(['-s', serial, 'install', '-r', apkPath]);
  const buildDir = path.join(workDir, 'build');
  if (path.dirname(buildDir) !== workDir) throw new Error('Unsafe builder output path');
  await fs.rm(buildDir, { recursive: true, force: true });
  onLog('Victory Heat Rally transferred. Launch it on the headset to confirm gameplay.');
  return { packageId, sha: release.tag, workDir };
}

module.exports = { validateVictoryHeatInput, runVictoryHeatBuild, extractOfficialZip, runAuthorBuilder };
