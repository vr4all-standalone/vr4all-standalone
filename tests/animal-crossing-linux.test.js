const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { installAnimalCrossingLinux } = require('../src/animal-crossing-linux');
const { installOfficialPlayer } = require('../src/official-player-runner');
const { sevenZipBinary } = require('./helpers/seven-zip');

const PKG = 'com.liquidazir.animalcrossingquest';
const MAGIC = Buffer.from([0xc2, 0x33, 0x9f, 0x3d]);

function header({ id = 'GAFE01', disc = 0, revision = 0 } = {}) {
  const bytes = Buffer.alloc(32);
  bytes.write(id, 0, 'latin1');
  bytes[6] = disc;
  bytes[7] = revision;
  MAGIC.copy(bytes, 28);
  return bytes;
}

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function fixture(run, { rom = Buffer.concat([header(), Buffer.alloc(4096, 5)]), name = 'game.iso', sums } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-ac-linux-'));
  try {
    const apk = path.join(root, 'AnimalCrossing-Quest.apk');
    await fs.writeFile(apk, 'apk-bytes');
    await fs.writeFile(path.join(root, 'SHA256SUMS.txt'), sums ?? `${sha(Buffer.from('apk-bytes'))} *AnimalCrossing-Quest.apk\n`);
    const gamePath = path.join(root, name);
    await fs.writeFile(gamePath, rom);
    return await run({ root, apk, gamePath, rom });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// A scripted Quest: `files` is the app's private storage (relative path -> bytes).
function fakeAdb({ running = '', existing = {}, corruptUpload = false, appearDuringUpload = null, installResult = 'Performing Streamed Install\nSuccess', freeKb = 50 * 1024 ** 2 } = {}) {
  const files = new Map(Object.entries(existing).map(([name, content]) => [name, Buffer.from(content)]));
  // The shell-owned staging area (/data/local/tmp): absolute path -> bytes; `readable` holds the files made world-readable.
  const staging = new Map();
  const readable = new Set();
  const matching = (map, pattern) => [...map.keys()].filter((name) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(name));
  const calls = [];
  const adb = {
    calls, files, staging,
    async run(args, _onOutput, options) {
      calls.push({ args, options });
      assert.deepEqual(args.slice(0, 2), ['-s', 'Q3']);
      const verb = args[2];
      if (verb === 'shell') return this.shell(args[3]);
      if (verb === 'push') {
        const data = await fs.readFile(args[3]);
        staging.set(args[4], corruptUpload ? data.subarray(1) : data);
        if (appearDuringUpload) files.set(appearDuringUpload, Buffer.from('someone else'));
        return `${args[3]}: 1 file pushed`;
      }
      if (verb === 'install') return installResult;
      assert.deepEqual(args.slice(2, 7), ['exec-out', 'run-as', PKG, 'sh', '-c']);
      assert.equal(args.length, 8, 'the script is one argv element');
      const script = args[7].replace(/^set -eu\n/, '').replace(/\nprintf '__ACQUEST_INSTALL_OK__\\n'$/, '');
      return (await this.app(script)) + '\n__ACQUEST_INSTALL_OK__';
    },
    async shell(script) {
      let match;
      if (script === `pidof ${PKG} || true`) return running;
      if (script === 'df -k /data/local/tmp | tail -1') return `/dev/block/dm-55 107584204 72292464 ${freeKb} 68% /data/local/tmp`;
      if ((match = /^stat -c %s (\S+) 2>\/dev\/null \|\| echo 0$/.exec(script))) return String(staging.get(match[1])?.length ?? 0);
      if ((match = /^chmod 644 (\S+)$/.exec(script))) { assert.ok(staging.has(match[1]), 'only a pushed file is made readable'); readable.add(match[1]); return ''; }
      if ((match = /^rm -f (\S+)$/.exec(script))) { for (const name of matching(staging, match[1])) staging.delete(name); return ''; }
      throw new Error('unexpected shell command: ' + script);
    },
    async app(script) {
      let match;
      if (script === 'pwd') return '/data/user/0/' + PKG;
      if (script.startsWith('if [ -d files/rom ]')) return [...files.keys()].filter((name) => name.startsWith('files/rom/')).join('\n');
      if (script === 'mkdir -p files/rom') return '';
      if ((match = /^if \[ -e (\S+) \]/.exec(script))) return files.has(match[1]) ? 'yes' : 'no';
      if ((match = /^sha256sum (\S+)\nwc -c < \S+$/.exec(script))) {
        const data = files.get(match[1]);
        return `${sha(data)}  ${match[1]}\n${data.length}`;
      }
      if ((match = /^umask 077; cp (\S+) (\S+)$/.exec(script))) {
        assert.ok(readable.has(match[1]), 'the app can only copy a staging file that was made world-readable');
        files.set(match[2], staging.get(match[1]));
        return '';
      }
      if ((match = /^mv -n (\S+) (\S+)$/.exec(script))) { if (!files.has(match[2])) { files.set(match[2], files.get(match[1])); files.delete(match[1]); } return ''; }
      if ((match = /^rm -f (\S+)$/.exec(script))) { for (const name of matching(files, match[1])) files.delete(name); return ''; }
      throw new Error('unexpected app script: ' + script);
    },
  };
  return adb;
}

const scripts = (adb) => adb.calls.map((call) => call.args.at(-1));

test('Animal Crossing on Linux installs the APK, pushes the ROM to a staging file, copies it into the app and verifies it', async () => {
  await fixture(async ({ apk, gamePath, rom }) => {
    const adb = fakeAdb();
    const logs = [];
    assert.deepEqual(await installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb, onLog: (line) => logs.push(line) }), {});
    assert.deepEqual([...adb.files.keys()], ['files/rom/AnimalCrossing.iso']);
    assert.deepEqual(adb.files.get('files/rom/AnimalCrossing.iso'), rom);
    const verbs = adb.calls.map((call) => call.args[2]);
    assert.equal(verbs[0], 'shell', 'the game is checked before the APK is installed');
    assert.ok(verbs.indexOf('install') < verbs.indexOf('push'));
    assert.deepEqual(adb.calls.find((call) => call.args[2] === 'install').args.slice(2), ['install', '-r', apk]);
    const push = adb.calls.find((call) => call.args[2] === 'push');
    assert.equal(push.args[3], gamePath);
    assert.match(push.args[4], /^\/data\/local\/tmp\/vr4all-acquest-[0-9a-f]{32}\.tmp$/);
    assert.equal(push.options.timeoutMs, 30 * 60 * 1000);
    assert.equal(adb.staging.size, 0, 'the staging copy is removed');
    const order = scripts(adb);
    const at = (pattern) => order.findIndex((script) => pattern.test(script));
    const [chmod, clear, copy, verify] = [/^chmod 644 /, /rm -f files\/rom\/\.acquest-import-\*\.tmp\n/, /umask 077; cp /, /sha256sum/].map(at);
    assert.ok(chmod >= 0 && clear >= 0 && copy >= 0 && verify >= 0, 'every step ran');
    assert.ok(chmod < copy && copy < verify, 'chmod, then copy into the app, then verify');
    assert.ok(clear < copy, 'leftovers of earlier attempts are cleared first');
    const copies = adb.calls.filter((call) => /umask 077; cp /.test(call.args.at(-1)));
    assert.equal(copies.length, 1);
    assert.equal(copies[0].options.timeoutMs, 600000);
    assert.ok(scripts(adb).filter((script) => /^pidof/.test(script)).length >= 4, 'the game-stopped check runs before install, after install, before upload and before publishing');
    assert.ok(adb.calls.filter((call) => /sha256sum|mv -n/.test(call.args.at(-1))).every((call) => call.options.timeoutMs === 600000));
    assert.ok(!scripts(adb).some((script) => /uninstall|pm clear/.test(script)));
    assert.ok(logs.at(-1).startsWith('Ready.'));
  });
});

