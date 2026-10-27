const fs = require('node:fs/promises');
const path = require('node:path');
const { verifyGameFile } = require('./file-verification');
const { packages } = require('./device-library');
const { validateVirtuaInput } = require('./fzero-virtuavr-runner');

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const n64Extensions = new Set(['.z64', '.n64', '.v64']);

async function listFiles(root) {
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('Choose an existing game library folder');
  const files = [];
  const folders = [];
  const queue = [{ folder: root, depth: 0 }];
  let truncated = false;
  while (queue.length) {
    const { folder, depth } = queue.shift();
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length + folders.length >= 5000) { truncated = true; break; }
      if (entry.isSymbolicLink()) continue;
      const local = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        folders.push({ path: local, name: entry.name });
        if (depth < 6) queue.push({ folder: local, depth: depth + 1 });
      } else if (entry.isFile()) files.push({ path: local, name: entry.name });
    }
    if (truncated) break;
  }
  return { files, folders, truncated };
}

function nameMatchesGame(filename, game) {
  const stem = normalize(path.parse(filename).name);
  const names = [game.gameName, game.title, game.id, ...(game.matchNames || [])].map(normalize).filter((name) => name.length >= 6);
  return names.some((name) => stem.includes(name) || name.includes(stem) && stem.length >= 8);
}

async function scanLibraryFolder(root, games, sources = {}, options = {}) {
  if (typeof root !== 'string' || !root || root.length > 4096) throw new Error('Choose a game library folder');
  const candidates = await listFiles(root);
  return scanCandidates(root, candidates, games, sources, options);
}

async function scanLibraryPaths(paths, games, sources = {}, options = {}) {
  if (!Array.isArray(paths) || paths.length > 5000) throw new Error('Choose up to 5,000 files or folders');
  const files = [];
  const folders = [];
  let truncated = false;
  const append = (collection, item) => {
    if (files.length + folders.length < 5000) collection.push(item);
    else truncated = true;
  };
  for (const value of paths) {
    if (files.length + folders.length >= 5000) { truncated = true; break; }
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 4096) throw new Error('Choose absolute local paths');
    const local = path.resolve(value);
    const stat = await fs.lstat(local).catch(() => null);
    if (!stat || stat.isSymbolicLink()) throw new Error(`Missing or linked path: ${local}`);
    if (stat.isFile()) append(files, { path: local, name: path.basename(local) });
    else if (stat.isDirectory()) {
      append(folders, { path: local, name: path.basename(local) });
      const nested = await listFiles(local);
      for (const file of nested.files.filter((file) => path.dirname(file.path) === local)) append(files, file);
      for (const folder of nested.folders) append(folders, folder);
      for (const file of nested.files.filter((file) => path.dirname(file.path) !== local)) append(files, file);
      if (nested.truncated) truncated = true;
    }
  }
  return scanCandidates('', { files, folders, truncated }, games, sources, options);
}

