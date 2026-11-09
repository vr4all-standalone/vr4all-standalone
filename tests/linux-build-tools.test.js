const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  parseKitScript, readKitPins, ensureJdk, ensureCommandLineTools, missingSdkPackages, prepareSdkToolsLinux,
  checkHostTools, assertLinuxToolsReady, buildShellArgs,
} = require('../src/linux-build-tools');

const JDK_SHA = '4B2220E232A97997B436CA6AB15CBF70171ECFF52958A46159DFA5A8C44CA4DE';
const CLI_SHA = '4E4C464F145A7512B57D088AC6C278C03C9EEA610886B35A5E0804E74EEDF583';

// Verbatim lines from the creator kits (gta-sa-vr-quest 7aab464, rdr1-quest 124f06e, vice-city-vr-quest 768d2b7).
const GTA_HEAD = `JDK_VERSION="21.0.11+10"
ANDROID_TOOLS_VERSION="15859902"
PLATFORM_TOOLS_VERSION="37.0.1"
NDK_VERSION="27.2.12479018"
CMAKE_VERSION="3.22.1"

configure_host_downloads() {
  local kernel arch
  case "$kernel:$arch" in
    Linux:x86_64|Linux:amd64)
      JDK_ARCHIVE_NAME="OpenJDK21U-jdk_x64_linux_hotspot_21.0.11_10.tar.gz"
      JDK_SHA256="${JDK_SHA}"
      ANDROID_ARCHIVE_NAME="commandlinetools-linux-\${ANDROID_TOOLS_VERSION}_latest.zip"
      ANDROID_TOOLS_SHA256="${CLI_SHA}"
      HOST_TAG="linux-x64"
      ;;
    Darwin:x86_64)
      JDK_ARCHIVE_NAME="OpenJDK21U-jdk_x64_mac_hotspot_21.0.11_10.tar.gz"
      JDK_SHA256="34180EB03E6D207C388CCE3DA668F6CC7CD7508C185C24782FADAC2C9C0E66F9"
      ANDROID_ARCHIVE_NAME="commandlinetools-mac_x86_64-\${ANDROID_TOOLS_VERSION}_latest.zip"
      ANDROID_TOOLS_SHA256="C5A6378AB5CF7E0D5701921405115BEFFF13E9FF7417FB588389338F8BD050F3"
      HOST_TAG="mac-x64"
      ;;
  esac
  JDK_URL="https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/\${JDK_ARCHIVE_NAME}"
  ANDROID_TOOLS_URL="https://dl.google.com/android/repository/\${ANDROID_ARCHIVE_NAME}"
}
`;
const GTA_KIT = `${GTA_HEAD}
missing_sdk_packages() {
  local sdk="$1"
  [ -f "$sdk/platforms/android-35/android.jar" ] || echo "platforms;android-35"
  if [ ! -f "$sdk/build-tools/35.0.0/aapt2" ] ||
     [ ! -f "$sdk/build-tools/35.0.0/apksigner" ] ||
     [ ! -f "$sdk/build-tools/35.0.0/d8" ]; then
    echo "build-tools;35.0.0"
  fi
  [ -f "$sdk/ndk/$NDK_VERSION/build/cmake/android.toolchain.cmake" ] || echo "ndk;$NDK_VERSION"
  if [ ! -f "$sdk/cmake/$CMAKE_VERSION/bin/cmake" ] ||
     [ ! -f "$sdk/cmake/$CMAKE_VERSION/bin/ninja" ]; then
    echo "cmake;$CMAKE_VERSION"
  fi
}
`;
const RDR_KIT = GTA_KIT.replace(`     [ ! -f "$sdk/build-tools/35.0.0/apksigner" ] ||
     [ ! -f "$sdk/build-tools/35.0.0/d8" ]; then`, `     [ ! -f "$sdk/build-tools/35.0.0/zipalign" ] ||
     [ ! -f "$sdk/build-tools/35.0.0/lib/apksigner.jar" ] ||
     [ ! -f "$sdk/build-tools/35.0.0/lib/d8.jar" ]; then`);
