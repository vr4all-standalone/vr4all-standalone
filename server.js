const http = require('node:http');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { getCatalog } = require('./src/catalog');
const { migrateStandaloneSettings } = require('./src/standalone-settings-migration');
const { buildInstallPlan, safeDestination } = require('./src/core');
const { createAdb } = require('./src/adb');
const { inspectDevice, packages } = require('./src/device-library');
const { verifyGameFile } = require('./src/file-verification');
const { verifyPushedFile } = require('./src/transfer-verification');
const { stageLowercaseDirectory } = require('./src/lowercase-directory');
const { packageWipeoutData, transferWipeoutData } = require('./src/wipeout-data');
const { packageAvpData, transferAvpData } = require('./src/avp-data');
const { isWipeoutDisc, isWipeoutArchive, inspectWipeoutDisc, inspectWipeoutArchive, extractWipeoutArchive, inspectWipeoutFolder } = require('./src/wipeout-disc');
const { validateMgsDiscPairs } = require('./src/mgs-discs');
const { inspectApkPackage } = require('./src/apk-verification');
const { ManagedLibrary } = require('./src/managed-library');
const { GitHubReleases, validateSource } = require('./src/releases');
const { matchesInstalledApk, matchesInstalledDigest } = require('./src/apk-match');
const { validatePersonalBuildInput, runPersonalBuild } = require('./src/personal-build');
const { checkRdrInternet } = require('./src/rdr-connectivity');
const { validateViceCityInput, runViceCityBuild } = require('./src/vice-city-runner');
const { setupBuildTools } = require('./src/android-sdk-setup');
const { listExportPhones, checkPhoneGame, exportPhoneGame, isHeadsetListing } = require('./src/phone-export');
const { validateVirtuaInput, installVirtuaFzero } = require('./src/fzero-virtuavr-runner');
const { installRoadRashPlayer } = require('./src/road-rash-runner');
const { installHarryPotterPlayer } = require('./src/harry-potter-runner');
const { installDescent3 } = require('./src/descent3-runner');
const { installOfficialPlayer, validateOwnedInput, recipes: officialPlayerRecipes } = require('./src/official-player-runner');
const { installMagicCarpet } = require('./src/magic-carpet-runner');
const { installAstroQuest, validateAstroGame } = require('./src/astroquest-runner');
const { installGalaxyQuest, validateGalaxyInput, chooseGalaxyWorkRoot } = require('./src/galaxyquest-runner');
const { installSclerosis, validateSclerosisGame } = require('./src/sclerosis-runner');
const { installJkxr } = require('./src/jkxr-runner');
const { inspectBeefRaiderData, installBeefRaiderApk, transferBeefRaiderData } = require('./src/beef-raider-runner');
const { pickPath } = require('./src/picker');
const { needsZipConversion, acceptsZipContents, convertArchiveToZip, packageDirectoryToZip, inspectDirectoryArchive, extractDirectoryArchive, inspectSingleFileArchive, extractSingleFileArchive, removeConversionDirectory } = require('./src/archive-conversion');

const publicDir = path.join(__dirname, 'public');
const defaultSettingsPath = path.join(__dirname, '.questdesk', 'settings.json');
const appearanceThemes = ['graphite', 'y2k', 'frost', 'classic', 'console'];
const appearancePalettes = ['blue', 'mint', 'iris', 'rose', 'amber', 'silver'];
function appearanceTheme(value) {
  if (value === 'classic') return 'graphite';
  if (value === 'console') return 'y2k';
  return ['graphite', 'y2k', 'frost'].includes(value) ? value : 'graphite';
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
function safeRelativeUpload(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.startsWith('/') || value.includes('\\')) throw new Error('Invalid dropped file path');
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.length > 255 || /[:\x00-\x1f]/.test(segment))) throw new Error('Invalid dropped file path');
  return segments;
}
function removeBulkTemp(root) {
  const resolved = path.resolve(root);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('vr4all-bulk-')) return Promise.resolve();
  return fs.rm(resolved, { recursive: true, force: true });
}

