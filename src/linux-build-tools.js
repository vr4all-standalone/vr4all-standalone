const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { findOnPath } = require('./find-tool');
const { downloadPinned } = require('./pinned-download');
const { findLinuxJavaHome } = require('./shared-build-tools');

const runFile = promisify(execFile);
const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;
const PACKAGE_NAME = /^[a-z][a-z0-9_.-]*(?:;[a-zA-Z0-9_.-]+)*$/;
const MARKER_PATH = /^(?:platforms|build-tools|ndk|cmake|platform-tools)\/[A-Za-z0-9_.+/-]+$/;

// ---- Reading the pins out of the creator's own build-and-install.sh ----------------------------

function assignments(scope, name) {
  return [...scope.matchAll(new RegExp(`^[ \\t]*${name}="([^"\\n]*)"[ \\t]*\\r?$`, 'gm'))].map((match) => match[1]);
}

function single(scope, ...names) {
  for (const name of names) {
    const found = assignments(scope, name);
    if (found.length > 1) throw new Error(`The creator's build script declares ${name} more than once; VR4ALL cannot tell which to trust`);
    if (found.length === 1) return found[0];
  }
  return undefined;
}

// Pure: turns the text of a creator kit's tools/build-and-install.sh into pinned downloads and the
// SDK packages (with the files that prove each is installed) the script itself checks for.
function parseKitScript(text) {
  // GTA and RDR keep one block per host; Vice declares the Linux values flat.
  const block = text.match(/^[ \t]*Linux:x86_64\|Linux:amd64\)[ \t]*\r?\n([\s\S]*?)^[ \t]*;;/m)?.[1];
  const scope = block ?? text;
  const values = {};
  for (const name of ['JDK_VERSION', 'NDK_VERSION', 'CMAKE_VERSION']) values[name] = single(text, name);
  values.ANDROID_TOOLS_VERSION = values.ANDROID_CMDLINE_TOOLS_VERSION = single(text, 'ANDROID_TOOLS_VERSION', 'ANDROID_CMDLINE_TOOLS_VERSION');
  if (block) for (const name of ['JDK_ARCHIVE_NAME', 'ANDROID_ARCHIVE_NAME']) values[name] = single(block, name);
  const expand = (value) => {
    let result = value;
    for (let round = 0; round < 3; round++) result = result.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => values[key] ?? '\0');
    if (/[$\0]/.test(result)) throw new Error(`The creator's build script uses a value VR4ALL cannot resolve: ${value}`);
    return result;
  };
  const jdkSha = single(scope, 'JDK_SHA256');
  const cliSha = single(scope, 'ANDROID_TOOLS_SHA256', 'ANDROID_CMDLINE_TOOLS_SHA256');
  const jdkUrl = single(text, 'JDK_URL');
  const cliUrl = single(text, 'ANDROID_TOOLS_URL', 'ANDROID_CMDLINE_TOOLS_URL');
  if ([values.JDK_VERSION, values.ANDROID_TOOLS_VERSION, jdkSha, cliSha, jdkUrl, cliUrl].some((value) => !value)) {
    throw new Error('The creator\'s build script no longer declares the Linux JDK and Android command-line tools in the expected form');
  }
  const jdk = { version: values.JDK_VERSION, url: expand(jdkUrl), sha256: jdkSha.toUpperCase() };
  const cli = { version: values.ANDROID_TOOLS_VERSION, url: expand(cliUrl), sha256: cliSha.toUpperCase() };
  const basename = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop());
  jdk.archive = basename(jdk.url);
  cli.archive = basename(cli.url);
  for (const pin of [jdk, cli]) if (!/^[0-9A-F]{64}$/.test(pin.sha256)) throw new Error('The creator\'s build script has a malformed SHA-256 pin');
  if (!/^21\.\d+\.\d+\+\d+$/.test(jdk.version)
      || !jdk.url.startsWith('https://github.com/adoptium/temurin21-binaries/releases/download/')
      || !/^OpenJDK21U-jdk_x64_linux_hotspot_[0-9_.]+\.tar\.gz$/.test(jdk.archive)) {
    throw new Error('The creator\'s build script points at an unexpected JDK download');
  }
  if (!/^\d+$/.test(cli.version)
      || !cli.url.startsWith('https://dl.google.com/android/repository/commandlinetools-linux-')
      || !cli.url.endsWith('_latest.zip') || !cli.archive.includes(cli.version)) {
    throw new Error('The creator\'s build script points at an unexpected Android command-line tools download');
  }
  return { jdk, cli, requirements: parseRequirements(text, values) };
}

