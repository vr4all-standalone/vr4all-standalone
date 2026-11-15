const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const { setTimeout: pause } = require('node:timers/promises');
const { acquireSourceKit } = require('./personal-build');
const { withShortBuildPath } = require('./build-path');
const { runLogged } = require('./run-logged');
const { verifyPushedFile } = require('./transfer-verification');

const PACKAGE = 'com.lucasmartinic.mario64mr';
const REMOTE = `/sdcard/Android/data/${PACKAGE}/files`;
const ROM_HASHES = new Set([
  '9bef1128717f958171a4afac3ed78ee2bb4e86ce', // .z64
  '1002dd7b56aa0a59a9103f1fb3d57d6b161f8da7', // .v64
  '39a4b853ca4deee3fe69eb20c0ffd0847c5b4367', // .n64
]);
const OUTPUTS = [
  ['baserom.us.z64', REMOTE],
  ['sm64/res/base.zip', `${REMOTE}/sm64/res`],
  ['native/libsm64game.so', `${REMOTE}/native`],
  ['native/libgoddard.so', `${REMOTE}/native`],
  ['native/libsm64.so', `${REMOTE}/native`],
];

async function validateMarioInput(input) {
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  const rom = input.gamePackage;
  if (typeof rom !== 'string' || !path.isAbsolute(rom) || !/\.(?:z64|v64|n64)$/i.test(rom))
    throw new Error('Choose your unmodified Super Mario 64 (USA) .z64, .v64 or .n64 ROM');
  const stat = await fs.lstat(rom).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== 8 * 1024 * 1024)
    throw new Error('Super Mario 64 (USA) requires an unmodified 8 MB ROM file');
  const hash = crypto.createHash('sha1');
  for await (const chunk of createReadStream(rom)) hash.update(chunk);
  if (!ROM_HASHES.has(hash.digest('hex')))
    throw new Error('This is not the unmodified Super Mario 64 (USA) ROM required by the creator (SHA-1 mismatch)');
  return { gamePackage: path.resolve(rom), serial: input.serial };
}

