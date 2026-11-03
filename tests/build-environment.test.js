const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { buildEnvironment } = require('../src/build-environment');
const run = promisify(execFile);

test('Windows author builds discard the inherited PowerShell module path without changing the parent process', { skip: process.platform !== 'win32' }, () => {
  const previous = process.env.PSModulePath;
  try {
    process.env.PSModulePath = 'C:\\incompatible-powershell-7-modules';
    const env = buildEnvironment('E:\\build');
    assert.equal(Object.keys(env).some((key) => key.toLowerCase() === 'psmodulepath'), false);
    assert.equal(process.env.PSModulePath, 'C:\\incompatible-powershell-7-modules');
    assert.equal(env.TEMP, path.join('E:\\build', '.tmp'));
    assert.equal(env.GRADLE_USER_HOME, path.join('E:\\build', '.gradle'));
  } finally { if (previous === undefined) delete process.env.PSModulePath; else process.env.PSModulePath = previous; }
});

test('real Windows PowerShell hashes files when launched from an incompatible PowerShell 7 environment', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.build-env-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const moduleRoot = path.join(root, 'PowerShell7', 'Microsoft.PowerShell.Utility');
  await fs.mkdir(moduleRoot, { recursive: true }); await fs.mkdir(path.join(root, '.tmp'));
  await fs.writeFile(path.join(moduleRoot, 'Microsoft.PowerShell.Utility.psd1'), "@{ModuleVersion='99.0';RootModule='utility.psm1';FunctionsToExport=@('Get-FileHash')}\n");
  await fs.writeFile(path.join(moduleRoot, 'utility.psm1'), "throw 'This module cannot be loaded by Windows PowerShell'\n");
  const input = path.join(root, 'input.txt'); await fs.writeFile(input, 'VR4ALL environment regression');
  const script = "$ErrorActionPreference='Stop'; [Console]::WriteLine((Get-FileHash -LiteralPath $env:VR4ALL_HASH_FIXTURE -Algorithm SHA256).Hash)";
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const polluted = { ...process.env, PSModulePath: path.dirname(moduleRoot), VR4ALL_HASH_FIXTURE: input };
  await assert.rejects(run(executable, args, { env: polluted, windowsHide: true, timeout: 15000 }), /Get-FileHash/);
  const previous = process.env.PSModulePath;
  try {
    process.env.PSModulePath = polluted.PSModulePath;
    const env = { ...buildEnvironment(root), VR4ALL_HASH_FIXTURE: input };
    const { stdout } = await run(executable, args, { env, windowsHide: true, timeout: 15000 });
    assert.equal(stdout.trim().toLowerCase(), crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex'));
  } finally { if (previous === undefined) delete process.env.PSModulePath; else process.env.PSModulePath = previous; }
});

function withEnv(changes, operation) {
  const previous = {};
  for (const [key, value] of Object.entries(changes)) { previous[key] = process.env[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { return operation(); } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test('Windows builds relocate the Android user folder and drop the inherited PowerShell module path on any host', () => {
  withEnv({ PSModulePath: 'C:\\modules', ANDROID_USER_HOME: undefined }, () => {
    const env = buildEnvironment(path.join(path.sep, 'build'), { platform: 'win32' });
    assert.equal(env.ANDROID_USER_HOME, path.join(path.sep, 'build', '.android-user'));
    assert.equal(env.PSModulePath, undefined);
    assert.equal(env.TMPDIR, undefined);
  });
});

test('Linux builds use the shared temp and Gradle folders but leave the Android user folder alone', { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, () => {
  withEnv({ ANDROID_USER_HOME: '/home/user/.android', APPIMAGE: undefined, LD_LIBRARY_PATH: '/keep' }, () => {
    const env = buildEnvironment('/work/shared', { platform: 'linux' });
    for (const key of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(env[key], '/work/shared/.tmp', key);
    assert.equal(env.GRADLE_USER_HOME, '/work/shared/.gradle');
    assert.equal(env.ANDROID_USER_HOME, '/home/user/.android');
    assert.equal(env.LD_LIBRARY_PATH, '/keep');
  });
  withEnv({ ANDROID_USER_HOME: undefined }, () => assert.equal('ANDROID_USER_HOME' in buildEnvironment('/work/shared', { platform: 'linux' }), false));
});

test('inside an AppImage the bundled library paths are not passed to system tools', () => {
  withEnv({ APPIMAGE: '/opt/VR4ALL.AppImage', LD_LIBRARY_PATH: '/tmp/.mount/lib', LD_PRELOAD: '/tmp/.mount/preload.so' }, () => {
    const env = buildEnvironment('/work/shared', { platform: 'linux' });
    assert.equal('LD_LIBRARY_PATH' in env, false);
    assert.equal('LD_PRELOAD' in env, false);
    assert.equal(process.env.LD_LIBRARY_PATH, '/tmp/.mount/lib', 'the parent environment is untouched');
  });
});
