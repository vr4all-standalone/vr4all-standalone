const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const { runSdkManager, setupViceCityTools, prepareSdkTools } = require('../src/android-sdk-setup');

const config = { javaExe: 'C:\\tools\\jdk\\bin\\java.exe', javaHome: 'C:\\tools\\jdk', classpath: 'C:\\tools\\sdk\\lib\\sdkmanager-classpath.jar', sdkRoot: 'C:\\tools\\sdk', packages: ['platforms;android-35', 'ndk;27.2.12479018'] };

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => child.emit('close', 1);
  return child;
}

test('SDK Manager waits for the displayed license decision before sending any input', async () => {
  let decide;
  let presented;
  let child;
  const pending = new Promise((resolve) => { decide = resolve; });
  const shown = new Promise((resolve) => { presented = resolve; });
  const writes = [];
  const task = runSdkManager(config, () => {}, async (text) => { presented(text); return pending; }, {
    spawnImpl: (binary, args, options) => {
      assert.equal(binary, config.javaExe);
      assert.ok(args.includes('--install'));
      assert.ok(args.includes('--sdk_root=C:\\tools\\sdk'));
      assert.deepEqual(args.slice(-2), config.packages);
      assert.equal(options.stdio[0], 'pipe');
      assert.equal(options.env.TEMP, 'C:\\tools\\.tmp');
      assert.equal(options.env.TMP, 'C:\\tools\\.tmp');
      assert.equal(options.env.ANDROID_USER_HOME, 'C:\\tools\\.android-user');
      assert.ok(args.includes('-Djava.io.tmpdir=C:\\tools\\.tmp'));
      child = childProcess();
      child.stdin.on('data', (chunk) => writes.push(String(chunk)));
      queueMicrotask(() => { child.stdout.write('License android-sdk-license:\nActual Google terms\nAccept? (y'); child.stdout.write('/N): '); });
      return child;
    },
  });
  assert.match(await shown, /Actual Google terms/);
  assert.deepEqual(writes, [], 'opening the setup screen must not accept terms');
  decide(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ['y\n']);
  child.emit('close', 0);
  await task;
});

test('declining a license sends no acceptance and cannot report setup success', async () => {
  const writes = [];
  const task = runSdkManager(config, () => {}, async () => false, {
    spawnImpl: () => {
      const child = childProcess();
      child.stdin.on('data', (chunk) => { writes.push(String(chunk)); queueMicrotask(() => child.emit('close', 0)); });
      queueMicrotask(() => child.stdout.write('Google terms\nAccept? (y/N): '));
      return child;
    },
  });
  await assert.rejects(task, /license.*not accepted|cancelled/i);
  assert.deepEqual(writes, ['n\n']);
});

test('each new SDK license requires its own decision', async () => {
  const terms = [];
  const writes = [];
  await runSdkManager(config, () => {}, async (text) => { terms.push(text); return true; }, {
    spawnImpl: () => {
      const child = childProcess();
      child.stdin.on('data', (chunk) => {
        writes.push(String(chunk));
        queueMicrotask(() => writes.length === 1 ? child.stdout.write('Second license\nAccept? (y/N): ') : child.emit('close', 0));
      });
      queueMicrotask(() => child.stdout.write('First license\nAccept? (y/N): '));
      return child;
    },
  });
  assert.equal(terms.length, 2);
  assert.match(terms[1], /Second license/);
  assert.doesNotMatch(terms[1], /First license/);
  assert.deepEqual(writes, ['y\n', 'y\n']);
});

test('an SDK process error keeps the operation pending until the child closes', async () => {
  let child;
  let settled = false;
  const error = new Error('SDK launch failed');
  const task = runSdkManager(config, () => {}, async () => true, { spawnImpl: () => { child = childProcess(); return child; } });
  const rejected = assert.rejects(task, (failure) => failure === error).then(() => { settled = true; });
  child.emit('error', error);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  child.emit('close', 1);
  await rejected;
});