const VICE_KIT = `JDK_VERSION="21.0.11+10"
JDK_URL="https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/OpenJDK21U-jdk_x64_linux_hotspot_21.0.11_10.tar.gz"
# Verified against the official Adoptium download on 2026-08-23.
JDK_SHA256="${JDK_SHA}"
ANDROID_CMDLINE_TOOLS_VERSION="15859902"
ANDROID_CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-\${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip"
# Verified against the official Google download on 2026-08-23.
ANDROID_CMDLINE_TOOLS_SHA256="${CLI_SHA}"
NDK_VERSION="27.2.12479018"
CMAKE_VERSION="3.22.1"
get_missing_sdk_packages() {
  local sdk_root="$1"
  [ -f "$sdk_root/platforms/android-35/android.jar" ] || echo "platforms;android-35"
  [ -d "$sdk_root/build-tools/34.0.0" ] || echo "build-tools;34.0.0"
  [ -f "$sdk_root/platform-tools/adb" ] || echo "platform-tools"
  # The file each component is known by, not the folder: a download that
  # stopped part way leaves the folder behind, and a folder test then
  # reports it present and skips the repair.
  [ -f "$sdk_root/ndk/$NDK_VERSION/source.properties" ] || echo "ndk;$NDK_VERSION"
  [ -f "$sdk_root/cmake/$CMAKE_VERSION/bin/cmake" ] || echo "cmake;$CMAKE_VERSION"
}
`;

const JDK_URL = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/OpenJDK21U-jdk_x64_linux_hotspot_21.0.11_10.tar.gz';
const CLI_URL = 'https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-linux-tools-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex').toUpperCase();

test('the pins and SDK requirements are read from all three creator kits', () => {
  for (const kit of [GTA_KIT, RDR_KIT, VICE_KIT]) {
    const pins = parseKitScript(kit);
    assert.deepEqual(pins.jdk, { version: '21.0.11+10', url: JDK_URL, sha256: JDK_SHA, archive: 'OpenJDK21U-jdk_x64_linux_hotspot_21.0.11_10.tar.gz' });
    assert.deepEqual(pins.cli, { version: '15859902', url: CLI_URL, sha256: CLI_SHA, archive: 'commandlinetools-linux-15859902_latest.zip' });
  }
  assert.deepEqual(parseKitScript(GTA_KIT).requirements, [
    { package: 'platforms;android-35', markers: [{ kind: 'f', rel: 'platforms/android-35/android.jar' }] },
    { package: 'build-tools;35.0.0', markers: ['aapt2', 'apksigner', 'd8'].map((name) => ({ kind: 'f', rel: `build-tools/35.0.0/${name}` })) },
    { package: 'ndk;27.2.12479018', markers: [{ kind: 'f', rel: 'ndk/27.2.12479018/build/cmake/android.toolchain.cmake' }] },
    { package: 'cmake;3.22.1', markers: ['cmake', 'ninja'].map((name) => ({ kind: 'f', rel: `cmake/3.22.1/bin/${name}` })) },
  ]);
  assert.deepEqual(parseKitScript(RDR_KIT).requirements[1].markers.map((marker) => marker.rel),
    ['aapt2', 'zipalign', 'lib/apksigner.jar', 'lib/d8.jar'].map((name) => `build-tools/35.0.0/${name}`));
  assert.deepEqual(parseKitScript(VICE_KIT).requirements, [
    { package: 'platforms;android-35', markers: [{ kind: 'f', rel: 'platforms/android-35/android.jar' }] },
    { package: 'build-tools;34.0.0', markers: [{ kind: 'd', rel: 'build-tools/34.0.0' }] },
    { package: 'platform-tools', markers: [{ kind: 'f', rel: 'platform-tools/adb' }] },
    { package: 'ndk;27.2.12479018', markers: [{ kind: 'f', rel: 'ndk/27.2.12479018/source.properties' }] },
    { package: 'cmake;3.22.1', markers: [{ kind: 'f', rel: 'cmake/3.22.1/bin/cmake' }] },
  ]);
});