function parseRequirements(text, values) {
  const fn = text.match(/^(?:missing_sdk_packages|get_missing_sdk_packages)\(\) \{\r?\n([\s\S]*?)^\}/m)?.[1];
  if (!fn) throw new Error('The creator\'s build script no longer lists the Android SDK packages it needs');
  const body = fn.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  const expand = (value) => value.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_, key) => values[key] ?? '\0');
  const requirements = [];
  let last = 0;
  for (const echo of body.matchAll(/echo "([^"]+)"/g)) {
    const chunk = body.slice(last, echo.index);
    last = echo.index + echo[0].length;
    const markers = [...chunk.matchAll(/\[\s+(?:!\s+)?-([fd])\s+"\$(?:sdk|sdk_root)\/([^"]+)"/g)].map((match) => ({ kind: match[1], rel: expand(match[2]) }));
    const name = expand(echo[1]);
    if (!PACKAGE_NAME.test(name) || !markers.length || markers.some((marker) => !MARKER_PATH.test(marker.rel) || marker.rel.includes('..'))) {
      throw new Error(`The creator's build script has an Android SDK requirement VR4ALL cannot verify: ${echo[1]}`);
    }
    requirements.push({ package: name, markers });
  }
  if (!requirements.length) throw new Error('The creator\'s build script no longer lists the Android SDK packages it needs');
  return requirements;
}

async function readKitPins(kitDir) {
  const script = path.join(kitDir, 'tools', 'build-and-install.sh');
  const stat = await fs.lstat(script).catch(() => null);
  if (!stat?.isFile()) throw new Error('The downloaded creator kit has no tools/build-and-install.sh');
  return { script, ...parseKitScript(await fs.readFile(script, 'utf8')) };
}

// ---- Installing the JDK and command-line tools ------------------------------------------------

function requireTool(findTool, names, packageName) {
  const found = findTool(names);
  if (!found) throw new Error(`${names[0]} is required on Linux (package ${packageName}). Install it and retry.`);
  return found;
}

async function isJdk21(javaHome, run) {
  const output = async (tool) => {
    const { stdout, stderr } = await run(path.join(javaHome, 'bin', tool), ['-version'], { timeout: 30000 });
    return `${stdout}\n${stderr}`;
  };
  const java = await output('java').catch(() => '');
  const javac = await output('javac').catch(() => '');
  return /version "21(\.|")/.test(java) && /^javac\s+21(\.|$)/m.test(javac);
}

// Moves an unexpected leftover aside instead of deleting it.
async function moveAside(target) {
  if (await fs.lstat(target).then(() => true, () => false)) await fs.rename(target, `${target}.invalid-${crypto.randomUUID()}`);
}

