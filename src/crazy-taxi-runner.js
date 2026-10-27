const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const ORIGINAL_NAME = 'com.sega.CrazyTaxiplayhaven_6.0-80_2arch_7dpi_24lang_1feat_017e8b1c582569ff9682193551b7e22c_apkmirror.com.apkm';
const BASE_PACKAGE = 'com.sega.CrazyTaxiplayhaven';
const VR_PACKAGE = 'com.baywilly.crazytaxivr';
const PATCH = Object.freeze({
  url: 'https://github.com/Baywilly/Crazy-Taxi-VR-Standalone/releases/download/v0.1-beta/crazywilly.xdelta',
  sha256: '414518a5ff8e1103488ffba0c74a80807df1d61329e5f628a09dcd3d8a8b0025',
  maxBytes: 400 * 1024 * 1024,
});
// Delta Patcher is a GUI with no documented unattended interface. The xdelta
// project's signed release supplies the compatible command-line decoder.
const TOOL = Object.freeze({
  url: 'https://github.com/jmacd/xdelta/releases/download/v3.2.2/xdelta3-3.2.2-windows-x86_64.zip',
  sha256: 'd48f7651d86b78fdca397057b46601f89131f37219675df736db70af44ec3379',
  maxBytes: 2 * 1024 * 1024,
});
const runFile = promisify(execFile);

async function readAt(handle, length, position) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error('ZIP archive is truncated');
  return buffer;
}

async function zipDirectory(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new Error('ZIP archive is incomplete');
    const tail = await readAt(handle, Math.min(size, 65557), size - Math.min(size, 65557));
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) {
        end = index;
        break;
      }
    }
    if (end < 0) throw new Error('ZIP archive has no valid directory');
    const count = tail.readUInt16LE(end + 10);
    const length = tail.readUInt32LE(end + 12);
    const offset = tail.readUInt32LE(end + 16);
    if (!count || count > 5000 || length > 16 * 1024 * 1024 || offset + length > size || length < count * 46) {
      throw new Error('ZIP archive directory is invalid or too large');
    }
    const directory = await readAt(handle, length, offset);
    const entries = [];
    let cursor = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > length || directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP archive directory is invalid');
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      if (cursor + 46 + nameLength + extraLength + commentLength > length) throw new Error('ZIP archive directory is invalid');
      const name = directory.toString('utf8', cursor + 46, cursor + 46 + nameLength);
      entries.push({
        name,
        method: directory.readUInt16LE(cursor + 10),
        compressed: directory.readUInt32LE(cursor + 20),
        uncompressed: directory.readUInt32LE(cursor + 24),
        offset: directory.readUInt32LE(cursor + 42),
      });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (cursor !== length) throw new Error('ZIP archive directory is invalid');
    return entries;
  } finally { await handle.close(); }
}

async function readZipEntry(file, entry, maxBytes) {
  if (!entry || entry.uncompressed > maxBytes || entry.compressed > maxBytes || ![0, 8].includes(entry.method)) {
    throw new Error('ZIP entry is missing, too large, or uses unsupported compression');
  }
  const handle = await fsp.open(file, 'r');
  try {
    const header = await readAt(handle, 30, entry.offset);
    if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== entry.method) {
      throw new Error('ZIP entry header is invalid');
    }
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const localName = await readAt(handle, nameLength, entry.offset + 30);
    if (localName.toString('utf8') !== entry.name) throw new Error('ZIP entry name differs from directory');
    const packed = await readAt(handle, entry.compressed, entry.offset + 30 + nameLength + extraLength);
    const bytes = entry.method === 8 ? zlib.inflateRawSync(packed, { maxOutputLength: maxBytes }) : packed;
    if (bytes.length !== entry.uncompressed) throw new Error('ZIP entry size differs from directory');
    return bytes;
  } finally { await handle.close(); }
}

