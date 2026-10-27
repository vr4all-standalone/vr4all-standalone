const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { inflateRawSync } = require('node:zlib');
const { extractZipSafely } = require('./harry-potter-runner');
const { inspectApkPackage } = require('./apk-verification');

// The creator's Quest R10 installer extracts two archives from the user's ROM.
const bundleZipSha256 = '13a1af3db416f296a6d4a6954eba76792c44109463e85317729d2f5eb768741e';
const romSha1 = '5f658e88ffa9de23cba6986a8fd3d3a90d7b4340';
const bundleFiles = Object.freeze({
  'FZeroXVR-Quest.apk': '3fc5eaba4d77359a7387538e6b0f2cbf4401fd6ec2d976c2369bed25f3f3a630',
  'Quest-Install.ps1': '8190d4893abe03c77a2d6de5b1f25841b76c6d6d05deebfaf3af555cadddb4bb',
  'tools/Prepare-QuestData.ps1': '27d4487aafa8959eca45e10baae302b3998950d39205b45a0495f3a70e0cd52c',
  'tools/Install-QuestCandidate.ps1': '951ee5e13563f488dbb232921acbb72a11f0fa10f617ebcc517a73f0c3c6af13',
  'tools/gdx-extract.exe': '2c56923350c0866394a1720cfce9272c2078f13c9764970d6732e7b34f2162b8',
  'tools/gdiffuser.o2r': '4877d69055e50be19b1109e45c4a910614c5f02dcf271adcee129285f5b74c35',
  'tools/adb.exe': 'b4a6b455702684652cccf7b46258b29e653538904359a58fd4931cf3ef286b3f',
  'tools/AdbWinApi.dll': 'c1d653030b4bde65d3e07e4d0b0979e17be56df1436cdd15528630f27808050d',
  'tools/AdbWinUsbApi.dll': '0710e894d9b40f71a670c13c694079d564c92c1279da382cfe4850983aaebe1b',
});
const recipesSha256 = '8600c00cbae999cb21d188b6e272b9df839a5946445cb2a3e8998db08e7f7f1a';
const remoteFiles = '/sdcard/Android/data/dev.gdiffuser.quest/files';

async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function validateRom(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.z64') {
    throw new Error('Choose your F-Zero X US Rev 0 .z64 ROM');
  }
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== 16 * 1024 * 1024) {
    throw new Error('F-Zero X ROM must be an unmodified 16 MiB US Rev 0 .z64 file');
  }
  if (await hashFile(file, 'sha1') !== romSha1) throw new Error('F-Zero X ROM SHA-1 does not match the required US Rev 0 release');
  return path.resolve(file);
}

async function findBundleRoot(folder) {
  const candidates = [folder];
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink()) candidates.push(path.join(folder, entry.name));
  for (const candidate of candidates) {
    if ((await fs.lstat(path.join(candidate, 'Quest-Install.ps1')).catch(() => null))?.isFile()) return candidate;
  }
  throw new Error('Choose the VirtuaVRPort F-Zero X Quest R10 ZIP or its extracted folder');
}

async function recipeTreeHash(root) {
  const hash = crypto.createHash('sha256');
  let count = 0;
  async function visit(folder) {
    const entries = (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('Creator recipes may not contain links');
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        hash.update(`${path.relative(root, file).replaceAll('\\', '/')}\0`);
        hash.update(await fs.readFile(file));
        count++;
      } else throw new Error('Creator recipes contain an unsupported entry');
    }
  }
  await visit(root);
  return { count, digest: hash.digest('hex') };
}

async function verifyBundleRoot(root) {
  for (const [relative, expected] of Object.entries(bundleFiles)) {
    const file = path.join(root, ...relative.split('/'));
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || await hashFile(file, 'sha256') !== expected) {
      throw new Error(`VirtuaVRPort R10 bundle is missing or changed: ${relative}`);
    }
  }
  const recipes = await recipeTreeHash(path.join(root, 'tools', 'decomp-recipes'));
  if (recipes.count !== 69 || recipes.digest !== recipesSha256) throw new Error('VirtuaVRPort R10 extraction recipes are missing or changed');
  return root;
}

async function validateVirtuaInput(input) {
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  const gamePackage = await validateRom(input.gamePackage);
  const bundle = input.audioSource;
  if (typeof bundle !== 'string' || !path.isAbsolute(bundle)) throw new Error('Choose the VirtuaVRPort R10 creator ZIP or extracted folder');
  const stat = await fs.lstat(bundle).catch(() => null);
  if (!stat || stat.isSymbolicLink()) throw new Error('Creator bundle was not found');
  if (stat.isFile()) {
    if (path.extname(bundle).toLowerCase() !== '.zip' || stat.size < 1024 || stat.size > 200 * 1024 ** 2) throw new Error('Choose the VirtuaVRPort R10 creator ZIP');
    if (await hashFile(bundle, 'sha256') !== bundleZipSha256) throw new Error('Creator ZIP does not match the checked VirtuaVRPort R10 bundle');
  } else if (stat.isDirectory()) await verifyBundleRoot(await findBundleRoot(bundle));
  else throw new Error('Choose the creator ZIP or extracted folder');
  return { serial: input.serial, gamePackage, audioSource: path.resolve(bundle) };
}

