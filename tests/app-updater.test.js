const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { availableUpdate, AppUpdater, replacementArgs, installApprovedUpdate, startReplacement } = require('../desktop/app-updater');

const asset = (version = '0.3.46', overrides = {}) => ({
  tag: `v${version}-beta`,
  assetName: `VR4ALL-${version}-win-x64.exe`,
  downloadUrl: `https://github.com/vr4all-standalone/vr4all-standalone/releases/download/v${version}-beta/VR4ALL-${version}-win-x64.exe`,
  url: `https://github.com/vr4all-standalone/vr4all-standalone/releases/tag/v${version}-beta`,
  digest: `sha256:${'a'.repeat(64)}`,
  size: 173062426,
  stale: false,
  ...overrides,
});

test('app update accepts only a newer matching VR4ALL portable release', () => {
  assert.equal(availableUpdate('0.3.45', asset()).version, '0.3.46');
  assert.equal(availableUpdate('0.3.46', asset()), null);
  assert.equal(availableUpdate('0.3.47', asset()), null);
  assert.equal(availableUpdate('0.3.45', asset('0.3.46', { assetName: 'VR4ALL-0.3.47-win-x64.exe' })), null);
  assert.equal(availableUpdate('0.3.45', asset('0.3.46', { downloadUrl: 'https://example.com/VR4ALL-0.3.46-win-x64.exe' })), null);
  assert.equal(availableUpdate('0.3.45', asset('0.3.46', { stale: true })), null);
  assert.equal(availableUpdate('0.3.45', asset('0.3.46', { digest: null })), null);
  assert.equal(availableUpdate('0.3.45', asset('0.3.46', { size: null }))?.version, '0.3.46', 'GitHub public-page fallback omits size but retains the digest');
});

test('a newer release can use a stable VR4ALL executable name', () => {
  const release = asset('0.3.52', {
    assetName: 'VR4ALL-win-x64.exe',
    downloadUrl: 'https://github.com/vr4all-standalone/vr4all-standalone/releases/download/v0.3.52-beta/VR4ALL-win-x64.exe',
  });
  assert.equal(availableUpdate('0.3.51', release)?.version, '0.3.52');
});

test('desktop update check uses the fixed official repository and verified EXE downloader', async () => {
  const calls = [];
  const releases = {
    async latest(source, options) { calls.push({ source, options }); return asset(); },
    async downloadTool(release, onProgress) { calls.push({ release }); onProgress(50, 100); return 'C:\\Updates\\verified.exe'; },
  };
  const updater = new AppUpdater({ releases, currentVersion: '0.3.45', portablePath: 'C:\\Games\\My VR4ALL.exe', platform: 'win32' });
  const update = await updater.check();
  assert.deepEqual(update, { available: true, version: '0.3.46', currentVersion: '0.3.45', url: asset().url, size: asset().size });
  assert.equal(calls[0].source.repo, 'vr4all-standalone/vr4all-standalone');
  assert.match(calls[0].source.assetPattern, /VR4ALL/);
  const progress = [];
  assert.equal(await updater.download((done, total) => progress.push([done, total])), 'C:\\Updates\\verified.exe');
  assert.deepEqual(progress, [[50, 100]]);
  assert.equal(calls[1].release.digest, asset().digest);
});

test('an unpacked app does not offer in-place self-update', async () => {
  const updater = new AppUpdater({ releases: { latest() { throw new Error('should not fetch'); } }, currentVersion: '0.3.45', portablePath: '', platform: 'win32' });
  assert.deepEqual(await updater.check(), { available: false, supported: false });
});

test('a newer release without a verified digest is reported as unavailable, not up to date', async () => {
  const updater = new AppUpdater({ releases: { async latest() { return asset('0.3.46', { digest: null }); } },
    currentVersion: '0.3.45', portablePath: 'C:\\VR4ALL.exe', platform: 'win32' });
  await assert.rejects(updater.check(), /cannot verify/i);
  assert.equal(updater.pending, null);
});

