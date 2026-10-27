const fs = require('node:fs/promises');
const path = require('node:path');

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function verifyPushedFile(adb, serial, local, destination) {
  const source = await fs.stat(local);
  if (!source.isFile()) return null;
  const remote = destination.endsWith('/') ? path.posix.join(destination, path.basename(local)) : destination;
  let output;
  try {
    output = await adb.run(['-s', serial, 'shell', 'stat', '-c', '%s', shellQuote(remote)]);
  } catch (error) {
    throw new Error(`Game file transfer could not be confirmed on the headset (${path.basename(local)}): ${error.message}`);
  }
  const size = String(output).trim();
  if (!/^\d+$/.test(size) || Number(size) !== source.size) {
    throw new Error(`Game file transfer is incomplete on the headset (${path.basename(local)}): expected ${source.size} bytes, found ${size || 'no readable size'}`);
  }
  return { remote, bytes: source.size };
}

module.exports = { verifyPushedFile };
