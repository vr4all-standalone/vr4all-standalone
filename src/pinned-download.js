const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try { for await (const chunk of handle.createReadStream()) hash.update(chunk); } finally { await handle.close(); }
  return hash.digest('hex');
}

// Downloads `url` to `destination` only if the bytes match the SHA-256 pinned by VR4ALL.
// A cached file is reused when it matches; a cached file that does not match is never overwritten.
async function downloadPinned({ name, url, sha256, maxBytes, destination, fetchImpl = fetch, signal, log = () => {} }) {
  const expected = String(sha256).toLowerCase();
  const existing = await fs.lstat(destination).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing?.isSymbolicLink()) throw new Error(`${name} destination must not be a link: ${destination}`);
  if (existing) {
    if (!existing.isFile()) throw new Error(`${name} destination is not a file: ${destination}`);
    if (await hashFile(destination) !== expected) throw new Error(`${name} at ${destination} does not match its pinned SHA-256. Delete it and retry.`);
    log(`Reusing verified ${name}.`);
    return destination;
  }
  log(`Downloading ${name}...`);
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'VR4ALL' }, signal });
  if (!response.ok || !response.body) throw new Error(`${name} download failed (HTTP ${response.status})`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  try {
    await pipeline(Readable.fromWeb(response.body), async function* count(source) {
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error(`${name} download exceeds the expected size`);
        hash.update(chunk);
        yield chunk;
      }
    }, createWriteStream(partial, { flags: 'w' }));
    if (hash.digest('hex') !== expected) throw new Error(`${name} failed SHA-256 verification`);
    await fs.rename(partial, destination);
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  }
  return destination;
}

module.exports = { downloadPinned };
