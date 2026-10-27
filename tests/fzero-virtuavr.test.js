const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateVirtuaInput, findBundleRoot, installVirtuaFzero } = require('../src/fzero-virtuavr-runner');

test('VirtuaVRPort installer rejects an incorrect ROM and an unknown creator bundle before device work', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-fzero-test-'));
  try {
    const rom = path.join(root, 'F-Zero X (USA).z64');
    const bundle = path.join(root, 'creator.zip');
    await fs.writeFile(rom, Buffer.alloc(16 * 1024 * 1024));
    await fs.writeFile(bundle, 'not the creator bundle');
    await assert.rejects(validateVirtuaInput({ serial: 'Q3', gamePackage: rom, audioSource: bundle }), /ROM.*US Rev 0|SHA-1/i);
    await assert.rejects(validateVirtuaInput({ serial: 'Q3', gamePackage: bundle, audioSource: bundle }), /\.z64/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('VirtuaVRPort bundle root detection handles the creator ZIP outer folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-fzero-root-'));
  try {
    const outer = path.join(root, 'FZeroXVR-Public-Quest-20261018-R10');
    await fs.mkdir(outer);
    await fs.writeFile(path.join(outer, 'Quest-Install.ps1'), 'fixture');
    assert.equal(await findBundleRoot(root), outer);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('VirtuaVRPort installer verifies inputs before running its checked extractor or ADB', async () => {
  let extracted = false;
  await assert.rejects(installVirtuaFzero({ serial: 'Q3', gamePackage: 'C:\\not-a-rom.z64', audioSource: 'C:\\not-a-bundle.zip' }, {
    extract: async () => { extracted = true; },
    adb: { run: async () => { throw new Error('ADB must not run'); } },
  }), /ROM|file/i);
  assert.equal(extracted, false);
});

test('VirtuaVRPort install cannot claim success without ADB', async () => {
  await assert.rejects(installVirtuaFzero({}, {}), /ADB is required/);
});
