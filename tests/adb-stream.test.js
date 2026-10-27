const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { commandToFile } = require('../src/adb');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(__dirname, '.adb-stream-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, 'pack.partial');
}

test('binary ADB output streams to a file without stderr or text conversion', async (t) => {
  const target = await fixture(t);
  const bytes = Buffer.from([0, 10, 13, 255, 128, 1, 0]);
  await commandToFile(process.execPath, ['-e', "process.stderr.write('progress only'); process.stdout.write(Buffer.from([0,10,13,255,128,1,0]));"], target, { maxBytes: 7 });
  assert.deepEqual(await fs.readFile(target), bytes);
});

test('a failed or oversized binary transfer removes only its own partial file', async (t) => {
  const target = await fixture(t);
  await assert.rejects(commandToFile(process.execPath, ['-e', "process.stdout.write('partial'); process.exitCode=1;"], target, { maxBytes: 32 }), /exit|failed/i);
  assert.equal(await fs.stat(target).catch(() => null), null);
  await assert.rejects(commandToFile(process.execPath, ['-e', "process.stdout.write('oversized');"], target, { maxBytes: 3 }), /size|limit|large/i);
  assert.equal(await fs.stat(target).catch(() => null), null);
});

test('binary transfer cannot overwrite or delete an existing destination', async (t) => {
  const target = await fixture(t);
  await fs.writeFile(target, 'keep this');
  await assert.rejects(commandToFile(process.execPath, ['-e', "process.stdout.write('new');"], target, { maxBytes: 10 }), /exist|EEXIST/i);
  assert.equal(await fs.readFile(target, 'utf8'), 'keep this');
});

test('a missing binary releases its timeout instead of keeping the host process alive', async (t) => {
  const target = await fixture(t);
  const source = `require(${JSON.stringify(require.resolve('../src/adb'))}).commandToFile(${JSON.stringify(path.join(path.dirname(target), 'missing-adb.exe'))}, [], ${JSON.stringify(target)}, {maxBytes: 1, timeoutMs: 5000}).then(() => {process.exitCode=1;}, () => {});`;
  await promisify(execFile)(process.execPath, ['-e', source], { windowsHide: true, timeout: 2000 });
  assert.equal(await fs.stat(target).catch(() => null), null);
});
