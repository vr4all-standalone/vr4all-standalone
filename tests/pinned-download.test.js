const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadPinned } = require('../src/pinned-download');

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-pinned-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

const served = (body, status = 200) => async (url, init) => {
  served.calls.push({ url, init });
  return new Response(status === 200 ? body : 'nope', { status });
};
served.calls = [];

test('a pinned download streams to a partial file, verifies the digest and sends the VR4ALL user agent', async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, 'tool.bin');
  served.calls = [];
  const result = await downloadPinned({ name: 'Tool', url: 'https://example.test/tool.bin', sha256: sha('payload').toUpperCase(), maxBytes: 1024, destination, fetchImpl: served('payload') });
  assert.equal(result, destination);
  assert.equal(await fs.readFile(destination, 'utf8'), 'payload');
  assert.deepEqual(await fs.readdir(root), ['tool.bin']);
  assert.equal(served.calls[0].init.headers['User-Agent'], 'VR4ALL');
});

test('a verified file already on disk is reused without any network request', async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, 'tool.bin');
  await fs.writeFile(destination, 'payload');
  const logs = [];
  await downloadPinned({ name: 'Tool', url: 'u', sha256: sha('payload'), maxBytes: 1024, destination, fetchImpl: () => { throw new Error('must not fetch'); }, log: (line) => logs.push(line) });
  assert.deepEqual(logs, ['Reusing verified Tool.']);
});

test('an existing file with another digest is reported and left untouched', async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, 'tool.bin');
  await fs.writeFile(destination, 'something else');
  await assert.rejects(downloadPinned({ name: 'Tool', url: 'u', sha256: sha('payload'), maxBytes: 1024, destination, fetchImpl: () => { throw new Error('must not fetch'); } }), /does not match its pinned SHA-256\. Delete it and retry/);
  assert.equal(await fs.readFile(destination, 'utf8'), 'something else');
});

test('a wrong digest deletes the partial download and leaves no destination', async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, 'tool.bin');
  await assert.rejects(downloadPinned({ name: 'Tool', url: 'u', sha256: sha('expected'), maxBytes: 1024, destination, fetchImpl: served('tampered') }), /Tool failed SHA-256 verification/);
  assert.deepEqual(await fs.readdir(root), []);
});

test('a download above the size cap is stopped and cleaned up', async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, 'tool.bin');
  await assert.rejects(downloadPinned({ name: 'Tool', url: 'u', sha256: sha('x'.repeat(100)), maxBytes: 10, destination, fetchImpl: served('x'.repeat(100)) }), /exceeds the expected size/);
  assert.deepEqual(await fs.readdir(root), []);
});

test('an HTTP error and a symlink destination are refused', async (t) => {
  const root = await fixture(t);
  await assert.rejects(downloadPinned({ name: 'Tool', url: 'u', sha256: sha('x'), maxBytes: 10, destination: path.join(root, 'a.bin'), fetchImpl: served('', 404) }), /HTTP 404/);
  const real = path.join(root, 'real.bin');
  await fs.writeFile(real, 'x');
  const link = path.join(root, 'link.bin');
  try { await fs.symlink(real, link); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows account cannot create symbolic links'); return; } throw error; }
  await assert.rejects(downloadPinned({ name: 'Tool', url: 'u', sha256: sha('x'), maxBytes: 10, destination: link, fetchImpl: () => { throw new Error('must not fetch'); } }), /must not be a link/);
});