test('Animal Crossing on Linux keeps the extension of a .ciso and accepts its wrapped header', async () => {
  const ciso = Buffer.alloc(32768 + 64);
  ciso.write('CISO', 0, 'latin1');
  ciso.writeUInt32LE(2048, 4);
  ciso[8] = 1;
  header().copy(ciso, 32768);
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb();
    await installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb });
    assert.deepEqual([...adb.files.keys()], ['files/rom/AnimalCrossing.ciso']);
  }, { rom: ciso, name: 'GAME.CISO' });
});

test('Animal Crossing on Linux rejects a wrong revision, a bad CISO header and unsupported extensions before uploading', async () => {
  const badCiso = Buffer.alloc(32768 + 64);
  badCiso.write('CISO', 0, 'latin1');
  badCiso.writeUInt32LE(16, 4);
  badCiso[8] = 1;
  const cases = [
    [Buffer.concat([header({ revision: 1 }), Buffer.alloc(100)]), 'game.iso', /GAFE01_00/],
    [Buffer.concat([header({ id: 'GAFP01' }), Buffer.alloc(100)]), 'game.iso', /GAFE01_00/],
    [Buffer.concat([header({ disc: 1 }), Buffer.alloc(100)]), 'game.iso', /GAFE01_00/],
    [badCiso, 'game.ciso', /Invalid CISO disc header/],
    [Buffer.from('CISO'), 'game.ciso', /incomplete/],
    [Buffer.from('short'), 'game.iso', /incomplete/],
    [Buffer.concat([header(), Buffer.alloc(100)]), 'game.rvz', /\.iso, \.gcm, or \.ciso/],
  ];
  for (const [rom, name, message] of cases) {
    await fixture(async ({ apk, gamePath }) => {
      const adb = fakeAdb();
      await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb }), message, name);
      assert.ok(!adb.calls.some((call) => call.args[2] === 'push'));
      assert.deepEqual([...adb.files.keys()], []);
    }, { rom, name });
  }
});

