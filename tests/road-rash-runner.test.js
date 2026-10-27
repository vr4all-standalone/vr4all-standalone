const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { extractReleaseZip, installRoadRashPlayer } = require('../src/road-rash-runner');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data || '');
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x800, 6);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, data);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x800, 8);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(entry.externalAttributes || 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function releaseFor(bytes, overrides = {}) {
  return {
    tag: 'v0.1.0', assetName: 'RoadRashJailbreak-0.1.0.zip',
    downloadUrl: 'https://github.com/dubrovskiy-yevhen-stakelogic/road-rash-jailbreak/releases/download/v0.1.0/RoadRashJailbreak-0.1.0.zip',
    digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
    size: bytes.length, stale: false, ...overrides,
  };
}

function playerZip() {
  return zip([
    { name: 'RoadRashJailbreak-0.1.0/' },
    { name: 'RoadRashJailbreak-0.1.0/scripts/' },
    { name: 'RoadRashJailbreak-0.1.0/scripts/install-player.ps1', data: 'param()' },
    { name: 'RoadRashJailbreak-0.1.0/release-manifest.json', data: '{}' },
    { name: 'RoadRashJailbreak-0.1.0/rrjb.apk', data: 'APK' },
  ]);
}

test('safe extraction places official package files under the staging root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-road-rash-zip-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'player.zip');
  const output = path.join(root, 'output');
  await fs.writeFile(archive, playerZip());
  const packageRoot = await extractReleaseZip(archive, output);
  assert.equal(packageRoot, path.join(output, 'RoadRashJailbreak-0.1.0'));
  assert.equal(await fs.readFile(path.join(packageRoot, 'scripts', 'install-player.ps1'), 'utf8'), 'param()');
});

test('safe extraction rejects a traversal entry before writing any package file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-road-rash-zip-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'bad.zip');
  const output = path.join(root, 'output');
  await fs.writeFile(archive, zip([
    { name: 'RoadRashJailbreak-0.1.0/scripts/install-player.ps1', data: 'param()' },
    { name: '../outside.txt', data: 'bad' },
  ]));
  await assert.rejects(extractReleaseZip(archive, output), (error) =>
    /unsafe.*path/i.test(error.message) && !/CLIXML|<Objs/.test(error.message));
  assert.equal(await fs.stat(path.join(root, 'outside.txt')).catch(() => null), null);
  assert.equal(await fs.stat(path.join(output, 'RoadRashJailbreak-0.1.0', 'scripts', 'install-player.ps1')).catch(() => null), null);
});

test('safe extraction rejects symbolic links and oversized declared files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-road-rash-zip-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'bad.zip');
  const output = path.join(root, 'output');
  await fs.writeFile(archive, zip([{ name: 'link', data: 'target', externalAttributes: 0xa1ff0000 }]));
  await assert.rejects(extractReleaseZip(archive, output), /link|unsupported/i);
  const huge = zip([
    { name: 'scripts/install-player.ps1', data: 'param()' },
    { name: 'release-manifest.json', data: '{}' },
    { name: 'huge-a.bin', data: 'x' },
    { name: 'huge-b.bin', data: 'x' },
    { name: 'huge-c.bin', data: 'x' },
  ]);
  const centralOffset = huge.readUInt32LE(huge.length - 6);
  let centralCursor = centralOffset;
  for (let index = 0; index < 5; index++) {
    if (index >= 2) huge.writeUInt32LE(0xffffffff, centralCursor + 24);
    centralCursor += 46 + huge.readUInt16LE(centralCursor + 28);
  }
  await fs.writeFile(archive, huge);
  await assert.rejects(extractReleaseZip(archive, output), /large|limit|ZIP64/i);
});

test('runner rejects stale, unsigned, and unrelated release metadata before download', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-road-rash-input-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const discImage = path.join(root, 'owned.bin');
  await fs.writeFile(discImage, 'owned fixture');
  const bytes = playerZip();
  let fetches = 0;
  const options = { fetchImpl: async () => { fetches++; throw new Error('unexpected fetch'); } };
  for (const release of [
    releaseFor(bytes, { stale: true }),
    releaseFor(bytes, { digest: null }),
    releaseFor(bytes, { downloadUrl: 'https://github.com/other/repo/releases/download/v0.1.0/RoadRashJailbreak-0.1.0.zip' }),
  ]) {
    await assert.rejects(installRoadRashPlayer({ discImage, serial: 'Quest-1', release }, options), /stale|SHA-256|official/i);
  }
  assert.equal(fetches, 0);
});

test('runner verifies ZIP digest before invoking the installer', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-road-rash-run-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const discImage = path.join(root, 'owned.bin');
  await fs.writeFile(discImage, 'owned fixture');
  const bytes = playerZip();
  let spawned = false;
  await assert.rejects(installRoadRashPlayer({ discImage, serial: 'Quest-1', release: releaseFor(bytes, { digest: `sha256:${'0'.repeat(64)}` }) }, {
    tempRoot: root,
    fetchImpl: async () => new Response(bytes),
    spawnImpl: () => { spawned = true; throw new Error('unexpected installer'); },
  }), /SHA-256/i);
  assert.equal(spawned, false);
  assert.deepEqual((await fs.readdir(root)).sort(), ['owned.bin']);
});

test('runner passes the selected disc, Quest, and ADB to the official script and streams its output', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-road-rash-run-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const discImage = path.join(root, 'owned disc.cue');
  await fs.writeFile(discImage, 'owned fixture');
  const bytes = playerZip();
  const logs = [];
  let call;
  const spawnImpl = (binary, args, options) => {
    call = { binary, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.write('Installing');
      child.stderr.write('Checking disc\n');
      child.stdout.write(' APK\n');
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 0);
    });
    return child;
  };
  const result = await installRoadRashPlayer({ discImage, serial: 'Quest-1', adbPath: 'C:\\tools\\adb.exe', release: releaseFor(bytes), onLog: (line) => logs.push(line) }, {
    tempRoot: root, fetchImpl: async () => new Response(bytes), spawnImpl,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(call.binary, 'powershell.exe');
  assert.deepEqual(call.args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.ok(call.args[5].endsWith(path.join('scripts', 'install-player.ps1')));
  assert.deepEqual(call.args.slice(6), ['-Target', 'Quest', '-DiscImage', discImage, '-Serial', 'Quest-1', '-HdMedia', 'Original', '-Adb', 'C:\\tools\\adb.exe']);
  assert.equal(call.options.cwd, path.dirname(path.dirname(call.args[5])));
  assert.ok(logs.includes('Installing APK'));
  assert.ok(logs.includes('Checking disc'));
  assert.deepEqual((await fs.readdir(root)).sort(), ['owned disc.cue']);
});
