function apk(entries, packageId, split) {
  const strings = ['manifest', 'package', packageId, ...(split === undefined ? [] : ['split', split])];
  const encoded = strings.map((value) => Buffer.concat([Buffer.from([value.length, Buffer.byteLength(value)]), Buffer.from(value), Buffer.from([0])]));
  const pool = Buffer.alloc(28 + 4 * strings.length);
  pool.writeUInt16LE(1); pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(pool.length + encoded.reduce((sum, bytes) => sum + bytes.length, 0), 4);
  pool.writeUInt32LE(strings.length, 8); pool.writeUInt32LE(0x100, 16); pool.writeUInt32LE(pool.length, 20);
  let cursor = 0;
  encoded.forEach((bytes, index) => { pool.writeUInt32LE(cursor, 28 + index * 4); cursor += bytes.length; });
  const start = Buffer.alloc(split === undefined ? 56 : 76);
  start.writeUInt16LE(0x102); start.writeUInt16LE(16, 2); start.writeUInt32LE(start.length, 4);
  start.writeUInt32LE(0xffffffff, 16); start.writeUInt16LE(20, 24); start.writeUInt16LE(20, 26); start.writeUInt16LE(split === undefined ? 1 : 2, 28);
  start.writeUInt32LE(0xffffffff, 36); start.writeUInt32LE(1, 40); start.writeUInt32LE(2, 44);
  start.writeUInt16LE(8, 48); start.writeUInt8(3, 51); start.writeUInt32LE(2, 52);
  if (split !== undefined) {
    start.writeUInt32LE(0xffffffff, 56); start.writeUInt32LE(3, 60); start.writeUInt32LE(4, 64);
    start.writeUInt16LE(8, 68); start.writeUInt8(3, 71); start.writeUInt32LE(4, 72);
  }
  const header = Buffer.alloc(8); header.writeUInt16LE(3); header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + pool.readUInt32LE(4) + start.length, 4);
  entries = [['AndroidManifest.xml', Buffer.concat([header, pool, ...encoded, start])], ...entries.map((name) => [name, Buffer.from('owned fixture')])];
  const locals = [], central = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name); const local = Buffer.alloc(30); const directory = Buffer.alloc(46);
    const crc = require('node:zlib').crc32(bytes);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes); central.push(directory, filename); offset += local.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}


module.exports = { apk };