function runExtractor(root, rom, output, log) {
  return new Promise((resolve, reject) => {
    const tool = path.join(root, 'tools', 'gdx-extract.exe');
    const args = ['o2r', rom, '-s', path.join(root, 'tools', 'decomp-recipes'), '-d', output, '-u', '2027490995'];
    const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const record = (chunk) => {
      tail += String(chunk);
      const lines = tail.split(/\r?\n/);
      tail = lines.pop() || '';
      for (const line of lines) if (line.trim() && !line.includes('Registered factory')) log(line.trim().slice(0, 500));
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (tail.trim()) log(tail.trim().slice(0, 500));
      code === 0 ? resolve() : reject(new Error(`VirtuaVRPort ROM extraction failed (exit ${code}); see activity log`));
    });
  });
}

async function checkArchiveVersion(file) {
  const zip = await fs.readFile(file);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Prepared F-Zero game archive is not a complete ZIP');
  const centralOffset = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  let entry = centralOffset;
  for (let i = 0; i < count && entry + 46 <= end; i++) {
    if (zip.readUInt32LE(entry) !== 0x02014b50) break;
    const nameLength = zip.readUInt16LE(entry + 28);
    const extraLength = zip.readUInt16LE(entry + 30);
    const commentLength = zip.readUInt16LE(entry + 32);
    const name = zip.toString('utf8', entry + 46, entry + 46 + nameLength);
    if (name === 'version') {
      const method = zip.readUInt16LE(entry + 10);
      const packed = zip.readUInt32LE(entry + 20);
      const local = zip.readUInt32LE(entry + 42);
      if (zip.readUInt32LE(local) !== 0x04034b50) break;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const bytes = zip.subarray(start, start + packed);
      const version = method === 8 ? inflateRawSync(bytes) : method === 0 ? bytes : null;
      if (version?.equals(Buffer.from([1, 0x78, 0xd9, 0x0e, 0xb3]))) return;
      break;
    }
    entry += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('Prepared F-Zero game archive does not match the required US Rev 0 version');
}

async function prepareVirtuaData(root, rom, output, log = () => {}, extract = runExtractor) {
  if (await fs.lstat(output).catch(() => null)) throw new Error('Preparation output already exists');
  await fs.mkdir(output, { recursive: true });
  log('Extracting your owned F-Zero X ROM into the creator’s game archive...');
  await extract(root, rom, output, log);
  const generated = path.join(output, 'generic.o2r');
  const archive = path.join(output, 'fzerox.o2r');
  if ((await fs.stat(generated).catch(() => null))?.isFile() && !(await fs.stat(archive).catch(() => null))) {
    await fs.copyFile(generated, archive);
  }
  if (!(await fs.stat(archive).catch(() => null))?.isFile()) throw new Error('ROM extractor did not produce fzerox.o2r');
  await checkArchiveVersion(archive);
  await fs.copyFile(rom, path.join(output, 'baserom.us.rev0.z64'));
  await fs.copyFile(path.join(root, 'tools', 'gdiffuser.o2r'), path.join(output, 'gdiffuser.o2r'));
  return ['baserom.us.rev0.z64', 'fzerox.o2r', 'gdiffuser.o2r'];
}

async function installVirtuaFzero(input, { adb, onLog = () => {}, extract = runExtractor } = {}) {
  if (!adb || typeof adb.run !== 'function') throw new Error('ADB is required to install F-Zero X on the selected Quest');
  const validated = await validateVirtuaInput(input);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-fzero-'));
  try {
    let root = validated.audioSource;
    if (path.extname(root).toLowerCase() === '.zip') {
      onLog('Unpacking the checked VirtuaVRPort R10 installer...');
      root = await findBundleRoot(await extractZipSafely(root, path.join(staging, 'bundle'), { maxBytes: 300 * 1024 ** 2 }));
    } else root = await findBundleRoot(root);
    await verifyBundleRoot(root);
    const apk = path.join(root, 'FZeroXVR-Quest.apk');
    if (await inspectApkPackage(apk) !== 'dev.gdiffuser.quest') throw new Error('Creator APK package does not match the VirtuaVRPort Quest app');
    const data = path.join(staging, 'data');
    const files = await prepareVirtuaData(root, validated.gamePackage, data, onLog, extract);
    onLog('Installing the separate VirtuaVRPort Quest APK...');
    await adb.run(['-s', validated.serial, 'get-state']);
    await adb.run(['-s', validated.serial, 'install', '-r', apk]);
    await adb.run(['-s', validated.serial, 'shell', 'mkdir', '-p', remoteFiles]);
    for (const name of files) {
      onLog(`Transferring ${name}...`);
      await adb.run(['-s', validated.serial, 'push', path.join(data, name), `${remoteFiles}/${name}.installing`]);
      await adb.run(['-s', validated.serial, 'shell', 'mv', `${remoteFiles}/${name}.installing`, `${remoteFiles}/${name}`]);
    }
    const installed = await adb.run(['-s', validated.serial, 'shell', 'pm', 'path', 'dev.gdiffuser.quest']);
    const remote = await adb.run(['-s', validated.serial, 'shell', 'ls', '-1', remoteFiles]);
    if (!/package:/i.test(installed) || !files.every((name) => remote.split(/\r?\n/).includes(name))) {
      throw new Error('APK install completed, but its prepared game archives were not found on the selected Quest');
    }
    return { packageId: 'dev.gdiffuser.quest', tag: 'R10', bundleSha256: bundleZipSha256 };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { validateVirtuaInput, findBundleRoot, verifyBundleRoot, prepareVirtuaData, installVirtuaFzero };
