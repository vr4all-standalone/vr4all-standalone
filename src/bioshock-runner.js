// Runs the creator's signed-off Windows workflow without shipping game data.
// The official EXE owns preparation, rollback, APK installation, and transfer.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function validateBioShockGame(gamePath) {
  if (typeof gamePath !== 'string' || !path.isAbsolute(gamePath)) throw new Error('Choose your original BioShock 2007 game folder');
  const root = path.resolve(gamePath);
  const folder = await fs.lstat(root).catch(() => null);
  const exe = await fs.stat(path.join(root, 'Builds', 'Release', 'Bioshock.exe')).catch(() => null);
  const content = await fs.stat(path.join(root, 'Content')).catch(() => null);
  if (!folder?.isDirectory() || folder.isSymbolicLink() || !exe?.isFile() || !content?.isDirectory()) {
    throw new Error('Choose the original BioShock 2007 install containing Builds/Release/Bioshock.exe and Content (not Remastered)');
  }
  return root;
}

function checkedRelease(release) {
  if (!release || release.assetName !== 'BioShockVR-Setup.exe'
    || !/^https:\/\/github\.com\/terx1232\/BioShock-Quest-VR\/releases\/download\/[A-Za-z0-9._-]+\/BioShockVR-Setup\.exe$/.test(release.downloadUrl || '')) {
    throw new Error('The official BioShock VR Windows installer release is unavailable');
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(release.digest || '')) throw new Error('The official BioShock VR installer has no SHA-256 checksum');
  return release;
}

function driveBioShockInstaller(exePath, gamePath, serial, model, workspace, { spawnImpl = spawn, onLog = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(exePath, ['--workspace', workspace], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let transcript = '';
    let logBuffer = '';
    let failed = null;
    const answered = new Set();
    const end = (error) => { if (!failed) failed = error; child.kill(); };
    const reply = (name, value) => { if (answered.has(name)) return; answered.add(name); child.stdin.write(`${value}\n`); };
    const examine = () => {
      const game = transcript.match(/Game: ([^\r\n]+)\r?\n/);
      if (game && !answered.has('game-check')) {
        answered.add('game-check');
        if (path.resolve(game[1].trim()).toLowerCase() !== path.resolve(gamePath).toLowerCase()) {
          end(new Error('The creator installer selected a different BioShock folder. Move or remove the other detected copy, then retry with your chosen game folder.'));
          return;
        }
      }
      if (/Headset number \[1\]:\s*$/.test(transcript)) reply('headset', model === 'Quest 3S' ? '2' : '1');
      const devicePrompt = /Device number(?: \[1\])?; R [—-] refresh:\s*$/;
      if (devicePrompt.test(transcript) && !answered.has('device')) {
        const devices = [...transcript.matchAll(/(?:^|\n)\s*(\d+)\.\s+[^\r\n]*\[([A-Za-z0-9._:-]+)\]\r?(?=\n|$)/g)];
        const selected = devices.find((entry) => entry[2] === serial);
        if (!selected) { end(new Error('The selected Quest was not listed by the official BioShock installer')); return; }
        reply('device', selected[1]);
      }
      if (/Game folder:\s*$/.test(transcript)) reply('game-folder', gamePath);
      if (/Support the project on Ko-fi\? \[y\/N\]:\s*$/.test(transcript)) reply('donation', 'n');
      if (/Press Enter to close…\s*$/.test(transcript)) reply('close', '');
    };
    const read = (chunk) => {
      const value = String(chunk);
      transcript = (transcript + value).slice(-120000);
      const lines = (logBuffer + value).split(/\r?\n/);
      logBuffer = lines.pop().slice(-1000);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !/^\s*\d+\./.test(line)) onLog(line.slice(0, 450));
      }
      examine();
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (error) => { failed ||= error; });
    child.on('close', (code) => {
      if (failed) reject(failed);
      else if (code !== 0) reject(new Error(`Official BioShock installer exited ${code}: ${transcript.slice(-900)}`));
      else if (!answered.has('game-check')) reject(new Error('Official BioShock installer did not confirm the selected game folder'));
      else resolve();
    });
  });
}

async function installBioShock({ gamePath, serial, model, release, releases, workspaceRoot, adb,
  onLog = () => {}, runInstaller = driveBioShockInstaller }) {
  const game = await validateBioShockGame(gamePath);
  if (!/^[A-Za-z0-9._:-]+$/.test(serial || '')) throw new Error('Choose a connected Quest headset');
  if (!['Quest 3', 'Quest 3S'].includes(model)) throw new Error('The official BioShock VR installer supports Quest 3 and Quest 3S');
  checkedRelease(release);
  if (!releases?.downloadTool || !adb?.run) throw new Error('BioShock installation tools are unavailable');
  let shown = -1;
  onLog('Downloading the official BioShock VR installer (about 1 GB)...');
  const exe = await releases.downloadTool(release, (bytes, total) => {
    if (!total) return;
    const percent = Math.floor(bytes / total * 100 / 10) * 10;
    if (percent > shown) { shown = percent; onLog(`Official installer download: ${percent}%`); }
  });
  const base = path.resolve(workspaceRoot || path.join(require('node:os').tmpdir(), 'vr4all-bioshock'));
  await fs.mkdir(base, { recursive: true });
  const workspace = await fs.mkdtemp(path.join(base, 'bioshock-vr-'));
  let success = false;
  try {
    onLog(`Using ${workspace} for temporary BioShock build files.`);
    await runInstaller(exe, game, serial, model, workspace, { onLog });
    const receipt = JSON.parse(await fs.readFile(path.join(workspace, 'last-install.json'), 'utf8'));
    if (receipt.status !== 'installed' || receipt.serial !== serial || !receipt.version) {
      throw new Error('The official BioShock installer did not confirm installation on the selected headset');
    }
    const packagePath = await adb.run(['-s', serial, 'shell', 'pm', 'path', 'com.winlator.cmod']);
    if (!/^package:/m.test(packagePath)) throw new Error('BioShock installer reported success, but its Quest APK was not found');
    success = true;
    return { tag: release.tag, packageId: 'com.winlator.cmod', version: receipt.version };
  } finally {
    if (success) await fs.rm(workspace, { recursive: true, force: true });
    else onLog(`BioShock diagnostic and recovery files are in ${workspace}.`);
  }
}

module.exports = { validateBioShockGame, checkedRelease, driveBioShockInstaller, installBioShock };
