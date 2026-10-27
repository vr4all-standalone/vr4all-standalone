const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { verifyPushedFile } = require('./transfer-verification');

const runFile = promisify(execFile);
const packageId = 'com.bassquake.quest.avpvr';
const appFiles = `/sdcard/Android/data/${packageId}/files`;
// Only the retail Gold Edition assets the port reads go to the Quest. The EXE, DLLs, PC profiles and
// configs stay behind. The retail default.cfg bootstraps a fresh install only;
// extraction excludes it whenever the headset already has that file.
const requiredEntries = { avp_rifs: 'directory', fastfile: 'directory', 'language.txt': 'file' };
const optionalEntries = ['avp_huds', 'fmvs', 'cd_tracks', 'cd tracks.txt', 'credits.txt', 'default.cfg'];
const retryableTransfer = /broken pipe|no response|device offline|connection reset|transport.*error|protocol fault|timed? out/i;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function listFiles(root, relative, files) {
  const stat = await fs.lstat(path.join(root, relative));
  if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error(`AvP game folder contains a link or unsupported file (${relative})`);
  if (stat.isFile()) { files.push({ path: relative, bytes: stat.size }); return; }
  for (const name of (await fs.readdir(path.join(root, relative))).sort()) await listFiles(root, `${relative}/${name}`, files);
}

async function packageAvpData(source, workspace) {
  if (typeof source !== 'string' || typeof workspace !== 'string' || !path.isAbsolute(source) || !path.isAbsolute(workspace)) {
    throw new Error('Choose a valid AvP game folder and PC build folder');
  }
  let directory = null;
  const workspaceRoot = path.resolve(workspace);
  async function cleanup() {
    if (!directory) return;
    const target = path.resolve(directory);
    if (path.dirname(target) !== workspaceRoot || !path.basename(target).startsWith('vr4all-avp-')) throw new Error('Invalid AvP temporary directory');
    await fs.rm(target, { recursive: true, force: true });
  }
  try {
    const root = await fs.lstat(source);
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Choose a regular AvP game folder without links');
    const names = await fs.readdir(source);
    for (const [name, kind] of Object.entries(requiredEntries)) {
      const stat = await fs.lstat(path.join(source, name)).catch(() => null);
      if (!stat || stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory())) throw new Error(`AvP game data is missing its ${name} ${kind === 'file' ? 'file' : 'folder'}`);
    }
    const entries = [...Object.keys(requiredEntries), ...optionalEntries.filter((name) => names.includes(name))];
    const files = [];
    for (const entry of entries) await listFiles(source, entry, files);
    await fs.mkdir(workspaceRoot, { recursive: true });
    directory = await fs.mkdtemp(path.join(workspaceRoot, 'vr4all-avp-'));
    const tarPath = path.join(directory, 'avp-data.tar');
    const tar = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    await runFile(tar, ['--format=ustar', '-cf', tarPath, '-C', source, ...entries], {
      windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 10 * 1024 * 1024,
    });
    if (!(await fs.stat(tarPath)).size) throw new Error('The AvP game-data TAR is empty');
    return { path: tarPath, directory, entries, files, cleanup };
  } catch (error) {
    await cleanup();
    throw new Error(`Could not package AvP game data: ${String(error.stderr || error.message).trim().slice(0, 320)}`);
  }
}

async function transferAvpData(adb, serial, packaged, log = () => {}) {
  const prefix = ['-s', serial];
  let ready = false;
  for (let attempt = 0; attempt < 10 && !ready; attempt++) {
    try { await adb.run([...prefix, 'shell', 'test', '-d', appFiles]); ready = true; }
    catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  if (!ready) log('AvP has not created its data folder yet; creating it over ADB...');
  // Stop the first-launch session so the game is not holding or rewriting files while assets land.
  await adb.run([...prefix, 'shell', 'am', 'force-stop', packageId]);
  await adb.run([...prefix, 'shell', 'mkdir', '-p', appFiles]);
  let keepDefaults = false;
  if (packaged.entries.includes('default.cfg')) {
    try { await adb.run([...prefix, 'shell', 'test', '-e', `${appFiles}/default.cfg`]); keepDefaults = true; } catch {}
  }
  // adb push cannot create nested folders under Android/data on Quest (secure_mkdirs: Operation not permitted),
  // so send one TAR to a shell-owned temp path and let the shell, which can create them, unpack it.
  const remoteArchive = `/data/local/tmp/vr4all-avp-${randomUUID()}.tar`;
  try {
    log('Sending the prepared AvP game-data TAR to the Quest...');
    for (let attempt = 1; ; attempt++) {
      try { await adb.run([...prefix, 'push', packaged.path, remoteArchive]); break; }
      catch (error) {
        if (!retryableTransfer.test(error.message) || attempt === 3) throw error;
        log(`USB transfer interrupted (${error.message.slice(-160)}). Retrying copy ${attempt + 1}/3...`);
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
    const pushed = await verifyPushedFile(adb, serial, packaged.path, remoteArchive);
    log('Unpacking AvP game data into its app folder; existing saves and settings are kept...');
    await adb.run([...prefix, 'shell', 'tar', '-xf', remoteArchive, '-C', appFiles,
      ...(keepDefaults ? ['--exclude', 'default.cfg'] : [])]);
    const output = await adb.run([...prefix, 'shell', 'cd', shellQuote(appFiles), '&&', 'find', ...packaged.entries.map(shellQuote),
      '-type', 'f', '-exec', 'stat', '-c', shellQuote('%s %n'), '{}', '+']);
    const remote = new Map();
    for (const line of String(output).split(/\r?\n/)) {
      const match = line.match(/^(\d+) (?:\.\/)?(.+)$/);
      if (match) remote.set(match[2], Number(match[1]));
    }
    const expected = packaged.files.filter((file) => !keepDefaults || file.path !== 'default.cfg');
    const wrong = expected.filter((file) => remote.get(file.path) !== file.bytes);
    if (wrong.length) throw new Error(`AvP game data is incomplete on the headset: ${wrong.length} of ${packaged.files.length} files are missing or the wrong size (first: ${wrong[0].path})`);
    log(`Verified ${expected.length} AvP game files on the headset.`);
    return { files: expected.length, bytes: pushed.bytes };
  } finally {
    await adb.run([...prefix, 'shell', 'rm', '-f', remoteArchive]).catch(() => {});
  }
}

module.exports = { packageAvpData, transferAvpData, appFiles, requiredEntries, optionalEntries };
