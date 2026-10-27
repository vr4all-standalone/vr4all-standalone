const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { runAuthorScript } = require('../src/personal-build');
const { runViceCityBuild } = require('../src/vice-city-runner');
const { withShortBuildPath } = require('../src/build-path');

const runFile = promisify(execFile);

test('build path skips occupied drives and releases only its own mapping after failure', async () => {
  const commands = [];
  const upstreamError = new Error('official builder failed');
  const physical = 'C:\\Users\\Player\\AppData\\Roaming\\vr4all\\builds\\rdr1-vr';
  const logs = [];
  await assert.rejects(withShortBuildPath(physical, async (shortPath) => {
    assert.equal(shortPath, 'Y:\\rdr1-vr');
    throw upstreamError;
  }, (line) => logs.push(line), {
    platform: 'win32',
    runFile: async (binary, args) => {
      assert.equal(binary, 'subst.exe');
      commands.push(args);
      if (args[0] === 'Z:') throw new Error('Drive already in use');
    },
  }), (error) => error === upstreamError);
  assert.deepEqual(commands, [
    ['Z:', 'C:\\Users\\Player\\AppData\\Roaming\\vr4all\\builds'],
    ['Y:', 'C:\\Users\\Player\\AppData\\Roaming\\vr4all\\builds'],
    ['Y:', '/D'],
  ]);
  assert.ok(logs.some((line) => line.includes(physical)));
});

test('build path does not launch a builder when Windows refuses every mapping', async () => {
  let launched = false;
  await assert.rejects(withShortBuildPath('C:\\profile\\builds\\rdr1-vr', async () => { launched = true; }, () => {}, {
    platform: 'win32',
    runFile: async (_binary, args) => {
      assert.notEqual(args[1], '/D', 'a failed reservation must never be removed');
      throw new Error('Access denied');
    },
  }), /temporary short build path.*Access denied/);
  assert.equal(launched, false);
});

test('a mapping cleanup error preserves the build result and is logged', async () => {
  const logs = [];
  const result = await withShortBuildPath('C:\\profile\\builds\\rdr1-vr', async () => 'built', (line) => logs.push(line), {
    platform: 'win32',
    runFile: async (_binary, args) => { if (args[1] === '/D') throw new Error('Drive busy'); },
  });
  assert.equal(result, 'built');
  assert.ok(logs.some((line) => line.includes('Drive busy')));
});

test('non-Windows builds keep the original path without invoking SUBST', async () => {
  const result = await withShortBuildPath('/home/player/builds/rdr1-vr', async (workDir) => workDir, () => {}, {
    platform: 'linux', runFile: async () => { throw new Error('Unexpected Windows command'); },
  });
  assert.equal(result, '/home/player/builds/rdr1-vr');
});

