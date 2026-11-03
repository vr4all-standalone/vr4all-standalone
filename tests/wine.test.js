const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { findWineLauncher, windowsPath, wineInvocation, runWindowsTool } = require('../src/wine');

test('findWineLauncher returns the first of wine and wine64 that the finder reports', () => {
  const seen = [];
  const launcher = findWineLauncher({ env: { PATH: '/x' }, findTool: (names, env) => { seen.push([names, env.PATH]); return '/usr/bin/wine'; } });
  assert.deepEqual(launcher, { kind: 'wine', path: '/usr/bin/wine' });
  assert.deepEqual(seen, [[['wine', 'wine64'], '/x']]);
});

test('findWineLauncher gives null when Wine is not installed', () => {
  assert.equal(findWineLauncher({ findTool: () => null }), null);
});

test('windowsPath maps a host path to the Z: drive, spaces included', { skip: process.platform === 'win32' && 'POSIX paths' }, () => {
  assert.equal(windowsPath('/home/me/My Games/rom.z64'), 'Z:\\home\\me\\My Games\\rom.z64');
});

test('wineInvocation carries its own prefix and quiet environment', { skip: process.platform === 'win32' && 'POSIX paths' }, () => {
  assert.deepEqual(wineInvocation({ kind: 'wine', path: '/usr/bin/wine' }, '/k/tool.exe', ['a'], '/root'), { command: '/usr/bin/wine', args: ['/k/tool.exe', 'a'], prefixDir: '/root/wine',
    env: { WINEPREFIX: '/root/wine', WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=;winemenubuilder.exe=d' } });
});

test('runWindowsTool creates the prefix folder and passes the environment, cwd and limits to the runner', { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wine-run-'));
  try {
    const calls = [];
    const onLine = () => {};
    const result = await runWindowsTool({ kind: 'wine', path: '/usr/bin/wine' }, '/k/tool.exe', ['x'], { prefixRoot: path.join(root, 'p'), cwd: '/work', timeoutMs: 5, onLine, captureStdout: true,
      runner: async (command, args, options) => { calls.push({ command, args, options }); return { code: 2, tail: [] }; } });
    assert.equal(result.code, 2);
    assert.equal(calls[0].command, '/usr/bin/wine');
    assert.deepEqual(calls[0].args, ['/k/tool.exe', 'x']);
    assert.equal(calls[0].options.cwd, '/work');
    assert.equal(calls[0].options.timeoutMs, 5);
    assert.equal(calls[0].options.captureStdout, true);
    assert.equal(calls[0].options.onLine, onLine);
    assert.equal(calls[0].options.env.WINEPREFIX, path.join(root, 'p', 'wine'));
    assert.equal(calls[0].options.env.PATH, process.env.PATH);
    assert.ok((await fs.stat(path.join(root, 'p', 'wine'))).isDirectory());
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
