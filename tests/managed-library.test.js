const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApp } = require('../server');

function request(app, method, url) {
  return new Promise((resolve) => {
    const req = Readable.from([]);
    req.method = method;
    req.url = url;
    req.headers = { host: '127.0.0.1:4173', 'x-questdesk-token': app.token };
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
    app.server.emit('request', req, res);
  });
}

test('old managed path changes back to its original without deleting the old copy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-legacy-migrate-'));
  const library = path.join(root, 'library');
  const original = path.join(root, 'Super Mario 64.z64');
  const id = '0b1492d8-94b4-4e4b-8c82-d709938bf1d4';
  const copy = path.join(library, 'items', id, path.basename(original));
  const settingsPath = path.join(root, 'settings.json');
  try {
    await fs.mkdir(path.dirname(copy), { recursive: true });
    await fs.writeFile(original, 'owned ROM');
    await fs.writeFile(copy, 'owned ROM');
    await fs.writeFile(path.join(library, 'index.json'), JSON.stringify({ version: 1, entries: [{ id, originalPath: original, originalName: path.basename(original), gameId: 'sm64-vr', itemId: 'rom' }] }));
    await fs.writeFile(settingsPath, JSON.stringify({ localPaths: { 'sm64-vr': { rom: copy } } }));
    const app = createApp({ settingsPath, libraryPath: library, downloadsPath: root, adb: { listDevices: async () => [] } });
    try {
      const remembered = await request(app, 'GET', '/api/local-paths');
      assert.equal(remembered.body.paths['sm64-vr'].rom, original);
      assert.equal(await fs.readFile(copy, 'utf8'), 'owned ROM');
    } finally { app.server.close(); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
