const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { findOnPath } = require('../src/find-tool');

test('findOnPath returns the first executable file named on PATH and skips non-executables', { skip: process.platform === 'win32' && 'POSIX permission bits' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-path-'));
  try {
    const first = path.join(root, 'a');
    const second = path.join(root, 'b');
    await fs.mkdir(first); await fs.mkdir(second);
    await fs.writeFile(path.join(first, '7z'), '#!/bin/sh\n', { mode: 0o644 });
    await fs.writeFile(path.join(second, '7z'), '#!/bin/sh\n', { mode: 0o755 });
    const env = { PATH: `${first}${path.delimiter}${second}` };
    assert.equal(findOnPath(['7zz', '7z'], env), path.join(second, '7z'));
    assert.equal(findOnPath(['nothing-here'], env), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
