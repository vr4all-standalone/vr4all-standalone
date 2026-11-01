const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

// Node port of the creator's Install-Quest.ps1 (Animal Crossing Quest, tag quest-v0.1.0-build14). The creator's
// device_data.py is not used: it bounds the on-device hash of the ~1.4 GB image at 60 s and does not install the APK.
// The Quest model check (step 1) is already done by requireSingleQuest3Family.
const PKG = 'com.liquidazir.animalcrossingquest';
const MARKER = '__ACQUEST_INSTALL_OK__';
const ROM_EXTENSIONS = ['.iso', '.gcm', '.ciso'];
const LONG = { timeoutMs: 10 * 60 * 1000 };
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const RUNNING = 'Animal Crossing is running on the Quest. Save and quit, then close the app before retrying. The installer will not force-stop your game.';

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyApk(apk) {
  const sums = await fs.readFile(path.join(path.dirname(apk), 'SHA256SUMS.txt'), 'utf8').catch(() => '');
  const lines = sums.split(/\r?\n/).map((line) => /^([0-9a-fA-F]{64})\s+\*?AnimalCrossing-Quest\.apk\s*$/.exec(line)).filter(Boolean);
  if (lines.length !== 1 || lines[0][1].toLowerCase() !== await sha256File(apk)) {
    throw new Error('The APK does not match SHA256SUMS.txt. Download and extract a fresh complete release ZIP.');
  }
}

async function readAt(handle, offset) {
  const header = Buffer.alloc(32);
  const { bytesRead } = await handle.read(header, 0, 32, offset);
  return bytesRead === 32 ? header : null;
}

// USA Rev 0 only (GAFE01, disc 0, revision 0, GameCube magic at 0x1C); a CISO wraps the same header at 0x8000.
async function assertCompatibleRom(rom) {
  if (!ROM_EXTENSIONS.includes(path.extname(rom).toLowerCase())) {
    throw new Error('Choose your own USA Rev 0 Animal Crossing .iso, .gcm, or .ciso dump; RVZ/ZIP files are not supported.');
  }
  const handle = await fs.open(rom, 'r');
  try {
    let header = await readAt(handle, 0);
    if (!header) throw new Error('The disc image is incomplete.');
    if (header.toString('latin1', 0, 4) === 'CISO') {
      if (header.readUInt32LE(4) < 32 || header[8] === 0) throw new Error('Invalid CISO disc header.');
      header = await readAt(handle, 32768);
      if (!header) throw new Error('The CISO disc image is incomplete.');
    }
    if (header.toString('latin1', 0, 6) !== 'GAFE01' || header[6] !== 0 || header[7] !== 0 || !header.subarray(28, 32).equals(Buffer.from([0xc2, 0x33, 0x9f, 0x3d]))) {
      throw new Error('This build requires Animal Crossing USA, revision 0 (GAFE01_00). The selected file has a different or invalid disc header.');
    }
  } finally { await handle.close(); }
}

async function installAnimalCrossingLinux({ apk, gamePath, serial, adb, onLog = () => {} }) {
  const S = ['-s', serial];
  await verifyApk(apk);

  // exec-out does not reliably return the remote exit code, so success is the marker the script prints last.
  async function inApp(script, options) {
    const out = await adb.run([...S, 'exec-out', 'run-as', PKG, 'sh', '-c', `set -eu\n${script}\nprintf '${MARKER}\\n'`], undefined, options);
    if (!out.endsWith(MARKER)) throw new Error('Quest app-storage command failed. ' + out);
    return out.slice(0, -MARKER.length).trim();
  }
  const remoteExists = async (file) => {
    const answer = await inApp(`if [ -e ${file} ] || [ -L ${file} ]; then echo yes; else echo no; fi`);
    if (answer !== 'yes' && answer !== 'no') throw new Error('Quest app-storage command failed. ' + answer);
    return answer === 'yes';
  };
  const assertStopped = async () => {
    if ((await adb.run([...S, 'shell', `pidof ${PKG} || true`])).trim()) throw new Error(RUNNING);
  };
  const remoteInfo = async (file) => {
    const lines = (await inApp(`sha256sum ${file}\nwc -c < ${file}`, LONG)).split(/\r?\n/);
    const hash = /^([0-9a-fA-F]{64})\s/.exec(lines[0] || '');
    const size = /^\s*(\d+)\s*$/.exec(lines[1] || '');
    return hash && size ? { sha256: hash[1].toLowerCase(), bytes: Number(size[1]) } : null;
  };

  await assertStopped();
  onLog('Installing the Animal Crossing Quest app (your saves and settings are kept)...');
  let installed;
  try { installed = await adb.run([...S, 'install', '-r', apk]); } catch (error) { installed = error.message; }
  if (!/^Success\s*$/m.test(installed)) {
    throw new Error('APK installation failed. Do not uninstall to work around an update/signing error; export saves first. ' + installed);
  }
  await assertStopped();

  if (!(await inApp('pwd')).endsWith('/' + PKG)) throw new Error('Unexpected private app-storage directory; no game data was changed.');
  const existing = await inApp('if [ -d files/rom ]; then find files/rom -maxdepth 1 -type f -print; fi');
  if (existing.split(/\r?\n/).some((line) => /\.(iso|gcm|ciso)$/i.test(line.trim()))) {
    onLog('Your existing Quest ROM, saves, and settings have been kept. No game data was imported.');
    return {};
  }

  await assertCompatibleRom(gamePath);
  onLog('Hashing the disc image...');
  const local = { sha256: await sha256File(gamePath), bytes: (await fs.stat(gamePath)).size };
  const destination = 'files/rom/AnimalCrossing' + path.extname(gamePath).toLowerCase();
  const temporary = `files/rom/.acquest-import-${crypto.randomBytes(16).toString('hex')}.tmp`;
  const matches = (info) => info && info.sha256 === local.sha256 && info.bytes === local.bytes;

  try {
    await assertStopped();
    await inApp('mkdir -p files/rom');
    if (await remoteExists(destination)) throw new Error('A Quest ROM appeared during setup; it has been kept. Close the game and run the installer again.');
    onLog(`Sending the disc image to the headset (${(local.bytes / 1024 ** 2).toFixed(0)} MiB)...`);
    let decile = 0;
    try {
      await adb.runWithInput([...S, 'exec-in', 'run-as', PKG, 'sh', '-c', `umask 077; cat > ${temporary}`], gamePath, {
        timeoutMs: UPLOAD_TIMEOUT_MS,
        onProgress: (sent) => { const reached = Math.floor(sent / local.bytes * 10); if (reached > decile) { decile = reached; onLog(`Sent ${decile * 10}%`); } },
      });
    } catch (error) { throw new Error('ROM transfer failed. ' + error.message); }
    onLog('Verifying the copy on the headset...');
    if (!matches(await remoteInfo(temporary))) throw new Error('ROM transfer verification failed; the incomplete copy will be removed.');
    await assertStopped();
    await inApp(`mv -n ${temporary} ${destination}`, LONG);
    if (await remoteExists(temporary)) throw new Error('A Quest ROM appeared during the transfer; the existing file was kept.');
    if (!matches(await remoteInfo(destination))) throw new Error('Final ROM verification failed.');
  } finally {
    await inApp(`rm -f ${temporary}`).catch(() => {});
  }
  onLog('ROM import verified. Your PC files and existing Quest saves/settings were not changed.');
  onLog('Ready. In your Quest library, open Unknown Sources, then Animal Crossing.');
  return {};
}

module.exports = { installAnimalCrossingLinux, assertCompatibleRom };