async function runMarioBuild(rawInput, options = {}) {
  const input = await (options.validateInput || validateMarioInput)(rawInput);
  const platform = options.platform || process.platform;
  if (!['win32', 'linux'].includes(platform)) throw new Error('The Mario 64 MR builder supports Windows and Linux');
  const root = options.workspaceRoot;
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Choose a PC build folder');
  if (!options.adb?.run) throw new Error('Quest ADB connection is unavailable');
  if (!options.source || !options.releases?.latest || !options.releases?.download) throw new Error('Official Mario 64 MR release is unavailable');
  const onLog = options.onLog || (() => {});
  const work = path.join(root, 'mario64mr');
  await fs.mkdir(work, { recursive: true });
  const msysReady = (await fs.stat(path.join(work, 'Mario64MR', 'msys2-ready')).catch(() => null))?.isFile();
  const ndkReady = (await fs.stat(path.join(work, 'Mario64MR', 'work', 'ndk')).catch(() => null))?.isDirectory();
  if (!msysReady || !ndkReady) {
    const availableBytes = options.availableBytes || (async (directory) => {
      const disk = await fs.statfs(directory, { bigint: true });
      return disk.bavail * disk.bsize;
    });
    if (BigInt(await availableBytes(work)) < 4n * 1024n ** 3n)
      throw new Error('Mario 64 MR first build needs at least 4 GB free in the selected PC build folder. Change PC build folder to a drive with enough space and retry.');
  }
  const withBuildPath = options.withBuildPath || withShortBuildPath;
  const sourceKit = options.sourceKit || acquireSourceKit;
  const runCommand = options.runCommand || ((command, args, settings) => runLogged(command, args, { ...settings, onLine: onLog }));
  const inspectApk = options.inspectApk;
  if (typeof inspectApk !== 'function') throw new Error('APK package verification is unavailable');
  const release = await options.releases.latest(options.source, { force: true });
  if (!release || release.stale) throw new Error('Could not verify the current Mario 64 MR Quest release');
  return withBuildPath(work, async (shortRoot) => {
    const kit = await sourceKit('mario64mr', path.join(shortRoot, 'source-kits'), onLog, { platform });
    if (!/^[a-f0-9]{40}$/i.test(kit.sha || '')) throw new Error('Official Mario 64 MR source revision is invalid');
    const output = platform === 'win32' ? path.join(kit.directory, 'Mario64MRData') : path.join(shortRoot, 'Mario64MRData');
    try {
      onLog(`Building Super Mario 64 MR from creator source ${kit.sha.slice(0, 12)} and your verified ROM.`);
      const command = platform === 'win32' ? 'powershell.exe' : 'python3';
      const args = platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(kit.directory, 'windows', 'install_mario64mr.ps1'), '-Rom', input.gamePackage, '-NoPush']
        : [path.join(kit.directory, 'install_mario64mr.py'), input.gamePackage, '--out', output, '--work', path.join(shortRoot, 'Mario64MR', 'work')];
      const env = platform === 'win32' ? { ...process.env, LOCALAPPDATA: shortRoot } : process.env;
      const built = await runCommand(command, args, { cwd: kit.directory, env, timeoutMs: 2 * 60 * 60 * 1000 });
      if (built.code !== 0) throw new Error(`Official Mario 64 MR build failed (exit ${built.code}): ${(built.tail || []).slice(-4).join(' ').slice(-800)}`);
      for (const [relative] of OUTPUTS) {
        const file = path.join(output, relative);
        const stat = await fs.lstat(file).catch(() => null);
        if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`The creator build did not produce ${relative}`);
      }
      const apk = await options.releases.download(release);
      const apkPackage = await inspectApk(apk, options.adb.getPath?.());
      if (apkPackage !== PACKAGE) throw new Error(`The official APK contains ${apkPackage}; expected ${PACKAGE}. Nothing was installed.`);
      onLog(`Installing ${release.assetName} on Quest ${input.serial}.`);
      const installed = await options.adb.run(['-s', input.serial, 'install', '-r', '-g', apk]);
      if (!/^Success\b/m.test(installed)) throw new Error(`Quest did not confirm APK installation: ${installed || 'no response'}`);
      await options.adb.run(['-s', input.serial, 'shell', 'am', 'force-stop', PACKAGE]).catch(() => {});
      const dataFolderExists = () => options.adb.run(['-s', input.serial, 'shell', 'ls', REMOTE]).then(() => true, () => false);
      if (!await dataFolderExists()) {
        onLog('Opening Mario 64 MR once so the Quest creates its game files folder...');
        await options.adb.run(['-s', input.serial, 'shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']);
        let created = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          if (await dataFolderExists()) { created = true; break; }
          await pause(1000);
        }
        if (!created) throw new Error('Mario 64 MR did not create its game files folder. Wake the Quest, open the app once, then retry.');
        await options.adb.run(['-s', input.serial, 'shell', 'am', 'force-stop', PACKAGE]).catch(() => {});
      }
      await options.adb.run(['-s', input.serial, 'shell', 'mkdir', '-p', `${REMOTE}/sm64/res`, `${REMOTE}/native`]);
      for (const [relative, destination] of OUTPUTS) {
        const file = path.join(output, relative);
        onLog(`Copying ${relative} to the selected Quest...`);
        await options.adb.run(['-s', input.serial, 'push', file, `${destination}/`]);
        await verifyPushedFile(options.adb, input.serial, file, `${destination}/`);
      }
      await options.adb.run(['-s', input.serial, 'shell', 'am', 'force-stop', PACKAGE]).catch(() => {});
      return { sha: kit.sha, packageId: PACKAGE, tag: release.tag };
    } finally {
      // The creator needs temporary ROM copies to compile. Keep its tool cache,
      // but remove raw ROM copies even when a build or transfer fails.
      await Promise.allSettled([
        fs.rm(path.join(output, 'baserom.us.z64'), { force: true }),
        fs.rm(path.join(shortRoot, 'Mario64MR', 'work', 'sm64ex', 'baserom.us.z64'), { force: true }),
      ]);
    }
  }, onLog, { platform });
}

module.exports = { validateMarioInput, runMarioBuild, PACKAGE };
