const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const APP_SOURCE = Object.freeze({
  repo: 'vr4all-standalone/vr4all-standalone',
  assetPattern: '^VR4ALL-\\d+\\.\\d+\\.\\d+-win-x64\\.exe$',
  releasePattern: '^VR4ALL v\\d+\\.\\d+\\.\\d+|^v\\d+\\.\\d+\\.\\d+',
});

function versionParts(version) {
  const match = String(version || '').match(/^v?(\d+)\.(\d+)\.(\d+)(?:-beta)?$/i);
  return match ? match.slice(1, 4).map(Number) : null;
}

function newerVersion(current, next) {
  const left = versionParts(current);
  const right = versionParts(next);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) {
    if (right[index] !== left[index]) return right[index] > left[index];
  }
  return false;
}

function availableUpdate(currentVersion, release) {
  if (!release || release.stale) return null;
  const tag = String(release.tag || '');
  const match = tag.match(/^v(\d+\.\d+\.\d+)(?:-beta)?$/i);
  if (!match || !newerVersion(currentVersion, match[1])) return null;
  const version = match[1];
  const assetName = `VR4ALL-${version}-win-x64.exe`;
  if (release.assetName !== assetName || !/^sha256:[a-f0-9]{64}$/i.test(release.digest || '')
    || release.size != null && (!Number.isSafeInteger(release.size) || release.size < 1024 * 1024 || release.size > 2 * 1024 ** 3)) return null;
  const expected = `https://github.com/vr4all-standalone/vr4all-standalone/releases/download/${tag}/${assetName}`;
  if (release.downloadUrl !== expected) return null;
  return { version, release };
}

function replacementArgs({ scriptPath, targetPath, candidatePath, appPid, launcherPid, digest, reportPath }) {
  if (!/^sha256:[a-f0-9]{64}$/i.test(digest || '')) throw new Error('App update checksum is missing');
  if (![scriptPath, targetPath, candidatePath, reportPath].every((value) => path.win32.isAbsolute(value || ''))) throw new Error('App update paths must be absolute');
  if (!Number.isSafeInteger(appPid) || appPid <= 0 || !Number.isSafeInteger(launcherPid) || launcherPid <= 0) throw new Error('App update process IDs are invalid');
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    '-Target', targetPath, '-Candidate', candidatePath, '-AppPid', String(appPid), '-LauncherPid', String(launcherPid),
    '-ExpectedSha256', digest.slice(7).toLowerCase(), '-ReportPath', reportPath];
}

class AppUpdater {
  constructor({ releases, currentVersion, portablePath, platform = process.platform }) {
    this.releases = releases;
    this.currentVersion = currentVersion;
    this.portablePath = portablePath;
    this.platform = platform;
    this.pending = null;
  }

  async check() {
    this.pending = null;
    if (this.platform !== 'win32' || !path.win32.isAbsolute(this.portablePath || '')
      || path.win32.extname(this.portablePath).toLowerCase() !== '.exe') return { available: false, supported: false };
    const release = await this.releases.latest(APP_SOURCE, { force: true });
    if (!release) throw new Error('Could not verify the current VR4ALL release on GitHub. Try again later.');
    const update = availableUpdate(this.currentVersion, release);
    if (!update) {
      if (newerVersion(this.currentVersion, release?.tag)) throw new Error('A newer VR4ALL release was found, but this app cannot verify its Windows EXE. Download it from the official release page.');
      return { available: false, supported: true };
    }
    this.pending = update.release;
    return { available: true, version: update.version, currentVersion: this.currentVersion, url: release.url, size: release.size };
  }

  async download(onProgress = () => {}) {
    if (!this.pending || !availableUpdate(this.currentVersion, this.pending)) throw new Error('Check for a current VR4ALL release before updating');
    return this.releases.downloadTool(this.pending, onProgress);
  }
}

async function installApprovedUpdate({ updater, getActiveJobs, confirm, onProgress = () => {}, startReplacement, quit }) {
  if (getActiveJobs().some((job) => job.status === 'running' || job.status === 'queued')) {
    throw new Error('Finish the current game installs before updating VR4ALL.');
  }
  if (!updater.pending) throw new Error('Check for a VR4ALL update first.');
  if (!await confirm(updater.pending)) return { cancelled: true };
  if (getActiveJobs().some((job) => job.status === 'running' || job.status === 'queued')) {
    throw new Error('Finish the current game installs before updating VR4ALL.');
  }
  const candidatePath = await updater.download(onProgress);
  if (getActiveJobs().some((job) => job.status === 'running' || job.status === 'queued')) {
    throw new Error('Finish the current game installs before updating VR4ALL.');
  }
  await startReplacement({ targetPath: updater.portablePath, candidatePath, digest: updater.pending.digest });
  quit();
  return { started: true };
}

async function startReplacement({ targetPath, candidatePath, digest, dataDir, appPid = process.pid, launcherPid = process.ppid, spawnProcess = spawn }) {
  if (process.platform !== 'win32') throw new Error('VR4ALL self-update requires Windows');
  if (!path.win32.isAbsolute(targetPath || '') || !path.win32.isAbsolute(candidatePath || '')) throw new Error('Invalid portable update path');
  const updateDir = path.join(dataDir, 'updates');
  await fs.mkdir(updateDir, { recursive: true });
  const probe = path.join(path.dirname(targetPath), `.vr4all-update-probe-${crypto.randomUUID()}`);
  const handle = await fs.open(probe, 'wx');
  await handle.close();
  await fs.unlink(probe);
  const scriptPath = path.join(updateDir, `update-helper-${appPid}.ps1`);
  const reportPath = path.join(updateDir, 'last-update.txt');
  await fs.writeFile(scriptPath, await fs.readFile(path.join(__dirname, 'update-helper.ps1')));
  const args = replacementArgs({ scriptPath, targetPath, candidatePath, appPid, launcherPid, digest, reportPath });
  const powershellPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawnProcess(powershellPath, args, { windowsHide: true, detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  return reportPath;
}

module.exports = { APP_SOURCE, availableUpdate, AppUpdater, replacementArgs, installApprovedUpdate, startReplacement };