test('a kit that changes its pins into something VR4ALL cannot check is refused', () => {
  assert.throws(() => parseKitScript(GTA_KIT.replace(JDK_SHA, 'not-a-digest')), /malformed SHA-256/);
  assert.throws(() => parseKitScript(GTA_KIT.replace('github.com/adoptium', 'example.com/adoptium')), /unexpected JDK download/);
  assert.throws(() => parseKitScript(GTA_KIT.replace('dl.google.com', 'example.com')), /unexpected Android command-line tools download/);
  assert.throws(() => parseKitScript(`${GTA_KIT}\nJDK_VERSION="21.0.12+1"\n`), /JDK_VERSION more than once/);
  assert.throws(() => parseKitScript(GTA_KIT.replace('"21.0.11+10"\nANDROID', '"17.0.1+1"\nANDROID')), /unexpected JDK download/);
  assert.throws(() => parseKitScript(GTA_KIT.replace('${JDK_ARCHIVE_NAME}"', '${UNKNOWN_NAME}"')), /cannot resolve/);
  assert.throws(() => parseKitScript(GTA_KIT.replace('missing_sdk_packages() {', 'renamed_packages() {')), /no longer lists the Android SDK packages/);
  assert.throws(() => parseKitScript(GTA_KIT.replace('"$sdk/platforms/android-35/android.jar"', '"$sdk/../android.jar"')), /cannot verify/);
  assert.throws(() => parseKitScript(GTA_KIT.replace('echo "platforms;android-35"', 'echo "Bad Package"')), /cannot verify/);
});

test('readKitPins reads tools/build-and-install.sh and rejects a missing script or a link', async (t) => {
  const root = await fixture(t);
  await assert.rejects(readKitPins(root), /no tools\/build-and-install\.sh/);
  await fs.mkdir(path.join(root, 'tools'));
  await fs.writeFile(path.join(root, 'real.sh'), GTA_KIT);
  try { await fs.symlink(path.join(root, 'real.sh'), path.join(root, 'tools', 'build-and-install.sh')); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows account cannot create symbolic links'); return; } throw error; }
  await assert.rejects(readKitPins(root), /no tools\/build-and-install\.sh/);
  await fs.rm(path.join(root, 'tools', 'build-and-install.sh'));
  await fs.writeFile(path.join(root, 'tools', 'build-and-install.sh'), GTA_KIT);
  const pins = await readKitPins(root);
  assert.equal(pins.script, path.join(root, 'tools', 'build-and-install.sh'));
  assert.equal(pins.jdk.version, '21.0.11+10');
});

test('SDK packages count as installed only when their files exist, and an empty build-tools folder does not', async (t) => {
  const root = await fixture(t);
  const { requirements } = parseKitScript(VICE_KIT);
  const write = async (rel, content = 'x') => { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), content); };
  assert.deepEqual(await missingSdkPackages(root, requirements), ['platforms;android-35', 'build-tools;34.0.0', 'platform-tools', 'ndk;27.2.12479018', 'cmake;3.22.1']);
  await fs.mkdir(path.join(root, 'build-tools', '34.0.0'), { recursive: true });
  await write('platforms/android-35/android.jar');
  await write('platform-tools/adb', '');
  assert.deepEqual(await missingSdkPackages(root, requirements), ['build-tools;34.0.0', 'platform-tools', 'ndk;27.2.12479018', 'cmake;3.22.1'], 'an empty folder and a zero-byte file are not installs');
  await write('build-tools/34.0.0/source.properties', 'Pkg.Revision=34.0.0');
  await write('platform-tools/adb');
  await write('ndk/27.2.12479018/source.properties');
  await write('cmake/3.22.1/bin/cmake');
  assert.deepEqual(await missingSdkPackages(root, requirements), []);
});

// ---- Installing the JDK and command-line tools with fake system tools ---------------------------

const fakeFetch = (bodies) => async (url) => {
  assert.ok(Object.hasOwn(bodies, url), `unexpected download ${url}`);
  return new Response(bodies[url]);
};

