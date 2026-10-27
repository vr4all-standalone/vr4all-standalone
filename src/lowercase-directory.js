const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectDirectory, removeConversionDirectory } = require('./archive-conversion');

async function stageLowercaseDirectory(source) {
  await inspectDirectory(source);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-convert-'));
  const output = path.join(directory, 'contents');
  try {
    async function copy(from, to) {
      await fs.mkdir(to, { recursive: true });
      for (const entry of await fs.readdir(from, { withFileTypes: true })) {
        const destination = path.join(to, entry.name.toLowerCase());
        if (entry.isDirectory()) await copy(path.join(from, entry.name), destination);
        else if (entry.isFile()) await fs.copyFile(path.join(from, entry.name), destination);
        else throw new Error('Game folder contains a link or unsupported file');
      }
    }
    await copy(source, output);
    return { path: output, directory };
  } catch (error) {
    await removeConversionDirectory(directory);
    throw error;
  }
}

module.exports = { stageLowercaseDirectory };
