const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const zlib = require('node:zlib');

const run = promisify(execFile);

async function findAapt(adbPath) {
  if (!adbPath) return null;
  const sdk = path.dirname(path.dirname(adbPath));
  const buildTools = path.join(sdk, 'build-tools');
  const versions = await fs.readdir(buildTools).catch(() => []);
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const file = path.join(buildTools, version, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
    if (await fs.stat(file).then((stat) => stat.isFile()).catch(() => false)) return file;
  }
  return null;
}

async function inspectApkPackage(file, adbPath) {
  const handle = await fs.open(file, 'r');
  try {
    const magic = Buffer.alloc(4);
    const { bytesRead } = await handle.read(magic, 0, 4, 0);
    if (bytesRead !== 4 || magic.toString('hex') !== '504b0304') throw new Error('Not an APK ZIP archive');
  } finally { await handle.close(); }
  const aapt = await findAapt(adbPath);
  let packageId = null;
  if (aapt) {
    const { stdout } = await run(aapt, ['dump', 'badging', file], { timeout: 20000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    packageId = stdout.match(/^package: name='([^']+)'/m)?.[1];
  } else packageId = await readManifestPackage(file);
  if (!packageId) throw new Error('APK package ID could not be read');
  return packageId;
}

// Portable builds bundle ADB but not the Android SDK. Read just the compressed
// AndroidManifest.xml ZIP entry so local and downloaded APKs can still be
// identity-checked and remembered without requiring aapt on the user's PC.
async function readManifestAttribute(file, attribute) {
  const handle = await fs.open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    const tailLength = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('APK ZIP directory was not found');
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (centralSize > 16 * 1024 * 1024 || centralOffset + centralSize > size) throw new Error('APK ZIP directory is invalid');
    const central = Buffer.alloc(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    let entry = null;
    for (let offset = 0; offset + 46 <= central.length && central.readUInt32LE(offset) === 0x02014b50;) {
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const name = central.toString('utf8', offset + 46, offset + 46 + nameLength);
      if (name === 'AndroidManifest.xml') {
        entry = { method: central.readUInt16LE(offset + 10), compressedSize: central.readUInt32LE(offset + 20), uncompressedSize: central.readUInt32LE(offset + 24), localOffset: central.readUInt32LE(offset + 42) };
        break;
      }
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (!entry || entry.compressedSize > 4 * 1024 * 1024 || entry.uncompressedSize > 4 * 1024 * 1024) throw new Error('APK manifest is missing or too large');
    const local = Buffer.alloc(30);
    await handle.read(local, 0, 30, entry.localOffset);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('APK manifest entry is invalid');
    const dataOffset = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    const compressed = Buffer.alloc(entry.compressedSize);
    await handle.read(compressed, 0, compressed.length, dataOffset);
    const manifest = entry.method === 8 ? zlib.inflateRawSync(compressed, { maxOutputLength: 4 * 1024 * 1024 }) : entry.method === 0 ? compressed : null;
    if (!manifest) throw new Error('APK manifest compression is unsupported');
    return binaryXmlAttribute(manifest, attribute);
  } finally { await handle.close(); }
}

function binaryXmlAttribute(xml, attribute) {
  if (xml.length < 8 || xml.readUInt16LE(0) !== 0x0003) return null;
  let strings = [];
  for (let offset = xml.readUInt16LE(2); offset + 8 <= xml.length;) {
    const type = xml.readUInt16LE(offset);
    const headerSize = xml.readUInt16LE(offset + 2);
    const chunkSize = xml.readUInt32LE(offset + 4);
    if (chunkSize < headerSize || offset + chunkSize > xml.length) break;
    if (type === 0x0001) {
      const count = xml.readUInt32LE(offset + 8);
      const utf8 = Boolean(xml.readUInt32LE(offset + 16) & 0x100);
      const start = offset + xml.readUInt32LE(offset + 20);
      if (count > 100000) break;
      strings = Array.from({ length: count }, (_, i) => {
        let cursor = start + xml.readUInt32LE(offset + headerSize + 4 * i);
        if (cursor >= offset + chunkSize) return '';
        if (utf8) {
          cursor += xml[cursor] & 0x80 ? 2 : 1; // UTF-16 character count
          let length = xml[cursor++];
          if (length & 0x80) length = ((length & 0x7f) << 8) | xml[cursor++];
          return xml.toString('utf8', cursor, cursor + length);
        }
        let length = xml.readUInt16LE(cursor); cursor += 2;
        if (length & 0x8000) { length = ((length & 0x7fff) << 16) | xml.readUInt16LE(cursor); cursor += 2; }
        return xml.toString('utf16le', cursor, cursor + length * 2);
      });
    }
    if (type === 0x0102 && strings[xml.readUInt32LE(offset + 20)] === 'manifest') {
      const firstAttribute = offset + 16 + xml.readUInt16LE(offset + 24);
      const attributeSize = xml.readUInt16LE(offset + 26);
      const count = xml.readUInt16LE(offset + 28);
      for (let i = 0; i < count; i++) {
        const attr = firstAttribute + i * attributeSize;
        if (attr + 20 > offset + chunkSize) break;
        if (strings[xml.readUInt32LE(attr + 4)] !== attribute) continue;
        const raw = xml.readUInt32LE(attr + 8);
        const value = strings[raw === 0xffffffff ? xml.readUInt32LE(attr + 16) : raw];
        if (attribute === 'split') {
          if (!/^[A-Za-z0-9_.-]+$/.test(value || '')) throw new Error('APK manifest has an unsafe split identity');
          return value;
        }
        return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(value || '') ? value : null;
      }
    }
    offset += chunkSize;
  }
  return null;
}

const readManifestPackage = (file) => readManifestAttribute(file, 'package');
const readManifestSplit = (file) => readManifestAttribute(file, 'split');
module.exports = { inspectApkPackage, readManifestPackage, readManifestSplit };