// Stands in for tar, unzip, java and javac so the suite does not depend on the host.
function fakeTools({ javaVersion = '21.0.11' } = {}) {
  const calls = [];
  const runFile = async (command, args) => {
    calls.push([command, ...args]);
    if (command === '/bin/tar') {
      assert.deepEqual(args.slice(0, 1), ['-xzf']);
      assert.equal(args[2], '-C');
      assert.equal(args[4], '--strip-components=1');
      const bin = path.join(args[3], 'bin');
      await fs.mkdir(bin, { recursive: true });
      for (const name of ['java', 'javac']) await fs.writeFile(path.join(bin, name), name, { mode: 0o755 });
      return { stdout: '', stderr: '' };
    }
    if (command === '/bin/unzip') {
      assert.deepEqual(args.slice(0, 2), ['-q', '-o']);
      const cli = path.join(args[4], 'cmdline-tools');
      await fs.mkdir(path.join(cli, 'bin'), { recursive: true });
      await fs.mkdir(path.join(cli, 'lib'));
      await fs.writeFile(path.join(cli, 'bin', 'sdkmanager'), '#!/bin/sh\n', { mode: 0o644 });
      await fs.writeFile(path.join(cli, 'lib', 'sdkmanager-classpath.jar'), 'jar');
      await fs.writeFile(path.join(cli, 'source.properties'), 'Pkg.Revision=22.0\n');
      return { stdout: '', stderr: '' };
    }
    if (command.endsWith('/bin/java')) return { stdout: '', stderr: `openjdk version "${javaVersion}" 2026-10-20\n` };
    if (command.endsWith('/bin/javac')) return { stdout: `javac ${javaVersion}\n`, stderr: '' };
    throw new Error(`unexpected command ${command}`);
  };
  return { calls, runFile, findTool: ([name]) => `/bin/${name}` };
}

function pinsFor(jdkBody = 'jdk archive', cliBody = 'cli archive') {
  const pins = parseKitScript(GTA_KIT);
  pins.jdk.sha256 = sha(jdkBody);
  pins.cli.sha256 = sha(cliBody);
  return { pins, fetchImpl: fakeFetch({ [JDK_URL]: jdkBody, [CLI_URL]: cliBody }) };
}

