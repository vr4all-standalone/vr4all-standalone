const path = require('node:path');
const { spawn } = require('node:child_process');

const maxCapturedStdout = 8 * 1024 * 1024;
const maxTail = 200;

// Spawns a process, streams its merged stdout/stderr lines to onLine and settles on close.
// Resolves { code, signal, stdout, tail }; callers decide success from `code`.
function runLogged(command, args, { cwd, env, timeoutMs = 0, onLine = () => {}, captureStdout = false, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const name = path.basename(command);
    const child = spawnImpl(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const tail = [];
    const pending = { stdout: '', stderr: '' };
    const captured = [];
    let capturedBytes = 0;
    let timer = null;
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    };
    const emit = (text) => {
      // A progress meter rewrites its line with \r; only the last rewrite is worth showing.
      const line = text.slice(text.lastIndexOf('\r') + 1).trim();
      if (!line) return;
      tail.push(line);
      if (tail.length > maxTail) tail.shift();
      onLine(line.slice(0, 500));
    };
    const feed = (stream) => (chunk) => {
      if (stream === 'stdout' && captureStdout) {
        capturedBytes += chunk.length;
        if (capturedBytes > maxCapturedStdout) {
          child.kill('SIGKILL');
          finish(reject, new Error(`${name} printed more than 8 MiB of output`));
          return;
        }
        captured.push(chunk);
      }
      const lines = (pending[stream] + chunk.toString('utf8')).split(/\r?\n/);
      pending[stream] = lines.pop();
      lines.forEach(emit);
    };
    child.stdout.on('data', feed('stdout'));
    child.stderr.on('data', feed('stderr'));
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, new Error(`${name} did not finish within ${Math.round(timeoutMs / 60000)} minutes`));
      }, timeoutMs);
    }
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code, signal) => {
      emit(pending.stdout);
      emit(pending.stderr);
      finish(resolve, { code, signal, stdout: Buffer.concat(captured).toString('utf8'), tail });
    });
  });
}

module.exports = { runLogged };
