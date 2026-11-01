const fs = require('node:fs/promises');
const path = require('node:path');
const { findOnPath } = require('./find-tool');
const { runLogged } = require('./run-logged');

// System Wine only. Proton was tried and rejected: `proton run` forwards neither the tool's
// stdout nor its exit code (`cmd /c exit 5` exits 0), and both are needed to judge a tool's result.
// Returns { kind: 'wine', path } or null.
function findWineLauncher({ env = process.env, findTool = findOnPath } = {}) {
  const wine = findTool(['wine', 'wine64'], env);
  return wine ? { kind: 'wine', path: wine } : null;
}

function windowsPath(file) {
  return `Z:${path.resolve(file).replaceAll('/', '\\')}`;
}

function wineInvocation(launcher, exe, args, prefixRoot) {
  const prefixDir = path.join(prefixRoot, 'wine');
  return { command: launcher.path, args: [exe, ...args], prefixDir,
    env: { WINEPREFIX: prefixDir, WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=;winemenubuilder.exe=d' } };
}

// Runs a Windows console tool under Wine. Arguments that are file paths must already be windowsPath()s.
async function runWindowsTool(launcher, exe, args, { prefixRoot, cwd, timeoutMs, onLine, captureStdout, runner = runLogged } = {}) {
  const invocation = wineInvocation(launcher, exe, args, prefixRoot);
  await fs.mkdir(invocation.prefixDir, { recursive: true });
  return runner(invocation.command, invocation.args, { cwd, env: { ...process.env, ...invocation.env }, timeoutMs, onLine, captureStdout });
}

module.exports = { findWineLauncher, windowsPath, wineInvocation, runWindowsTool };
