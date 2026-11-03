const fs = require('node:fs/promises');
const path = require('node:path');

// Node port of the creator's files/setup-quest.ps1 (Descent 1 & 2 VR, v1.2.1) Do-Install. It leaves out the Game Tome
// (the creator renders it with Windows WinRT PDF APIs and treats it as optional), the save backup/restore (only its
// uninstall path needs it, and this port never uninstalls) and the PC library search.
const REMOTE = '/sdcard/Android/data/net.gameordie.descentvr/files';
const GAMES = [
  { name: 'Descent', hog: 'descent.hog', companion: 'descent.pig', remote: REMOTE },
  { name: 'Descent 2', hog: 'descent2.hog', companion: 'descent2.ham', remote: REMOTE + '/descent2' },
];
const DATA_EXT = new Set(['.hog', '.pig', '.ham', '.s11', '.s22', '.mvl', '.mn2', '.msn', '.rl2', '.rdl', '.sng', '.txb', '.lgt', '.clr', '.dtx', '.hmp', '.mid']);
const SIGNATURE_ERROR = /INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i;
const MIB = 1024 * 1024;
const mib = (bytes) => (bytes / MIB).toFixed(1);

async function regularFiles(folder) {
  const names = await fs.readdir(folder).catch(() => []);
  const files = [];
  for (const name of names.sort()) {
    const stat = await fs.stat(path.join(folder, name)).catch(() => null);
    if (stat?.isFile()) files.push({ name, local: path.join(folder, name), bytes: stat.size });
  }
  return files;
}

async function subdirectories(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && entry.name.toLowerCase() !== 'vr').map((entry) => path.join(folder, entry.name)).sort();
}

// The chosen folder itself, then each direct subfolder (skipping the VR folder of a previous install), whichever first holds both key files.
async function findGame(game, candidates) {
  for (const candidate of candidates) {
    const names = new Set((await regularFiles(candidate)).map((file) => file.name.toLowerCase()));
    if (names.has(game.hog) && names.has(game.companion)) return candidate;
  }
  return null;
}

async function gameFiles(folder) {
  const files = new Map();
  const add = (entries, prefix) => {
    for (const file of entries) {
      const name = prefix + file.name.toLowerCase();
      if (DATA_EXT.has(path.extname(file.name).toLowerCase()) && !files.has(name)) files.set(name, { name, local: file.local, bytes: file.bytes });
    }
  };
  add(await regularFiles(folder), '');
  const missions = (await fs.readdir(folder, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.toLowerCase() === 'missions').map((entry) => entry.name).sort()[0];
  if (missions) add(await regularFiles(path.join(folder, missions)), 'missions/');
  return [...files.values()];
}

async function remoteSizes(adb, serial, remote) {
  const output = await adb.run(['-s', serial, 'shell', `cd "${remote}" 2>/dev/null && for f in * missions/*; do [ -f "$f" ] && stat -c "%s|%n" "$f"; done; true`]);
  const sizes = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\d+)\|(.+)$/.exec(line.trim());
    if (match) sizes.set(match[2].toLowerCase(), Number(match[1]));
  }
  return sizes;
}

async function installDescentLinux({ apk, gamePath, serial, adb, onLog = () => {} }) {
  const candidates = [gamePath, ...await subdirectories(gamePath)];
  const found = [];
  for (const game of GAMES) {
    const folder = await findGame(game, candidates);
    if (!folder) continue;
    const files = await gameFiles(folder);
    const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
    onLog(`Found ${game.name}: ${folder} (${files.length} files, ${mib(bytes)} MiB)`);
    found.push({ ...game, files, bytes });
  }
  if (!found.length) {
    throw new Error('Neither Descent nor Descent 2 was found in the chosen folder. Choose the folder with descent.hog and descent.pig (or descent2.hog and descent2.ham), or a folder that holds both game folders.');
  }

  const apkBytes = (await fs.stat(apk)).size;
  const need = apkBytes + 50 * MIB + found.reduce((sum, game) => sum + game.bytes, 0);
  const columns = (await adb.run(['-s', serial, 'shell', 'df -k /sdcard | tail -1'])).trim().split(/\s+/);
  if (/^\d+$/.test(columns[3] || '')) {
    const free = Number(columns[3]) * 1024;
    if (free < need) throw new Error(`The headset needs ${mib(need)} MiB free and has ${mib(free)} MiB. Remove something and retry.`);
  }

  onLog('Installing the Descent 1 & 2 VR app...');
  const signature = 'A differently signed Descent 1 & 2 VR is installed. Back up your pilots, uninstall it on the headset, then retry.';
  let installed;
  try { installed = await adb.run(['-s', serial, 'install', '-r', apk]); } catch (error) {
    if (SIGNATURE_ERROR.test(error.message)) throw new Error(signature);
    throw new Error(`The app did not install: ${error.message}`);
  }
  if (SIGNATURE_ERROR.test(installed)) throw new Error(signature);
  if (!/Success/.test(installed)) throw new Error(`The app did not install: ${installed}`);

  for (const game of found) {
    for (const directory of [game.remote, game.remote + '/missions']) {
      await adb.run(['-s', serial, 'shell', `mkdir -p "${directory}" && chmod 2775 "${directory}" 2>/dev/null; true`]);
    }
    const existing = await remoteSizes(adb, serial, game.remote);
    const pending = game.files.filter((file) => existing.get(file.name) !== file.bytes);
    onLog(`${game.name}: ${pending.length} of ${game.files.length} files need to be sent.`);
    for (const [index, file] of pending.entries()) {
      onLog(`${index + 1}/${pending.length} ${file.name} (${mib(file.bytes)} MiB)`);
      await adb.run(['-s', serial, 'push', file.local, `${game.remote}/${file.name}`]);
    }
    const after = await remoteSizes(adb, serial, game.remote);
    const broken = game.files.filter((file) => after.get(file.name) !== file.bytes).map((file) => file.name);
    if (broken.length) throw new Error(`${game.name}: ${broken.length} files did not arrive whole (${broken.join(', ')}). Run the install again.`);
  }
  onLog('The Game Tome (the illustrated manual) is not created on Linux; the games play without it.');
  return {};
}

module.exports = { installDescentLinux };