test('missing GitHub release metadata is an error rather than an up-to-date result', async () => {
  const updater = new AppUpdater({ releases: { async latest() { return null; } },
    currentVersion: '0.3.45', portablePath: 'C:\\VR4ALL.exe', platform: 'win32' });
  await assert.rejects(updater.check(), /could not verify/i);
});

test('replacement helper arguments preserve a renamed portable path and exact digest', () => {
  const args = replacementArgs({ scriptPath: 'C:\\Data\\update-helper.ps1', targetPath: 'D:\\Apps\\My VR4ALL.exe', candidatePath: 'C:\\Data\\verified.exe', appPid: 312, digest: asset().digest, reportPath: 'C:\\Data\\update-status.txt' });
  assert.deepEqual(args.slice(0, 7), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File']);
  assert.equal(args[7], 'C:\\Data\\update-helper.ps1');
  assert.equal(args[args.indexOf('-Target') + 1], 'D:\\Apps\\My VR4ALL.exe');
  assert.equal(args[args.indexOf('-ExpectedSha256') + 1], 'a'.repeat(64));
  assert.equal(path.win32.basename(args[args.indexOf('-Candidate') + 1]), 'verified.exe');
  assert.equal(args.includes('-LauncherPid'), false);
});

test('Windows handoff replaces the portable file and records success', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows helper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr4all-update-test-'));
  t.after(() => { if (dir.startsWith(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true }); });
  const target = path.join(dir, 'My VR4ALL.exe');
  const candidate = path.join(dir, 'new.exe');
  const report = path.join(dir, 'status.txt');
  fs.writeFileSync(target, 'old executable');
  fs.writeFileSync(candidate, 'new executable');
  const digest = crypto.createHash('sha256').update('new executable').digest('hex');
  const script = path.join(__dirname, '..', 'desktop', 'update-helper.ps1');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Target', target, '-Candidate', candidate, '-AppPid', '999998', '-ExpectedSha256', digest,
    '-ReportPath', report, '-SkipLaunch'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, [result.stderr, result.stdout, fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : 'no report'].filter(Boolean).join('\n'));
  assert.equal(fs.readFileSync(target, 'utf8'), 'new executable');
  assert.match(fs.readFileSync(report, 'utf8'), /updated/i);
});

test('Windows handoff leaves the old portable file intact on checksum failure', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows helper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr4all-update-test-'));
  t.after(() => { if (dir.startsWith(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true }); });
  const target = path.join(dir, 'VR4ALL.exe');
  const candidate = path.join(dir, 'new.exe');
  const report = path.join(dir, 'status.txt');
  fs.writeFileSync(target, 'old executable');
  fs.writeFileSync(candidate, 'untrusted executable');
  const script = path.join(__dirname, '..', 'desktop', 'update-helper.ps1');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Target', target, '-Candidate', candidate, '-AppPid', '999998', '-ExpectedSha256', '0'.repeat(64),
    '-ReportPath', report, '-SkipLaunch'], { encoding: 'utf8', timeout: 20000 });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old executable');
  assert.match(fs.readFileSync(report, 'utf8'), /failed/i);
});

test('app updater never closes VR4ALL while game installs are active or approval is declined', async () => {
  let confirmed = 0;
  let downloaded = 0;
  let replaced = 0;
  let quit = 0;
  const updater = { pending: asset(), portablePath: 'C:\\VR4ALL.exe', async download() { downloaded++; return 'C:\\new.exe'; } };
  const options = { updater, getActiveJobs: () => [{ status: 'running' }], confirm: async () => { confirmed++; return true; },
    startReplacement: async () => { replaced++; }, quit: () => { quit++; } };
  await assert.rejects(installApprovedUpdate(options), /Finish the current game installs/i);
  assert.deepEqual([confirmed, downloaded, replaced, quit], [0, 0, 0, 0]);
  options.getActiveJobs = () => [];
  options.confirm = async () => { confirmed++; return false; };
  assert.deepEqual(await installApprovedUpdate(options), { cancelled: true });
  assert.deepEqual([confirmed, downloaded, replaced, quit], [1, 0, 0, 0]);
});