test('setup checks required files again and refuses an SDK Manager false success', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-check-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let checks = 0;
  let installs = 0;
  await assert.rejects(setupViceCityTools({ cacheRoot: root, workRoot: root }, () => {}, async () => true, {
    platform: 'linux',
    acquireKit: async () => ({ directory: root, sha: 'a'.repeat(40) }),
    prepareTools: async () => { checks++; return config; },
    installTools: async () => { installs++; },
  }), /still missing/);
  assert.equal(checks, 2);
  assert.equal(installs, 1);
});

test('an already prepared SDK needs no license acceptance or installation', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-ready-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await setupViceCityTools({ cacheRoot: root, workRoot: root }, () => {}, async () => { throw new Error('Unexpected license'); }, {
    platform: 'linux', acquireKit: async () => ({ directory: root, sha: 'b'.repeat(40) }),
    prepareTools: async () => ({ ...config, packages: [] }),
    installTools: async () => { throw new Error('Unexpected install'); },
  });
  assert.equal(result.sha, 'b'.repeat(40));
});

test('PowerShell imports SDK helpers without running the author game installer', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-import-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const kit = path.join(root, 'kit');
  await fs.mkdir(path.join(kit, 'tools'), { recursive: true });
  await fs.mkdir(path.join(root, '.tools', 'jdk', 'bin'), { recursive: true });
  await fs.writeFile(path.join(root, '.tools', 'jdk', 'bin', 'java.exe'), 'fixture');
  await fs.mkdir(path.join(root, '.android-sdk', 'cmdline-tools', 'latest', 'lib'), { recursive: true });
  await fs.writeFile(path.join(root, '.android-sdk', 'cmdline-tools', 'latest', 'lib', 'sdkmanager-classpath.jar'), 'fixture');
  const buildTools = path.join(root, '.android-sdk', 'build-tools', '34.0.0');
  await fs.mkdir(buildTools, { recursive: true });
  await fs.writeFile(path.join(kit, 'tools', 'build-and-install.ps1'), `
$androidCommandLineToolsVersion = 'test'
$androidCommandLineToolsUrl = 'test'
$androidCommandLineToolsSha256 = 'test'
$jdkVersion = 'test'
$jdkUrl = 'test'
$jdkSha256 = 'test'
$ndkVersion = 'test'
$cmakeVersion = 'test'
function Find-JavaHome { return (Join-Path $WorkDir '.tools/jdk') }
function Ensure-AndroidCommandLineTools { param($SdkRoot) return (Join-Path $SdkRoot 'cmdline-tools/latest/bin/sdkmanager.bat') }
function Get-MissingSdkPackages {
  param($SdkRoot)
  $required = @(
    [PSCustomObject]@{ Path = 'platforms/android-35/android.jar'; Package = 'platforms;android-35' },
    [PSCustomObject]@{ Path = 'build-tools/34.0.0'; Package = 'build-tools;34.0.0' }
  )
  return @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $SdkRoot $_.Path)) })
}
throw 'The game installer entry point must never run during SDK setup'
`);
  const metadata = await prepareSdkTools(kit, root, () => {}, { spawnImpl: (binary, args, options) => {
    const helper = args[args.indexOf('-File') + 1];
    assert.ok(helper.startsWith(root + path.sep), 'external PowerShell cannot read a helper inside the packaged app.asar');
    assert.equal(options.env.TEMP, path.join(root, '.tmp'));
    return spawn(binary, args, options);
  } });
  assert.equal(metadata.sdkRoot, path.join(root, '.android-sdk'));
  assert.deepEqual(metadata.packages, ['platforms;android-35', 'build-tools;34.0.0'], 'an empty build-tools directory must not count as installed');
  assert.equal(metadata.javaExe, path.join(root, '.tools', 'jdk', 'bin', 'java.exe'));
  assert.equal((await fs.readdir(root)).some((name) => name.startsWith('.vr4all-sdk-helper-')), false);
  await fs.mkdir(path.join(buildTools, 'lib'));
  for (const marker of ['aapt2.exe', 'zipalign.exe', 'lib/apksigner.jar', 'lib/d8.jar', 'source.properties']) await fs.writeFile(path.join(buildTools, marker), 'fixture');
  const complete = await prepareSdkTools(kit, root, () => {});
  assert.deepEqual(complete.packages, ['platforms;android-35']);
});

