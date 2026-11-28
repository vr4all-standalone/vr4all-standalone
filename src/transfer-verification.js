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

async function verifyRequiredRemoteFiles(adb, serial, localRoot, remoteRoot, requiredPaths) {
  if (!Array.isArray(requiredPaths) || !requiredPaths.length) throw new Error('No game file manifest to verify');
  let bytes = 0;
  for (let index = 0; index < requiredPaths.length; index += 10) {
    const names = requiredPaths.slice(index, index + 10);
    if (names.some((name) => !/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').includes('..'))) throw new Error('Invalid game file manifest path');
    const localSizes = await Promise.all(names.map(async (name) => (await fs.stat(path.join(localRoot, ...name.split('/')))).size));
    const remotePaths = names.map((name) => path.posix.join(remoteRoot, name));
    let output;
    try {
      output = await adb.run(['-s', serial, 'shell', 'stat', '-c', '%s', ...remotePaths]);
    } catch (error) {
      throw new Error(`Game data transfer could not be confirmed on the headset (${names[0]}): ${error.message}`);
    }
    const remoteSizes = String(output).trim().split(/\r?\n/);
    for (let offset = 0; offset < names.length; offset++) {
      const size = remoteSizes[offset];
      if (!/^\d+$/.test(size || '') || Number(size) !== localSizes[offset]) {
        throw new Error(`Game data transfer is incomplete on the headset (${names[offset]}): expected ${localSizes[offset]} bytes, found ${size || 'no readable size'}`);
      }
      bytes += localSizes[offset];
    }
  }
  return { files: requiredPaths.length, bytes };
}

module.exports = { verifyPushedFile, verifyRequiredRemoteFiles };
