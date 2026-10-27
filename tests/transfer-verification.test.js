const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyPushedFile } = require('../src/transfer-verification');

test('uploaded ROM is confirmed by its byte size on the selected headset', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-transfer-'));
  const local = path.join(root, 'Owned Game.iso');
  await fs.writeFile(local, Buffer.alloc(64));
  const calls = [];
  try {
    const result = await verifyPushedFile({ run: async (args) => { calls.push(args); return '64'; } }, 'Q3S', local, '/sdcard/Download/');
    assert.equal(result.bytes, 64);
    assert.equal(result.remote, '/sdcard/Download/Owned Game.iso');
    assert.deepEqual(calls[0].slice(0, 5), ['-s', 'Q3S', 'shell', 'stat', '-c']);
    assert.match(calls[0].at(-1), /Owned Game\.iso/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('uploaded ROM with the wrong byte size is reported as an incomplete transfer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-transfer-'));
  const local = path.join(root, 'game.iso');
  await fs.writeFile(local, Buffer.alloc(64));
  try {
    await assert.rejects(verifyPushedFile({ run: async () => '32' }, 'Q3S', local, '/sdcard/Download/game.iso'), /incomplete|64|32/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