function uniqueEntry(entries, name) {
  const found = entries.filter((entry) => entry.name === name);
  if (found.length !== 1) throw new Error(`ZIP archive must contain one ${name}`);
  return found[0];
}

async function inspectCrazyTaxiOriginal(originalPath) {
  if (typeof originalPath !== 'string' || !path.isAbsolute(originalPath) || !['.apk', '.apkm'].includes(path.extname(originalPath).toLowerCase())) {
    throw new Error('Choose a Crazy Taxi Android .apk or .apkm file');
  }
  const stat = await fsp.lstat(originalPath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 100) throw new Error('Choose an existing regular Crazy Taxi Android file');
  const entries = await zipDirectory(originalPath);
  if (entries.some((entry) => entry.name === 'AndroidManifest.xml')) {
    const manifest = await readZipEntry(originalPath, uniqueEntry(entries, 'AndroidManifest.xml'), 4 * 1024 * 1024);
    const packageId = packageFromManifest(manifest);
    if (packageId === VR_PACKAGE) return { kind: 'vr-apk', packageId, message: 'Crazy Taxi VR APK package verified; patching is not needed' };
    if (packageId === BASE_PACKAGE) throw new Error('This is a base Crazy Taxi APK. The author’s patch needs the compatible APKM archive, or you can provide an already patched Crazy Taxi VR APK.');
    throw new Error(`APK is not Crazy Taxi VR (package ID: ${packageId})`);
  }
  uniqueEntry(entries, 'base.apk');
  const metadata = JSON.parse((await readZipEntry(originalPath, uniqueEntry(entries, 'info.json'), 1024 * 1024)).toString('utf8'));
  if (metadata.pname !== BASE_PACKAGE) throw new Error('Original APKM package is not Crazy Taxi for Android');
  const version = String(metadata.release_version || '');
  if (!/^6\.0(?:-80)?(?:\s|$)/.test(version)) throw new Error('Original APKM version is not Crazy Taxi 6.0-80');
  if (version === '6.0' && metadata.versioncode != null && String(metadata.versioncode) !== '80') {
    throw new Error('Original APKM version code is not 80');
  }
  return { kind: 'original-apkm', packageId: BASE_PACKAGE, message: 'Crazy Taxi APKM package and version metadata match; the patch decoder will check binary compatibility' };
}

function axmlStrings(bytes, offset, chunkSize) {
  const count = bytes.readUInt32LE(offset + 8);
  const flags = bytes.readUInt32LE(offset + 16);
  const start = bytes.readUInt32LE(offset + 20);
  if (count > 100000 || start >= chunkSize || 28 + count * 4 > chunkSize) throw new Error('APK manifest string table is invalid');
  const result = [];
  for (let i = 0; i < count; i++) {
    let cursor = offset + start + bytes.readUInt32LE(offset + 28 + i * 4);
    if (cursor >= offset + chunkSize) throw new Error('APK manifest string table is invalid');
    if (flags & 0x100) {
      const utf16 = bytes[cursor++];
      if (utf16 & 0x80) cursor++;
      let length = bytes[cursor++];
      if (length & 0x80) length = ((length & 0x7f) << 8) | bytes[cursor++];
      if (cursor + length >= offset + chunkSize) throw new Error('APK manifest string table is invalid');
      result.push(bytes.toString('utf8', cursor, cursor + length));
    } else {
      let length = bytes.readUInt16LE(cursor); cursor += 2;
      if (length & 0x8000) { length = ((length & 0x7fff) << 16) | bytes.readUInt16LE(cursor); cursor += 2; }
      if (cursor + length * 2 >= offset + chunkSize) throw new Error('APK manifest string table is invalid');
      result.push(bytes.toString('utf16le', cursor, cursor + length * 2));
    }
  }
  return result;
}

