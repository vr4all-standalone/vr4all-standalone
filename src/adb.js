const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { parseDevices } = require('./core');

function findAdb(configured = '', options = {}) {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const resourcesPath = options.resourcesPath || process.resourcesPath;
  const candidates = [
    configured,
    process.env.ADB_PATH,
    resourcesPath && path.join(resourcesPath, 'platform-tools', exe),
    path.join(__dirname, '..', 'vendor', 'platform-tools', exe),
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', exe),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', exe),
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe),
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "MRSURVIV0R'S VR HUB", 'Tools', 'AndroidPlatformTools', 'platform-tools', exe),
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  const finder = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [exe], { encoding: 'utf8', windowsHide: true });
  return finder.status === 0 ? finder.stdout.trim().split(/\r?\n/)[0] : null;
}

function command(adbPath, args, onOutput = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(adbPath, args, { windowsHide: true, timeout: options.timeoutMs || 0 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; onOutput(String(chunk)); });
    child.stderr.on('data', (chunk) => { stderr += chunk; onOutput(String(chunk)); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim() || stderr.trim()) : reject(new Error((stderr || stdout || `ADB exited ${code}`).trim())));
  });
}

async function commandToFile(adbPath, args, destination, options = {}) {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) throw new Error('A binary transfer needs an expected size limit');
  const child = spawn(adbPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', processError, created = false, bytes = 0;
  const timer = setTimeout(() => {
    processError = new Error('ADB file transfer timed out. Keep the phone connected and unlocked, then retry.');
    child.kill();
  }, options.timeoutMs || 20 * 60 * 1000);
  timer.unref();
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-65536); });
  const closed = new Promise((resolve, reject) => {
    child.once('error', (error) => { processError = error; });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (processError) reject(processError);
      else if (code !== 0) reject(new Error(stderr.trim() || `ADB transfer failed (exit ${code}, signal ${signal || 'none'})`));
      else resolve();
    });
  });
  const limit = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    if (bytes > options.maxBytes) return done(new Error('The binary transfer exceeded its expected size limit'));
    try { options.onProgress?.(bytes); done(null, chunk); } catch (error) { done(error); }
  } });
  const output = fs.createWriteStream(destination, { flags: 'wx' });
  output.once('open', () => { created = true; });
  const transferred = pipeline(child.stdout, limit, output);
  try {
    await Promise.all([closed, transferred]);
    return bytes;
  } catch (error) {
    child.kill();
    await Promise.allSettled([closed, transferred]);
    if (created) await fsp.rm(destination, { force: true });
    throw error;
  }
}

function createAdb(getConfiguredPath = () => '') {
  function requiredPath() {
    const found = findAdb(getConfiguredPath());
    if (!found) throw new Error('ADB not found. Set its path in Settings or install Android Platform Tools.');
    return found;
  }
  return {
    getPath: () => findAdb(getConfiguredPath()),
    listDevices: async () => parseDevices(await command(requiredPath(), ['devices', '-l'])),
    run: (args, onOutput, options) => command(requiredPath(), args, onOutput, options),
    runToFile: (args, destination, options) => commandToFile(requiredPath(), args, destination, options),
  };
}

module.exports = { findAdb, createAdb, commandToFile };
