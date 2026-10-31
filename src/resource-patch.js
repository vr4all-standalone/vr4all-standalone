const fs = require('node:fs/promises');
const path = require('node:path');
const { extractDirectoryArchive, removeConversionDirectory } = require('./archive-conversion');

const patchContents = {
  label: 'Official re:Source Unofficial Patch',
  kind: 'directory',
  requiredEntries: ['pack.json'],
  requiredDirectories: ['Unofficial_Patch'],
  requiredNestedEntries: { 'Unofficial_Patch/scripts': ['liblist.gam'] },
};

async function prepareResourcePatch(releases, source, onLog = () => {}) {
  const release = await releases.latest(source);
  if (!release || release.stale) throw new Error('The current re:Source patch could not be confirmed on GitHub');
  onLog(`Downloading the creator's ${release.assetName} patch...`);
  let lastPercent = -10;
  const archive = await releases.downloadPackage(release, (done, total) => {
    const percent = total ? Math.floor(done / total * 100) : 0;
    if (total && percent >= lastPercent + 10) { lastPercent = percent; onLog(`Patch download ${percent}%`); }
  });
  onLog('Extracting and checking the creator patch...');
  const extracted = await extractDirectoryArchive(patchContents, archive, { maxEntries: 20000 });
  try {
    const root = extracted.path;
    for (const name of ['pack.json', 'Unofficial_Patch/scripts/liblist.gam']) {
      if (!(await fs.stat(path.join(root, ...name.split('/'))).catch(() => null))?.isFile()) {
        throw new Error(`Creator patch is missing ${name}`);
      }
    }
    return { path: root, release, cleanup: () => removeConversionDirectory(extracted.directory) };
  } catch (error) {
    await removeConversionDirectory(extracted.directory);
    throw error;
  }
}

async function transferResourcePatch(adb, serial, root, onLog = () => {}) {
  for (const name of ['Unofficial_Patch', 'credits', 'pack.json']) {
    const local = path.join(root, name);
    const stat = await fs.stat(local).catch(() => null);
    if (!stat || !stat.size && stat.isFile()) throw new Error(`Creator patch is missing ${name}`);
    if (name === 'pack.json' ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error(`Creator patch has an invalid ${name}`);
    }
  }
  await adb.run(['-s', serial, 'shell', 'mkdir', '-p', '/sdcard/vtmb']);
  for (const name of ['Unofficial_Patch', 'credits', 'pack.json']) {
    onLog(`Copying creator patch ${name}...`);
    await adb.run(['-s', serial, 'push', path.join(root, name), '/sdcard/vtmb/']);
  }
  for (const index of ['/sdcard/vtmb/Vampire/.vtmb-index', '/sdcard/vtmb/Unofficial_Patch/.vtmb-index']) {
    await adb.run(['-s', serial, 'shell', 'rm', '-f', index]);
  }
  const check = await adb.run(['-s', serial, 'shell', 'ls', '-1', '/sdcard/vtmb/Unofficial_Patch/scripts/']);
  if (!check.split(/\r?\n/).includes('liblist.gam')) throw new Error('The creator patch did not transfer to the expected headset folder');
}

module.exports = { prepareResourcePatch, transferResourcePatch, patchContents };
