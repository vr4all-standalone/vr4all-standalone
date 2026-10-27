const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { validateViceCityInput, runViceCityBuild: buildViceCity } = require('../src/vice-city-runner');

// These tests isolate source validation and process reporting. Real Windows
// drive mapping and PowerShell extraction are covered in build-path.test.js.
const runViceCityBuild = (input, roots, log, options) => buildViceCity(input, roots, log, { platform: 'linux', ...options });

const commit = 'a'.repeat(40);
const required = ['data', 'TEXT', 'anim', 'txd', 'skins', 'mp3', 'movies', 'models', 'Audio'];

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(__dirname, '.vice-city-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gamePath = path.join(root, 'Owned Vice City');
  await fs.mkdir(gamePath);
  for (const name of required) await fs.mkdir(path.join(gamePath, name));
  return { root, gamePath };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [entry, body] of entries) {
    const name = Buffer.from(entry);
    const data = Buffer.from(body);
    const crc = crc32(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x800, 6);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(name.length, 26);
    local.push(l, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += l.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function sourceArchive() {
  const root = `vice-city-vr-quest-${commit}/`;
  return zip([
    [`${root}BUILD_AND_INSTALL.bat`, '@echo off'],
    [`${root}tools/build-and-install.ps1`, 'param([string]$GameDir,[string]$Serial,[switch]$NonInteractive)'],
    [`${root}overlay/android/app/build.gradle.kts`, 'versionName = "0.5.6"'],
  ]);
}

function fetchFor(bytes, overrides = {}) {
  return async (url) => {
    if (url === 'https://api.github.com/repos/dubrovskiy-yevhen-stakelogic/vice-city-vr-quest/commits/master') {
      return new Response(JSON.stringify({ sha: overrides.sha || commit }), { status: 200 });
    }
    assert.equal(url, `https://codeload.github.com/dubrovskiy-yevhen-stakelogic/vice-city-vr-quest/zip/${commit}`);
    return new Response(overrides.archive || bytes);
  };
}

function fakeProcess(output, code = 0) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  queueMicrotask(() => {
    child.stdout.end(output);
    child.stderr.end();
    child.emit('close', code);
  });
  return child;
}

test('rejects an incomplete owned game folder and invalid selected headset before downloading', async (t) => {
  const { root, gamePath } = await fixture(t);
  await fs.rm(path.join(gamePath, 'Audio'), { recursive: true });
  await assert.rejects(validateViceCityInput({ gamePackage: gamePath, serial: 'Quest-1' }), /Audio|complete PC/i);
  await fs.mkdir(path.join(gamePath, 'Audio'));
  await assert.rejects(validateViceCityInput({ gamePackage: gamePath, serial: 'Quest 1' }), /serial|Quest/i);
  const input = await validateViceCityInput({ gamePackage: gamePath, serial: 'Quest-1' });
  assert.equal(input.gamePackage, gamePath);
  assert.equal(input.kind, 'directory');
  assert.deepEqual((await fs.readdir(root)).sort(), ['Owned Vice City']);
});

test('rejects an unpinned branch reference before downloading source', async (t) => {
  const { root, gamePath } = await fixture(t);
  let calls = 0;
  await assert.rejects(runViceCityBuild({ gamePackage: gamePath, serial: 'Quest-1' }, { cacheRoot: root, workRoot: root }, () => {}, {
    fetchImpl: async () => { calls++; return new Response(JSON.stringify({ sha: 'master' })); },
    spawnImpl: () => { throw new Error('unexpected launch'); },
  }), /commit SHA/i);
  assert.equal(calls, 1);
  assert.deepEqual((await fs.readdir(root)).sort(), ['Owned Vice City']);
});

test('runs the pinned author script for the selected game and Quest with noninteractive safeguards', async (t) => {
  const { root, gamePath } = await fixture(t);
  const bytes = sourceArchive();
  const logs = [];
  let call;
  const result = await runViceCityBuild({ gamePackage: gamePath, serial: 'Quest-1' }, { cacheRoot: path.join(root, 'cache'), workRoot: path.join(root, 'work') }, (line) => logs.push(line), {
    fetchImpl: fetchFor(bytes),
    spawnImpl: (binary, args, options) => {
      call = { binary, args, options };
      return fakeProcess('[8/8] Copying the user\'s game data\nVice City VR setup complete.\n');
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(call.binary, 'powershell.exe');
  assert.deepEqual(call.args.slice(0, 6), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', call.args[5]]);
  assert.ok(call.args[5].endsWith(path.join('tools', 'build-and-install.ps1')));
  assert.deepEqual(call.args.slice(6, 12), ['-GameDir', gamePath, '-Serial', 'Quest-1', '-NonInteractive', '-WorkDir']);
  assert.equal(call.args[12], path.join(root, 'work', 'vice-city-vr'));
  assert.equal(call.options.env.TEMP, path.join(root, 'work', 'vice-city-vr', '.tmp'));
  assert.equal(call.options.env.GRADLE_USER_HOME, path.join(root, 'work', 'vice-city-vr', '.gradle'));
  assert.ok(logs.some((line) => line.includes('[8/8] Copying')));
  assert.equal(result.sha, commit);
  assert.deepEqual((await fs.readdir(root)).sort(), ['Owned Vice City', 'cache', 'work']);
});

test('surfaces upstream license and signature stops without retrying or uninstalling', async (t) => {
  const { root, gamePath } = await fixture(t);
  const bytes = sourceArchive();
  for (const text of [
    'Required Android SDK components are missing; automatic installation needs an interactive license confirmation.',
    'Incompatible installed signature. Interactive confirmation is required before uninstalling com.miamivr.quest.',
  ]) {
    await assert.rejects(runViceCityBuild({ gamePackage: gamePath, serial: 'Quest-1' }, { cacheRoot: path.join(root, 'cache'), workRoot: path.join(root, 'work') }, () => {}, {
      fetchImpl: fetchFor(bytes),
      spawnImpl: () => fakeProcess(`${text}\n`, 1),
    }), (error) => error.message.includes(text));
  }
  assert.deepEqual((await fs.readdir(root)).sort(), ['Owned Vice City', 'cache', 'work']);
});

test('extracts an owned game ZIP privately and removes it after the author script exits', async (t) => {
  const { root } = await fixture(t);
  const gamePackage = path.join(root, 'owned-game.zip');
  await fs.writeFile(gamePackage, zip(required.map((name) => [`Vice City/${name}/`, ''])));
  const input = await validateViceCityInput({ gamePackage, serial: 'Quest-1' });
  assert.equal(input.kind, 'zip');
  let extractedGamePath;
  await runViceCityBuild(input, { cacheRoot: path.join(root, 'cache'), workRoot: path.join(root, 'work') }, () => {}, {
    fetchImpl: fetchFor(sourceArchive()),
    spawnImpl: (_binary, args) => {
      extractedGamePath = args[args.indexOf('-GameDir') + 1];
      return fakeProcess('Vice City VR setup complete.\n');
    },
  });
  assert.equal(path.basename(extractedGamePath), 'Vice City');
  assert.ok(extractedGamePath.startsWith(path.join(root, 'work', 'vice-city-vr', '.tmp') + path.sep));
  assert.equal(await fs.stat(extractedGamePath).catch(() => null), null);
  assert.deepEqual((await fs.readdir(root)).sort(), ['Owned Vice City', 'cache', 'owned-game.zip', 'work']);
});

test('reuses a verified cache entry for the same official commit', async (t) => {
  const { root, gamePath } = await fixture(t);
  const roots = { cacheRoot: path.join(root, 'cache'), workRoot: path.join(root, 'work') };
  await runViceCityBuild({ gamePackage: gamePath, serial: 'Quest-1' }, roots, () => {}, {
    fetchImpl: fetchFor(sourceArchive()), spawnImpl: () => fakeProcess('done\n'),
  });
  const logs = [];
  let downloads = 0;
  await runViceCityBuild({ gamePackage: gamePath, serial: 'Quest-1' }, roots, (line) => logs.push(line), {
    fetchImpl: async (url) => {
      if (!url.endsWith('/commits/master')) downloads++;
      return new Response(JSON.stringify({ sha: commit }));
    },
    spawnImpl: () => fakeProcess('done\n'),
  });
  assert.equal(downloads, 0);
  assert.ok(logs.some((line) => line.includes('cached official Vice City source')));
});

test('refuses a cached kit when any source file changed', async (t) => {
  const { root, gamePath } = await fixture(t);
  const roots = { cacheRoot: path.join(root, 'cache'), workRoot: path.join(root, 'work') };
  const bytes = sourceArchive();
  await runViceCityBuild({ gamePackage: gamePath, serial: 'Quest-1' }, roots, () => {}, {
    fetchImpl: fetchFor(bytes), spawnImpl: () => fakeProcess('done\n'),
  });
  const overlay = path.join(roots.cacheRoot, 'vice-city-vr', commit, `vice-city-vr-quest-${commit}`, 'overlay', 'android', 'app', 'build.gradle.kts');
  await fs.appendFile(overlay, '\n// modified\n');
  let launched = false;
  await assert.rejects(runViceCityBuild({ gamePackage: gamePath, serial: 'Quest-1' }, roots, () => {}, {
    fetchImpl: async (url) => {
      assert.ok(url.endsWith('/commits/master'));
      return new Response(JSON.stringify({ sha: commit }));
    },
    spawnImpl: () => { launched = true; return fakeProcess('unexpected\n'); },
  }), /cache|modified|SHA-256/i);
  assert.equal(launched, false);
});

test('keeps the short build drive until a cancelled child has closed', async (t) => {
  const { root, gamePath } = await fixture(t);
  const commands = [];
  let child;
  let didSpawn;
  const spawned = new Promise((resolve) => { didSpawn = resolve; });
  const cancelled = new Error('Build cancelled');
  const task = runViceCityBuild({ gamePackage: gamePath, serial: 'Quest-1' }, { cacheRoot: path.join(root, 'cache'), workRoot: path.join(root, 'work') }, () => {}, {
    platform: 'win32',
    fetchImpl: fetchFor(sourceArchive()),
    runFile: async (_binary, args) => { commands.push(args); },
    spawnImpl: () => {
      child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      didSpawn();
      return child;
    },
  });
  const rejected = assert.rejects(task, (error) => error === cancelled);
  await spawned;
  t.after(() => child.emit('close', null));
  child.emit('error', cancelled);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(commands.some((args) => args[1] === '/D'), false, 'an error event does not mean the process has closed');
  child.emit('close', null);
  await rejected;
  assert.deepEqual(commands.at(-1), ['Z:', '/D']);
});