test('Animal Crossing on Linux keeps an existing Quest ROM and imports nothing', async () => {
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb({ existing: { 'files/rom/AnimalCrossing.gcm': 'mine' } });
    const logs = [];
    await installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb, onLog: (line) => logs.push(line) });
    assert.ok(!adb.calls.some((call) => call.args[2] === 'push'));
    assert.equal(adb.files.get('files/rom/AnimalCrossing.gcm').toString(), 'mine');
    assert.ok(logs.some((line) => /existing Quest ROM, saves, and settings have been kept/.test(line)));
  });
});

test('Animal Crossing on Linux refuses to touch a running game and a tampered APK', async () => {
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb({ running: '4242' });
    await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb }), /is running on the Quest/);
    assert.ok(!adb.calls.some((call) => call.args[2] === 'install'));
  });
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb();
    await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb }), /does not match SHA256SUMS\.txt/);
    assert.deepEqual(adb.calls, []);
  }, { sums: `${'0'.repeat(64)}  AnimalCrossing-Quest.apk\n` });
  await fixture(async ({ apk, gamePath }) => {
    await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb: fakeAdb() }), /does not match SHA256SUMS\.txt/);
  }, { sums: '' });
});

test('Animal Crossing on Linux reports a failed APK install without uninstalling anything', async () => {
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb({ installResult: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]' });
    await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb }), /APK installation failed\. Do not uninstall .*INSTALL_FAILED_UPDATE_INCOMPATIBLE/);
    assert.ok(!scripts(adb).some((script) => /uninstall/.test(script)));
  });
});

test('Animal Crossing on Linux removes a corrupted upload and never publishes it', async () => {
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb({ corruptUpload: true });
    await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb }), /ROM transfer verification failed/);
    assert.deepEqual([...adb.files.keys()], []);
    assert.equal(adb.staging.size, 0);
    assert.ok(!scripts(adb).some((script) => script.includes('mv -n')));
  });
});

