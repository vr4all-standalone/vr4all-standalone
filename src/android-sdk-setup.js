const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { acquireViceCitySource } = require('./vice-city-runner');
const { acquireSourceKit } = require('./personal-build');
const { withShortBuildPath } = require('./build-path');
const { buildEnvironment } = require('./build-environment');
const { withSharedBuildTools, findSharedJavaHome } = require('./shared-build-tools');

async function prepareSdkTools(kitDir, workDir, log, options = {}) {
  await fs.mkdir(path.join(workDir, '.tmp'), { recursive: true });
  // Electron can read embedded files through its ASAR-aware fs, but external
  // PowerShell needs a real file. Keep this copy private to the setup invocation.
  const helperDir = await fs.mkdtemp(path.join(workDir, '.vr4all-sdk-helper-'));
  const helper = path.join(helperDir, 'android-sdk-prepare.ps1');
  try {
    const source = ['rdr1-vr', 'gta-sa-vr'].includes(options.gameId) ? 'rdr-sdk-prepare.ps1' : 'android-sdk-prepare.ps1';
    await fs.writeFile(helper, await fs.readFile(path.join(__dirname, source)), { flag: 'wx' });
    return await prepareSdkToolsAtPath(kitDir, workDir, helper, log, { ...options, javaHome: await findSharedJavaHome(workDir) });
  } finally { await fs.rm(helperDir, { recursive: true, force: true }); }
}

function prepareSdkToolsAtPath(kitDir, workDir, helper, log, options) {
  return new Promise((resolve, reject) => {
    const child = (options.spawnImpl || spawn)('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
      '-KitScript', path.join(kitDir, 'tools', 'build-and-install.ps1'), '-WorkDir', workDir,
      ...(options.javaHome ? ['-JavaHome', options.javaHome] : []),
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: buildEnvironment(workDir) });
    let pending = '';
    let metadata;
    let processError;
    const record = (chunk) => {
      pending += String(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('VR4ALL_SDK_READY:')) {
          try { metadata = JSON.parse(line.slice('VR4ALL_SDK_READY:'.length)); } catch { processError = new Error('Build tool preparation returned invalid metadata'); }
        } else if (line.trim()) log(line.trim().slice(0, 500));
      }
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    child.once('error', (error) => { processError = error; });
    child.once('close', (code) => {
      if (pending) record('\n');
      if (processError) return reject(processError);
      if (code !== 0) return reject(new Error(`Build tool preparation failed (exit ${code}); see activity for details`));
      if (!metadata || !['javaExe', 'javaHome', 'classpath', 'sdkRoot'].every((key) => typeof metadata[key] === 'string' && path.isAbsolute(metadata[key]))
          || !Array.isArray(metadata.packages) || metadata.packages.length > 50
          || !metadata.packages.every((name) => typeof name === 'string' && /^[a-z][a-z0-9_.-]*(?:;[a-zA-Z0-9_.-]+)*$/.test(name))) {
        return reject(new Error('Build tool preparation returned unsupported SDK settings'));
      }
      resolve(metadata);
    });
  });
}

function runSdkManager(config, log, onLicense, options = {}) {
  const env = { ...buildEnvironment(path.dirname(config.sdkRoot)), JAVA_HOME: config.javaHome };
  return new Promise((resolve, reject) => {
    const child = (options.spawnImpl || spawn)(config.javaExe, [
      '-Xmx2048m', `-Djava.io.tmpdir=${env.TEMP}`, '-classpath', config.classpath, 'com.android.sdklib.tool.sdkmanager.SdkManagerCli',
      `--sdk_root=${config.sdkRoot}`, '--install', ...config.packages,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let licenseText = '';
    let truncated = false;
    let pendingDecision = false;
    let closed = false;
    let declined = false;
    let processError;
    let lineTail = '';
    child.stdin.on('error', (error) => { processError ||= error; });
    const record = (chunk) => {
      const text = String(chunk).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      licenseText += text;
      if (licenseText.length > 512 * 1024) { licenseText = licenseText.slice(-512 * 1024); truncated = true; }
      lineTail += text;
      const lines = lineTail.split(/[\r\n]+/);
      lineTail = (lines.pop() || '').slice(-1000);
      for (const line of lines) if (line.trim()) log(line.trim().slice(0, 500));
      if (pendingDecision || !/Accept\?\s*\(y\/n\)\s*:/i.test(licenseText)) return;
      pendingDecision = true;
      const decision = truncated
        ? Promise.reject(new Error('The SDK license is too long to display completely; setup stopped without accepting it'))
        : Promise.resolve().then(() => onLicense(licenseText.trim()));
      decision.then((accepted) => {
        if (closed) return;
        declined = accepted !== true;
        licenseText = ''; truncated = false; pendingDecision = false;
        if (declined) child.stdin.end('n\n');
        else child.stdin.write('y\n');
      }, (error) => {
        processError = error;
        if (!closed) { child.stdin.end('n\n'); child.kill(); }
      });
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    child.once('error', (error) => { processError = error; });
    child.once('close', (code) => {
      closed = true;
      if (lineTail.trim()) log(lineTail.trim().slice(0, 500));
      if (processError) reject(processError);
      else if (declined || pendingDecision) reject(new Error('Build tool setup cancelled; the license was not accepted'));
      else if (code !== 0) reject(new Error(`Android tool installation failed (exit ${code}); see activity for details`));
      else resolve();
    });
  });
}

async function setupBuildTools(roots, log, onLicense, options = {}) {
  const gameId = options.gameId || 'vice-city-vr';
  const titles = { 'vice-city-vr': 'Vice City', 'rdr1-vr': 'Red Dead Redemption', 'gta-sa-vr': 'GTA: San Andreas' };
  const title = titles[gameId];
  if (!Object.hasOwn(titles, gameId)) throw new Error('Choose a supported build tool setup');
  const workDir = path.join(roots.workRoot, gameId);
  await fs.mkdir(path.join(workDir, '.tmp'), { recursive: true });
  const acquire = gameId !== 'vice-city-vr' ? (cacheRoot, onLog, config) => acquireSourceKit(gameId, cacheRoot, onLog, config) : acquireViceCitySource;
  const kit = await (options.acquireKit || acquire)(roots.cacheRoot, log, options);
  return withSharedBuildTools(workDir, () => (options.withBuildPath || withShortBuildPath)(workDir, async (shortPath) => {
    const prepare = options.prepareTools || prepareSdkTools;
    const config = await prepare(kit.directory, shortPath, log, options);
    if (config.packages.length) {
      log(`Checking the licenses for the Android tools required by ${title}.`);
      await (options.installTools || runSdkManager)(config, log, onLicense, options);
      const verified = await prepare(kit.directory, shortPath, log, options);
      if (verified.packages.length) throw new Error(`Android tools are still missing: ${verified.packages.join(', ')}`);
    }
    log(`Build tools are ready. You can now build and install ${title}.`);
    return { sha: kit.sha };
  }, log, options), log);
}

module.exports = { prepareSdkTools, runSdkManager, setupViceCityTools: setupBuildTools, setupBuildTools };