async function ensureJdk(toolsDir, pin, options = {}) {
  const { findTool = findOnPath, runFile: run = runFile, log = () => {} } = options;
  const existing = await findLinuxJavaHome(toolsDir);
  if (existing) return existing;
  const tar = requireTool(findTool, ['tar'], 'tar');
  const archive = await downloadPinned({
    name: `Temurin JDK ${pin.version}`, url: pin.url, sha256: pin.sha256, maxBytes: MAX_ARCHIVE_BYTES,
    destination: path.join(toolsDir, '.downloads', pin.archive), fetchImpl: options.fetchImpl, signal: options.signal, log,
  });
  const staging = path.join(toolsDir, '.tools', `.extract-jdk-${crypto.randomUUID()}`);
  await fs.mkdir(staging, { recursive: true });
  try {
    log('Unpacking the JDK...');
    await run(tar, ['-xzf', archive, '-C', staging, '--strip-components=1'], { timeout: 10 * 60 * 1000 });
    if (!await isJdk21(staging, run)) throw new Error('The downloaded JDK did not report version 21');
    const target = path.join(toolsDir, '.tools', `jdk-${pin.version}-linux-x64`);
    await moveAside(target);
    await fs.rename(staging, target);
    return target;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function cliReady(cliDir) {
  const files = await Promise.all(['bin/sdkmanager', 'lib/sdkmanager-classpath.jar'].map((file) => fs.stat(path.join(cliDir, file)).catch(() => null)));
  return files.every((stat) => stat?.isFile() && stat.size);
}

async function ensureCommandLineTools(toolsDir, pin, options = {}) {
  const { findTool = findOnPath, runFile: run = runFile, log = () => {} } = options;
  const cliDir = path.join(toolsDir, '.android-sdk', 'cmdline-tools', pin.version);
  if (await cliReady(cliDir)) return cliDir;
  const unzip = requireTool(findTool, ['unzip'], 'unzip');
  const archive = await downloadPinned({
    name: `Android command-line tools ${pin.version}`, url: pin.url, sha256: pin.sha256, maxBytes: MAX_ARCHIVE_BYTES,
    destination: path.join(toolsDir, '.downloads', pin.archive), fetchImpl: options.fetchImpl, signal: options.signal, log,
  });
  // `unzip` keeps the executable bits that extractZipSafely drops.
  const staging = path.join(toolsDir, '.tools', `.extract-cli-${crypto.randomUUID()}`);
  await fs.mkdir(staging, { recursive: true });
  try {
    log('Unpacking the Android command-line tools...');
    await run(unzip, ['-q', '-o', archive, '-d', staging], { timeout: 10 * 60 * 1000 });
    const unpacked = path.join(staging, 'cmdline-tools');
    if (!await cliReady(unpacked)) throw new Error('The Android command-line tools archive has an unexpected layout');
    for (const name of await fs.readdir(path.join(unpacked, 'bin'))) await fs.chmod(path.join(unpacked, 'bin', name), 0o755);
    await fs.mkdir(path.dirname(cliDir), { recursive: true });
    await moveAside(cliDir);
    await fs.rename(unpacked, cliDir);
    return cliDir;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

// ---- Checking what is already installed --------------------------------------------------------

async function markerReady(sdkRoot, { kind, rel }) {
  const target = path.join(sdkRoot, rel);
  if (kind === 'f') {
    const stat = await fs.stat(target).catch(() => null);
    return Boolean(stat?.isFile() && stat.size);
  }
  // A folder alone survives a download that stopped part way; require the file SDK Manager writes last.
  const stat = await fs.stat(path.join(target, 'source.properties')).catch(() => null);
  return Boolean(stat?.isFile() && stat.size);
}

async function missingSdkPackages(sdkRoot, requirements) {
  const missing = [];
  for (const requirement of requirements) {
    if (!(await Promise.all(requirement.markers.map((marker) => markerReady(sdkRoot, marker)))).every(Boolean)) missing.push(requirement.package);
  }
  return missing;
}

// Linux twin of the PowerShell helper: ensure the JDK and command-line tools, then list the SDK
// packages SDK Manager still has to install. Same shape as the helper's VR4ALL_SDK_READY line.
async function prepareSdkToolsLinux(kitDir, toolsDir, log, options = {}) {
  for (const name of ['.tmp', '.downloads', '.tools', '.android-sdk']) await fs.mkdir(path.join(toolsDir, name), { recursive: true });
  const pins = await readKitPins(kitDir);
  const settings = { ...options, log };
  const javaHome = await ensureJdk(toolsDir, pins.jdk, settings);
  const cliDir = await ensureCommandLineTools(toolsDir, pins.cli, settings);
  const sdkRoot = path.join(toolsDir, '.android-sdk');
  return {
    javaExe: path.join(javaHome, 'bin', 'java'), javaHome,
    classpath: path.join(cliDir, 'lib', 'sdkmanager-classpath.jar'), sdkRoot,
    packages: await missingSdkPackages(sdkRoot, pins.requirements),
  };
}

// ---- Preflight and arguments for running the creator's script -----------------------------------

const BASE_TOOLS = [['bash', 'bash'], ['curl', 'curl'], ['unzip', 'unzip'], ['tar', 'tar'], ['awk', 'gawk'], ['sha256sum', 'coreutils']];

async function checkHostTools(gameId, options = {}) {
  const { findTool = findOnPath, runFile: run = runFile, needsXz = false } = options;
  const missing = [];
  const need = (name, packageName) => { if (!findTool([name])) missing.push(`${name} (package ${packageName})`); };
  for (const [name, packageName] of BASE_TOOLS) need(name, packageName);
  if (gameId === 'vice-city-vr') need('git', 'git');
  if (needsXz) need('xz', 'xz');
  const python = findTool(['python3', 'python']);
  const bash = findTool(['bash']);
  if (gameId !== 'vice-city-vr') {
    if (!python) missing.push('python3 (package python)');
    else if (!await run(python, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)']).then(() => true, () => false)) missing.push('python 3.10 or newer (package python)');
  } else if (bash) {
    // The Vice script uses ${var,,} and associative arrays.
    const major = await run(bash, ['-c', 'echo ${BASH_VERSINFO[0]}']).then(({ stdout }) => Number(stdout.trim()), () => 0);
    if (major < 4) missing.push('bash 4 or newer (package bash)');
  }
  if (missing.length) throw new Error(`Missing system tools needed to build on Linux: ${missing.join(', ')}. Install them and retry.`);
}

// Without this the creator's script dies half way, or (RDR) runs its own stricter license check.
async function assertLinuxToolsReady(kitDir, toolsDir) {
  const pins = await readKitPins(kitDir);
  const javaHome = await findLinuxJavaHome(toolsDir);
  const sdkRoot = path.join(toolsDir, '.android-sdk');
  const cliDir = path.join(sdkRoot, 'cmdline-tools', pins.cli.version);
  if (!javaHome || !await cliReady(cliDir) || (await missingSdkPackages(sdkRoot, pins.requirements)).length) {
    throw new Error('Build tools are not set up. Click "Set up build tools" first.');
  }
  return { javaHome, sdkRoot };
}

// Linux twin of buildPowerShellArgs. GTA also needs --yes in non-interactive mode; RDR and Vice reject it.
function buildShellArgs(gameId, input, kitDir, { toolsDir, javaHome, sdkRoot }) {
  const script = path.join(kitDir, 'tools', 'build-and-install.sh');
  const shared = ['--work-dir', toolsDir, '--android-sdk', sdkRoot, '--java-home', javaHome];
  if (gameId === 'vice-city-vr') return [script, '--game-dir', input.gamePath, '--serial', input.serial, '--non-interactive', ...shared];
  if (gameId === 'gta-sa-vr') return [script, '--game-package', input.gamePackage, '--audio-source', input.audioSource, ...shared, '--serial', input.serial, '--non-interactive', '--yes'];
  return [script, '--game-package', input.gamePackage, ...shared, '--serial', input.serial, '--non-interactive'];
}

// curl's progress meter (header, units, and one numeric row per update) is noise in the activity log.
function isCurlMeterLine(line) {
  return /^\s*(?:%\s+Total|Dload|\d+\s+[\d.kMGT]+\s+\d+)/.test(line);
}

module.exports = {
  parseKitScript, readKitPins, ensureJdk, ensureCommandLineTools, missingSdkPackages, prepareSdkToolsLinux,
  checkHostTools, assertLinuxToolsReady, buildShellArgs, isCurlMeterLine,
};