for (const gameId of ['rdr1-vr', 'gta-sa-vr']) {
test(`${gameId} bootstrap imports its own SDK requirements without executing the game installer or accepting licenses`, { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-rdr-sdk-import-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const kit = path.join(root, 'kit');
  await fs.mkdir(path.join(kit, 'tools'), { recursive: true });
  await fs.mkdir(path.join(root, '.tools', 'jdk', 'bin'), { recursive: true });
  await fs.writeFile(path.join(root, '.tools', 'jdk', 'bin', 'java.exe'), 'fixture');
  const cli = path.join(root, '.android-sdk', 'cmdline-tools', '15859902', 'lib', 'sdkmanager-classpath.jar');
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(cli, 'fixture');
  const helpers = ['Get-FullPath', 'Test-IsUnderPath', 'Move-AsideIfPresent', 'Format-DownloadSize', 'Invoke-DownloadWithProgress', 'Get-VerifiedDownload', 'Expand-ZipToFreshDirectory', 'Invoke-NativeCapture'];
  await fs.writeFile(path.join(kit, 'tools', 'build-and-install.ps1'), `
$script:PinnedFiles = @{}
${gameId === 'rdr1-vr' ? "$script:ModVersion = 'test'" : ''}
${helpers.map((name) => `function ${name} { throw 'Unexpected unused helper' }`).join('\n')}
function Resolve-JavaHome { param($DownloadRoot, $ToolsRoot) return (Join-Path $ToolsRoot 'jdk') }
function Install-AndroidCommandLineTools { param($SdkRoot, $DownloadRoot, $ToolsRoot) return (Join-Path $SdkRoot 'cmdline-tools/15859902/lib/sdkmanager-classpath.jar') }
function Test-AndroidPackages {
  param($SdkRoot)
  @('platforms/android-35/android.jar', 'build-tools/35.0.0/aapt2.exe', 'build-tools/35.0.0/lib/d8.jar', 'ndk/27.2.12479018/build/cmake/android.toolchain.cmake', 'cmake/3.22.1/bin/ninja.exe') | ForEach-Object { Join-Path $SdkRoot $_ } | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }
}

function Invoke-AndroidSdkLicenses { throw 'Bootstrap must never accept terms' }
throw 'Game installer must not execute during tool preparation'
`);
  const result = await prepareSdkTools(kit, root, () => {}, { gameId });
  assert.equal(result.javaExe, path.join(root, '.tools', 'jdk', 'bin', 'java.exe'));
  assert.equal(result.classpath, cli);
  assert.deepEqual(result.packages, ['platforms;android-35', 'build-tools;35.0.0', 'ndk;27.2.12479018', 'cmake;3.22.1']);
});
}


test('all three setup flows reuse installed SDK packages and only install a different required version once', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-sdk-shared-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installed = [];
  for (const gameId of ['vice-city-vr', 'rdr1-vr', 'gta-sa-vr']) {
    const required = ['platforms;android-35', 'ndk;27.2.12479018', 'cmake;3.22.1', gameId === 'vice-city-vr' ? 'build-tools;34.0.0' : 'build-tools;35.0.0'];
    await setupViceCityTools({ cacheRoot: root, workRoot: root }, () => {}, async () => true, {
      gameId, platform: 'linux', acquireKit: async () => ({ directory: root, sha: 'a'.repeat(40) }),
      prepareTools: async (_kit, workDir) => {
        const sdkRoot = path.join(workDir, '.android-sdk');
        await fs.mkdir(sdkRoot, { recursive: true });
        const packages = [];
        for (const name of required) if (!await fs.stat(path.join(sdkRoot, name.replace(';', '-'))).catch(() => null)) packages.push(name);
        return { ...config, sdkRoot, packages };
      },
      installTools: async (settings) => {
        for (const name of settings.packages) { installed.push(name); await fs.writeFile(path.join(settings.sdkRoot, name.replace(';', '-')), 'installed'); }
      },
    });
  }
  assert.deepEqual(installed, ['platforms;android-35', 'ndk;27.2.12479018', 'cmake;3.22.1', 'build-tools;34.0.0', 'build-tools;35.0.0']);
});
