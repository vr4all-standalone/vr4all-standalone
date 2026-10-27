const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyGameFile } = require('../src/file-verification');

test('Super Mario 64 drop rejects a different Nintendo 64 game before install', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-verify-'));
  try {
    const rom = Buffer.alloc(64);
    rom.writeUInt32BE(0x80371240, 0);
    rom.write('NZSE', 0x3b, 'ascii');
    const file = path.join(dir, 'wrong.z64');
    await fs.writeFile(file, rom);
    const game = { id: 'sm64-vr' };
    const item = { id: 'rom', label: 'Super Mario 64 ROM', kind: 'file', extensions: ['.z64'] };
    await assert.rejects(() => verifyGameFile(game, item, file), /does not match Super Mario 64/i);
    rom.write('NSME', 0x3b, 'ascii');
    await fs.writeFile(file, rom);
    assert.match((await verifyGameFile(game, item, file)).message, /Super Mario 64/i);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('F-Zero X refuses a header-only or wrong-revision ROM before installing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-fzero-verify-'));
  try {
    const file = path.join(dir, 'F-Zero X (USA).z64');
    const rom = Buffer.alloc(16 * 1024 * 1024);
    rom.writeUInt32BE(0x80371240, 0);
    await fs.writeFile(file, rom);
    const game = { id: 'fzero-x-virtuavr' };
    const item = { id: 'rom', label: 'F-Zero X ROM', kind: 'file', extensions: ['.z64', '.n64', '.v64'] };
    await assert.rejects(() => verifyGameFile(game, item, file), /required US Rev 0 release/);
    await fs.truncate(file, 1024);
    await assert.rejects(() => verifyGameFile(game, item, file), /16 MiB US Rev 0/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('archive drop checks its signature and does not claim to verify game identity', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-verify-'));
  try {
    const file = path.join(dir, 'timecris.zip');
    const game = { id: 'time-crisis-vr' };
    const item = { id: 'timecris', label: 'Time Crisis arcade set', kind: 'file', extensions: ['.zip'] };
    await fs.writeFile(file, 'not a ZIP');
    await assert.rejects(() => verifyGameFile(game, item, file), /ZIP/i);
    await fs.writeFile(file, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));
    await assert.rejects(() => verifyGameFile(game, item, file), /ZIP/i);
    const name = Buffer.from('rom.bin');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(local.length + name.length + 1, 16);
    await fs.writeFile(file, Buffer.concat([local, name, Buffer.from('x'), central, name, end]));
    assert.equal((await verifyGameFile(game, item, file)).level, 'format');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Pokémon Gen 1 drop rejects a different 1 MiB Game Boy ROM', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-pokemon-'));
  try {
    const file = path.join(dir, 'pokemon-blue.gb');
    await fs.writeFile(file, Buffer.alloc(1024 * 1024));
    const game = { id: 'pokemon-gen1-vr' };
    const item = { id: 'rom', label: 'Pokémon Red or Blue US ROM', kind: 'file', extensions: ['.gb'] };
    await assert.rejects(() => verifyGameFile(game, item, file), /does not match the supported US Pokémon/i);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
