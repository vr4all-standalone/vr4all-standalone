const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyGameFile } = require('../src/file-verification');
const { getCatalog } = require('../src/catalog');

async function disc(root, name, code, revision = 0, wbfs = false) {
  const local = path.join(root, name);
  const bytes = Buffer.alloc(wbfs ? 520 : 64);
  if (wbfs) bytes.write('WBFS', 0);
  bytes.write(code, wbfs ? 512 : 0);
  bytes[wbfs ? 519 : 7] = revision;
  await fs.writeFile(local, bytes);
  return local;
}

test('Melee disc validation rejects revision 0 and accepts NTSC-U 1.02', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-disc-'));
  const game = getCatalog().find((entry) => entry.id === 'xelee');
  try {
    await assert.rejects(verifyGameFile(game, game.data[0], await disc(root, 'old.iso', 'GALE01', 0)), /1\.02|revision 2/i);
    assert.match((await verifyGameFile(game, game.data[0], await disc(root, 'new.iso', 'GALE01', 2))).message, /Melee/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Twilight Princess rejects a different game despite generic game.iso filename', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-disc-'));
  const game = getCatalog().find((entry) => entry.id === 'twilight-vr');
  try {
    await assert.rejects(verifyGameFile(game, game.data[0], await disc(root, 'game.iso', 'GALE01')), /Twilight Princess/i);
    assert.match((await verifyGameFile(game, game.data[0], await disc(root, 'game.iso', 'GZ2E01'))).message, /Twilight Princess/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('WiiCompiled rejects a USA WBFS and accepts a PAL RMCP01 WBFS', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-disc-'));
  const game = getCatalog().find((entry) => entry.id === 'wii-compiled');
  try {
    await assert.rejects(verifyGameFile(game, game.data[0], await disc(root, 'RMCE01.wbfs', 'RMCE01', 0, true)), /PAL|RMCP01/i);
    assert.match((await verifyGameFile(game, game.data[0], await disc(root, 'RMCP01.wbfs', 'RMCP01', 0, true))).message, /PAL|RMCP01/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