function packageFromManifest(bytes) {
  if (bytes.length < 8 || bytes.readUInt16LE(0) !== 0x0003 || bytes.readUInt32LE(4) > bytes.length) {
    throw new Error('APK has no binary Android manifest');
  }
  const strings = [];
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const type = bytes.readUInt16LE(offset);
    const headerSize = bytes.readUInt16LE(offset + 2);
    const size = bytes.readUInt32LE(offset + 4);
    if (size < headerSize || headerSize < 8 || offset + size > bytes.length) throw new Error('APK manifest chunk is invalid');
    if (type === 0x0001) strings.push(...axmlStrings(bytes, offset, size));
    if (type === 0x0102 && strings[bytes.readUInt32LE(offset + 20)] === 'manifest') {
      const attributeStart = bytes.readUInt16LE(offset + 24);
      const attributeSize = bytes.readUInt16LE(offset + 26);
      const count = bytes.readUInt16LE(offset + 28);
      if (attributeSize < 20 || count > 1000) throw new Error('APK manifest attributes are invalid');
      for (let index = 0; index < count; index++) {
        const at = offset + 16 + attributeStart + index * attributeSize;
        if (at + 20 > offset + size) throw new Error('APK manifest attributes are invalid');
        if (strings[bytes.readUInt32LE(at + 4)] !== 'package') continue;
        const raw = bytes.readUInt32LE(at + 8);
        const value = raw !== 0xffffffff ? strings[raw]
          : bytes[at + 15] === 3 ? strings[bytes.readUInt32LE(at + 16)] : null;
        if (!/^[A-Za-z][A-Za-z0-9_.]+$/.test(value || '')) throw new Error('APK manifest package ID is invalid');
        return value;
      }
    }
    offset += size;
  }
  throw new Error('APK manifest package ID could not be read');
}

async function readApkPackage(apkPath) {
  const entries = await zipDirectory(apkPath);
  const manifest = await readZipEntry(apkPath, uniqueEntry(entries, 'AndroidManifest.xml'), 4 * 1024 * 1024);
  return packageFromManifest(manifest);
}

async function downloadVerified(asset, target, fetchImpl, signal) {
  const timeout = AbortSignal.timeout(15 * 60 * 1000);
  const response = await fetchImpl(asset.url, {
    headers: { 'User-Agent': 'VR4All-Crazy-Taxi' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok || !response.body) throw new Error(`Official Crazy Taxi dependency download failed (${response.status})`);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const bounded = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > asset.maxBytes) callback(new Error('Official Crazy Taxi dependency exceeds download limit'));
    else { hash.update(chunk); callback(null, chunk); }
  } });
  await pipeline(Readable.fromWeb(response.body), bounded, fs.createWriteStream(target, { flags: 'wx' }), { signal });
  if (!bytes || hash.digest('hex') !== asset.sha256) throw new Error('Official Crazy Taxi dependency failed SHA-256 verification');
}

async function installOnQuest(adb, serial, apkPath, onLog = () => {}) {
  const result = await adb.run(['-s', serial, 'install', '-r', apkPath], onLog);
  if (!/^Success$/m.test(String(result).trim())) throw new Error('ADB did not confirm APK install success');
  const paths = await adb.run(['-s', serial, 'shell', 'pm', 'path', VR_PACKAGE]);
  if (!/^package:\/\S+\.apk\s*$/m.test(String(paths))) throw new Error('Crazy Taxi VR package was not found on the selected Quest');
}