test('the JDK is downloaded with its pin, unpacked, checked for version 21 and installed under the shared name', { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, async (t) => {
  const root = await fixture(t);
  const { pins, fetchImpl } = pinsFor();
  const tools = fakeTools();
  const home = await ensureJdk(root, pins.jdk, { ...tools, fetchImpl });
  assert.equal(home, path.join(root, '.tools', 'jdk-21.0.11+10-linux-x64'));
  assert.equal(await fs.readFile(path.join(root, '.downloads', pins.jdk.archive), 'utf8'), 'jdk archive');
  assert.deepEqual(tools.calls[0].slice(0, 2), ['/bin/tar', '-xzf']);
  assert.deepEqual((await fs.readdir(path.join(root, '.tools'))), ['jdk-21.0.11+10-linux-x64'], 'no staging folder is left behind');
  // A second call reuses the install without a network request.
  assert.equal(await ensureJdk(root, pins.jdk, { ...tools, fetchImpl: () => { throw new Error('must not fetch'); } }), home);
});

test('a JDK that is not version 21 is rejected and not installed', async (t) => {
  const root = await fixture(t);
  const { pins, fetchImpl } = pinsFor();
  await assert.rejects(ensureJdk(root, pins.jdk, { ...fakeTools({ javaVersion: '17.0.2' }), fetchImpl }), /did not report version 21/);
  assert.deepEqual(await fs.readdir(path.join(root, '.tools')), []);
});

test('a JDK archive with another digest is never unpacked', async (t) => {
  const root = await fixture(t);
  const { pins } = pinsFor();
  const tools = fakeTools();
  await assert.rejects(ensureJdk(root, pins.jdk, { ...tools, fetchImpl: fakeFetch({ [JDK_URL]: 'tampered' }) }), /SHA-256/);
  assert.deepEqual(tools.calls, []);
});

test('a missing tar or unzip is reported by name and package', async (t) => {
  const root = await fixture(t);
  const { pins, fetchImpl } = pinsFor();
  await assert.rejects(ensureJdk(root, pins.jdk, { findTool: () => null, fetchImpl }), /tar is required on Linux \(package tar\)/);
  await assert.rejects(ensureCommandLineTools(root, pins.cli, { findTool: () => null, fetchImpl }), /unzip is required on Linux \(package unzip\)/);
});

test('the command-line tools are unpacked with unzip, made executable and found in the versioned folder', { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, async (t) => {
  const root = await fixture(t);
  const { pins, fetchImpl } = pinsFor();
  const tools = fakeTools();
  const cli = await ensureCommandLineTools(root, pins.cli, { ...tools, fetchImpl });
  assert.equal(cli, path.join(root, '.android-sdk', 'cmdline-tools', '15859902'));
  assert.equal((await fs.stat(path.join(cli, 'bin', 'sdkmanager'))).mode & 0o777, 0o755);
  assert.equal(await fs.readFile(path.join(cli, 'lib', 'sdkmanager-classpath.jar'), 'utf8'), 'jar');
  assert.equal(await ensureCommandLineTools(root, pins.cli, { ...tools, fetchImpl: () => { throw new Error('must not fetch'); } }), cli);
});

test('an incomplete command-line tools folder is moved aside, never deleted', async (t) => {
  const root = await fixture(t);
  const { pins, fetchImpl } = pinsFor();
  const stale = path.join(root, '.android-sdk', 'cmdline-tools', '15859902');
  await fs.mkdir(stale, { recursive: true });
  await fs.writeFile(path.join(stale, 'leftover.txt'), 'partial');
  const cli = await ensureCommandLineTools(root, pins.cli, { ...fakeTools(), fetchImpl });
  assert.equal(await fs.readFile(path.join(cli, 'lib', 'sdkmanager-classpath.jar'), 'utf8'), 'jar');
  const aside = (await fs.readdir(path.dirname(cli))).find((name) => name.includes('.invalid-'));
  assert.equal(await fs.readFile(path.join(path.dirname(cli), aside, 'leftover.txt'), 'utf8'), 'partial');
});

test('an archive without bin/sdkmanager is refused', async (t) => {
  const root = await fixture(t);
  const { pins, fetchImpl } = pinsFor();
  const tools = fakeTools();
  const runFile = async (command, args) => { if (command === '/bin/unzip') { await fs.mkdir(path.join(args[4], 'cmdline-tools'), { recursive: true }); return { stdout: '', stderr: '' }; } return tools.runFile(command, args); };
  await assert.rejects(ensureCommandLineTools(root, pins.cli, { ...tools, runFile, fetchImpl }), /unexpected layout/);
  assert.deepEqual(await fs.readdir(path.join(root, '.tools')), []);
});

test('prepareSdkToolsLinux returns the same settings shape as the PowerShell helper', { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, async (t) => {
  const root = await fixture(t);
  const kit = path.join(root, 'kit');
  await fs.mkdir(path.join(kit, 'tools'), { recursive: true });
  await fs.writeFile(path.join(kit, 'tools', 'build-and-install.sh'), GTA_KIT.replace(JDK_SHA, sha('jdk archive')).replace(CLI_SHA, sha('cli archive')));
  const toolsDir = path.join(root, 'shared');
  const logs = [];
  const metadata = await prepareSdkToolsLinux(kit, toolsDir, (line) => logs.push(line), { ...fakeTools(), fetchImpl: fakeFetch({ [JDK_URL]: 'jdk archive', [CLI_URL]: 'cli archive' }) });
  const javaHome = path.join(toolsDir, '.tools', 'jdk-21.0.11+10-linux-x64');
  assert.deepEqual(metadata, {
    javaExe: path.join(javaHome, 'bin', 'java'), javaHome,
    classpath: path.join(toolsDir, '.android-sdk', 'cmdline-tools', '15859902', 'lib', 'sdkmanager-classpath.jar'),
    sdkRoot: path.join(toolsDir, '.android-sdk'),
    packages: ['platforms;android-35', 'build-tools;35.0.0', 'ndk;27.2.12479018', 'cmake;3.22.1'],
  });
  assert.ok(logs.some((line) => /Downloading Temurin JDK/.test(line)));
  assert.ok((await fs.stat(path.join(toolsDir, '.tmp'))).isDirectory());
});

// ---- Preflight and argv -------------------------------------------------------------------------

const present = (...names) => (candidates) => candidates.find((name) => names.includes(name)) ? `/usr/bin/${candidates.find((name) => names.includes(name))}` : null;
const ALL = ['bash', 'curl', 'unzip', 'tar', 'awk', 'sha256sum', 'python3', 'git', 'xz'];
const run = (python, bash) => async (_command, args) => {
  if (args[0] === '-c' && /BASH_VERSINFO/.test(args[1])) return { stdout: `${bash}\n`, stderr: '' };
  if (python) return { stdout: '', stderr: '' };
  throw Object.assign(new Error('old python'), { code: 1 });
};

test('host tool preflight names every missing tool with its package', async () => {
  await assert.rejects(checkHostTools('gta-sa-vr', { findTool: present('bash', 'tar'), runFile: run(true, 5) }), (error) => {
    for (const expected of ['curl (package curl)', 'unzip (package unzip)', 'awk (package gawk)', 'sha256sum (package coreutils)', 'python3 (package python)']) assert.ok(error.message.includes(expected), expected);
    assert.ok(!error.message.includes('git'));
    return true;
  });
  await assert.doesNotReject(checkHostTools('rdr1-vr', { findTool: present(...ALL), runFile: run(true, 3) }), 'RDR needs python but not bash 4');
  await assert.rejects(checkHostTools('rdr1-vr', { findTool: present(...ALL), runFile: run(false, 5) }), /python 3\.10 or newer/);
  await assert.rejects(checkHostTools('gta-sa-vr', { findTool: present(...ALL.filter((name) => name !== 'xz')), runFile: run(true, 5), needsXz: true }), /xz \(package xz\)/);
  await assert.doesNotReject(checkHostTools('gta-sa-vr', { findTool: present(...ALL.filter((name) => name !== 'xz')), runFile: run(true, 5) }));
});

test('Vice City additionally needs git and bash 4', async () => {
  await assert.rejects(checkHostTools('vice-city-vr', { findTool: present(...ALL.filter((name) => name !== 'git')), runFile: run(true, 5) }), /git \(package git\)/);
  await assert.rejects(checkHostTools('vice-city-vr', { findTool: present(...ALL), runFile: run(true, 3) }), /bash 4 or newer/);
  await assert.doesNotReject(checkHostTools('vice-city-vr', { findTool: present('bash', 'curl', 'unzip', 'tar', 'awk', 'sha256sum', 'git'), runFile: run(false, 5) }), 'Vice runs no python');
});

test('assertLinuxToolsReady demands the JDK, the command-line tools and every SDK package', async (t) => {
  const root = await fixture(t);
  const kit = path.join(root, 'kit');
  await fs.mkdir(path.join(kit, 'tools'), { recursive: true });
  await fs.writeFile(path.join(kit, 'tools', 'build-and-install.sh'), VICE_KIT);
  const toolsDir = path.join(root, 'shared');
  await assert.rejects(assertLinuxToolsReady(kit, toolsDir), /Build tools are not set up\. Click "Set up build tools" first\./);
  const put = async (rel, mode = 0o644) => { await fs.mkdir(path.dirname(path.join(toolsDir, rel)), { recursive: true }); await fs.writeFile(path.join(toolsDir, rel), 'x', { mode }); };
  await put('.tools/jdk-21.0.11+10-linux-x64/bin/java', 0o755);
  await put('.tools/jdk-21.0.11+10-linux-x64/bin/javac', 0o755);
  await put('.android-sdk/cmdline-tools/15859902/bin/sdkmanager', 0o755);
  await put('.android-sdk/cmdline-tools/15859902/lib/sdkmanager-classpath.jar');
  await assert.rejects(assertLinuxToolsReady(kit, toolsDir), /not set up/, 'SDK packages are still missing');
  for (const rel of ['platforms/android-35/android.jar', 'build-tools/34.0.0/source.properties', 'platform-tools/adb', 'ndk/27.2.12479018/source.properties', 'cmake/3.22.1/bin/cmake']) await put(`.android-sdk/${rel}`);
  assert.deepEqual(await assertLinuxToolsReady(kit, toolsDir), { javaHome: path.join(toolsDir, '.tools', 'jdk-21.0.11+10-linux-x64'), sdkRoot: path.join(toolsDir, '.android-sdk') });
});

test('buildShellArgs passes each kit exactly the options its script accepts', { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, () => {
  const kit = '/kits/k';
  const tools = { toolsDir: '/work/shared', javaHome: '/work/shared/.tools/jdk', sdkRoot: '/work/shared/.android-sdk' };
  const script = '/kits/k/tools/build-and-install.sh';
  const common = ['--work-dir', '/work/shared', '--android-sdk', '/work/shared/.android-sdk', '--java-home', '/work/shared/.tools/jdk'];
  assert.deepEqual(buildShellArgs('gta-sa-vr', { gamePackage: '/g.zip', audioSource: '/a.7z', serial: 'Q1' }, kit, tools),
    [script, '--game-package', '/g.zip', '--audio-source', '/a.7z', ...common, '--serial', 'Q1', '--non-interactive', '--yes']);
  assert.deepEqual(buildShellArgs('rdr1-vr', { gamePackage: '/g.zip', audioSource: '/ignored', serial: 'Q1' }, kit, tools),
    [script, '--game-package', '/g.zip', ...common, '--serial', 'Q1', '--non-interactive']);
  assert.deepEqual(buildShellArgs('vice-city-vr', { gamePath: '/vc', serial: 'Q1' }, kit, tools),
    [script, '--game-dir', '/vc', '--serial', 'Q1', '--non-interactive', ...common]);
});

test('setupBuildTools on Linux installs the JDK and tools into the one shared folder, then asks SDK Manager for the missing packages', { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, async (t) => {
  const { setupBuildTools } = require('../src/android-sdk-setup');
  const root = await fixture(t);
  const kit = path.join(root, 'kit');
  await fs.mkdir(path.join(kit, 'tools'), { recursive: true });
  await fs.writeFile(path.join(kit, 'tools', 'build-and-install.sh'), VICE_KIT.replace(JDK_SHA, sha('jdk archive')).replace(CLI_SHA, sha('cli archive')));
  const tools = fakeTools();
  const installs = [];
  const result = await setupBuildTools({ cacheRoot: root, workRoot: path.join(root, 'builds') }, () => {}, async () => { throw new Error('the fake installer never asks'); }, {
    gameId: 'vice-city-vr', platform: 'linux', acquireKit: async () => ({ directory: kit, sha: 'c'.repeat(40) }),
    ...tools, fetchImpl: fakeFetch({ [JDK_URL]: 'jdk archive', [CLI_URL]: 'cli archive' }),
    installTools: async (settings) => {
      installs.push(settings);
      for (const rel of ['platforms/android-35/android.jar', 'build-tools/34.0.0/source.properties', 'platform-tools/adb', 'ndk/27.2.12479018/source.properties', 'cmake/3.22.1/bin/cmake']) {
        await fs.mkdir(path.dirname(path.join(settings.sdkRoot, rel)), { recursive: true });
        await fs.writeFile(path.join(settings.sdkRoot, rel), 'installed');
      }
    },
  });
  assert.equal(result.sha, 'c'.repeat(40));
  const shared = path.join(root, 'builds', 'shared');
  assert.equal(installs.length, 1);
  assert.equal(installs[0].sdkRoot, path.join(shared, '.android-sdk'));
  assert.deepEqual(installs[0].packages, ['platforms;android-35', 'build-tools;34.0.0', 'platform-tools', 'ndk;27.2.12479018', 'cmake;3.22.1']);
  assert.ok((await fs.lstat(path.join(shared, '.android-sdk', 'cmdline-tools', 'latest'))).isSymbolicLink(), 'Vice finds the tools through the latest alias');
});
