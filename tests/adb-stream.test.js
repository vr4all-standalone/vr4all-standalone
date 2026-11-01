const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { commandToFile, commandWithInput, createAdb } = require('../src/adb');

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

const countInput = "let n=0;process.stdin.on('data',c=>n+=c.length).on('end',()=>process.stdout.write(String(n)))";

test('a local file is piped byte-exact into the child stdin', async (t) => {
  const target = await fixture(t);
  const input = path.join(path.dirname(target), 'rom.bin');
  await fs.writeFile(input, Buffer.concat([Buffer.from([0, 0x1a, 13, 10, 255]), Buffer.alloc(300000, 7)]));
  const progress = [];
  assert.equal(await commandWithInput(process.execPath, ['-e', countInput], input, { onProgress: (n) => progress.push(n) }), '300005');
  assert.equal(progress.at(-1), 300005);
  const echo = "const c=[];process.stdin.on('data',d=>c.push(d)).on('end',()=>process.stdout.write(Buffer.concat(c).toString('hex')))";
  await fs.writeFile(input, Buffer.from([0, 0x1a, 13, 10, 255]));
  assert.equal(await commandWithInput(process.execPath, ['-e', echo], input), '001a0d0aff');
});

test('a child that exits early reports its own stderr, not the broken pipe', async (t) => {
  const target = await fixture(t);
  const input = path.join(path.dirname(target), 'big.bin');
  await fs.writeFile(input, Buffer.alloc(8 * 1024 * 1024, 1));
  await assert.rejects(commandWithInput(process.execPath, ['-e', "process.stderr.write('remote refused');process.exit(3)"], input), /remote refused/);
  await assert.rejects(commandWithInput(process.execPath, ['-e', 'process.exit(4)'], input), /exited 4/);
});

test('a child that never finishes is killed at the timeout', async (t) => {
  const target = await fixture(t);
  const input = path.join(path.dirname(target), 'small.bin');
  await fs.writeFile(input, 'x');
  await assert.rejects(commandWithInput(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], input, { timeoutMs: 200 }), /timed out/);
});

test('an abort signal kills the child and a missing input file is reported as such', async (t) => {
  const target = await fixture(t);
  const input = path.join(path.dirname(target), 'small.bin');
  await fs.writeFile(input, 'x');
  const controller = new AbortController();
  const pending = commandWithInput(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], input, { signal: controller.signal });
  setTimeout(() => controller.abort(new Error('cancelled by test')), 100);
  await assert.rejects(pending, /cancelled by test/);
  await assert.rejects(commandWithInput(process.execPath, ['-e', countInput], path.join(path.dirname(target), 'missing.bin')), /ENOENT/);
});

test('createAdb exposes runWithInput through the resolved adb binary', async (t) => {
  const target = await fixture(t);
  const input = path.join(path.dirname(target), 'small.bin');
  await fs.writeFile(input, 'abc');
  const adb = createAdb(() => process.execPath);
  assert.equal(typeof adb.runWithInput, 'function');
  assert.equal(await adb.runWithInput(['-e', countInput], input), '3');
});