function createApp(options = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const settingsPath = options.settingsPath || null;
  let settings = { adbPath: '', sources: {}, theme: 'graphite', palette: 'blue', customGames: [], installed: {}, localPaths: {} };
  let pendingSettingsWrite = Promise.resolve();
  const jobs = new Map();
  const busySerials = new Set();
  const installQueues = new Map();
  function canQueueInstall(serial) {
    return !busySerials.has(serial) || installQueues.has(serial);
  }
  function queueInstall(job, runner) {
    let queue = installQueues.get(job.serial);
    if (!queue) {
      queue = [];
      installQueues.set(job.serial, queue);
      busySerials.add(job.serial);
    }
    queue.push({ job, runner });
    job.queuePosition = queue.length - 1;
    if (job.queuePosition) job.log.push(`Waiting for ${job.queuePosition} install${job.queuePosition === 1 ? '' : 's'} ahead on this headset.`);
    if (queue.length === 1) setImmediate(() => runQueuedInstall(job.serial));
  }
  async function runQueuedInstall(serial) {
    const queue = installQueues.get(serial);
    if (!queue?.length) return;
    const { job, runner } = queue[0];
    job.queuePosition = 0;
    try { await runner(); }
    catch (error) {
      job.status = 'error';
      job.error = error.message;
      job.log.push(`Error: ${error.message}`);
      await rememberFinishedJob(job);
    }
    finally {
      queue.shift();
      for (let index = 0; index < queue.length; index++) {
        queue[index].job.queuePosition = index;
        queue[index].job.log.push(index ? `Waiting for ${index} install${index === 1 ? '' : 's'} ahead on this headset.` : 'Starting installation on this headset…');
      }
      if (queue.length) setImmediate(() => runQueuedInstall(serial));
      else { installQueues.delete(serial); busySerials.delete(serial); }
    }
  }
  const busyBuildGames = new Set();
  const busyPhoneExportGames = new Set();
  const buildToolGames = new Set(['vice-city-vr', 'rdr1-vr', 'gta-sa-vr']);
  const sdkDecisions = new Map();
  const uploadedFiles = new Set();
  const bulkSessions = new Map();
  const convertedArchives = new Map();
  const conversionDirectories = new Set();
  const adb = options.adb || createAdb(() => settings.adbPath);
  const releases = options.releases || new GitHubReleases();
  const picker = options.picker || pickPath;
  const inspectApk = options.inspectApkPackage || inspectApkPackage;
  const personalBuilder = options.personalBuilder || runPersonalBuild;
  const viceCityBuilder = options.viceCityBuilder || runViceCityBuild;
  const sdkSetup = options.sdkSetup || setupBuildTools;
  const phoneExporter = options.phoneExporter || exportPhoneGame;
  const phoneChecker = options.phoneChecker || checkPhoneGame;
  const validateFzeroVirtuaInput = options.validateFzeroVirtuaInput || validateVirtuaInput;
  const fzeroVirtuaInstaller = options.fzeroVirtuaInstaller || installVirtuaFzero;
  const roadRashInstaller = options.roadRashInstaller || installRoadRashPlayer;
  const harryPotterInstaller = options.harryPotterInstaller || installHarryPotterPlayer;
  const descent3Installer = options.descent3Installer || installDescent3;
  const officialPlayerInstaller = options.officialPlayerInstaller || installOfficialPlayer;
  const magicCarpetInstaller = options.magicCarpetInstaller || installMagicCarpet;
  const astroQuestInstaller = options.astroQuestInstaller || installAstroQuest;
  const galaxyQuestInstaller = options.galaxyQuestInstaller || installGalaxyQuest;
  const galaxyWorkspacePicker = options.galaxyWorkspacePicker || chooseGalaxyWorkRoot;
  const sclerosisInstaller = options.sclerosisInstaller || installSclerosis;
  const jkxrInstaller = options.jkxrInstaller || installJkxr;
  const beefRaiderInstaller = options.beefRaiderInstaller || installBeefRaiderApk;
  const beefRaiderTransfer = options.beefRaiderTransfer || transferBeefRaiderData;
  const crazyTaxiInstaller = options.crazyTaxiInstaller || ((input) => require('./src/crazy-taxi-runner').installCrazyTaxi(input));
  const managedRoot = options.libraryPath || path.join(path.dirname(settingsPath || path.join(os.tmpdir(), `vr4all-session-${token}`, 'settings.json')), 'library');
  let managedLibrary = options.managedLibrary || new ManagedLibrary(managedRoot); // Read legacy links only.
  const defaultScanFolder = path.resolve(options.downloadsPath || path.join(os.homedir(), 'Downloads'));
  const builderHome = settingsPath ? path.dirname(settingsPath) : path.join(os.tmpdir(), 'vr4all-personal-build');
  const builderRoots = options.builderRoots || { cacheRoot: path.join(builderHome, 'source-kits'), workRoot: path.join(builderHome, 'builds') };
  function buildWorkRoot() { return settings.buildWorkspace || builderRoots.workRoot; }
  function personalRoots() { return { ...builderRoots, workRoot: buildWorkRoot() }; }
  function viceCityRoots(downloadLocation) {
    const root = path.join(downloadLocation, 'VR4ALL-build-tools');
    return { cacheRoot: path.join(root, 'source-kits'), workRoot: path.join(root, 'builds') };
  }
  function buildToolsLocation(gameId) {
    return settings.buildToolsLocations?.[gameId] || settings.sharedBuildToolsLocation
      || [...buildToolGames].map((id) => settings.buildToolsLocations?.[id]).find(Boolean);
  }
  async function validateBuildToolsLocation(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) {
      throw new Error('Choose an absolute download folder for build tools');
    }
    const location = path.resolve(value);
    const stat = await fs.lstat(location).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose an existing download folder for build tools');
    return location;
  }
  const updateLogPath = settingsPath ? path.join(path.dirname(settingsPath), 'update-checks.log') : null;
  const updateTextLogPath = settingsPath ? path.join(path.dirname(settingsPath), 'update-checks.txt') : null;
  const installTextLogPath = settingsPath ? path.join(path.dirname(settingsPath), 'install-jobs.txt') : null;

  async function logReleaseCheck(entry) {
    if (!updateLogPath) return;
    const safe = {
      at: new Date().toISOString(), origin: ['manual', 'bulk'].includes(entry.origin) ? entry.origin : 'automatic',
      gameId: entry.gameId, title: entry.title, repo: entry.repo, status: entry.status,
      tag: entry.tag || null, assetName: entry.assetName || null,
      message: String(entry.message || '').slice(0, 500),
    };
    await fs.mkdir(path.dirname(updateLogPath), { recursive: true });
    await fs.appendFile(updateLogPath, `${JSON.stringify(safe)}\n`);
    const field = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    const details = [safe.repo, safe.tag, safe.assetName, safe.message].filter(Boolean).map(field).join(' | ');
    await fs.appendFile(updateTextLogPath, `${safe.at} [${safe.origin}] ${field(safe.status).toUpperCase()} ${field(safe.title || safe.gameId)}${details ? ` | ${details}` : ''}\n`);
  }

  const ready = settingsPath ? fs.readFile(settingsPath, 'utf8').then(async (text) => {
    settings = { ...settings, ...JSON.parse(text) };
    if (migrateStandaloneSettings(settings)) await saveSettings();
    for (const job of Array.isArray(settings.jobHistory) ? settings.jobHistory : []) if (job?.id && !['queued', 'running'].includes(job.status)) jobs.set(job.id, job);
    if (!options.libraryPath && !options.managedLibrary && typeof settings.libraryPath === 'string' && path.isAbsolute(settings.libraryPath)) managedLibrary = new ManagedLibrary(settings.libraryPath);
  }).catch((error) => { if (error.code !== 'ENOENT') console.error(`Settings: ${error.message}`); }) : Promise.resolve();

  function catalog() { return [...getCatalog(), ...(settings.customGames || [])]; }
  function gameById(id) { return catalog().find((game) => game.id === id); }
  function sourceFor(game) { return settings.sources?.[game.id] || game.source; }
  function saveSettings() {
    if (!settingsPath) return Promise.resolve();
    const contents = JSON.stringify(settings, null, 2);
    pendingSettingsWrite = pendingSettingsWrite.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, contents);
    });
    return pendingSettingsWrite;
  }
  async function rememberFinishedJob(job) {
    if (!settingsPath) return;
    // The UI must not report a completed job while its history is still being
    // written. A new app instance may read the settings file at that point.
    const finalStatus = job.status;
    job.status = 'running';
    settings.jobHistory = [{ ...job, status: finalStatus }, ...(settings.jobHistory || []).filter((entry) => entry.id !== job.id)].slice(0, 50);
    try {
      await saveSettings();
      const oneLine = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
      const lines = [`${new Date().toISOString()} ${oneLine(finalStatus).toUpperCase()} ${oneLine(job.title || job.gameId)} | ${oneLine(job.serial)}`];
      if (job.error) lines.push(`Error: ${oneLine(job.error)}`);
      for (const line of job.log || []) lines.push(`  ${oneLine(line)}`);
      await fs.appendFile(installTextLogPath, `${lines.join('\n')}\n\n`);
    }
    catch (error) { console.error(`Could not save job history: ${error.message}`); }
    finally { job.status = finalStatus; }
  }
  async function logRejectedInstall(game, serial, error) {
    if (!installTextLogPath) return;
    const oneLine = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    await fs.mkdir(path.dirname(installTextLogPath), { recursive: true });
    await fs.appendFile(installTextLogPath, `${new Date().toISOString()} REJECTED ${oneLine(game.title)} | ${oneLine(serial)}\nError: ${oneLine(error.message)}\n\n`);
  }
  function localPathKey(game, key) {
    return key === 'apkPath' || game.personalBuild && (key === 'gamePackage' || key === 'audioSource' && game.personalBuild.audioLabel)
      || game.data.some((item) => item.id === key);
  }
  function sharedFilePeers(game, key) {
    const item = game.data.find((entry) => entry.id === key);
    if (!item?.sharedInput) return [{ game, item }];
    return catalog().flatMap((candidate) => candidate.data
      .filter((entry) => entry.sharedInput === item.sharedInput)
      .map((entry) => ({ game: candidate, item: entry })));
  }
  async function rememberLocalPath(game, key, local) {
    const sourceItem = game.data.find((item) => item.id === key);
    let peers = sharedFilePeers(game, key);
    let sourceValid = local ? await localPathAvailable(game, key, local) : false;
    if (local && sourceItem?.sharedInput && sourceValid) {
      sourceValid = await validateLocalItem(game, sourceItem, local).then(() => true, () => false);
    }
    if (local && !sourceValid) peers = peers.filter((peer) => peer.game.id === game.id && peer.item?.id === key);
    const linked = [];
    for (const peer of peers) {
      const peerKey = peer.item?.id || key;
      if (local && (peer.game.id !== game.id || peerKey !== key)
        && !await validateLocalItem(peer.game, peer.item, local).then(() => true, () => false)) continue;
      settings.localPaths ||= {};
      settings.localPaths[peer.game.id] ||= {};
      if (local) settings.localPaths[peer.game.id][peerKey] = local;
      else delete settings.localPaths[peer.game.id][peerKey];
      linked.push({ gameId: peer.game.id, key: peerKey, path: local, available: Boolean(local) && sourceValid });
    }
    await saveSettings();
    return linked;
  }
  async function rememberInput(game, key, source) {
    if (!source) return source;
    if (!localPathKey(game, key) || !await localPathAvailable(game, key, source)) throw new Error(`Choose valid ${key} game files`);
    const resolved = path.resolve(source);
    const temporary = uploadedFiles.has(source);
    if (!temporary) await rememberLocalPath(game, key, resolved);
    return resolved;
  }
  async function reuseSavedGamePath(game, input, device) {
    if (input.gamePath || device?.dataReady) return;
    const saved = settings.localPaths?.[game.id]?.gamePath;
    if (saved && await localPathAvailable(game, 'gamePath', saved)) input.gamePath = saved;
  }
  async function keepDownloadedApk(_game, local) { return local; }
  const localApkInput = { kind: 'file', label: 'Quest APK', extensions: ['.apk'], destination: '/sdcard/Download/' };
  const crazyTaxiInput = { kind: 'file', label: 'Crazy Taxi package', extensions: ['.apk', '.apkm'], destination: '/sdcard/Download/' };
  const fzeroRomInput = { kind: 'file', label: 'F-Zero X ROM', extensions: ['.z64'], destination: '/sdcard/Download/' };
  const fzeroBundleInput = { kind: 'file', label: 'VirtuaVRPort creator ZIP', extensions: ['.zip'], includeArchiveMembers: true, destination: '/sdcard/Download/' };
  function wrappedGameFile(item, local) {
    const extension = path.extname(local).toLowerCase();
    return item?.kind === 'file' && ['.zip', '.7z', '.rar'].includes(extension)
      && (item.archiveMember || !(item.extensions || []).some((allowed) => ['.zip', '.7z', '.rar'].includes(allowed.toLowerCase())));
  }
  async function prepareSpecialGamePath(game, local, options = {}) {
    if (!local || !['.zip', '.7z', '.rar'].includes(path.extname(local).toLowerCase())) return { path: local, directory: null };
    const item = game.data.find((entry) => entry.id === 'gamePath');
    if (!item) return { path: local, directory: null };
    if (item.kind === 'directory') return extractDirectoryArchive(item, local);
    const extension = path.extname(local).toLowerCase();
    if ((item.extensions || []).some((allowed) => allowed.toLowerCase() === extension)) return { path: local, directory: null };
    if (['.7z', '.rar'].includes(extension) && (item.extensions || []).includes('.zip')) return convertArchiveToZip(local);
    return extractSingleFileArchive(item, local, options);
  }
  async function withSpecialGamePath(game, local, action, options = {}) {
    const prepared = await prepareSpecialGamePath(game, local, options);
    try { return await action(prepared.path); }
    finally { if (prepared.directory) await removeConversionDirectory(prepared.directory, options.tempRoot || os.tmpdir()); }
  }
  async function localPathAvailable(game, key, local) {
    const stat = await fs.stat(local).catch(() => null);
    if (!stat) return false;
    if (game.id === 'fzero-x-virtuavr' && key === 'gamePackage') {
      return stat.isFile() && stat.size > 0 && (path.extname(local).toLowerCase() === '.z64'
        || ['.zip', '.7z', '.rar'].includes(path.extname(local).toLowerCase()) && Boolean(await inspectSingleFileArchive(fzeroRomInput, local).catch(() => null)));
    }
    if (game.id === 'fzero-x-virtuavr' && key === 'audioSource') {
      return stat.isDirectory() ? Boolean((await fs.readdir(local).catch(() => [])).length)
        : stat.isFile() && stat.size > 0 && (path.extname(local).toLowerCase() === '.zip'
          || ['.7z', '.rar'].includes(path.extname(local).toLowerCase()) && Boolean(await inspectSingleFileArchive(fzeroBundleInput, local).catch(() => null)));
    }
    if (key === 'gamePackage' || key === 'audioSource') {
      if (stat.isDirectory()) return Boolean((await fs.readdir(local).catch(() => [])).length);
      const allowed = key === 'audioSource' && game.id !== 'rdr1-vr' ? ['.7z', '.zip', '.rar'] : ['.apk', '.apks', '.zip', '.xapk', '.apkm', '.7z', '.rar'];
      return stat.isFile() && stat.size > 0 && allowed.includes(path.extname(local).toLowerCase());
    }
    if (key === 'apkPath') return stat.isFile() && stat.size > 0 && (path.extname(local).toLowerCase() === '.apk'
      || ['.zip', '.7z', '.rar'].includes(path.extname(local).toLowerCase()) && Boolean(await inspectSingleFileArchive(localApkInput, local).catch(() => null)));
    const item = game.data.find((entry) => entry.id === key);
    if (!item) return false;
    if (game.id === 'wipeout-vr' && key === 'gameData' && stat.isFile() && isWipeoutDisc(local)) {
      return Boolean(await inspectWipeoutDisc(local, buildWorkRoot()).catch(() => null));
    }
    if (game.id === 'wipeout-vr' && key === 'gameData' && stat.isFile() && isWipeoutArchive(local)) {
      return Boolean(await inspectDirectoryArchive(item, local).catch(() => null)
        || await inspectWipeoutArchive(local).catch(() => null));
    }
    if (game.id === 'wipeout-vr' && key === 'gameData' && stat.isDirectory()
      && await inspectWipeoutFolder(local, buildWorkRoot()).catch(() => null)) return true;
    if (wrappedGameFile(item, local) && stat.isFile()) {
      return Boolean(stat.size) && Boolean(await inspectSingleFileArchive(item, local).catch(() => null));
    }
    if (item.kind === 'directory') {
      if (stat.isFile() && ['.zip', '.7z', '.rar'].includes(path.extname(local).toLowerCase())) return Boolean(stat.size) && Boolean(await inspectDirectoryArchive(item, local).catch(() => null));
      if (!stat.isDirectory()) return false;
      const names = await fs.readdir(local).catch(() => []);
      return names.length > 0 && (item.requiredEntries || []).every((entry) => names.includes(entry))
        && (item.requiredExtensions || []).every((extension) => names.some((name) => name.toLowerCase().endsWith(extension.toLowerCase())));
    }
    const extensions = (item.extensions || []).map((extension) => extension.toLowerCase());
    if (extensions.includes('.zip')) extensions.push('.7z', '.rar');
    if (acceptsZipContents(item) && stat.isDirectory()) return Boolean((await fs.readdir(local).catch(() => [])).length);
    return stat.isFile() && stat.size > 0 && extensions.includes(path.extname(local).toLowerCase());
  }
  function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
  async function body(req) {
    let chunks = '';
    for await (const chunk of req) { chunks += chunk; if (chunks.length > 65536) throw new Error('Request too large'); }
    return JSON.parse(chunks || '{}');
  }
  async function zipForItem(item, local) {
    const stat = await fs.stat(local).catch(() => null);
    const folder = acceptsZipContents(item) && stat?.isDirectory();
    const nestedName = acceptsZipContents(item) && !item.destination?.endsWith('/') && path.posix.basename(item.destination).toLowerCase().endsWith('.zip')
      ? path.posix.basename(item.destination) : null;
    const wrappedZip = nestedName && stat?.isFile() && ['.zip', '.7z', '.rar'].includes(path.extname(local).toLowerCase())
      && await inspectSingleFileArchive({ ...item, archiveMember: nestedName }, local).then(() => true, () => false);
    if (!folder && !wrappedZip && !needsZipConversion(item, local)) return { path: local, converted: false };
    if (!folder && !stat?.isFile()) throw new Error('Choose an existing archive');
    const cacheKey = `${local}\u0000${stat.size}\u0000${stat.mtimeMs}`;
    const cached = folder ? null : convertedArchives.get(cacheKey);
    if (cached && (await fs.stat(cached.path).catch(() => null))?.isFile()) return cached;
    const converted = folder
      ? await packageDirectoryToZip(local, path.basename(item.destination || `${item.id}.zip`, '.zip'))
      : wrappedZip ? await extractSingleFileArchive({ ...item, archiveMember: nestedName }, local)
      : await convertArchiveToZip(local);
    conversionDirectories.add(converted.directory);
    const result = { path: converted.path, converted: true, originalExtension: converted.originalExtension || path.extname(local), folder, unwrapped: Boolean(wrappedZip), directory: converted.directory };
    if (!folder) convertedArchives.set(cacheKey, result);
    return result;
  }
  async function validateLocalItem(game, item, local) {
    if (typeof local !== 'string' || !local || local.length > 4096) throw new Error(`Select ${item.label || item.id}`);
    const stat = await fs.stat(local).catch(() => null);
    if (game.id === 'wipeout-vr' && item.id === 'gameData' && stat?.isFile() && isWipeoutDisc(local)) {
      const disc = await inspectWipeoutDisc(local, buildWorkRoot());
      return { verification: { level: 'ps1-disc', message: `${disc.format} disc recognized; VR4ALL will extract its original game files for Wipeout Rewrite` }, entries: null, path: local };
    }
    if (game.id === 'wipeout-vr' && item.id === 'gameData' && stat?.isFile() && isWipeoutArchive(local)) {
      if (!await inspectDirectoryArchive(item, local).then(() => true, () => false)) {
        const disc = await inspectWipeoutArchive(local);
        return { verification: { level: 'disc-archive', message: `Archive contains ${path.posix.basename(disc.member)}; VR4ALL will extract its original Wipeout game files` }, entries: null, path: local };
      }
    }
    if (game.id === 'wipeout-vr' && item.id === 'gameData' && stat?.isDirectory()) {
      const disc = await inspectWipeoutFolder(local, buildWorkRoot());
      if (disc) return { verification: { level: 'disc-folder', message: `Found ${path.basename(disc.path)}; VR4ALL will extract its original Wipeout game files` }, entries: null, path: local, discPath: disc.path };
    }
    if (!stat || (item.kind === 'file' && !stat.isFile() && !(acceptsZipContents(item) && stat.isDirectory())) || (item.kind === 'directory' && !stat.isDirectory() && !(stat.isFile() && ['.zip', '.7z', '.rar'].includes(path.extname(local).toLowerCase())))) throw new Error(`${item.label || item.id} path does not exist or has the wrong type`);
    if (item.kind === 'file') {
      if (wrappedGameFile(item, local)) {
        const archive = await inspectSingleFileArchive(item, local);
        return { verification: { level: 'archive', message: `Archive contains ${path.posix.basename(archive.member)}; VR4ALL will extract it for the Quest` }, entries: null, path: local, archiveMember: archive.member };
      }
      const prepared = await zipForItem(item, local);
      const verification = await verifyGameFile(game, item, prepared.path);
      if (prepared.folder) verification.message = `Packed folder contents into ZIP · ${verification.message}`;
      else if (prepared.unwrapped) verification.message = `Extracted ${path.basename(prepared.path)} from archive · ${verification.message}`;
      else if (prepared.converted) verification.message = `Converted ${prepared.originalExtension.toUpperCase()} to ZIP · ${verification.message}`;
      return { verification, entries: null, path: local, preparedPath: prepared.path, directory: prepared.converted ? prepared.directory : null };
    }
    if (item.kind !== 'directory') throw new Error('Invalid game data kind');
    if (stat.isFile()) {
      const inspected = await inspectDirectoryArchive(item, local);
      return { verification: { level: 'archive', message: `Archive contains ${inspected.files} game files; identity and edition are not independently verified` }, entries: null, path: local };
    }
    const entries = await fs.readdir(local, { withFileTypes: true });
    if (!entries.length) throw new Error(`${item.label || item.id} folder is empty`);
    if (entries.some((entry) => entry.isSymbolicLink())) throw new Error(`${item.label || item.id} folder contains a link; choose a regular folder`);
    const names = new Map(entries.map((entry) => [item.lowercaseCopy ? entry.name.toLowerCase() : entry.name, entry]));
    const getEntry = (name) => names.get(item.lowercaseCopy ? name.toLowerCase() : name);
    const missing = (item.requiredEntries || []).filter((name) => !getEntry(name)?.isFile());
    if (missing.length) throw new Error(`${item.label || item.id} is missing ${missing.join(', ')}`);
    const missingExtensions = (item.requiredExtensions || []).filter((extension) => !entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase())));
    if (missingExtensions.length) throw new Error(`${item.label || item.id} is missing ${missingExtensions.join(', ')} game files`);
    for (const name of item.requiredDirectories || []) {
      const entry = getEntry(name);
      if (!entry?.isDirectory()) throw new Error(`${item.label || item.id} is missing ${name}`);
      if (!(await fs.readdir(path.join(local, entry.name))).length) throw new Error(`${item.label || item.id} has an empty ${name} folder`);
    }
    if (item.oneOfDirectories?.length && !item.oneOfDirectories.some((name) => getEntry(name)?.isDirectory())) {
      throw new Error(`${item.label || item.id} needs one of ${item.oneOfDirectories.join(', ')}`);
    }
    for (const [folder, files] of Object.entries(item.requiredNestedEntries || {})) {
      const entry = getEntry(folder);
      if (!entry?.isDirectory()) throw new Error(`${item.label || item.id} is missing ${folder}`);
      const nested = new Set((await fs.readdir(path.join(local, entry.name))).map((name) => name.toLowerCase()));
      for (const file of files) if (!nested.has(file.toLowerCase())) throw new Error(`${item.label || item.id} is missing ${folder}/${file}`);
    }
    const message = item.requiredEntries?.length || item.requiredDirectories?.length
      ? `Found ${(item.requiredEntries || []).length} required game files and ${(item.requiredDirectories || []).length} asset folders; their identity and edition are not independently verified`
      : `Folder found with ${entries.length} item${entries.length === 1 ? '' : 's'}; game contents are not independently verified`;
    return { verification: { level: 'directory', message }, entries: entries.map((entry) => entry.name), path: local };
  }
  async function validateLocalApk(game, local) {
    if (typeof local !== 'string' || !local) throw new Error('Select an APK file');
    if (['.zip', '.7z', '.rar'].includes(path.extname(local).toLowerCase())) {
      const extracted = await extractSingleFileArchive(localApkInput, local);
      try {
        const verification = await validateLocalApk(game, extracted.path);
        return { ...verification, message: `Archive contains ${path.basename(extracted.path)} · ${verification.message}` };
      } finally { await removeConversionDirectory(extracted.directory); }
    }
    if (path.extname(local).toLowerCase() !== '.apk') throw new Error('Select an APK file or ZIP, 7z, or RAR containing one APK');
    const stat = await fs.stat(local).catch(() => null);
    if (!stat?.isFile() || !stat.size) throw new Error('Select an existing APK file');
    const packageId = await inspectApk(local, adb.getPath?.() || settings.adbPath);
    const expected = packages[game.id];
    if (expected && packageId && packageId !== expected) throw new Error(`APK belongs to ${packageId}, not ${game.title} (${expected})`);
    const message = packageId && expected ? `APK verified for ${game.title} · ${packageId}`
      : packageId ? `APK package: ${packageId} · game identity not verified`
        : 'APK file selected · package identity could not be verified';
    return { packageId, message };
  }
  async function validateViceCityRequest(input, downloadLocation) {
    if (!['.7z', '.rar'].includes(path.extname(input.gamePackage || '').toLowerCase())) return validateViceCityInput(input);
    const tempRoot = path.join(viceCityRoots(downloadLocation).workRoot, 'vice-city-vr', '.tmp');
    const converted = await convertArchiveToZip(input.gamePackage, { tempRoot });
    try {
      await validateViceCityInput({ ...input, gamePackage: converted.path });
      return { gamePackage: input.gamePackage, serial: input.serial, kind: 'archive' };
    } finally { await removeConversionDirectory(converted.directory, tempRoot); }
  }
  async function prepareFzeroPaths(input) {
    const prepared = { ...input };
    const directories = [];
    try {
      if (['.zip', '.7z', '.rar'].includes(path.extname(input.gamePackage || '').toLowerCase())) {
        const extracted = await extractSingleFileArchive(fzeroRomInput, input.gamePackage);
        directories.push(extracted.directory);
        prepared.gamePackage = extracted.path;
      }
      if (['.7z', '.rar'].includes(path.extname(input.audioSource || '').toLowerCase()) || input.bundleWrapped) {
        const extracted = await extractSingleFileArchive(fzeroBundleInput, input.audioSource);
        directories.push(extracted.directory);
        prepared.audioSource = extracted.path;
      }
      return { prepared, directories };
    } catch (error) { for (const directory of directories) await removeConversionDirectory(directory); throw error; }
  }
  async function validateFzeroRequest(input) {
    let prepared = await prepareFzeroPaths(input);
    try {
      let validated;
      let bundleWrapped = false;
      try { validated = await validateFzeroVirtuaInput(prepared.prepared); }
      catch (error) {
        if (path.extname(input.audioSource || '').toLowerCase() !== '.zip'
          || !await inspectSingleFileArchive(fzeroBundleInput, input.audioSource).then(() => true, () => false)) throw error;
        for (const directory of prepared.directories) await removeConversionDirectory(directory);
        prepared = await prepareFzeroPaths({ ...input, bundleWrapped: true });
        validated = await validateFzeroVirtuaInput(prepared.prepared);
        bundleWrapped = true;
      }
      return { ...validated, gamePackage: input.gamePackage, audioSource: input.audioSource, bundleWrapped };
    } finally { for (const directory of prepared.directories) await removeConversionDirectory(directory); }
  }
  async function checkFiles(game, files, reuseExistingData = false, tempDirectories = []) {
    const directoryEntries = {};
    if (game.requireOneOf?.length && !reuseExistingData && !game.requireOneOf.some((id) => files?.[id])) throw new Error(`Select one of ${game.requireOneOf.map((id) => game.data.find((item) => item.id === id)?.label || id).join(' or ')}`);
    for (const item of game.data) {
      const local = files?.[item.id];
      if (!local) { if (item.optional || reuseExistingData) continue; throw new Error(`Select ${item.label || item.id}`); }
      const validated = await validateLocalItem(game, item, local);
      if (validated.archiveMember) {
        const extracted = await extractSingleFileArchive(item, local);
        tempDirectories.push(extracted.directory);
        conversionDirectories.add(extracted.directory);
        await validateLocalItem(game, item, extracted.path);
        files[item.id] = extracted.path;
      } else if (game.id === 'wipeout-vr' && item.id === 'gameData' && validated.verification.level === 'disc-folder') {
        files[item.id] = validated.discPath;
      } else if (game.id === 'wipeout-vr' && item.id === 'gameData' && validated.verification.level === 'disc-archive') {
        const extracted = await extractWipeoutArchive(local);
        tempDirectories.push(extracted.directory);
        conversionDirectories.add(extracted.directory);
        await validateLocalItem(game, item, extracted.path);
        files[item.id] = extracted.path;
      } else if (item.kind === 'directory' && validated.verification.level === 'archive') {
        const extracted = await extractDirectoryArchive(item, local);
        tempDirectories.push(extracted.directory);
        conversionDirectories.add(extracted.directory);
        const unpacked = await validateLocalItem(game, item, extracted.path);
        files[item.id] = unpacked.path;
        directoryEntries[item.id] = unpacked.entries;
      } else {
        files[item.id] = validated.preparedPath || validated.path;
        if (validated.directory) tempDirectories.push(validated.directory);
        if (validated.entries) directoryEntries[item.id] = validated.entries;
      }
      if (item.lowercaseCopy) {
        const staged = await stageLowercaseDirectory(files[item.id]);
        tempDirectories.push(staged.directory);
        conversionDirectories.add(staged.directory);
        files[item.id] = staged.path;
        directoryEntries[item.id] = (await fs.readdir(staged.path));
      }
    }
    return directoryEntries;
  }
  async function runJob(job, game, input) {
    const log = (message) => { job.log.push(message); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    let packagedWipeout = null;
    let packagedAvp = null;
    let finalStatus = 'error';
    try {
      let apkPath = input.apkPath;
      let companionApkPath = null;
      if (input.apkMode === 'github') {
        const source = sourceFor(game);
        if (!source) throw new Error('No GitHub source configured');
        log(`Checking ${source.repo} for ${game.title}...`);
        const release = await releases.latest(source);
        if (!release) throw new Error('No matching APK release found');
        if (release.stale) throw new Error('GitHub could not be refreshed, so the latest APK cannot be confirmed. Try again later or choose a local APK.');
        job.release = { tag: release.tag, url: release.url, assetName: release.assetName };
        log(`Downloading ${release.assetName}...`);
        let lastPercent = -1;
        apkPath = await releases.download(release, (done, total) => {
          const percent = total ? Math.floor(done / total * 100) : 0;
          if (total && percent >= lastPercent + 10) { lastPercent = percent; log(`Download ${percent}%`); }
        });
        apkPath = await keepDownloadedApk(game, apkPath);
      }
      if (game.companionSource) {
        log('Checking the official companion launcher release...');
        const companion = await releases.latest(game.companionSource);
        if (!companion || companion.stale) throw new Error('The current official companion launcher APK could not be confirmed');
        companionApkPath = await keepDownloadedApk(game, await releases.download(companion));
        job.companionRelease = { tag: companion.tag, url: companion.url, assetName: companion.assetName };
      }
      const installedPackageId = await inspectApk(apkPath, adb.getPath?.() || settings.adbPath);
      if (packages[game.id] && installedPackageId && installedPackageId !== packages[game.id]) throw new Error(`Downloaded APK belongs to ${installedPackageId}, not ${game.title} (${packages[game.id]})`);
      const planGame = ['wipeout-vr', 'avp-vr'].includes(game.id) ? { ...game, data: [] } : game;
      const plan = buildInstallPlan(planGame, { serial: input.serial, apkPath, files: input.files || {}, directoryEntries: input.directoryEntries, reuseExistingData: input.reuseExistingData });
      if (input.reuseExistingData && !Object.values(input.files || {}).some(Boolean)) log('Keeping existing game files on the headset.');
      for (const step of plan) {
        log(`${step.label}...`);
        const result = await adb.run(step.args, (line) => { const trimmed = line.trim(); if (trimmed && !trimmed.includes('%')) log(trimmed.slice(0, 350)); });
        if (result && !job.log.at(-1)?.includes(result.slice(0, 40))) log(result.slice(0, 350));
        if (step.label === 'Initialize AvP game folder') await new Promise((resolve) => setTimeout(resolve, 1500));
        const item = game.data.find((entry) => step.label === `Copy ${entry.id}` && entry.kind === 'file');
        if (item) {
          const verified = await verifyPushedFile(adb, input.serial, step.args.at(-2), step.args.at(-1));
          log(`Verified ${item.label || item.id} on the headset (${verified.bytes} bytes).`);
        }
      }
      if (game.id === 'wipeout-vr' && input.files?.gameData) {
        log(isWipeoutDisc(input.files.gameData) ? 'Extracting your Wipeout disc and packaging the game files...' : 'Packaging prepared Wipeout game files as the creator’s wipeout.tar...');
        packagedWipeout = await packageWipeoutData(input.files.gameData, buildWorkRoot());
        await transferWipeoutData(adb, input.serial, packagedWipeout.path, log);
      }
      if (game.id === 'avp-vr' && input.files?.game) {
        log('Packaging the lowercase AvP game assets for the Quest...');
        packagedAvp = await packageAvpData(input.files.game, buildWorkRoot());
        await transferAvpData(adb, input.serial, packagedAvp, log);
      }
      if (companionApkPath) {
        log('Installing companion launcher...');
        await adb.run(['-s', input.serial, 'install', '-r', companionApkPath], (line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.includes('%')) log(trimmed.slice(0, 350));
        });
      }
      finalStatus = 'success';
      log('Transfer complete. Open the game in the headset to confirm it runs.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), apk: job.release?.assetName || path.basename(apkPath), tag: job.release?.tag || null, packageId: installedPackageId || packages[game.id] || null };
      await saveSettings();
    } catch (error) { finalStatus = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally {
      if (packagedWipeout) await packagedWipeout.cleanup();
      if (packagedAvp) await packagedAvp.cleanup();

      for (const directory of input.tempDirectories || []) { await removeConversionDirectory(directory); conversionDirectories.delete(directory); }
      for (const file of [...Object.values(input.files || {}), ...Object.values(input.originalFiles || {}), input.apkPath, input.originalApkPath]) {
        if (uploadedFiles.delete(file)) fs.rm(path.dirname(file), { recursive: true, force: true }).catch(() => {});
      }
      job.status = finalStatus;
      await rememberFinishedJob(job);
    }
  }

  async function runPersonalJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    let convertedGame = null;
    try {
      if (game.id === 'rdr1-vr') job.internetStatus = (await checkRdrInternet(adb, input.serial, log)).status;
      if (game.id === 'vice-city-vr' && ['.7z', '.rar'].includes(path.extname(input.gamePackage).toLowerCase())) {
        convertedGame = await convertArchiveToZip(input.gamePackage, { tempRoot: path.join(viceCityRoots(input.downloadLocation).workRoot, 'vice-city-vr', '.tmp') });
      }
      const kit = game.id === 'vice-city-vr'
        ? await viceCityBuilder({ ...input, gamePackage: convertedGame?.path || input.gamePackage }, viceCityRoots(input.downloadLocation), log)
        : await personalBuilder(game.id, input, input.downloadLocation ? viceCityRoots(input.downloadLocation) : personalRoots(), log);
      job.sourceCommit = kit.sha;
      job.status = 'success';
      log('Author build and Quest installation completed. Start the game on the headset to confirm it plays.');
      if (game.afterInstall) { job.afterInstall = game.afterInstall; log(game.afterInstall); }
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), sourceCommit: kit.sha };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally { if (convertedGame) await removeConversionDirectory(convertedGame.directory, path.dirname(convertedGame.directory));  busyBuildGames.delete(game.id); await rememberFinishedJob(job); }
  }

  async function runBuildToolsJob(job) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      log(`Download folder: ${job.downloadLocation}`);
      const result = await sdkSetup(viceCityRoots(job.downloadLocation), log, (text) => new Promise((resolve) => {
        job.license = { id: crypto.randomUUID(), text: String(text) };
        sdkDecisions.set(job.id, { licenseId: job.license.id, resolve });
        log('Review the Google license in the build tools window to continue.');
      }), { gameId: job.gameId });
      job.sourceCommit = result.sha;
      job.status = 'success';
      log(`Build tools are ready. Click Build and install to retry ${gameById(job.gameId).title}.`);
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally {
      sdkDecisions.get(job.id)?.resolve(false);
      sdkDecisions.delete(job.id);
      job.license = null;
      busyBuildGames.delete(job.gameId);
      await rememberFinishedJob(job);
    }
  }

  async function runPhoneExportJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      if (game.id === 'rdr1-vr') log(`Additional RDR game data: ${input.audioSource || 'none selected; private phone packs will require existing root access'}`);
      const result = await phoneExporter(game.id, input, { adb, onLog: log });
      job.sourceEdition = result.edition;
      job.sourcePackage = result.packageId;
      job.exportPath = await rememberInput(game, 'gamePackage', result.gamePackage);
      settings.phoneExportLocations ||= {};
      settings.phoneExportLocations[game.id] = input.downloadLocation;
      await saveSettings();
      job.status = 'success';
      log(`Export saved at ${job.exportPath}. Disconnect the phone and connect your Quest when you are ready to build.`);
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally { busySerials.delete(input.serial); busyPhoneExportGames.delete(game.id); await rememberFinishedJob(job); }
  }

  async function runCrazyTaxiJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    let extractedInput = null;
    try {
      const outputRoot = path.join(buildWorkRoot(), 'crazy-taxi-vr');
      await fs.mkdir(outputRoot, { recursive: true });
      const outputPath = path.join(outputRoot, `Crazy-Taxi-VR-${crypto.randomUUID()}.apk`);
      if (['.zip', '.7z', '.rar'].includes(path.extname(input.gamePackage).toLowerCase())) extractedInput = await extractSingleFileArchive(crazyTaxiInput, input.gamePackage);
      const result = await crazyTaxiInstaller({ originalPath: extractedInput?.path || input.gamePackage, serial: input.serial, adb, outputPath, onLog: log });
      if (result?.apkPath) log(`${result.kind === 'vr-apk' ? 'Verified provided APK' : 'Personally patched APK'} remains at ${result.apkPath}`);
      job.release = { tag: result?.tag || null, url: 'https://github.com/Baywilly/Crazy-Taxi-VR-Standalone/releases' };
      job.stage = 'installed';
      job.status = 'success';
      log('Crazy Taxi VR APK installed. Open it on the headset to confirm it plays.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: result?.tag || null };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally { if (extractedInput) await removeConversionDirectory(extractedInput.directory);  await rememberFinishedJob(job); }
  }

  async function runFzeroVirtuaJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    let prepared = null;
    try {
      prepared = await prepareFzeroPaths(input);
      const result = await fzeroVirtuaInstaller(prepared.prepared, { adb, onLog: log });
      job.status = 'success';
      log('VirtuaVRPort APK and all three prepared game files were transferred. Open it on the Quest to confirm the graphics.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: result.tag, packageId: result.packageId };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally { for (const directory of prepared?.directories || []) await removeConversionDirectory(directory);  await rememberFinishedJob(job); }
  }

  async function runRoadRashJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    let convertedDisc = null;
    try {
      log('Checking the official Road Rash player release...');
      const release = await releases.latest(game.source, { force: true });
      if (!release || release.stale) throw new Error('The current official Road Rash player ZIP could not be confirmed');
      if (path.extname(input.discImage).toLowerCase() === '.rar') convertedDisc = await convertArchiveToZip(input.discImage);
      const result = await roadRashInstaller({ discImage: convertedDisc?.path || input.discImage, serial: input.serial, adbPath: adb.getPath?.() || settings.adbPath, release, onLog: log });
      job.release = { tag: release.tag, url: release.url, assetName: release.assetName };
      log('Official disc validation and Quest installation completed. Open the game to confirm it plays.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: result.tag || release.tag };
      await saveSettings();
      job.status = 'success';
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally {
      const completedStatus = job.status;
      job.status = 'running';
      try { if (convertedDisc) await removeConversionDirectory(convertedDisc.directory); }
      catch (error) { log(`Temporary archive cleanup needs attention: ${error.message}`); }

      job.status = completedStatus;
      await rememberFinishedJob(job);
    }
  }

  async function runHarryPotterJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    let convertedGame = null;
    try {
      log('Checking the official Harry Potter VR player release...');
      const release = await releases.latest(sourceFor(game), { force: true });
      if (!release || release.stale) throw new Error('The current official Harry Potter player ZIP could not be confirmed');
      if (['.7z', '.rar'].includes(path.extname(input.gamePath).toLowerCase())) convertedGame = await convertArchiveToZip(input.gamePath);
      await harryPotterInstaller({ gamePath: convertedGame?.path || input.gamePath, serial: input.serial, adbPath: adb.getPath?.() || settings.adbPath, release, onLog: log });
      job.release = { tag: release.tag, url: release.url, assetName: release.assetName };
      log('Official game validation and Quest installation completed. Open the game to confirm it plays.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: release.tag };
      await saveSettings();
      job.status = 'success';
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally {
      const completedStatus = job.status;
      job.status = 'running';
      try { if (convertedGame) await removeConversionDirectory(convertedGame.directory); }
      catch (error) { log(`Temporary archive cleanup needs attention: ${error.message}`); }

      job.status = completedStatus;
      await rememberFinishedJob(job);
    }
  }

  async function runDescent3Job(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      log('Checking the official Descent 3 VR Quest release...');
      const release = await releases.latest(sourceFor(game), { force: true });
      if (!release || release.stale) throw new Error('Current official Descent 3 Quest APK could not be confirmed');
      const downloaded = await releases.download(release);
      const apkPath = await keepDownloadedApk(game, downloaded);
      await withSpecialGamePath(game, input.gamePath, (gamePath) => descent3Installer({ apkPath, gamePath, serial: input.serial, adb, release, onLog: log }));
      job.release = { tag: release.tag, url: release.url, assetName: release.assetName };
      job.status = 'success';
      log('Descent 3 VR installation completed. Open it on the headset to confirm play.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: release.tag };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally {  await rememberFinishedJob(job); }
  }

  async function runOfficialPlayerJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      log('Checking the official Quest player ZIP release...');
      const release = await releases.latest(sourceFor(game), { force: true });
      if (!release || release.stale) throw new Error('The current official Quest player ZIP could not be confirmed');
      const zipPath = await releases.downloadPackage(release, (done, total) => {
        if (total && done === total) log('Official player ZIP downloaded.');
      });
      await withSpecialGamePath(game, input.gamePath, (gamePath) => officialPlayerInstaller({
        gameId: game.id, gamePath: gamePath || null, serial: input.serial,
        adbPath: adb.getPath?.() || settings.adbPath, adb, zipPath,
        workRoot: buildWorkRoot(), onLog: log,
      }));
      const installed = (await inspectDevice(adb, input.serial, [game]))[game.id];
      if (!installed) throw new Error('Official installer finished, but its Quest package was not found on the selected headset');
      if (input.gamePath && !installed.dataReady) throw new Error('Official installer finished, but the game disc was not found on the selected headset');
      job.release = { tag: release.tag, url: release.url, assetName: release.assetName };
      job.status = 'success';
      log('Official Quest player installation completed. Open the game in the headset to confirm it runs.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: release.tag, packageId: installed.packageId, versionName: installed.versionName };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log('Error: ' + error.message); }
    finally {  await rememberFinishedJob(job); }
  }

  async function runMagicCarpetJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      log(input.gamePath ? 'Checking the official Quest APK and Windows importer releases...' : 'Checking the official Quest APK release...');
      const apkRelease = await releases.latest(sourceFor(game), { force: true });
      const importerRelease = input.gamePath ? await releases.latest({ repo: 'NathanaelA/mgcarpet-vr', assetPattern: '^mgc-import-windows\\.zip$' }) : null;
      if (!apkRelease || apkRelease.stale || input.gamePath && (!importerRelease || importerRelease.stale)) throw new Error('The required official Magic Carpet release could not be confirmed');
      const apkPath = await keepDownloadedApk(game, await releases.download(apkRelease));
      const importerZip = input.gamePath ? await releases.downloadPackage(importerRelease) : null;
      const result = await withSpecialGamePath(game, input.gamePath, (gamePath) => magicCarpetInstaller({ apkPath, importerZip, gamePath: gamePath || null, serial: input.serial, adb, workRoot: buildWorkRoot(), onLog: log }));
      job.release = { tag: apkRelease.tag, url: apkRelease.url, assetName: apkRelease.assetName };
      job.status = 'success';
      log('Magic Carpet VR is installed. Open it on the headset to confirm play.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: apkRelease.tag, packageId: result.packageId };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log('Error: ' + error.message); }
    finally {  await rememberFinishedJob(job); }
  }

  async function runAstroQuestJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      log('Checking the official AstroQuest Quest release...');
      const release = await releases.latest(sourceFor(game), { force: true });
      if (!release || release.stale) throw new Error('Current official AstroQuest Quest APK could not be confirmed');
      const apkPath = await keepDownloadedApk(game, await releases.download(release));
      const result = await withSpecialGamePath(game, input.gamePath, (gamePath) => astroQuestInstaller({ apkPath, gamePath: gamePath || null, serial: input.serial, adb, onLog: log }));
      job.release = { tag: release.tag, url: release.url, assetName: release.assetName };
      job.status = 'success';
      log('AstroQuest installation completed. Open it on the headset to confirm play.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: release.tag, packageId: result.packageId };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log('Error: ' + error.message); }
    finally {  await rememberFinishedJob(job); }
  }

  async function runGalaxyQuestJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      const workRoot = input.gamePath ? await galaxyWorkspacePicker(input.gamePath, path.join(buildWorkRoot(), 'galaxyquest')) : null;
      if (workRoot) log(`Using ${workRoot} for temporary GalaxyQuest conversion files.`);
      log(input.gamePath ? 'Checking the official GalaxyQuest APK and Windows converter...' : 'Checking the official GalaxyQuest APK release...');
      const apkRelease = await releases.latest(sourceFor(game), { force: true });
      const toolRelease = input.gamePath ? await releases.latest({ repo: 'bigmak94/GalaxyQuest', assetPattern: '^GalaxyQuest-Installer-windows-x86_64\\.exe$' }) : null;
      if (!apkRelease || apkRelease.stale || input.gamePath && (!toolRelease || toolRelease.stale)) throw new Error('The required official GalaxyQuest release could not be confirmed');
      const apkPath = await keepDownloadedApk(game, await releases.download(apkRelease));
      const converterPath = input.gamePath ? await releases.downloadTool(toolRelease) : null;
      const result = await withSpecialGamePath(game, input.gamePath, (gamePath) => galaxyQuestInstaller({ apkPath, converterPath, gamePath: gamePath || null, serial: input.serial, adb, workRoot, onLog: log }), { tempRoot: workRoot || os.tmpdir() });
      if (input.gamePath && !(await inspectDevice(adb, input.serial, [game]))[game.id]?.dataReady) {
        throw new Error('GalaxyQuest conversion finished, but the game files were not found on the selected headset');
      }
      job.release = { tag: apkRelease.tag, url: apkRelease.url, assetName: apkRelease.assetName };
      job.status = 'success';
      log(result.updatedOnly ? 'GalaxyQuest APK updated; existing game files remain on the headset.' : 'GalaxyQuest conversion and transfer completed. Open it on the headset to confirm play.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: apkRelease.tag, packageId: result.packageId };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log('Error: ' + error.message); }
    finally {  await rememberFinishedJob(job); }
  }

  async function runSclerosisJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      const result = await sclerosisInstaller({ apkPath: input.apkPath, gamePath: input.gamePath || null, serial: input.serial, adb, onLog: log });
      job.status = 'success';
      log('Sclerosis installation completed. Open it on the headset to confirm play.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), apk: path.basename(input.apkPath), packageId: result.packageId };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log('Error: ' + error.message); }
    finally {  await rememberFinishedJob(job); }
  }

  async function runJkxrJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      log('Checking official JKXR engine and Meta companion releases...');
      const engineRelease = await releases.latest(sourceFor(game), { force: true });
      const companionRelease = await releases.latest({ repo: 'Team-Beef-Studios/JKXR', assetPattern: '^jkxrcompanion_[a-z0-9.]+meta\\.apk$' });
      if (!engineRelease || engineRelease.stale || !companionRelease || companionRelease.stale) throw new Error('Current official JKXR engine and companion APKs could not both be confirmed');
      const engineApkPath = await keepDownloadedApk(game, await releases.download(engineRelease));
      const companionApkPath = await keepDownloadedApk(game, await releases.download(companionRelease));
      await withSpecialGamePath(game, input.gamePath, (gamePath) => jkxrInstaller({ engineApkPath, companionApkPath, engineRelease, companionRelease,
        gamePath, game: input.jediGame, serial: input.serial, adb, onLog: log }));
      job.release = { tag: engineRelease.tag, url: engineRelease.url, assetName: engineRelease.assetName };
      job.status = 'success';
      log('JKXR engine and companion installed. Open JKXR on the headset to confirm play.');
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: engineRelease.tag };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally {  await rememberFinishedJob(job); }
  }

  async function runBeefRaiderJob(job, game, input) {
    const log = (message) => { job.log.push(String(message).slice(0, 500)); if (job.log.length > 150) job.log.shift(); job.updatedAt = new Date().toISOString(); };
    job.status = 'running';
    try {
      log('Checking the official Beef Raider XR Quest release...');
      const release = await releases.latest(game.source, { force: true });
      if (!release || release.stale) throw new Error('The current official Beef Raider XR Quest APK could not be confirmed');
      const apkPath = await keepDownloadedApk(game, await releases.download(release));
      const installed = await beefRaiderInstaller({ apkPath, release, serial: input.serial, adb, onLog: log });
      job.release = { tag: release.tag, url: release.url, assetName: release.assetName };
      if (input.gamePath) {
        if (installed.launchRequired) {
          job.stage = 'demo';
          log('APK installed. Launch Beef Raider XR once on the headset and grant permissions; then click Prepare & install again to transfer your saved game data.');
        }
        else {
          await withSpecialGamePath(game, input.gamePath, (gamePath) => beefRaiderTransfer({ extractedPath: gamePath, serial: input.serial, adb, onLog: log }));
          job.stage = 'full-game';
          log('Full-game data transferred. Open Beef Raider XR to confirm it plays.');
        }
      } else {
        job.stage = 'demo';
        log('Beef Raider XR demo installed. Add extracted game data later to enable the full game.');
      }
      job.status = 'success';
      settings.installed[input.serial] ||= {};
      settings.installed[input.serial][game.id] = { at: new Date().toISOString(), tag: release.tag };
      await saveSettings();
    } catch (error) { job.status = 'error'; job.error = error.message; log(`Error: ${error.message}`); }
    finally {  await rememberFinishedJob(job); }
  }

  let pathsMigrated = false;
  async function migrateSavedPaths() {
    if (pathsMigrated) return;
    pathsMigrated = true;
    // Older versions recorded managed copies. Restore the player's original path
    // when it is still present; keep a missing original's copy as a fallback.
    const existing = (await fs.stat(path.join(managedLibrary.root, 'index.json')).catch(() => null))?.isFile()
      ? await managedLibrary.list().catch(() => []) : [];
    let changed = false;
    for (const [gameId, values] of Object.entries(settings.localPaths || {})) {
      const game = gameById(gameId);
      if (!game) continue;
      for (const [key, local] of Object.entries(values || {})) {
        const entry = existing.find((item) => item.path === local && item.gameId === gameId && item.itemId === key);
        if (entry?.originalPath && await localPathAvailable(game, key, entry.originalPath)) {
          values[key] = entry.originalPath;
          changed = true;
        }
      }
    }
    const sharedGroups = new Map();
    for (const game of catalog()) for (const item of game.data) if (item.sharedInput) {
      if (!sharedGroups.has(item.sharedInput)) sharedGroups.set(item.sharedInput, []);
      sharedGroups.get(item.sharedInput).push({ game, item });
    }
    for (const peers of sharedGroups.values()) {
      let local = '';
      for (const { game, item } of peers) {
        const saved = settings.localPaths?.[game.id]?.[item.id];
        if (saved && await validateLocalItem(game, item, saved).then(() => true, () => false)) { local = saved; break; }
      }
      if (!local) continue;
      for (const { game, item } of peers) {
        if (settings.localPaths?.[game.id]?.[item.id]) continue;
        if (!await validateLocalItem(game, item, local).then(() => true, () => false)) continue;
        settings.localPaths ||= {};
        settings.localPaths[game.id] ||= {};
        settings.localPaths[game.id][item.id] = local;
        changed = true;
      }
    }
    if (changed) await saveSettings();
  }
  function scanFolder() { return path.resolve(settings.scanFolder || defaultScanFolder); }
  async function overlayRemembered(scan) {
    const items = [];
    const listedSharedFiles = new Set();
    for (const [gameId, values] of Object.entries(settings.localPaths || {})) {
      const game = gameById(gameId);
      if (!game) continue;
      for (const [key, local] of Object.entries(values || {})) {
        if (!localPathKey(game, key) || typeof local !== 'string' || !path.isAbsolute(local)) continue;
        const id = `${gameId}:${key}`;
        const field = game.data.find((entry) => entry.id === key);
        const sharedFile = field?.sharedInput ? `${field.sharedInput}\u0000${local}` : '';
        if (!sharedFile || !listedSharedFiles.has(sharedFile)) {
          items.push({ id, gameId, itemId: key, path: local,
            label: field?.sharedInput ? `${field.label} · shared with ${sharedFilePeers(game, key).length} ports` : `${game.title} · ${key}`,
            originalName: path.basename(local), shared: Boolean(field?.sharedInput) });
          if (sharedFile) listedSharedFiles.add(sharedFile);
        }
        if (!await localPathAvailable(game, key, local)) { scan.warnings.push(`${game.title}: remembered ${key} is missing or invalid`); continue; }
        let match = scan.matches.find((candidate) => candidate.gameId === gameId);
        if (!match) { match = { gameId, apkPath: '', files: {}, buildInputs: {}, checks: {} }; scan.matches.push(match); }
        try {
          if (key === 'apkPath') {
            await validateLocalApk(game, local);
            match.apkPath = local;
            match.checks.apk = 'Remembered APK path';
          } else if (game.personalBuild && (key === 'gamePackage' || key === 'audioSource')) {
            match.buildInputs ||= {};
            match.buildInputs[key] = local;
            match.checks[key] = 'Remembered build input';
          } else {
            const field = game.data.find((item) => item.id === key);
            if (field) {
              const checked = await validateLocalItem(game, field, local);
              match.files[key] = local;
              match.checks[key] = `Remembered path · ${checked.verification.message}`;
            }
          }
        } catch (error) { scan.warnings.push(`${game.title}: remembered ${key} needs review (${error.message})`); }
      }
    }
    return items;
  }
  async function savedLibrarySnapshot() {
    await migrateSavedPaths();
    const scan = { path: '', scannedFiles: 0, scannedFolders: 0, matches: [], warnings: [] };
    const items = await overlayRemembered(scan);
    return { items, scan };
  }

  const server = http.createServer(async (req, res) => {
    await ready;
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      const host = req.headers.host || '';
      const port = server.address()?.port || 4173;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json(res, 403, { error: 'Only the local app address is allowed' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return json(res, 403, { error: 'Only requests from the local app are allowed' });
      if (req.method === 'POST' && req.headers['x-questdesk-token'] !== token) return json(res, 403, { error: 'Invalid local session token' });
      if (url.pathname === '/api/catalog' && req.method === 'GET') return json(res, 200, { games: catalog(), sources: settings.sources, installed: settings.installed });
      if (url.pathname === '/api/discovery' && req.method === 'GET') {
        const stats = {};
        if (typeof releases.cachedLatest === 'function') await Promise.all(catalog().map(async (game) => {
          const source = sourceFor(game);
          if (!source) return;
          try {
            const release = await releases.cachedLatest(source);
            if (release) stats[game.id] = { totalDownloads: release.totalDownloads, publishedAt: release.publishedAt, checkedAt: release.checkedAt };
          } catch { /* A bad cache entry cannot block the library. */ }
        }));
        return json(res, 200, { stats });
      }
      if (url.pathname === '/api/local-paths' && req.method === 'GET') {
        await migrateSavedPaths();
        const paths = {};
        const availability = {};
        for (const [gameId, values] of Object.entries(settings.localPaths || {})) {
          const game = gameById(gameId);
          if (!game || !values || typeof values !== 'object') continue;
          for (const [key, local] of Object.entries(values)) {
            if (!localPathKey(game, key) || typeof local !== 'string' || !path.isAbsolute(local)) continue;
            paths[gameId] ||= {};
            availability[gameId] ||= {};
            paths[gameId][key] = local;
            availability[gameId][key] = await localPathAvailable(game, key, local);
          }
        }
        return json(res, 200, { paths, availability });
      }
      if (url.pathname === '/api/local-paths' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (!game || typeof input.key !== 'string' || !localPathKey(game, input.key)) throw new Error('Choose a valid game file field');
        if (typeof input.path !== 'string' || input.path.length > 4096 || input.path && !path.isAbsolute(input.path)) throw new Error('Choose an absolute local path');
        let remembered = input.path ? path.resolve(input.path) : '';
        if (uploadedFiles.has(remembered)) return json(res, 200, { path: remembered, available: await localPathAvailable(game, input.key, remembered), temporary: true });
        const linked = await rememberLocalPath(game, input.key, remembered);
        return json(res, 200, { path: settings.localPaths[game.id][input.key] || '', available: linked.find((entry) => entry.gameId === game.id && entry.key === input.key)?.available || false, linked });
      }
      if (url.pathname === '/api/library' && req.method === 'GET') return json(res, 200, await savedLibrarySnapshot());
      if (url.pathname === '/api/library/remove' && req.method === 'POST') {
        const input = await body(req);
        const [gameId, key] = String(input.id || '').split(':');
        const removed = Boolean(settings.localPaths?.[gameId]?.[key]);
        if (removed) {
          const game = gameById(gameId);
          if (game && localPathKey(game, key)) await rememberLocalPath(game, key, '');
          else { delete settings.localPaths[gameId][key]; await saveSettings(); }
        }
        return json(res, 200, { removed });
      }
      if (url.pathname === '/api/devices' && req.method === 'GET') {
        try { return json(res, 200, { adbPath: adb.getPath?.() || settings.adbPath || null, devices: (await adb.listDevices()).filter(isHeadsetListing) }); }
        catch (error) { return json(res, 200, { adbPath: null, devices: [], error: error.message }); }
      }
      if (url.pathname === '/api/device-library' && req.method === 'GET') {
        const serial = url.searchParams.get('serial');
        const devices = await adb.listDevices();
        if (!devices.some((device) => device.serial === serial && device.state === 'device')) return json(res, 400, { error: 'Choose a connected, authorized headset' });
        const known = Object.fromEntries(Object.entries(settings.installed?.[serial] || {}).filter(([, value]) => value?.packageId).map(([id, value]) => [id, value.packageId]));
        return json(res, 200, { games: await inspectDevice(adb, serial, catalog(), known) });
      }
      if (url.pathname === '/api/releases' && req.method === 'GET') {
        const game = gameById(url.searchParams.get('gameId'));
        if (!game) return json(res, 404, { error: 'Unknown game' });
        const source = sourceFor(game);
        if (!source) return json(res, 200, { release: null, source: null });
        const logBase = { origin: url.searchParams.get('origin'), gameId: game.id, title: game.title, repo: source.repo };
        try {
          let release = await releases.latest(source, { force: url.searchParams.get('refresh') === '1' });
          const serial = url.searchParams.get('serial');
          if (release && serial && packages[game.id] && (release.digest || game.verifyApkHash || typeof releases.cachedFile === 'function')) {
            const devices = await adb.listDevices().catch(() => []);
            if (devices.some((device) => device.serial === serial && device.state === 'device')) {
              let installedApkMatchesRelease = null;
              if (release.digest) installedApkMatchesRelease = await matchesInstalledDigest(adb, serial, packages[game.id], release.digest).catch(() => null);
              else if (typeof releases.cachedFile === 'function') {
                const cached = await releases.cachedFile(release).catch(() => null);
                if (cached) installedApkMatchesRelease = await matchesInstalledApk(adb, serial, packages[game.id], cached).catch(() => null);
              }
              release = { ...release, verifiedSerial: serial, installedApkMatchesRelease };
            }
          }
          await logReleaseCheck({ ...logBase, status: release ? release.stale ? 'stale' : 'ok' : 'missing', tag: release?.tag, assetName: release?.assetName, message: release ? release.stale ? 'Using cached release; GitHub refresh failed' : 'Release found' : 'No matching published release asset' }).catch((error) => console.error(`Update log: ${error.message}`));
          return json(res, 200, { release, source });
        } catch (error) {
          await logReleaseCheck({ ...logBase, status: 'error', message: error.message }).catch((logError) => console.error(`Update log: ${logError.message}`));
          throw error;
        }
      }
      if (url.pathname === '/api/bulk-sessions' && req.method === 'POST') {
        const id = crypto.randomUUID();
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-bulk-'));
        bulkSessions.set(id, { root, files: new Set(), bytes: 0 });
        return json(res, 200, { id });
      }
      if (url.pathname === '/api/bulk-upload' && req.method === 'POST') {
        const session = bulkSessions.get(url.searchParams.get('session'));
        if (!session) throw new Error('Bulk drop session expired; drop the files again');
        if (req.headers['content-type'] !== 'application/octet-stream') throw new Error('Drop regular files or folders');
        const segments = safeRelativeUpload(url.searchParams.get('path'));
        const relative = segments.join('/');
        if (session.files.size >= 5000 && !session.files.has(relative)) throw new Error('Drop up to 5,000 files at once');
        if (session.files.has(relative)) throw new Error('This file is already staged; rename it or choose another folder');
        const maxFile = 8 * 1024 ** 3;
        if (Number(req.headers['content-length'] || 0) > maxFile) throw new Error('One dropped file exceeds 8 GB; choose its folder instead');
        const local = path.join(session.root, ...segments);
        await fs.mkdir(path.dirname(local), { recursive: true });
        let size = 0;
        const limiter = new Transform({ transform(chunk, encoding, callback) {
          size += chunk.length;
          callback(size > maxFile || session.bytes + size > 50 * 1024 ** 3 ? new Error('Bulk drop size limit reached; choose a folder instead') : null, chunk);
        } });
        try {
          await pipeline(req, limiter, createWriteStream(local, { flags: 'wx' }));
          session.files.add(relative);
          session.bytes += size;
          return json(res, 200, { path: relative, size });
        } catch (error) { if (error.code !== 'EEXIST') await fs.rm(local, { force: true }).catch(() => {}); throw error; }
      }
      if (url.pathname === '/api/package-uploaded' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        const item = game?.data.find((entry) => entry.id === input.itemId);
        if (!acceptsZipContents(item)) throw new Error('Choose a ZIP game file field');
        const session = bulkSessions.get(input.session);
        if (!session || !session.files.size) throw new Error('Dropped game files expired or were empty');
        bulkSessions.delete(input.session);
        try {
          if (session.bytes > 8 * 1024 ** 3) throw new Error('Dropped game files exceed the 8 GB conversion limit');
          const packaged = await packageDirectoryToZip(session.root, path.basename(item.destination || `${item.id}.zip`, '.zip'));
          conversionDirectories.add(packaged.directory);
          let verification;
          try { verification = await verifyGameFile(game, item, packaged.path); }
          catch (error) { await removeConversionDirectory(packaged.directory); conversionDirectories.delete(packaged.directory); throw error; }
          verification.message = `Packed ${packaged.files} dropped file${packaged.files === 1 ? '' : 's'} into ZIP · ${verification.message}`;
          uploadedFiles.add(packaged.path);
          return json(res, 200, { path: packaged.path, verification });
        } finally { await removeBulkTemp(session.root); }
      }
      if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, 200, { adbPath: settings.adbPath, sources: settings.sources, buildWorkspace: buildWorkRoot(), defaultBuildWorkspace: builderRoots.workRoot, theme: appearanceTheme(settings.theme), palette: appearancePalettes.includes(settings.palette) ? settings.palette : 'blue' });
      if (url.pathname === '/api/settings' && req.method === 'POST') {
        const input = await body(req);
        if (typeof input.adbPath !== 'string' || input.adbPath.length > 1000) throw new Error('Invalid ADB path');
        if (input.sources && (typeof input.sources !== 'object' || Array.isArray(input.sources))) throw new Error('Invalid sources');
        if (input.theme !== undefined && !appearanceThemes.includes(input.theme)) throw new Error('Invalid appearance theme');
        if (input.palette !== undefined && !appearancePalettes.includes(input.palette)) throw new Error('Invalid appearance palette');
        if (input.buildWorkspace !== undefined && input.buildWorkspace !== '') {
          if (typeof input.buildWorkspace !== 'string' || !path.isAbsolute(input.buildWorkspace) || input.buildWorkspace.length > 4096 || /[\x00-\x1f]/.test(input.buildWorkspace)) throw new Error('Choose an absolute build folder');
          const folder = await fs.lstat(input.buildWorkspace).catch(() => null);
          if (!folder?.isDirectory() || folder.isSymbolicLink()) throw new Error('Choose an existing regular build folder');
        }
        const sources = {};
        for (const [id, source] of Object.entries(input.sources || {})) {
          if (!gameById(id)) throw new Error(`Unknown game ${id}`);
          if (source?.repo) sources[id] = validateSource(source);
        }
        settings = { ...settings, adbPath: input.adbPath, sources, ...(input.buildWorkspace !== undefined ? { buildWorkspace: input.buildWorkspace } : {}), theme: appearanceTheme(input.theme || settings.theme), palette: input.palette || settings.palette || 'blue' };
        await saveSettings();
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/custom-games' && req.method === 'POST') {
        const input = await body(req);
        const title = String(input.title || '').trim();
        if (!title || title.length > 80) throw new Error('Enter a port name under 80 characters');
        const gameConsole = String(input.console || 'Other').trim();
        const genre = String(input.genre || 'Other').trim();
        if (!gameConsole || !genre || gameConsole.length > 40 || genre.length > 40) throw new Error('Console and genre must be under 40 characters');
        let source = null;
        if (input.repo || input.assetPattern) source = validateSource({ repo: String(input.repo || '').trim(), assetPattern: String(input.assetPattern || '').trim() });
        const data = [];
        if (input.dataLabel || input.extensions || input.destination) {
          const label = String(input.dataLabel || '').trim();
          const destination = String(input.destination || '').trim();
          const extensions = String(input.extensions || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
          if (!label || label.length > 100) throw new Error('Enter a game data label');
          if (!destination.endsWith('/')) throw new Error('Custom data destination must be a headset folder ending in /');
          safeDestination(destination);
          if (!extensions.length || extensions.some((ext) => !/^\.[a-z0-9]{1,8}$/.test(ext))) throw new Error('Enter file extensions like .zip, .chd');
          data.push({ id: 'game-data', label, kind: 'file', extensions, destination, note: 'A file from your own game copy' });
        }
        const game = { id: `custom-${crypto.randomUUID()}`, title, series: 'Your ports', category: 'Custom', console: gameConsole, genre, art: '/art/custom.svg', icon: '◌', color: '#9da9f0', description: 'A custom Quest port from your library.', source, data, afterInstall: 'Open the installed port under Unknown Sources.' };
        settings.customGames ||= [];
        settings.customGames.push(game);
        await saveSettings();
        return json(res, 201, { game });
      }
      if (url.pathname === '/api/pick' && req.method === 'POST') {
        const input = await body(req);
        const defaultPath = await validateBuildToolsLocation(input.defaultPath).catch(() => undefined);
        return json(res, 200, { path: await picker(input.kind || 'file', defaultPath) });
      }
      if (url.pathname === '/api/validate-file' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        const item = game?.data.find((entry) => entry.id === input.itemId);
        if (!item) throw new Error('Choose a game file field');
        const { verification, path: preparedPath } = await validateLocalItem(game, item, input.path);
        return json(res, 200, { verification, path: (await fs.stat(input.path)).isDirectory() && acceptsZipContents(item) ? input.path : preparedPath });
      }
      if (url.pathname === '/api/upload' && req.method === 'POST') {
        const game = gameById(url.searchParams.get('gameId'));
        const item = game?.data.find((entry) => entry.id === url.searchParams.get('itemId'));
        if (!item || item.kind !== 'file') throw new Error('Choose a game file field');
        if (req.headers['content-type'] !== 'application/octet-stream') throw new Error('Upload a game file');
        const name = path.basename(url.searchParams.get('name') || '').replace(/[^A-Za-z0-9._ ()-]/g, '_');
        if (!name || name === '.' || name === '..') throw new Error('Invalid file name');
        if (!item.extensions.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase())) && !wrappedGameFile(item, name) && !needsZipConversion(item, name)) throw new Error(`${item.label} must be ${item.extensions.join(', ')} or a ZIP, 7z, or RAR containing one matching file`);
        const maxBytes = 8 * 1024 * 1024 * 1024;
        if (Number(req.headers['content-length'] || 0) > maxBytes) throw new Error('File exceeds the 8 GB drop limit; use Browse instead');
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-drop-'));
        const local = path.join(directory, name);
        let size = 0;
        const limiter = new Transform({ transform(chunk, encoding, callback) {
          size += chunk.length;
          callback(size > maxBytes ? new Error('File exceeds the 8 GB drop limit; use Browse instead') : null, chunk);
        } });
        try {
          await pipeline(req, limiter, createWriteStream(local, { flags: 'wx' }));
          if (!size) throw new Error('Dropped file is empty');
          const validated = await validateLocalItem(game, item, local);
          uploadedFiles.add(validated.path);
          if (validated.path !== local) await fs.rm(directory, { recursive: true, force: true });
          return json(res, 200, { path: validated.path, name: path.basename(validated.path), size: (await fs.stat(validated.path)).size, verification: validated.verification });
        } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
      }
      if (url.pathname === '/api/validate-apk' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (!game) throw new Error('Unknown game');
        return json(res, 200, { verification: await validateLocalApk(game, input.path) });
      }
      if (url.pathname === '/api/upload-apk' && req.method === 'POST') {
        const game = gameById(url.searchParams.get('gameId'));
        if (!game) throw new Error('Unknown game');
        if (req.headers['content-type'] !== 'application/octet-stream') throw new Error('Upload an APK file');
        const name = path.basename(url.searchParams.get('name') || '').replace(/[^A-Za-z0-9._ ()-]/g, '_');
        if (!['.apk', '.zip', '.7z', '.rar'].includes(path.extname(name).toLowerCase())) throw new Error('Drop an APK or ZIP, 7z, or RAR containing one APK');
        const maxBytes = 2 * 1024 ** 3;
        if (Number(req.headers['content-length'] || 0) > maxBytes) throw new Error('APK exceeds the 2 GB drop limit; use Browse instead');
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-apk-drop-'));
        const local = path.join(directory, name);
        let size = 0;
        const limiter = new Transform({ transform(chunk, encoding, callback) {
          size += chunk.length;
          callback(size > maxBytes ? new Error('APK exceeds the 2 GB drop limit; use Browse instead') : null, chunk);
        } });
        try {
          await pipeline(req, limiter, createWriteStream(local, { flags: 'wx' }));
          const verification = await validateLocalApk(game, local);
          uploadedFiles.add(local);
          return json(res, 200, { path: local, name, size, verification });
        } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
      }
      if (url.pathname === '/api/install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (!game) throw new Error('Unknown game');
        if (game.externalInstaller) throw new Error('This port requires its official build-and-install guide');
        if (game.manualRelease && input.apkMode === 'github') throw new Error('The official GitHub release is an installer ZIP. Use its installer to prepare an APK, then select that APK locally.');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          if (!['local', 'github'].includes(input.apkMode)) throw new Error('Choose an APK source');
          if (input.apkMode === 'local') {
            await validateLocalApk(game, input.apkPath);
            input.apkPath = await rememberInput(game, 'apkPath', input.apkPath);
          } else if (!sourceFor(game)) throw new Error('No GitHub source configured');
          const known = { [game.id]: settings.installed?.[input.serial]?.[game.id]?.packageId };
          const deviceLibrary = await inspectDevice(adb, input.serial, [game], known);
          input.reuseExistingData = Boolean(deviceLibrary[game.id] && (deviceLibrary[game.id].dataReady || game.reuseInstalledData));
          for (const item of game.data) if (input.files?.[item.id]) input.files[item.id] = await rememberInput(game, item.id, input.files[item.id]);
          input.originalFiles = { ...input.files };
          input.tempDirectories = [];
          if (input.apkMode === 'local' && ['.zip', '.7z', '.rar'].includes(path.extname(input.apkPath).toLowerCase())) {
            input.originalApkPath = input.apkPath;
            const extracted = await extractSingleFileArchive(localApkInput, input.apkPath);
            input.tempDirectories.push(extracted.directory);
            conversionDirectories.add(extracted.directory);
            input.apkPath = extracted.path;
          }
          input.directoryEntries = await checkFiles(game, input.files, input.reuseExistingData, input.tempDirectories);
          if (game.id === 'mgs-vr') await validateMgsDiscPairs(input.files);
          buildInstallPlan(game.id === 'wipeout-vr' ? { ...game, data: [] } : game, { serial: input.serial, apkPath: input.apkMode === 'local' ? input.apkPath : 'download.apk', files: input.files || {}, directoryEntries: input.directoryEntries, reuseExistingData: input.reuseExistingData });
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { for (const directory of input.tempDirectories || []) { await removeConversionDirectory(directory); conversionDirectories.delete(directory); } throw error; }
      }
      if (url.pathname === '/api/official-player-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (!game || !officialPlayerRecipes[game.id] || game.playerInstall !== 'official-zip') throw new Error('Choose an integrated Quest player');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          const known = { [game.id]: settings.installed?.[input.serial]?.[game.id]?.packageId };
          const device = (await inspectDevice(adb, input.serial, [game], known))[game.id];
          await reuseSavedGamePath(game, input, device);
          const updateOnly = Boolean(device?.dataReady);
          await withSpecialGamePath(game, input.gamePath, (gamePath) => validateOwnedInput(game.id, gamePath, updateOnly));
          if (input.gamePath) input.gamePath = await rememberInput(game, 'gamePath', input.gamePath);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runOfficialPlayerJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { throw error; }
      }
      if (url.pathname === '/api/magic-carpet-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (game?.id !== 'magic-carpet-vr') throw new Error('Choose Magic Carpet VR');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          const known = { [game.id]: settings.installed?.[input.serial]?.[game.id]?.packageId };
          const device = (await inspectDevice(adb, input.serial, [game], known))[game.id];
          await reuseSavedGamePath(game, input, device);
          if (!input.gamePath && !device?.dataReady) throw new Error('Drop your owned Magic Carpet game folder for the first install');
          if (input.gamePath) input.gamePath = await rememberInput(game, 'gamePath', input.gamePath);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runMagicCarpetJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { throw error; }
      }
      if (url.pathname === '/api/astroquest-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (game?.id !== 'astroquest') throw new Error('Choose AstroQuest');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          const known = { [game.id]: settings.installed?.[input.serial]?.[game.id]?.packageId };
          const device = (await inspectDevice(adb, input.serial, [game], known))[game.id];
          await reuseSavedGamePath(game, input, device);
          const updateOnly = Boolean(device?.dataReady);
          await withSpecialGamePath(game, input.gamePath, (gamePath) => validateAstroGame(gamePath, updateOnly));
          if (input.gamePath) input.gamePath = await rememberInput(game, 'gamePath', input.gamePath);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runAstroQuestJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { throw error; }
      }
      if (url.pathname === '/api/galaxyquest-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (game?.id !== 'galaxyquest') throw new Error('Choose GalaxyQuest');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          const known = { [game.id]: settings.installed?.[input.serial]?.[game.id]?.packageId };
          const device = (await inspectDevice(adb, input.serial, [game], known))[game.id];
          await reuseSavedGamePath(game, input, device);
          const updateOnly = Boolean(device?.dataReady);
          if (input.gamePath && ['.zip', '.7z', '.rar'].includes(path.extname(input.gamePath).toLowerCase())) {
            await inspectSingleFileArchive(game.data.find((item) => item.id === 'gamePath'), input.gamePath);
          } else await validateGalaxyInput(input.gamePath, updateOnly);
          if (input.gamePath) input.gamePath = await rememberInput(game, 'gamePath', input.gamePath);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runGalaxyQuestJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { await logRejectedInstall(game, input.serial, error).catch(() => {}); throw error; }
      }
      if (url.pathname === '/api/sclerosis-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (game?.id !== 'sclerosis-vr') throw new Error('Choose Sclerosis');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          await validateLocalApk(game, input.apkPath);
          input.apkPath = await rememberInput(game, 'apkPath', input.apkPath);
          const known = { [game.id]: settings.installed?.[input.serial]?.[game.id]?.packageId };
          const device = (await inspectDevice(adb, input.serial, [game], known))[game.id];
          await reuseSavedGamePath(game, input, device);
          const updateOnly = Boolean(device?.dataReady);
          await validateSclerosisGame(input.gamePath, updateOnly);
          if (input.gamePath) input.gamePath = await rememberInput(game, 'gamePath', input.gamePath);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runSclerosisJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { throw error; }
      }
      if (url.pathname === '/api/road-rash-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (game?.id !== 'road-rash-vr') throw new Error('Choose Road Rash Jailbreak VR');
        if (typeof input.discImage !== 'string' || !['.bin', '.cue', '.zip', '.7z', '.rar'].includes(path.extname(input.discImage).toLowerCase())) {
          throw new Error('Choose an owned USA Road Rash BIN/CUE, ZIP, 7z, or RAR disc image');
        }
        const disc = await fs.stat(input.discImage).catch(() => null);
        if (!disc?.isFile() || !disc.size || disc.size > 8 * 1024 ** 3) throw new Error('Choose an existing Road Rash disc file under 8 GB');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          input.discImage = await rememberInput(game, 'discImage', input.discImage);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runRoadRashJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { throw error; }
      }
      if (url.pathname === '/api/harry-potter-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (game?.id !== 'harry-potter-vr') throw new Error('Choose Harry Potter VR');
        if (typeof input.gamePath !== 'string' || !path.isAbsolute(input.gamePath)) throw new Error('Choose your owned US PC game folder or ZIP');
        const gameStat = await fs.stat(input.gamePath).catch(() => null);
        if (!gameStat || !gameStat.isDirectory() && (!['.zip', '.7z', '.rar'].includes(path.extname(input.gamePath).toLowerCase()) || !gameStat.isFile())) throw new Error('Choose an existing game folder, ZIP, 7z, or RAR');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          input.gamePath = await rememberInput(game, 'gamePath', input.gamePath);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runHarryPotterJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { throw error; }
      }
      if (url.pathname === '/api/descent3-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (game?.id !== 'descent3-vr') throw new Error('Choose Descent 3 VR');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          const device = (await inspectDevice(adb, input.serial, [game]))[game.id];
          if (!input.gamePath && !device?.dataReady) throw new Error('Choose your owned Descent 3 game folder for the first install');
          if (input.gamePath) input.gamePath = await rememberInput(game, 'gamePath', input.gamePath);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runDescent3Job(job, game, input));
          return json(res, 202, { job });
        } catch (error) { throw error; }
      }
      if (url.pathname === '/api/jkxr-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (game?.id !== 'jkxr') throw new Error('Choose JKXR');
        if (!['jk2', 'jk3'].includes(input.jediGame)) throw new Error('Choose Jedi Outcast or Jedi Academy');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          const device = (await inspectDevice(adb, input.serial, [game]))[game.id];
          if (!input.gamePath && !device?.dataReady) throw new Error('Choose your owned Jedi game folder for the first install');
          if (input.gamePath) input.gamePath = await rememberInput(game, 'gamePath', input.gamePath);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runJkxrJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { throw error; }
      }
      if (url.pathname === '/api/beef-raider-install' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (game?.id !== 'beef-raider-xr') throw new Error('Choose Beef Raider XR');
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });

        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          if (input.gamePath) {
            await withSpecialGamePath(game, input.gamePath, (gamePath) => inspectBeefRaiderData(gamePath));
            input.gamePath = await rememberInput(game, 'gamePath', input.gamePath);
          }
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => runBeefRaiderJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { throw error; }
      }
      if (url.pathname === '/api/build-tools/location' && req.method === 'POST') {
        const input = await body(req);
        if (!buildToolGames.has(input.gameId)) throw new Error('Choose a supported build tool setup');
        const saved = buildToolsLocation(input.gameId);
        let downloadLocation = saved || '';
        if (!downloadLocation && typeof input.gamePackage === 'string' && path.isAbsolute(input.gamePackage)) {
          const stat = await fs.lstat(input.gamePackage).catch(() => null);
          if (stat && !stat.isSymbolicLink()) downloadLocation = stat.isDirectory() ? input.gamePackage : path.dirname(input.gamePackage);
        }
        return json(res, 200, { downloadLocation, configured: Boolean(saved) });
      }
      if (url.pathname === '/api/build-tools' && req.method === 'POST') {
        const input = await body(req);
        if (!buildToolGames.has(input.gameId)) throw new Error('Choose a supported build tool setup');
        if (busyBuildGames.has(input.gameId)) return json(res, 409, { error: 'Game tool setup or build is already running' });
        const downloadLocation = await validateBuildToolsLocation(input.downloadLocation);
        if (busyBuildGames.has(input.gameId)) return json(res, 409, { error: 'Game tool setup or build is already running' });
        busyBuildGames.add(input.gameId);
        try {
          settings.buildToolsLocations ||= {};
          settings.buildToolsLocations[input.gameId] = downloadLocation;
          settings.sharedBuildToolsLocation = downloadLocation;
          await saveSettings();
        } catch (error) { busyBuildGames.delete(input.gameId); throw error; }
        const job = { id: crypto.randomUUID(), gameId: input.gameId, kind: 'build-tools', title: `${gameById(input.gameId).title} build tools`, downloadLocation, status: 'queued', license: null, log: [], createdAt: new Date().toISOString() };
        jobs.set(job.id, job);
        setImmediate(() => runBuildToolsJob(job));
        return json(res, 202, { job });
      }
      const sdkDecisionRoute = url.pathname.match(/^\/api\/build-tools\/([a-f0-9-]+)\/license$/);
      if (sdkDecisionRoute && req.method === 'POST') {
        const input = await body(req);
        const job = jobs.get(sdkDecisionRoute[1]);
        const pending = sdkDecisions.get(sdkDecisionRoute[1]);
        if (!job || !pending || pending.licenseId !== input.licenseId) return json(res, 409, { error: 'This license prompt is no longer waiting for a decision' });
        if (typeof input.accepted !== 'boolean') throw new Error('Choose Accept or Decline for this license');
        sdkDecisions.delete(job.id);
        job.license = null;
        job.updatedAt = new Date().toISOString();
        pending.resolve(input.accepted);
        return json(res, 200, { accepted: input.accepted });
      }
      if (url.pathname === '/api/phone-export/devices' && req.method === 'GET') return json(res, 200, { devices: await listExportPhones(adb) });
      if (url.pathname === '/api/phone-export/check' && req.method === 'POST') {
        const input = await body(req);
        if (input.gameId !== 'rdr1-vr') throw new Error('Choose RDR for a game-data check');
        if (!/^[A-Za-z0-9._:-]{1,200}$/.test(input.serial || '')) throw new Error('Choose a connected Android phone');
        input.edition ||= 'auto';
        if (!['auto', 'google-play', 'netflix'].includes(input.edition)) throw new Error('Choose a supported game edition');
        if (input.audioSource && (typeof input.audioSource !== 'string' || !path.isAbsolute(input.audioSource))) throw new Error('Choose an absolute additional game-data path');
        if (busySerials.has(input.serial) || busyPhoneExportGames.has(input.gameId)) return json(res, 409, { error: 'An export or another operation is already running on this phone or game' });
        // Use the same locks as export; preview never creates a job or saves settings.
        busySerials.add(input.serial); busyPhoneExportGames.add(input.gameId);
        try { return json(res, 200, { readiness: await phoneChecker(input.gameId, input, { adb }) }); }
        finally { busySerials.delete(input.serial); busyPhoneExportGames.delete(input.gameId); }
      }
      if (url.pathname === '/api/phone-export/location' && req.method === 'POST') {
        const input = await body(req);
        if (!['rdr1-vr', 'gta-sa-vr'].includes(input.gameId)) throw new Error('Choose RDR or GTA SA for phone export');
        const candidates = [settings.phoneExportLocations?.[input.gameId], input.gamePackage, settings.localPaths?.[input.gameId]?.gamePackage, settings.buildToolsLocations?.[input.gameId], scanFolder()];
        for (const candidate of candidates) {
          if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue;
          const stat = await fs.stat(candidate).catch(() => null);
          const location = stat?.isFile() ? path.dirname(candidate) : candidate;
          const checked = await validateBuildToolsLocation(location).catch(() => null);
          if (checked) return json(res, 200, { downloadLocation: checked, ...(input.gameId === 'rdr1-vr' ? { additionalDataSource: settings.localPaths?.[input.gameId]?.audioSource || '' } : {}) });
        }
        throw new Error('Choose an existing folder on a drive with free space');
      }
      if (url.pathname === '/api/phone-export' && req.method === 'POST') {
        const input = await body(req);
        const game = gameById(input.gameId);
        if (!game || !['rdr1-vr', 'gta-sa-vr'].includes(game.id)) throw new Error('Choose RDR or Google Play GTA SA for phone export');
        input.edition ||= 'auto';
        if (!['auto', 'google-play', 'netflix'].includes(input.edition) || game.id !== 'rdr1-vr' && input.edition === 'netflix') throw new Error('Choose a supported game edition');
        if (!/^[A-Za-z0-9._:-]{1,200}$/.test(input.serial || '')) throw new Error('Choose a connected Android phone');
        input.downloadLocation = await validateBuildToolsLocation(input.downloadLocation);
        if (game.id === 'rdr1-vr' && input.audioSource) input.audioSource = await rememberInput(game, 'audioSource', input.audioSource);
        if (busySerials.has(input.serial) || busyPhoneExportGames.has(game.id)) return json(res, 409, { error: 'An export or another operation is already running on this phone or game' });
        busySerials.add(input.serial); busyPhoneExportGames.add(game.id);
        const job = { id: crypto.randomUUID(), kind: 'phone-export', gameId: game.id, title: `${game.title} phone export`, edition: input.edition, serial: input.serial, downloadLocation: input.downloadLocation, ...(game.id === 'rdr1-vr' ? { additionalDataSource: input.audioSource || '' } : {}), status: 'queued', log: [], createdAt: new Date().toISOString() };
        jobs.set(job.id, job);
        setImmediate(() => runPhoneExportJob(job, game, input));
        return json(res, 202, { job });
      }
      if (url.pathname === '/api/personal-build' && req.method === 'POST') {
        const requestInput = await body(req);
        const game = gameById(requestInput.gameId);
        if (!game || !['gta-sa-vr', 'rdr1-vr', 'vice-city-vr', 'crazy-taxi-vr', 'fzero-x-virtuavr'].includes(game.id)) throw new Error('Choose a supported personal build');
        if (buildToolGames.has(game.id) && busyBuildGames.has(game.id)) return json(res, 409, { error: 'Game tool setup or build is already running' });
        const downloadLocation = buildToolGames.has(game.id) && (game.id === 'vice-city-vr' || buildToolsLocation(game.id))
          ? await validateBuildToolsLocation(buildToolsLocation(game.id)) : null;
        if (game.id === 'crazy-taxi-vr') {
          if (typeof requestInput.gamePackage !== 'string' || !path.isAbsolute(requestInput.gamePackage)
            || !['.apk', '.apkm', '.zip', '.7z', '.rar'].includes(path.extname(requestInput.gamePackage).toLowerCase())) throw new Error('Choose your Crazy Taxi APKM or VR APK, plain or in a ZIP, 7z, or RAR');
          const original = await fs.lstat(requestInput.gamePackage).catch(() => null);
          if (!original?.isFile() || original.isSymbolicLink() || !original.size || original.size > 4 * 1024 ** 3) throw new Error('Choose an existing regular Crazy Taxi Android package under 4 GB');
          if (['.zip', '.7z', '.rar'].includes(path.extname(requestInput.gamePackage).toLowerCase())) await inspectSingleFileArchive(crazyTaxiInput, requestInput.gamePackage);
          if (!/^[A-Za-z0-9._:-]+$/.test(requestInput.serial || '')) throw new Error('Choose a connected Quest serial');
        }
        const input = game.id === 'crazy-taxi-vr'
          ? { gamePackage: requestInput.gamePackage, serial: requestInput.serial }
          : game.id === 'fzero-x-virtuavr'
          ? await validateFzeroRequest(requestInput)
          : game.id === 'vice-city-vr'
          ? await validateViceCityRequest(requestInput, downloadLocation)
          : await validatePersonalBuildInput(game.id, requestInput);
        if (downloadLocation) input.downloadLocation = downloadLocation;
        if (!canQueueInstall(input.serial)) return json(res, 409, { error: 'Another operation is already running on this device' });
        if (buildToolGames.has(game.id) && busyBuildGames.has(game.id)) return json(res, 409, { error: 'Game tool setup or build is already running' });

        if (buildToolGames.has(game.id)) busyBuildGames.add(game.id);
        try {
          const devices = await adb.listDevices();
          if (!devices.some((device) => device.serial === input.serial && device.state === 'device')) throw new Error('Choose a connected, authorized headset');
          input.gamePackage = await rememberInput(game, 'gamePackage', input.gamePackage);
          if (input.audioSource) input.audioSource = await rememberInput(game, 'audioSource', input.audioSource);
          const job = { id: crypto.randomUUID(), gameId: game.id, title: game.title, serial: input.serial, status: 'queued', log: [], createdAt: new Date().toISOString() };
          jobs.set(job.id, job);
          queueInstall(job, () => game.id === 'crazy-taxi-vr' ? runCrazyTaxiJob(job, game, input)
            : game.id === 'fzero-x-virtuavr' ? runFzeroVirtuaJob(job, game, input)
              : runPersonalJob(job, game, input));
          return json(res, 202, { job });
        } catch (error) { busyBuildGames.delete(game.id); throw error; }
      }
      if (url.pathname === '/api/jobs' && req.method === 'GET') return json(res, 200, { jobs: [...jobs.values()].reverse().slice(0, 20) });
      if (url.pathname.startsWith('/api/jobs/') && req.method === 'GET') {
        const job = jobs.get(url.pathname.slice('/api/jobs/'.length));
        return job ? json(res, 200, { job }) : json(res, 404, { error: 'Unknown job' });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown API route' });
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.resolve(publicDir, `.${requested}`);
      if (!file.startsWith(`${publicDir}${path.sep}`)) return json(res, 403, { error: 'Forbidden' });
      let content = await fs.readFile(file);
      if (file.endsWith('index.html')) content = Buffer.from(content.toString().replace('__QUESTDESK_TOKEN__', token).replace('__VR4ALL_VERSION__', require('./package.json').version));
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(content);
    } catch (error) {
      json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message });
    }
  });
  server.on('close', () => {
    for (const file of uploadedFiles) fs.rm(path.dirname(file), { recursive: true, force: true }).catch(() => {});
    for (const session of bulkSessions.values()) removeBulkTemp(session.root).catch(() => {});
    for (const directory of conversionDirectories) removeConversionDirectory(directory).catch(() => {});
  });
  return { server, token, getActiveInstallJobs: () => [...installQueues.values()].flatMap((queue) => queue.map(({ job }, index) => ({ ...job, status: index ? 'queued' : 'running' }))) };
}

if (require.main === module) {
  const app = createApp({ settingsPath: defaultSettingsPath });
  app.server.listen(4173, '127.0.0.1', () => {
    const address = 'http://127.0.0.1:4173';
    console.log(`VR4ALL is ready at ${address}`);
    if (process.platform === 'win32') require('node:child_process').execFile('rundll32.exe', ['url.dll,FileProtocolHandler', address], { windowsHide: true }, () => {});
  });
}

module.exports = { createApp };