// Exercise the same Windows PowerShell 5.1 ZIP APIs and SDK member that failed
// on the user's machine, without downloading tools or contacting a headset.
for (const game of ['rdr1-vr', 'vice-city-vr']) {
  test(`${game} extracts Android tools from a deep profile and retains files after the build`, { skip: process.platform !== 'win32' }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-long-build-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const sha = 'a'.repeat(40);
    const kitName = `vice-city-vr-quest-${sha}`;
    const kit = path.join(root, kitName);
    const owned = path.join(root, 'owned');
    const workRoot = path.join(root, 'a deeply nested user profile', 'builds');
    const workDir = path.join(workRoot, game);
    const sdkZip = path.join(owned, 'sdk.zip');
    const sourceZip = path.join(root, 'source.zip');
    await fs.mkdir(path.join(kit, 'tools'), { recursive: true });
    await fs.mkdir(owned);
    const member = 'cmdline-tools/lib/external/com/google/guava/listenablefuture/9999.0-empty-to-avoid-conflict-with-guava/listenablefuture-9999.0-empty-to-avoid-conflict-with-guava.jar';
    const staging = '.tools/.extract-android-cli-4f4316eb0af6495ca643c7d611d35cf3';
    assert.ok(path.join(workDir, staging, member).length > 260);
    await fs.writeFile(path.join(kit, 'tools', 'build-and-install.ps1'), `
param([string]$GamePackage, [string]$GameDir, [string]$WorkDir, [string]$Serial, [switch]$NonInteractive)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = if ($GamePackage) { $GamePackage } else { Join-Path $GameDir 'sdk.zip' }
$destination = Join-Path $WorkDir '${staging}'
if ($GamePackage) {
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $destination)
} else {
  Expand-Archive -LiteralPath $zip -DestinationPath $destination -Force
  $installed = Join-Path $WorkDir '.android-sdk/cmdline-tools/latest'
  New-Item -ItemType Directory -Path $installed -Force | Out-Null
  Copy-Item -Path (Join-Path $destination 'cmdline-tools/*') -Destination $installed -Recurse -Force
}
$content = [IO.File]::ReadAllText((Join-Path $destination '${member}'))
if ($content -ne 'verified SDK fixture' -or $Serial -ne 'Quest-Test' -or -not $NonInteractive) { throw 'Wrong build input' }
Set-Content -LiteralPath (Join-Path $WorkDir 'build-result.txt') -Value $content
exit 0
`);
    await fs.writeFile(path.join(kit, 'BUILD_AND_INSTALL.bat'), '@echo off');
    await fs.mkdir(path.join(kit, 'overlay', 'android', 'app'), { recursive: true });
    await fs.writeFile(path.join(kit, 'overlay', 'android', 'app', 'build.gradle.kts'), 'versionName = "test"');
    const createZip = path.join(root, 'create-fixtures.ps1');
    await fs.writeFile(createZip, `
param([string]$SdkZip, [string]$Kit, [string]$SourceZip)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($SdkZip, 'Create')
try {
  $writer = New-Object IO.StreamWriter($zip.CreateEntry('${member}').Open())
  $writer.Write('verified SDK fixture')
  $writer.Dispose()
} finally { $zip.Dispose() }
[IO.Compression.ZipFile]::CreateFromDirectory($Kit, $SourceZip, 'Optimal', $true)
`);
    await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', createZip, '-SdkZip', sdkZip, '-Kit', kit, '-SourceZip', sourceZip], { windowsHide: true });
    const logs = [];
    if (game === 'rdr1-vr') {
      await fs.mkdir(workDir, { recursive: true });
      await runAuthorScript(game, { gamePackage: sdkZip, serial: 'Quest-Test' }, kit, workDir, (line) => logs.push(line));
    } else {
      for (const directory of ['data', 'TEXT', 'anim', 'txd', 'skins', 'mp3', 'movies', 'models', 'Audio']) await fs.mkdir(path.join(owned, directory));
      const bytes = await fs.readFile(sourceZip);
      await runViceCityBuild({ gamePackage: owned, serial: 'Quest-Test' }, { cacheRoot: path.join(root, 'cache'), workRoot }, (line) => logs.push(line), {
        fetchImpl: async (url) => url.includes('/commits/') ? new Response(JSON.stringify({ sha })) : new Response(bytes),
      });
      assert.equal(await fs.readFile(path.join(workDir, '.android-sdk', 'cmdline-tools', 'latest', member.slice('cmdline-tools/'.length)), 'utf8'), 'verified SDK fixture');
    }
    assert.equal((await fs.readFile(path.join(workDir, 'build-result.txt'), 'utf8')).trim(), 'verified SDK fixture');
    assert.equal(await fs.readFile(path.join(workDir, staging, member), 'utf8'), 'verified SDK fixture');
    const aliasLine = logs.find((line) => line.includes('Temporary build path:'));
    assert.ok(aliasLine, 'the job should explain the temporary short build path');
    const drive = aliasLine.match(/\b([A-Z]):\\/)[1];
    const mappings = (await runFile('subst.exe', [], { windowsHide: true })).stdout;
    assert.ok(!mappings.includes(`${drive}:\\: =>`), 'the temporary drive must be released after the script exits');
  });
}
