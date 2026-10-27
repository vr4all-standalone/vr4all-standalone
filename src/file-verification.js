const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const pokemonGen1Hashes = new Set([
  'ea9bcae617fdf159b045185467ae58b2e4a48b9a', // Pokémon Red US
  'd7037c83e1ae5b39bde3c30787637ba1d4c48ce2', // Pokémon Blue US
]);

const n64Games = {
  'sm64-vr': { name: 'Super Mario 64', codes: ['NSME'] },
  'oot-vr': { name: 'Ocarina of Time', codes: ['CZLE', 'CZLP', 'CZLJ'] },
  'mm-vr': { name: 'Majora’s Mask', codes: ['NZSE', 'NZSP', 'NZSJ'] },
  'goldeneye-vr': { name: 'GoldenEye 007', codes: ['NGEE', 'NGEP', 'NGEJ'] },
  'perfect-dark-vr': { name: 'Perfect Dark', codes: ['NPDE', 'NPDP', 'NPDJ'] },
  'xrkart-64': { name: 'Mario Kart 64', codes: ['NKTE', 'NKTP', 'NKTJ'] },
  'mega-man-64-vr': { name: 'Mega Man 64', codes: ['NM6E'] },
};

function normalizeN64(bytes) {
  const magic = bytes.readUInt32BE(0);
  if (magic === 0x80371240) return bytes;
  const result = Buffer.from(bytes);
  if (magic === 0x37804012) {
    for (let i = 0; i + 1 < result.length; i += 2) [result[i], result[i + 1]] = [result[i + 1], result[i]];
  } else if (magic === 0x40123780) {
    for (let i = 0; i + 3 < result.length; i += 4) {
      [result[i], result[i + 1], result[i + 2], result[i + 3]] = [result[i + 3], result[i + 2], result[i + 1], result[i]];
    }
  } else throw new Error('File is not a Nintendo 64 ROM');
  return result;
}

async function verifyZipStructure(file) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 52) throw new Error('ZIP archive is incomplete');
    const tail = Buffer.alloc(Math.min(size, 65557));
    await handle.read(tail, 0, tail.length, size - tail.length);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    }
    if (end < 0 || tail.readUInt16LE(end + 10) < 1) throw new Error('ZIP archive has no readable directory');
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (directoryOffset + directorySize > size || directorySize < 46) throw new Error('ZIP archive directory is invalid');
    const signature = Buffer.alloc(4);
    await handle.read(signature, 0, 4, directoryOffset);
    if (signature.readUInt32LE(0) !== 0x02014b50) throw new Error('ZIP archive directory is invalid');
  } finally { await handle.close(); }
}

async function verifyGameFile(game, item, file) {
  if (item.kind !== 'file') throw new Error('Choose a regular game file');
  const extension = path.extname(file).toLowerCase();
  if (!item.extensions?.map((value) => value.toLowerCase()).includes(extension)) throw new Error(`${item.label} must be ${item.extensions.join(', ')}`);
  const handle = await fs.open(file, 'r');
  let bytes;
  try {
    const buffer = Buffer.alloc(game.id === 'wii-compiled' && extension === '.wbfs' ? 520 : 64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    bytes = buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
  if (game.id === 'pokemon-gen1-vr') {
    const stat = await fs.stat(file);
    if (stat.size !== 1024 * 1024) throw new Error('Pokémon Red or Blue US ROM must be 1 MiB');
    const hash = crypto.createHash('sha1');
    const input = require('node:fs').createReadStream(file);
    for await (const chunk of input) hash.update(chunk);
    if (!pokemonGen1Hashes.has(hash.digest('hex'))) throw new Error('ROM does not match the supported US Pokémon Red or Blue revision');
    return { level: 'hash', message: 'Pokémon Red or Blue US ROM SHA-1 matches the supported release' };
  }
  if (['.iso', '.gcm'].includes(extension) && ['xelee', 'twilight-vr', 'wii-compiled'].includes(game.id)) {
    const code = bytes.toString('ascii', 0, 6);
    if (game.id === 'xelee') {
      if (code !== 'GALE01' || bytes[7] !== 2) throw new Error('Xelee requires the NTSC-U Melee 1.02 disc (revision 2)');
      return { level: 'title', message: 'Melee NTSC-U 1.02 disc header matches' };
    }
    if (game.id === 'twilight-vr') {
      if (!/^(?:GZ2|RZD)[EPJ]01$/.test(code)) throw new Error('Disc does not match Twilight Princess');
      return { level: 'title', message: 'Twilight Princess disc header matches; exact edition is not independently verified' };
    }
    if (code !== 'RMCP01') throw new Error('WiiCompiled requires a clean PAL Mario Kart Wii disc (RMCP01)');
    return { level: 'title', message: 'PAL Mario Kart Wii RMCP01 disc header matches; exact dump is not independently verified' };
  }
  if (game.id === 'wii-compiled' && extension === '.wbfs') {
    if (bytes.toString('ascii', 0, 4) !== 'WBFS' || bytes.toString('ascii', 512, 518) !== 'RMCP01') throw new Error('WiiCompiled requires a clean PAL Mario Kart Wii disc (RMCP01)');
    return { level: 'title', message: 'PAL Mario Kart Wii RMCP01 WBFS header matches; exact dump is not independently verified' };
  }
  if (['.z64', '.n64', '.v64'].includes(extension)) {
    if (bytes.length < 64) throw new Error('Nintendo 64 ROM is too small');
    const code = normalizeN64(bytes).toString('ascii', 0x3b, 0x3f);
    if (game.id === 'fzero-x-virtuavr') {
      const rom = await fs.readFile(file);
      if (rom.length !== 16 * 1024 * 1024) throw new Error('F-Zero X VR requires an unmodified 16 MiB US Rev 0 ROM');
      const digest = crypto.createHash('sha1').update(normalizeN64(rom)).digest('hex');
      if (digest !== '5f658e88ffa9de23cba6986a8fd3d3a90d7b4340') throw new Error('F-Zero X ROM does not match the required US Rev 0 release (SHA-1)');
      return { level: 'hash', message: 'F-Zero X US Rev 0 SHA-1 matches the port requirement' };
    }
    const expected = n64Games[game.id];
    if (expected && !expected.codes.includes(code)) throw new Error(`ROM does not match ${expected.name} (${code || 'unknown'} found)`);
    return { level: expected ? 'title' : 'format', message: expected ? `${expected.name} cartridge header matches; exact revision is not verified` : 'Nintendo 64 ROM format matches; game identity is not verified' };
  }
  if (extension === '.zip') {
    if (bytes.length < 4 || bytes.toString('hex', 0, 4) !== '504b0304') throw new Error('File is not a readable ZIP archive');
    await verifyZipStructure(file);
    return { level: 'format', message: 'ZIP structure matches; ROM set contents are not independently verified' };
  }
  if (extension === '.7z') {
    if (bytes.toString('hex', 0, 6) !== '377abcaf271c') throw new Error('File is not a 7-Zip archive');
    return { level: 'format', message: '7-Zip format matches; game identity is not independently verified' };
  }
  return { level: 'extension', message: `${extension.toUpperCase()} extension matches; game identity is not independently verified` };
}

module.exports = { verifyGameFile };