test('approved app update downloads before launching replacement and quitting', async () => {
  const actions = [];
  const updater = { pending: asset(), portablePath: 'D:\\Apps\\VR4ALL.exe', async download(onProgress) { actions.push('download'); onProgress(50, 100); return 'C:\\new.exe'; } };
  const result = await installApprovedUpdate({ updater, getActiveJobs: () => [], confirm: async () => { actions.push('confirm'); return true; },
    onProgress: (done, total) => actions.push(`progress:${done}/${total}`),
    startReplacement: async (input) => { actions.push(`replace:${input.targetPath}:${input.candidatePath}`); },
    quit: () => actions.push('quit') });
  assert.deepEqual(result, { started: true });
  assert.deepEqual(actions, ['confirm', 'download', 'progress:50/100', 'replace:D:\\Apps\\VR4ALL.exe:C:\\new.exe', 'quit']);
});

test('a game install that starts during the app download prevents restart', async () => {
  let jobs = [];
  let replaced = false;
  let quit = false;
  const updater = { pending: asset(), portablePath: 'C:\\VR4ALL.exe', async download() { jobs = [{ status: 'running' }]; return 'C:\\new.exe'; } };
  await assert.rejects(installApprovedUpdate({ updater, getActiveJobs: () => jobs, confirm: async () => true,
    startReplacement: async () => { replaced = true; }, quit: () => { quit = true; } }), /Finish the current game installs/i);
  assert.equal(replaced, false);
  assert.equal(quit, false);
});

test('handoff stages its bundled helper and launches hidden PowerShell before quitting', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows handoff');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr4all-handoff-test-'));
  t.after(() => { if (dir.startsWith(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true }); });
  const targetPath = path.join(dir, 'Renamed VR4ALL.exe');
  const candidatePath = path.join(dir, 'downloaded.exe');
  fs.writeFileSync(targetPath, 'previous release');
  fs.writeFileSync(candidatePath, 'new release');
  let launch;
  const spawnProcess = (file, args, options) => {
    launch = { file, args, options };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from('started:12345\n')); child.emit('close', 0); });
    return child;
  };
  const report = await startReplacement({ targetPath, candidatePath, digest: asset().digest, dataDir: path.join(dir, 'data'),
    appPid: 222, spawnProcess });
  assert.match(launch.file, /powershell\.exe$/i);
  assert.equal(launch.options.windowsHide, true);
  assert.match(launch.args[launch.args.indexOf('-CommandLine') + 1], /Renamed VR4ALL\.exe/);
  assert.match(fs.readFileSync(path.join(dir, 'data', 'updates', 'update-helper-222.ps1'), 'utf8'), /Move-Item/);
  assert.equal(path.basename(report), 'last-update.txt');
});

test('handoff reports bootstrap failure instead of closing the app', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows handoff');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr4all-handoff-fail-'));
  t.after(() => { if (dir.startsWith(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true }); });
  const targetPath = path.join(dir, 'VR4ALL.exe');
  const candidatePath = path.join(dir, 'downloaded.exe');
  fs.writeFileSync(targetPath, 'previous release');
  fs.writeFileSync(candidatePath, 'new release');
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => {
      child.emit('spawn');
      child.stderr.emit('data', Buffer.from('Windows could not start the updater'));
      child.emit('close', 1);
    });
    return child;
  };
  await assert.rejects(startReplacement({ targetPath, candidatePath, digest: asset().digest,
    dataDir: path.join(dir, 'data'), appPid: 222, spawnProcess }),
  /could not start the updater/i);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'previous release');
});