async function installCrazyTaxi(input, options = {}) {
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Choose a connected Quest');
  if (!input.adb || typeof input.adb.run !== 'function') throw new Error('ADB is unavailable');
  const original = await inspectCrazyTaxiOriginal(input.originalPath);
  const apkPath = input.outputPath || path.join(path.dirname(input.originalPath), 'Crazy-Taxi-VR-Standalone-v0.1-beta.apk');
  if (typeof apkPath !== 'string' || !path.isAbsolute(apkPath) || path.extname(apkPath).toLowerCase() !== '.apk'
    || path.resolve(apkPath) === path.resolve(input.originalPath)) throw new Error('Choose a distinct absolute APK output path');
  if (await fsp.lstat(apkPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))) {
    throw new Error('APK output path already exists');
  }
  const onLog = typeof input.onLog === 'function' ? input.onLog : () => {};
  if (original.kind === 'vr-apk') {
    onLog(original.message);
    const temporary = path.extname(input.originalPath).toLowerCase() === '.apkm'
      ? await fsp.mkdtemp(path.join(options.tempRoot || os.tmpdir(), 'vr4all-crazy-taxi-')) : null;
    try {
      const directApk = temporary ? path.join(temporary, 'Crazy-Taxi-VR.apk') : input.originalPath;
      if (temporary) await fsp.copyFile(input.originalPath, directApk, fs.constants.COPYFILE_EXCL);
      onLog('Installing the provided Crazy Taxi VR APK on the selected Quest...');
      await installOnQuest(input.adb, input.serial, directApk, onLog);
      return { apkPath: null, packageId: VR_PACKAGE, serial: input.serial, tag: null, kind: 'vr-apk' };
    } finally { if (temporary) await fsp.rm(temporary, { recursive: true, force: true }); }
  }
  const staging = await fsp.mkdtemp(path.join(options.tempRoot || os.tmpdir(), 'vr4all-crazy-taxi-'));
  try {
    const patchFile = path.join(staging, 'crazywilly.xdelta');
    const toolZip = path.join(staging, 'xdelta3.zip');
    onLog(original.message);
    onLog('Downloading the official Crazy Taxi VR patch...');
    await downloadVerified(PATCH, patchFile, options.fetchImpl || fetch, input.signal);
    onLog('Crazy Taxi VR patch SHA-256 verified.');
    await downloadVerified(TOOL, toolZip, options.fetchImpl || fetch, input.signal);
    onLog('Official xdelta decoder SHA-256 verified.');
    const entries = await zipDirectory(toolZip);
    const executables = entries.filter((entry) => /(?:^|\/)xdelta3\.exe$/i.test(entry.name) && !entry.name.includes('..'));
    if (executables.length !== 1) throw new Error('Official xdelta package must contain one decoder executable');
    const executable = path.join(staging, 'xdelta3.exe');
    const bytes = await readZipEntry(toolZip, executables[0], 5 * 1024 * 1024);
    if (bytes.subarray(0, 2).toString('ascii') !== 'MZ') throw new Error('Official xdelta decoder is not a Windows executable');
    await fsp.writeFile(executable, bytes, { flag: 'wx' });
    const stagedApk = path.join(staging, 'Crazy-Taxi-VR-Standalone.apk');
    onLog('Applying the patch to your owned Crazy Taxi APKM...');
    try {
      await (options.execFileImpl || runFile)(executable, ['-d', '-D', '-s', input.originalPath, patchFile, stagedApk], {
        windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 1024 * 1024, signal: input.signal,
      });
    } catch (error) {
      throw new Error(`Crazy Taxi patch failed; check the exact original APKM revision (${String(error.stderr || error.message).trim().slice(0, 250)})`);
    }
    const packageId = await readApkPackage(stagedApk);
    if (packageId !== VR_PACKAGE) throw new Error(`Patched APK has unexpected package ID: ${packageId}`);
    onLog('Patched Crazy Taxi VR APK package verified.');
    await fsp.mkdir(path.dirname(apkPath), { recursive: true });
    await fsp.copyFile(stagedApk, apkPath, fs.constants.COPYFILE_EXCL);
    onLog('Installing Crazy Taxi VR on the selected Quest...');
    await installOnQuest(input.adb, input.serial, apkPath, onLog);
    return { apkPath, packageId, serial: input.serial, tag: 'v0.1-beta', kind: 'original-apkm' };
  } finally { await fsp.rm(staging, { recursive: true, force: true }); }
}

module.exports = { ORIGINAL_NAME, inspectCrazyTaxiOriginal, readApkPackage, downloadVerified, installOnQuest, installCrazyTaxi };