async function scanCandidates(root, { files, folders, truncated = false }, games, sources, options) {
  const apkCandidates = new Map();
  for (const file of files.filter((item) => path.extname(item.name).toLowerCase() === '.apk')) {
    const name = file.name.replace(/^[a-f0-9]{16}-/i, '');
    apkCandidates.set(file.path, games.filter((game) => {
      const source = sources[game.id] || game.source;
      return !game.manualRelease && source?.assetPattern && new RegExp(source.assetPattern, 'i').test(name)
        || nameMatchesGame(name, game);
    }).map((game) => game.id));
  }
  const inspected = new Map();
  const matches = [];
  const warnings = truncated ? ['Scan limit reached inside a large folder; files found before the limit were still matched'] : [];
  for (const game of games) {
    const match = { gameId: game.id, apkPath: '', files: {}, buildInputs: {}, checks: {} };
    for (const [file, candidates] of apkCandidates) {
      if (!inspected.has(file)) inspected.set(file, options.inspectApk ? options.inspectApk(file).catch(() => undefined) : Promise.resolve(null));
      const packageId = await inspected.get(file);
      if (packageId === undefined) continue;
      const expected = packages[game.id];
      if (!candidates.includes(game.id) && (!expected || packageId !== expected)) continue;
      if (expected && packageId && packageId !== expected) continue;
      if (candidates.length > 1 && (!expected || packageId !== expected)) continue;
      match.apkPath = file;
      match.checks.apk = packageId ? `APK package ${packageId} matches` : 'Release filename matches; APK package ID not independently verified';
      break;
    }
    for (const item of game.data || []) {
      if (item.kind === 'directory') {
        const targetName = normalize(path.posix.basename(item.destination.replace(/\/$/, '')));
        if (targetName.length < 4 && targetName !== 'id1') continue;
        const generic = ['main', 'game', 'maps', 'files'].includes(targetName);
        let candidate = folders.find((folder) => normalize(folder.name) === targetName && (!generic || nameMatchesGame(path.basename(path.dirname(folder.path)), game)));
        const requiredCount = (item.requiredEntries?.length || 0) + (item.requiredDirectories?.length || 0) + (item.requiredExtensions?.length || 0);
        const matchesContents = async (folder) => {
          const entries = await fs.readdir(folder.path, { withFileTypes: true });
          const names = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
          return (item.requiredEntries || []).every((name) => names.get(name.toLowerCase())?.isFile())
            && (item.requiredDirectories || []).every((name) => names.get(name.toLowerCase())?.isDirectory())
            && (item.requiredExtensions || []).every((extension) => entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase())));
        };
        if (candidate && requiredCount && !await matchesContents(candidate)) candidate = null;
        if (!candidate && requiredCount) {
          for (const folder of folders) {
            if (requiredCount < 2 && !nameMatchesGame(folder.name, game)) continue;
            if (await matchesContents(folder)) {
              candidate = folder;
              break;
            }
          }
        }
        if (candidate) { match.files[item.id] = candidate.path; match.checks[item.id] = 'Folder name matches; contents need review'; }
        if (!candidate && options.inspectDirectoryArchive) for (const file of files) {
          if (!['.zip', '.7z', '.rar'].includes(path.extname(file.name).toLowerCase())) continue;
          if (!nameMatchesGame(file.name, game) && !normalize(file.name).includes(targetName)) continue;
          try {
            await options.inspectDirectoryArchive(item, file.path);
            match.files[item.id] = file.path;
            match.checks[item.id] = 'Archive contains the required game folders; contents are not independently verified';
            break;
          } catch { /* An installer or unrelated archive is not usable game data. */ }
        }
        continue;
      }
      const extensions = new Set((item.extensions || []).map((extension) => extension.toLowerCase()));
      const targetName = path.posix.basename(item.destination).toLowerCase();
      if (options.inspectSingleFileArchive && item.kind === 'file' && (item.archiveMember || [...extensions].some((value) => !['.zip', '.7z', '.rar'].includes(value)))) {
        for (const file of files) {
          const extension = path.extname(file.name).toLowerCase();
          if (!['.zip', '.7z', '.rar'].includes(extension) || extensions.has(extension) && !item.archiveMember) continue;
          const memberStem = item.archiveMember && path.parse(item.archiveMember).name.toLowerCase();
          if (!nameMatchesGame(file.name, game) && !file.name.toLowerCase().includes(memberStem || targetName.replace(/\.[^.]+$/, '')) && !file.name.toLowerCase().includes(item.id.toLowerCase())) continue;
          try {
            const inspected = await options.inspectSingleFileArchive(item, file.path);
            match.files[item.id] = file.path;
            match.checks[item.id] = `Archive contains ${path.posix.basename(inspected.member)}; it will be extracted for the Quest`;
            break;
          } catch { /* An unrelated archive is not a BIOS input. */ }
        }
        if (match.files[item.id]) continue;
      }
      for (const file of files) {
        const extension = path.extname(file.name).toLowerCase();
        const convertible = ['.7z', '.rar'].includes(extension) && extensions.has('.zip');
        if (!extensions.has(extension) && !convertible) continue;
        const explicitName = targetName && targetName.includes('.') && file.name.toLowerCase() === targetName;
        const sourceStem = file.name.slice(0, -extension.length).replace(/\s*\(\d+\)$/, '').toLowerCase();
        const archiveNameMatch = targetName.endsWith('.zip') && ['.zip', '.7z', '.rar'].includes(extension) && sourceStem === targetName.slice(0, -4);
        const possibleN64 = n64Extensions.has(extension) && ['rom'].includes(item.id);
        const pokemonRom = game.id === 'pokemon-gen1-vr' && extension === '.gb';
        const namedN64 = game.id === 'smash-remix-vr' && /smash/i.test(file.name) || game.id === 'wave-race-vr' && /wave.?race/i.test(file.name);
        if (!explicitName && !archiveNameMatch && !possibleN64 && !pokemonRom && !nameMatchesGame(file.name, game)) continue;
        try {
          if (convertible && !options.convertArchive) continue;
          const prepared = convertible ? await options.convertArchive(item, file.path) : { path: file.path };
          const verification = await verifyGameFile(game, item, prepared.path);
          if (possibleN64 && verification.level !== 'title' && !explicitName && !namedN64) continue;
          // Remember the source. Conversion is repeated when the file is installed.
          match.files[item.id] = file.path;
          match.checks[item.id] = convertible ? `Converted ${extension.toUpperCase()} to ZIP · ${verification.message}` : verification.message;
          break;
        } catch (error) {
          if (convertible) warnings.push(`${file.name}: ${error.message}`);
          // A file with the right name but wrong contents is not a match.
        }
      }
    }
    if (game.id === 'fzero-x-virtuavr') {
      const roms = files.filter((file) => path.extname(file.name).toLowerCase() === '.z64' && /f.?zero/i.test(file.name));
      const bundles = files.filter((file) => path.extname(file.name).toLowerCase() === '.zip' && /f.?zero|virtuavr/i.test(file.name));
      for (const rom of roms) {
        for (const bundle of bundles) {
          try {
            await (options.validateFzeroInput || validateVirtuaInput)({ serial: 'SCAN', gamePackage: rom.path, audioSource: bundle.path });
            match.buildInputs = { gamePackage: rom.path, audioSource: bundle.path };
            match.checks.gamePackage = 'F-Zero X ROM and creator ZIP verified';
            match.checks.audioSource = 'Creator package checksum matches';
            break;
          } catch { /* Keep unmatched build inputs for manual review. */ }
        }
        if (match.buildInputs.gamePackage) break;
      }
    }
    if (match.apkPath || Object.keys(match.files).length || Object.keys(match.buildInputs).length) matches.push(match);
  }
  return { path: root, scannedFiles: files.length, scannedFolders: folders.length, matches, warnings: [...new Set(warnings)].slice(0, 20) };
}

module.exports = { scanLibraryFolder, scanLibraryPaths };
