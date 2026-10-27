const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { deflateRawSync } = require('node:zlib');
const { extractZipSafely, installHarryPotterPlayer } = require('../src/harry-potter-runner');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
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
    const packed = entry.deflate ? deflateRawSync(data) : data;
    const method = entry.deflate ? 8 : 0;
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.utf8 === false ? 0 : 0x800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, packed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(entry.externalAttributes ? 0x0314 : 20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(entry.utf8 === false ? 0 : 0x800, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(packed.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(entry.externalAttributes || 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function releaseZip() {
  const prefix = 'HPVR-Quest-0.1.4.1/';
  return zip([
    { name: `${prefix}tools/INSTALL-HPVR.ps1`, data: 'param([string]$GamePath)' },
    { name: `${prefix}release-manifest.json`, data: JSON.stringify({ schema: 1, packageName: 'io.github.hpvr.quest', apk: 'hpvr.apk', files: [] }) },
    { name: `${prefix}hpvr.apk`, data: 'APK bytes', deflate: true },
  ]);
}

function releaseFor(bytes, overrides = {}) {
  return {
    tag: 'v0.1.4.1', assetName: 'HPVR-Quest-0.1.4.1.zip',
    downloadUrl: 'https://github.com/dubrovskiy-yevhen-stakelogic/harry-potter-vr/releases/download/v0.1.4.1/HPVR-Quest-0.1.4.1.zip',
    digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
    size: bytes.length, stale: false, ...overrides,
  };
}

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-hpvr-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function gameFolder(root) {
  const folder = path.join(root, 'Owned HP');
  for (const name of ['Maps', 'Textures', 'Sounds', 'Music', 'system']) {
    await fs.mkdir(path.join(folder, name), { recursive: true });
    await fs.writeFile(path.join(folder, name, 'fixture.dat'), name);
  }
  return folder;
}

test('safe ZIP extraction supports deflate and rejects traversal before writing', async (t) => {
  const root = await temp(t);
  const archive = path.join(root, 'input.zip');
  const output = path.join(root, 'out');
  await fs.writeFile(archive, zip([{ name: 'HP/Maps/Lev_Tut3.unr', data: 'level', deflate: true }]));
  await extractZipSafely(archive, output);
  assert.equal(await fs.readFile(path.join(output, 'HP', 'Maps', 'Lev_Tut3.unr'), 'utf8'), 'level');
  await fs.writeFile(archive, zip([{ name: 'safe.txt', data: 'safe' }, { name: '../escape.txt', data: 'bad' }]));
  await assert.rejects(extractZipSafely(archive, path.join(root, 'bad')), /unsafe.*path/i);
  assert.equal(await fs.stat(path.join(root, 'bad', 'safe.txt')).catch(() => null), null);
  assert.equal(await fs.stat(path.join(root, 'escape.txt')).catch(() => null), null);
});

test('safe ZIP extraction accepts an ASCII Windows archive without the UTF-8 flag', async (t) => {
  const root = await temp(t);
  const archive = path.join(root, 'ascii.zip');
  await fs.writeFile(archive, zip([{ name: 'HP/Maps/map.unr', data: 'map', utf8: false }]));
  await extractZipSafely(archive, path.join(root, 'out'));
  assert.equal(await fs.readFile(path.join(root, 'out', 'HP', 'Maps', 'map.unr'), 'utf8'), 'map');
});

test('safe ZIP extraction rejects links and impossible expansion sizes', async (t) => {
  const root = await temp(t);
  const archive = path.join(root, 'input.zip');
  await fs.writeFile(archive, zip([{ name: 'link', data: 'target', externalAttributes: 0xa1ff0000 }]));
  await assert.rejects(extractZipSafely(archive, path.join(root, 'out')), /link|unsupported/i);
  const oversized = zip([{ name: 'huge.bin', data: 'x' }]);
  const central = oversized.readUInt32LE(oversized.length - 6);
  oversized.writeUInt32LE(0xffffffff, central + 24);
  await fs.writeFile(archive, oversized);
  await assert.rejects(extractZipSafely(archive, path.join(root, 'out')), /large|limit|ZIP64/i);
});

test('runner rejects stale, unsigned, unrelated, and source ZIP metadata before download', async (t) => {
  const root = await temp(t);
  const gamePath = await gameFolder(root);
  const bytes = releaseZip();
  let fetches = 0;
  const options = { fetchImpl: async () => { fetches++; throw new Error('unexpected fetch'); } };
  for (const release of [
    releaseFor(bytes, { stale: true }), releaseFor(bytes, { digest: null }),
    releaseFor(bytes, { downloadUrl: 'https://github.com/other/repo/releases/download/v0.1.4.1/HPVR-Quest-0.1.4.1.zip' }),
    releaseFor(bytes, { assetName: 'Source-code.zip' }),
  ]) await assert.rejects(installHarryPotterPlayer({ gamePath, serial: 'Quest-1', release }, options), /stale|SHA-256|official|player/i);
  assert.equal(fetches, 0);
});

test('runner verifies downloaded ZIP before invoking the author installer', async (t) => {
  const root = await temp(t);
  const gamePath = await gameFolder(root);
  const adbPath = path.join(root, 'adb.exe');
  await fs.writeFile(adbPath, 'adb');
  let spawned = false;
  await assert.rejects(installHarryPotterPlayer({ gamePath, serial: 'Quest-1', adbPath, release: releaseFor(releaseZip(), { digest: `sha256:${'0'.repeat(64)}` }) }, {
    tempRoot: root, fetchImpl: async () => new Response(releaseZip()),
    spawnImpl: () => { spawned = true; throw new Error('unexpected spawn'); },
  }), /SHA-256/i);
  assert.equal(spawned, false);
});

test('runner passes owned folder, selected Quest and ADB to official noninteractive script', async (t) => {
  const root = await temp(t);
  const gamePath = await gameFolder(root);
  const adbPath = path.join(root, 'adb.exe');
  await fs.writeFile(adbPath, 'adb');
  const bytes = releaseZip();
  const logs = [];
  let call;
  const spawnImpl = (binary, args, options) => {
    call = { binary, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.write('Installing\nINSTALL=PASS DATA_IMPORT=PASS device=Quest-1\n');
      child.stderr.write('Checking audio\n');
      child.stdout.end(); child.stderr.end(); child.emit('close', 0);
    });
    return child;
  };
  const result = await installHarryPotterPlayer({ gamePath, serial: 'Quest-1', adbPath, release: releaseFor(bytes), onLog: (line) => logs.push(line) }, {
    tempRoot: root, fetchImpl: async () => new Response(bytes), spawnImpl,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(call.binary, 'powershell.exe');
  assert.deepEqual(call.args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.ok(call.args[5].endsWith(path.join('tools', 'INSTALL-HPVR.ps1')));
  assert.deepEqual(call.args.slice(6), ['-GamePath', gamePath, '-DeviceSerial', 'Quest-1', '-AdbPath', adbPath]);
  assert.equal(call.options.cwd, path.dirname(path.dirname(call.args[5])));
  assert.ok(logs.includes('Checking audio'));
  assert.ok(logs.some((line) => line.startsWith('INSTALL=PASS DATA_IMPORT=PASS')));
  assert.deepEqual((await fs.readdir(root)).sort(), ['Owned HP', 'adb.exe']);
});

test('runner accepts a ZIP containing one owned game folder and cleans private extraction', async (t) => {
  const root = await temp(t);
  const gamePath = path.join(root, 'owned.zip');
  await fs.writeFile(gamePath, zip(['Maps', 'Textures', 'Sounds', 'Music', 'system'].map((name) => ({ name: `Harry Potter/${name}/fixture.dat`, data: name }))));
  const adbPath = path.join(root, 'adb.exe');
  await fs.writeFile(adbPath, 'adb');
  const bytes = releaseZip();
  let installedGamePath;
  await installHarryPotterPlayer({ gamePath, serial: 'Quest-1', adbPath, release: releaseFor(bytes) }, {
    tempRoot: root, fetchImpl: async () => new Response(bytes),
    spawnImpl: (_binary, args) => {
      installedGamePath = args[args.indexOf('-GamePath') + 1];
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      queueMicrotask(() => { child.stdout.end('INSTALL=PASS DATA_IMPORT=PASS\n'); child.stderr.end(); child.emit('close', 0); });
      return child;
    },
  });
  assert.equal(path.basename(installedGamePath), 'Harry Potter');
  assert.equal(await fs.stat(installedGamePath).catch(() => null), null);
  assert.deepEqual((await fs.readdir(root)).sort(), ['adb.exe', 'owned.zip']);
});

test('runner requires installer success marker even when PowerShell exits zero', async (t) => {
  const root = await temp(t);
  const gamePath = await gameFolder(root);
  const adbPath = path.join(root, 'adb.exe'); await fs.writeFile(adbPath, 'adb');
  const bytes = releaseZip();
  await assert.rejects(installHarryPotterPlayer({ gamePath, serial: 'Quest-1', adbPath, release: releaseFor(bytes) }, {
    tempRoot: root, fetchImpl: async () => new Response(bytes),
    spawnImpl: () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      queueMicrotask(() => { child.stdout.end('PREPARE=PASS\n'); child.stderr.end(); child.emit('close', 0); });
      return child;
    },
  }), /success|INSTALL=PASS/i);
});