test('Animal Crossing on Linux clears leftovers of an interrupted attempt before sending the disc', async () => {
  await fixture(async ({ apk, gamePath, rom }) => {
    const adb = fakeAdb({ existing: { 'files/rom/.acquest-import-0123.tmp': 'partial' } });
    adb.staging.set('/data/local/tmp/vr4all-acquest-0123.tmp', Buffer.from('partial'));
    await installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb });
    assert.deepEqual([...adb.files.keys()], ['files/rom/AnimalCrossing.iso']);
    assert.deepEqual(adb.files.get('files/rom/AnimalCrossing.iso'), rom);
    assert.equal(adb.staging.size, 0);
  });
});

test('Animal Crossing on Linux refuses to start when the headset cannot hold the staging copy plus the final copy', async () => {
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb({ freeKb: 100 });
    await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb }), /needs \d+ MiB free to import the disc and has 0 MiB/);
    assert.ok(!adb.calls.some((call) => call.args[2] === 'push'));
  });
});

test('Animal Crossing on Linux reports a failed push and leaves no staging or partial copy behind', async () => {
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb();
    const run = adb.run.bind(adb);
    adb.run = async (args, onOutput, options) => {
      if (args[2] !== 'push') return run(args, onOutput, options);
      adb.staging.set(args[4], Buffer.from('half'));
      throw new Error('adb: error: failed to write');
    };
    await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb }), /ROM transfer failed\. adb: error: failed to write/);
    assert.equal(adb.staging.size, 0);
    assert.deepEqual([...adb.files.keys()], []);
  });
});

test('Animal Crossing on Linux keeps a ROM that appears during the transfer', async () => {
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb({ appearDuringUpload: 'files/rom/AnimalCrossing.iso' });
    await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb }), /appeared during the transfer/);
    assert.deepEqual([...adb.files.keys()], ['files/rom/AnimalCrossing.iso']);
    assert.equal(adb.files.get('files/rom/AnimalCrossing.iso').toString(), 'someone else');
  });
});

test('Animal Crossing on Linux rejects app-storage output without the success marker', async () => {
  await fixture(async ({ apk, gamePath }) => {
    const adb = fakeAdb();
    adb.app = async () => { throw new Error('boom'); };
    const run = adb.run.bind(adb);
    adb.run = async (args, onOutput, options) => (args[2] === 'exec-out' ? 'run-as: package not debuggable' : run(args, onOutput, options));
    await assert.rejects(installAnimalCrossingLinux({ apk, gamePath, serial: 'Q3', adb }), /Quest app-storage command failed\. run-as: package not debuggable/);
  });
});

test('the official player installer runs the Animal Crossing Linux path on Linux', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-ac-player-'));
  try {
    const release = path.join(root, 'release', 'AnimalCrossing-Quest');
    await fs.mkdir(release, { recursive: true });
    await fs.writeFile(path.join(release, 'AnimalCrossing-Quest.apk'), 'apk-bytes');
    await fs.writeFile(path.join(release, 'SHA256SUMS.txt'), `${sha(Buffer.from('apk-bytes'))} *AnimalCrossing-Quest.apk\n`);
    await fs.writeFile(path.join(release, 'Install-Quest.ps1'), '# not used on Linux');
    const archive = path.join(root, 'player.zip');
    assert.equal(spawnSync(sevenZipBinary(), ['a', '-tzip', archive, 'AnimalCrossing-Quest'], { cwd: path.join(root, 'release'), windowsHide: true }).status, 0);
    const gamePath = path.join(root, 'game.iso');
    await fs.writeFile(gamePath, Buffer.concat([header(), Buffer.alloc(512, 3)]));
    const adbPath = path.join(root, 'adb');
    await fs.writeFile(adbPath, '');
    const quest = fakeAdb();
    const result = await installOfficialPlayer({
      gameId: 'animal-crossing-vr', gamePath, serial: 'Q3', adbPath, zipPath: archive, workRoot: root, platform: 'linux',
      adb: Object.assign(quest, { listDevices: async () => [{ serial: 'Q3', state: 'device', model: 'Quest 3S' }] }),
    });
    assert.equal(result.updatedOnly, false);
    assert.deepEqual([...quest.files.keys()], ['files/rom/AnimalCrossing.iso']);
    assert.ok(!quest.calls.some((call) => /Install-Quest/.test(call.args.join(' '))));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
