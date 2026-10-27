const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { inspectDirectory } = require('./archive-conversion');
const { verifyPushedFile } = require('./transfer-verification');
const { isWipeoutDisc, extractWipeoutDisc } = require('./wipeout-disc');

const runFile = promisify(execFile);
const packageId = 'online.portroyale.wipeoutrewritevr';
const appFiles = `/sdcard/Android/data/${packageId}/files`;
const tarDestination = `${appFiles}/wipeout.tar`;

async function packageWipeoutData(source, workspace) {
  if (typeof source !== 'string' || typeof workspace !== 'string' || !path.isAbsolute(workspace)) {
    throw new Error('Choose a valid Wipeout folder and PC build folder');
  }
  let extracted = null;
  if (isWipeoutDisc(source)) {
    extracted = await extractWipeoutDisc(source, workspace);
    source = extracted.path;
  }
  let directory = null;
  try {
    await inspectDirectory(source);
    for (const name of ['common', 'textures', 'track01']) {
      const stat = await fs.lstat(path.join(source, name)).catch(() => null);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error(`Wipeout game data is missing its ${name} folder`);
    }
    await fs.mkdir(workspace, { recursive: true });
    directory = await fs.mkdtemp(path.join(workspace, 'vr4all-wipeout-'));
    const tarPath = path.join(directory, 'wipeout.tar');
    if (path.basename(source).toLowerCase() !== 'wipeout') {
      await fs.cp(source, path.join(directory, 'wipeout'), { recursive: true, errorOnExist: true, force: false });
      source = path.join(directory, 'wipeout');
    }
    const tar = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    await runFile(tar, ['--format=ustar', '--exclude=game_data_goes_here.txt', '-cf', tarPath, '-C', path.dirname(source), 'wipeout'], {
      windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 10 * 1024 * 1024,
    });
    const stat = await fs.stat(tarPath);
    if (!stat.size) throw new Error('The Wipeout game-data TAR is empty');
    return { path: tarPath, directory, cleanup: async () => { await fs.rm(directory, { recursive: true, force: true }); if (extracted) await extracted.cleanup(); } };
  } catch (error) {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    if (extracted) await extracted.cleanup();
    throw new Error(`Could not package Wipeout game data: ${String(error.stderr || error.message).trim().slice(0, 320)}`);
  }
}

async function transferWipeoutData(adb, serial, tarPath, log = () => {}) {
  const prefix = ['-s', serial];
  let ready = false;
  try { await adb.run([...prefix, 'shell', 'test', '-d', appFiles]); ready = true; } catch {}
  if (!ready) {
    log('Starting Wipeout once to create its app-owned data folder...');
    await adb.run([...prefix, 'shell', 'am', 'start', '-n', `${packageId}/android.app.NativeActivity`]);
    for (let attempt = 0; attempt < 20; attempt++) {
      try { await adb.run([...prefix, 'shell', 'test', '-d', appFiles]); ready = true; break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await adb.run([...prefix, 'shell', 'am', 'force-stop', packageId]);
  }
  if (!ready) throw new Error('Wipeout did not create its game-data folder. Open it once on the Quest, then retry.');
  log('Sending the prepared Wipeout TAR to the Quest...');
  await adb.run([...prefix, 'push', tarPath, tarDestination]);
  const result = await verifyPushedFile(adb, serial, tarPath, tarDestination);
  log(`Verified Wipeout game-data transfer (${result.bytes} bytes). It imports when the game next opens.`);
  return result;
}

module.exports = { packageWipeoutData, transferWipeoutData, appFiles, tarDestination };
