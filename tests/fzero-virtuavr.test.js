const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateVirtuaInput, findBundleRoot, installVirtuaFzero, extractorCommand, runExtractor } = require('../src/fzero-virtuavr-runner');

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

test('extractorCommand keeps plain paths on Windows', () => {
  const command = extractorCommand({ platform: 'win32', root: 'C:\\kit', rom: 'C:\\roms\\fzx.z64', output: 'C:\\out' });
  assert.equal(command.command, path.join('C:\\kit', 'tools', 'gdx-extract.exe'));
  assert.deepEqual(command.args, ['o2r', 'C:\\roms\\fzx.z64', '-s', path.join('C:\\kit', 'tools', 'decomp-recipes'), '-d', 'C:\\out', '-u', '2027490995']);
});

test('extractorCommand runs the pinned extractor through Wine with Z: paths and the output folder as cwd', { skip: process.platform === 'win32' && 'POSIX paths' }, () => {
  const command = extractorCommand({ platform: 'linux', root: '/tmp/kit root', rom: '/home/me/My Roms/fzx.z64', output: '/tmp/out dir/data', launcher: { kind: 'wine', path: '/usr/bin/wine' }, prefixRoot: '/home/me/.vr4all/wine' });
  assert.equal(command.command, '/usr/bin/wine');
  assert.deepEqual(command.args, ['/tmp/kit root/tools/gdx-extract.exe', 'o2r', 'Z:\\home\\me\\My Roms\\fzx.z64', '-s', 'Z:\\tmp\\kit root\\tools\\decomp-recipes', '-d', 'Z:\\tmp\\out dir\\data', '-u', '2027490995']);
  assert.equal(command.cwd, '/tmp/out dir/data');
  assert.equal(command.env.WINEPREFIX, '/home/me/.vr4all/wine/wine');
  assert.equal(command.prefixDir, '/home/me/.vr4all/wine/wine');
});

test('Linux extractor needs a Wine launcher, filters factory noise and removes the stray Torch hash file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-fzero-wine-'));
  try {
    await assert.rejects(runExtractor('/k', '/r.z64', root, () => {}, { platform: 'linux', launcher: null, prefixRoot: root }), /Wine is required/);
    const logs = [];
    const calls = [];
    const output = path.join(root, 'out');
    await fs.mkdir(output);
    const runner = async (command, args, options) => {
      calls.push({ command, args, options });
      options.onLine('Registered factory X');
      options.onLine('Extracting 69 recipes');
      await fs.writeFile(path.join(output, 'torch.hash.yml'), 'stray');
      return { code: 0, signal: null, stdout: '', tail: [] };
    };
    await runExtractor('/k', '/r.z64', output, (line) => logs.push(line), { platform: 'linux', launcher: { kind: 'wine', path: '/usr/bin/wine' }, prefixRoot: path.join(root, 'prefix'), runner });
    assert.deepEqual(logs, ['Extracting 69 recipes']);
    assert.equal(calls[0].options.cwd, output);
    assert.equal(calls[0].options.timeoutMs, 10 * 60 * 1000);
    assert.equal(calls[0].options.env.WINEPREFIX, path.join(root, 'prefix', 'wine'));
    assert.ok((await fs.stat(path.join(root, 'prefix', 'wine'))).isDirectory());
    assert.equal(await fs.stat(path.join(output, 'torch.hash.yml')).catch(() => null), null);
    await assert.rejects(runExtractor('/k', '/r.z64', output, () => {}, { platform: 'linux', launcher: { kind: 'wine', path: '/usr/bin/wine' }, prefixRoot: root, runner: async () => ({ code: 3 }) }), /extraction failed \(exit 3\)/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
