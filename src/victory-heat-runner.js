const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { inspectApkPackage } = require('./apk-verification');
const { inspectListing, runSevenZip, sevenZipPath } = require('./archive-conversion');
const { downloadPinned } = require('./pinned-download');
const { runLogged } = require('./run-logged');

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

const utmtLinux = Object.freeze({
  name: 'UndertaleModTool CLI 0.9.2.0 (Ubuntu)',
  url: 'https://github.com/UnderminersTeam/UndertaleModTool/releases/download/0.9.2.0/UTMT_CLI_v0.9.2.0-Ubuntu.zip',
  sha256: 'd182f00c0e5ced8d9252aa1f796374cfee077a3889a658e70b68685f9cd559c7', maxBytes: 80 * 1024 * 1024,
});
const openxrLoader = Object.freeze({
  name: 'OpenXR loader 1.1.63 for Android',
  url: 'https://repo1.maven.org/maven2/org/khronos/openxr/openxr_loader_for_android/1.1.63/openxr_loader_for_android-1.1.63.aar',
  sha256: '622419d2f6741c3443a3beb4779af0764318edd01830de967f24c741ebcded73', maxBytes: 20 * 1024 * 1024,
});
const gameDataSha256 = '2f7161d6250c42fe9ad72f078c2e41c035125c19694d5e41a9b456eb8e20f680';
const builderTimeoutMs = 30 * 60 * 1000;
const kitFiles = ['quest/Patch-Quest.csx', 'quest/Build-Apk.csx', 'quest/AndroidManifest-quest.bin', 'runner/gamemaker-runner-2024.8.apk', 'bin/libvhrvr.so', 'bin/VHRQuest.dex'];

async function isFile(file) { return Boolean((await fs.stat(file).catch(() => null))?.isFile()); }

// The creator's Install-Quest.ps1 -BuildOnly flow, with the Ubuntu build of UndertaleModTool's CLI.
async function runLinuxBuilder(script, args, onLog = () => {}, { runner = runLogged, download = downloadPinned, extract = extractOfficialZip, fetchImpl = fetch, home = os.homedir(), dataSha256 = gameDataSha256 } = {}) {
  const kit = path.dirname(script);
  const gameDir = args[1];
  const buildDir = path.join(kit, 'build');
  for (const file of kitFiles) if (!await isFile(path.join(kit, file))) throw new Error(`Official Victory Heat Rally kit is missing ${file}`);
  const art = (await fs.readdir(path.join(kit, 'quest', 'art')).catch(() => [])).filter((name) => name.toLowerCase().endsWith('.png'));
  if (art.length < 65) throw new Error(`Official Victory Heat Rally kit has ${art.length} of 65 driver art PNGs in quest/art`);
  await fs.mkdir(buildDir, { recursive: true });

  let data = null;
  if (await isFile(path.join(gameDir, 'data.win')) && await sha256(path.join(gameDir, 'data.win')) === dataSha256) data = path.join(gameDir, 'data.win');
  else if (await isFile(path.join(gameDir, '.vhrvr-backup', 'data.win')) && await sha256(path.join(gameDir, '.vhrvr-backup', 'data.win')) === dataSha256) {
    data = path.join(gameDir, '.vhrvr-backup', 'data.win');
    onLog('Using the original data.win saved by the PC VR mod.');
  } else throw new Error('Unsupported or modified data.win. Verify the game files in Steam (Properties > Installed Files > Verify) and try again.');

  const toolsDir = path.join(kit, 'tools');
  const cliRoot = path.join(toolsDir, 'UndertaleModCli');
  const cli = path.join(cliRoot, 'UndertaleModCli');
  if (!await isFile(cli)) {
    const archive = await download({ ...utmtLinux, destination: path.join(toolsDir, 'UTMT_CLI_v0.9.2.0-Ubuntu.zip'), fetchImpl, log: onLog });
    const staging = `${cliRoot}.partial`;
    await fs.rm(staging, { recursive: true, force: true });
    await extract(archive, staging);
    await fs.rm(cliRoot, { recursive: true, force: true });
    await fs.rename(staging, cliRoot);
  }
  const head = Buffer.alloc(4);
  const handle = await fs.open(cli, 'r').catch(() => null);
  if (!handle) throw new Error('UndertaleModTool CLI download looks wrong (no UndertaleModCli).');
  try { await handle.read(head, 0, 4, 0); } finally { await handle.close(); }
  if (head.toString('latin1') !== '\x7fELF') throw new Error('UndertaleModTool CLI is not a Linux executable');
  await fs.chmod(cli, 0o755);
  const loader = await download({ ...openxrLoader, destination: path.join(toolsDir, 'openxr_loader_for_android-1.1.63.aar'), fetchImpl, log: onLog });

  const env = { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', VHRVR_PACKAGE: kit };
  const run = async (label, cliArgs, extraEnv, logName, fatal) => {
    const lines = [];
    onLog(`${label}...`);
    const result = await runner(cli, cliArgs, { cwd: kit, env: { ...env, ...extraEnv }, timeoutMs: builderTimeoutMs, onLine: (line) => { lines.push(line); onLog(line); } });
    await fs.writeFile(path.join(buildDir, logName), `${lines.join('\n')}\n`);
    return { ...result, lines, failed: result.code !== 0 || fatal.test(lines.join('\n')) };
  };
  const droid = path.join(buildDir, 'game.droid');
  const apk = path.join(buildDir, 'VHRQuest.apk');
  await fs.rm(droid, { force: true });
  const patch = await run('Patching the Victory Heat Rally game data', ['load', data, '-s', path.join(kit, 'quest', 'Patch-Quest.csx'), '-o', droid, '-f'], {}, 'patch.log', /Script execution failed|Compile errors occurred/i);
  if (patch.failed || !await isFile(droid)) throw new Error(`Patching failed. See build/patch.log. ${patch.lines.slice(-5).join(' | ')}`);
  await fs.rm(apk, { force: true });
  const key = path.join(home, '.vhrquest-key.pem');
  const build = await run('Building the Quest APK', ['load', droid, '-s', path.join(kit, 'quest', 'Build-Apk.csx')],
    { VHRQ_DATA: droid, VHRQ_GAME: gameDir, VHRQ_LOADER: loader, VHRQ_OUT: apk, VHRQ_KEY: key }, 'build.log', /Script execution failed|Exception/i);
  if (await fs.stat(key).catch(() => null)) await fs.chmod(key, 0o600);
  if (build.failed || !await isFile(apk)) throw new Error(`Building the APK failed. See build/build.log. ${build.lines.slice(-5).join(' | ')}`);
}

async function runVictoryHeatBuild(input) {
  const { serial, releases, adb, workspaceRoot, onLog = () => {},
    extract = extractOfficialZip, platform = process.platform, build = platform === 'win32' ? runAuthorBuilder : runLinuxBuilder, inspectApk = inspectApkPackage } = input;
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

module.exports = { validateVictoryHeatInput, runVictoryHeatBuild, extractOfficialZip, runAuthorBuilder, runLinuxBuilder };
