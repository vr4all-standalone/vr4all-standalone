const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { sevenZipBinary } = require('./helpers/seven-zip');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { validatePersonalBuildInput, buildPowerShellArgs, acquireSourceKit, runAuthorScript, runPersonalBuild, withCompatibleGamePackage } = require('../src/personal-build');

// The Windows flow maps a short drive with subst.exe unless the test hands the path straight through.
const withBuildPath = async (dir, operation) => operation(dir);

test('RDR accepts a complete export path and targets exactly the selected Quest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-rdr-input-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'owned-game.xapk');
  await fs.writeFile(archive, 'fixture');
  const input = await validatePersonalBuildInput('rdr1-vr', { gamePackage: archive, serial: 'Q3-ONE' });
  assert.equal(input.gamePackage, archive);
  const args = buildPowerShellArgs('rdr1-vr', input, path.join(root, 'kit'), path.join(root, 'work'));
  assert.deepEqual(args.slice(-3), ['-Serial', 'Q3-ONE', '-NonInteractive']);
  assert.ok(args.includes(archive));
  assert.ok(args.includes('Q3-ONE'));
  assert.ok(!args.includes('-AudioSource'));
});

test('GTA SA requires its separate supported audio input before any build', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-gta-input-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const game = path.join(root, 'base.apk');
  const audio = path.join(root, 'gta-sa-ps2-style-mod-pack_1786856007_737162.7z');
  await fs.writeFile(game, 'fixture');
  await fs.writeFile(audio, 'fixture');
  await assert.rejects(() => validatePersonalBuildInput('gta-sa-vr', { gamePackage: game, serial: 'Q3' }), /audio/i);
  const input = await validatePersonalBuildInput('gta-sa-vr', { gamePackage: game, audioSource: audio, serial: 'Q3' });
  const args = buildPowerShellArgs('gta-sa-vr', input, path.join(root, 'kit'), path.join(root, 'work'));
  assert.ok(args.includes('-AudioSource'));
  assert.ok(args.includes(audio));
  assert.ok(args.includes('-NonInteractive'));
});

test('RDR accepts an optional separate game-data input and validates it when supplied', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.rdr-data-input-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gamePackage = path.join(root, 'base.apk'); await fs.writeFile(gamePackage, 'owned original');
  const audioSource = path.join(root, 'additional.apks'); await fs.writeFile(audioSource, 'owned data');
  const input = await validatePersonalBuildInput('rdr1-vr', { serial: 'QUEST', gamePackage, audioSource });
  assert.equal(input.audioSource, audioSource);
  await assert.rejects(validatePersonalBuildInput('rdr1-vr', { serial: 'QUEST', gamePackage, audioSource: path.join(root, 'missing.apks') }), /data|exist/i);
});

test('personal builder refuses unrelated inputs and source IDs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wrong-input-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const wrong = path.join(root, 'game.iso');
  await fs.writeFile(wrong, 'fixture');
  await assert.rejects(() => validatePersonalBuildInput('rdr1-vr', { gamePackage: wrong, serial: 'Q3' }), /APK|archive|export/i);
  await assert.rejects(() => validatePersonalBuildInput('sourcevr', { gamePackage: wrong, serial: 'Q3' }), /build profile/i);
});

test('source kit uses a specific official GitHub commit and caches the verified script', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-kit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'a'.repeat(40);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('/commits/')) return new Response(JSON.stringify({ sha }), { status: 200 });
    return new Response('zip fixture', { status: 200 });
  };
  let extracts = 0;
  const extract = async (_zip, destination) => {
    extracts++;
    const repo = path.join(destination, `rdr1-quest-${sha}`);
    await fs.mkdir(path.join(repo, 'tools'), { recursive: true });
    await fs.writeFile(path.join(repo, 'tools', 'build-and-install.ps1'), 'param()');
  };
  const first = await acquireSourceKit('rdr1-vr', root, () => {}, { fetchImpl, extract, platform: 'win32' });
  const second = await acquireSourceKit('rdr1-vr', root, () => {}, { fetchImpl, extract, platform: 'win32' });
  assert.equal(first.sha, sha);
  assert.equal(first.directory, second.directory);
  assert.equal(extracts, 1);
  assert.ok(urls.some((url) => url === `https://codeload.github.com/dubrovskiy-yevhen-stakelogic/rdr1-quest/zip/${sha}`));
});

test('source kit pins the Git branch SHA when the GitHub API is rate limited', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-kit-fallback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'b'.repeat(40);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('api.github.com')) return new Response('rate limited', { status: 403 });
    if (url.includes('/info/refs?')) return new Response(`001e# service=git-upload-pack\n0000${sha} refs/heads/main\n`, { status: 200 });
    return new Response('zip fixture', { status: 200 });
  };
  const extract = async (_zip, destination) => {
    const source = path.join(destination, `rdr1-quest-${sha}`, 'tools');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'build-and-install.ps1'), 'param()');
  };
  const kit = await acquireSourceKit('rdr1-vr', root, () => {}, { fetchImpl, extract, platform: 'win32' });
  assert.equal(kit.sha, sha);
  assert.ok(urls.some((url) => url.endsWith('/info/refs?service=git-upload-pack')));
  assert.ok(urls.some((url) => url.endsWith(`/zip/${sha}`)));
});

test('author builder progress and a failed exit are reported through the job log', async () => {
  const lines = [];
  const spawnImpl = (_program, args) => {
    assert.ok(args.includes('-NonInteractive'));
    assert.deepEqual(args.slice(-3), ['-Serial', 'Q3', '-NonInteractive']);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.write('Validating owned game data...\n');
      child.stderr.write('Android SDK licenses have not been accepted.\n');
      child.emit('close', 1);
    });
    return child;
  };
  await assert.rejects(() => runAuthorScript('rdr1-vr', { gamePackage: 'C:\\game.xapk', serial: 'Q3' }, 'C:\\kit', 'C:\\work', (line) => lines.push(line), { spawnImpl, platform: 'win32', withBuildPath }), /failed \(exit 1\)/);
  assert.ok(lines.some((line) => line.includes('Validating owned game data')));
  assert.ok(lines.some((line) => line.includes('licenses have not been accepted')));
});

for (const gameId of ['rdr1-vr', 'gta-sa-vr']) {
  for (const exitCode of [0, 1]) {
    test(`${gameId} hands APKM to the author as ZIP and cleans it after exit ${exitCode}`, async (t) => {
      const root = await fs.mkdtemp(path.join(__dirname, '.personal-apkm-'));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const source = path.join(root, 'owned-game.apkm');
      const bytes = Buffer.from('PK\x03\x04 owned APKM fixture');
      await fs.writeFile(source, bytes);
      const input = { gamePackage: source, audioSource: gameId === 'gta-sa-vr' ? path.join(root, 'audio.7z') : null, serial: 'Q3' };
      const roots = { cacheRoot: path.join(root, 'source'), workRoot: path.join(root, 'selected drive') };
      const sha = 'c'.repeat(40);
      let prepared;
      const options = {
        platform: 'win32', withBuildPath,
        fetchImpl: async (url) => new Response(url.includes('/commits/') ? JSON.stringify({ sha }) : 'source zip'),
        extract: async (_zip, destination) => {
          const tools = path.join(destination, 'official-kit', 'tools');
          await fs.mkdir(tools, { recursive: true });
          await fs.writeFile(path.join(tools, 'build-and-install.ps1'), 'param()');
        },
        spawnImpl: (_program, args) => {
          prepared = args[args.indexOf('-GamePackage') + 1];
          assert.equal(path.extname(prepared), '.zip');
          assert.ok(prepared.startsWith(path.join(roots.workRoot, gameId, '.tmp') + path.sep));
          const child = new EventEmitter();
          child.stdout = new PassThrough(); child.stderr = new PassThrough();
          fs.readFile(prepared).then((actual) => {
            assert.deepEqual(actual, bytes);
            child.emit('close', exitCode);
          }).catch((error) => child.emit('error', error));
          return child;
        },
      };
      const job = runPersonalBuild(gameId, input, roots, () => {}, options);
      if (exitCode) await assert.rejects(job, /failed \(exit 1\)/);
      else await job;
      assert.equal(input.gamePackage, source);
      assert.deepEqual(await fs.readFile(source), bytes);
      assert.equal(await fs.stat(prepared).catch(() => null), null);
      assert.deepEqual(await fs.readdir(path.join(roots.workRoot, gameId, '.tmp')), []);
    });
  }
}

test('APKM preparation can copy on filesystems without hard links and removes the copy', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.personal-copy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'owned.apkm');
  await fs.writeFile(source, 'original APKM');
  const tempRoot = path.join(root, 'build temp');
  let prepared;
  await withCompatibleGamePackage(source, tempRoot, async (file) => {
    prepared = file;
    assert.equal(await fs.readFile(file, 'utf8'), 'original APKM');
  }, () => {}, { linkFile: async () => { throw Object.assign(new Error('no hard links'), { code: 'EXDEV' }); } });
  assert.equal(await fs.readFile(source, 'utf8'), 'original APKM');
  assert.equal(await fs.stat(prepared).catch(() => null), null);
});

test('personal builder reports the author error in the failed job message', async () => {
  const spawnImpl = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stderr.write('ER');
      child.stdout.write('Build progress on the other stream\n');
      child.stderr.write('ROR: the game data is incomplete. Export all world and audio files.\n');
      child.emit('close', 1);
    });
    return child;
  };
  await assert.rejects(() => runAuthorScript('rdr1-vr', { gamePackage: 'C:\\game.zip', serial: 'Q3' },
    'C:\\kit', 'C:\\work', () => {}, { spawnImpl, platform: 'win32', withBuildPath }), /the game data is incomplete.*world and audio/);
});

test('personal builder reports FAILED messages from the author instead of a generic exit code', async () => {
  const spawnImpl = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.write('FAIL'); child.stdout.write('ED: Required Windows build command is unavailable.\n'); child.emit('close', 1);
    });
    return child;
  };
  await assert.rejects(() => runAuthorScript('rdr1-vr', { gamePackage: 'C:\\game.zip', serial: 'Q3' },
    'C:\\kit', 'C:\\work', () => {}, { spawnImpl, platform: 'win32', withBuildPath }), /Required Windows build command is unavailable/);
});

test('7z personal game archives reach the builder as ZIP and clean up on failure', { skip: process.platform !== 'win32' }, async (t) => {
  const { promisify } = require('node:util');
  const runFile = promisify(require('node:child_process').execFile);
  const binary = sevenZipBinary();
  const root = await fs.mkdtemp(path.join(__dirname, '.personal-7z-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'base.apk'), 'owned APK');
  const source = path.join(root, 'owned.7z');
  await runFile(binary, ['a', '-t7z', source, 'base.apk'], { cwd: root, windowsHide: true });
  const original = await fs.readFile(source);
  const tempRoot = path.join(root, 'selected build temp');
  await assert.rejects(() => withCompatibleGamePackage(source, tempRoot, async (file) => {
    assert.equal(path.extname(file), '.zip');
    assert.ok(file.startsWith(tempRoot + path.sep));
    const { stdout } = await runFile(binary, ['l', file], { windowsHide: true });
    assert.match(stdout, /base\.apk/);
    throw new Error('fixture author rejection');
  }), /fixture author rejection/);
  assert.deepEqual(await fs.readdir(tempRoot), []);
  assert.deepEqual(await fs.readFile(source), original);
});

// ---- Linux: the creator's build-and-install.sh ----

const { buildShellArgs } = require('../src/linux-build-tools');

const scriptFor = (gameId) => `# options: --non-interactive --serial --game-package --work-dir --android-sdk --java-home${gameId === 'gta-sa-vr' ? ' --audio-source --yes' : ''}\n`;

const linuxKit = (gameId, script = scriptFor(gameId)) => async (_zip, destination) => {
  const tools = path.join(destination, 'official-kit', 'tools');
  await fs.mkdir(tools, { recursive: true });
  await fs.writeFile(path.join(tools, 'build-and-install.sh'), script);
};

function fakeShell({ lines = [], code = 0, signal = null, onSpawn = () => {} } = {}) {
  return (program, args, spawnOptions) => {
    onSpawn({ program, args, spawnOptions });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    queueMicrotask(() => { child.stdout.write(lines.join('\n') + '\n'); child.emit('close', code, signal); });
    return child;
  };
}

const linuxOptions = (extra = {}) => ({
  platform: 'linux', findTool: () => '/usr/bin/bash', checkHostTools: async () => {},
  resolveLinuxTools: async () => ({ javaHome: '/opt/jdk-21', sdkRoot: '/work/shared/.android-sdk' }), ...extra,
});

test('Linux source kit is unzipped, needs build-and-install.sh and every option VR4ALL passes, and is cached', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-kit-linux-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'd'.repeat(40);
  const fetchImpl = async (url) => url.includes('/commits/') ? new Response(JSON.stringify({ sha })) : new Response('zip fixture');
  let extracts = 0;
  const counted = (extract) => async (...args) => { extracts++; return extract(...args); };
  const first = await acquireSourceKit('rdr1-vr', root, () => {}, { fetchImpl, extract: counted(linuxKit('rdr1-vr')), platform: 'linux' });
  const second = await acquireSourceKit('rdr1-vr', root, () => {}, { fetchImpl, extract: counted(linuxKit('rdr1-vr')), platform: 'linux' });
  assert.equal(first.directory, second.directory);
  assert.equal(extracts, 1);
  // GTA also needs --audio-source and --yes; the RDR script text above lacks them.
  await assert.rejects(acquireSourceKit('gta-sa-vr', root, () => {}, { fetchImpl, extract: linuxKit('gta-sa-vr', scriptFor('rdr1-vr')), platform: 'linux' }), /safe unattended installation on Linux/);
  await assert.rejects(acquireSourceKit('rdr1-vr', path.join(root, 'ps1'), () => {}, {
    fetchImpl, platform: 'linux',
    extract: async (_zip, destination) => { await fs.mkdir(path.join(destination, 'kit', 'tools'), { recursive: true }); await fs.writeFile(path.join(destination, 'kit', 'tools', 'build-and-install.ps1'), 'param()'); },
  }), /missing its build script/);
});

test('Linux unpacks the real source archive with the system unzip', async (t) => {
  const { execFileSync } = require('node:child_process');
  const { findOnPath } = require('../src/find-tool');
  const zipTool = findOnPath(['zip']);
  if (!zipTool || !findOnPath(['unzip'])) return t.skip('zip and unzip are not installed');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-kit-unzip-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'e'.repeat(40);
  const kit = path.join(root, `rdr1-quest-${sha}`);
  await fs.mkdir(path.join(kit, 'tools'), { recursive: true });
  await fs.writeFile(path.join(kit, 'tools', 'build-and-install.sh'), scriptFor('rdr1-vr'));
  const archive = path.join(root, 'source.zip');
  execFileSync(zipTool, ['-qr', archive, `rdr1-quest-${sha}`], { cwd: root });
  const fetchImpl = async (url) => url.includes('/commits/') ? new Response(JSON.stringify({ sha })) : new Response(await fs.readFile(archive));
  const found = await acquireSourceKit('rdr1-vr', path.join(root, 'cache'), () => {}, { fetchImpl, platform: 'linux' });
  assert.equal(await fs.readFile(path.join(found.directory, 'tools', 'build-and-install.sh'), 'utf8'), scriptFor('rdr1-vr'));
});

test('Linux resolves symlinked game inputs to their real files, Windows leaves the path alone', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-input-link-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const real = path.join(root, 'real.xapk');
  const audio = path.join(root, 'audio.zip');
  await fs.writeFile(real, 'fixture'); await fs.writeFile(audio, 'fixture');
  await fs.symlink(real, path.join(root, 'link.xapk'));
  await fs.symlink(audio, path.join(root, 'link-audio.zip'));
  const input = { gamePackage: path.join(root, 'link.xapk'), audioSource: path.join(root, 'link-audio.zip'), serial: 'Q3' };
  const linux = await validatePersonalBuildInput('gta-sa-vr', input, { platform: 'linux' });
  assert.equal(linux.gamePackage, await fs.realpath(real));
  assert.equal(linux.audioSource, await fs.realpath(audio));
  const windows = await validatePersonalBuildInput('gta-sa-vr', input, { platform: 'win32' });
  assert.equal(windows.gamePackage, path.join(root, 'link.xapk'));
});

for (const gameId of ['rdr1-vr', 'gta-sa-vr']) {
  test(`Linux ${gameId} runs the creator script with the shared tools and the selected Quest`, { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, async () => {
    const lines = [];
    let call;
    const input = { gamePackage: '/games/export.zip', audioSource: gameId === 'gta-sa-vr' ? '/games/audio.7z' : null, serial: 'Q3' };
    let hostArgs;
    await runAuthorScript(gameId, input, '/kit', '/work/gta', (line) => lines.push(line), linuxOptions({
      checkHostTools: async (id, tools) => { hostArgs = { id, needsXz: tools.needsXz }; },
      spawnImpl: fakeShell({ lines: ['  % Total    % Received % Xferd  Average Speed', '100  130M  100  130M    0     0  55.1M      0  0:00:02  0:00:02 --:--:-- 55.2M', 'INSTALLED AND VERIFIED on Q3.'], onSpawn: (spawned) => { call = spawned; } }),
    }));
    assert.equal(call.program, '/usr/bin/bash');
    assert.deepEqual(call.args, buildShellArgs(gameId, input, '/kit', { toolsDir: '/work/shared', javaHome: '/opt/jdk-21', sdkRoot: '/work/shared/.android-sdk' }));
    assert.equal(call.args.includes('--yes'), gameId === 'gta-sa-vr');
    assert.equal(call.args.includes('--audio-source'), gameId === 'gta-sa-vr');
    assert.equal(call.spawnOptions.cwd, '/kit');
    assert.equal(call.spawnOptions.env.TMPDIR, '/work/shared/.tmp');
    assert.deepEqual(lines, ['INSTALLED AND VERIFIED on Q3.']);
    assert.deepEqual(hostArgs, { id: gameId, needsXz: gameId === 'gta-sa-vr' });
  });
}

test('Linux keeps the author’s specific ERROR line, not the closing "Read the ERROR line above"', async () => {
  const lines = ['ERROR: the game data is incomplete. Export all world and audio files.', 'ERROR: the build failed. Read the ERROR line above; fix it and rerun.', 'FAILED. No failure was treated as success.'];
  await assert.rejects(() => runAuthorScript('rdr1-vr', { gamePackage: '/games/export.zip', serial: 'Q3' }, '/kit', '/work/rdr1-vr', () => {},
    linuxOptions({ spawnImpl: fakeShell({ lines, code: 1 }) })), (error) => /\(exit 1\): the game data is incomplete\. Export all world and audio files\.$/.test(error.message));
});

test('Linux names the signal when the script is killed and points at the activity log when it printed no ERROR', async () => {
  await assert.rejects(() => runAuthorScript('rdr1-vr', { gamePackage: '/g.zip', serial: 'Q3' }, '/kit', '/work/rdr1-vr', () => {},
    linuxOptions({ spawnImpl: fakeShell({ lines: ['working'], code: null, signal: 'SIGTERM' }) })), /failed \(signal SIGTERM\); see activity/);
  await assert.rejects(() => runAuthorScript('rdr1-vr', { gamePackage: '/g.zip', serial: 'Q3' }, '/kit', '/work/rdr1-vr', () => {},
    linuxOptions({ spawnImpl: fakeShell({ lines: ['working'], code: 3 }) })), /failed \(exit 3\); see activity/);
});

test('Linux stops before launching when a host tool or the build tools are missing', async () => {
  const spawnImpl = () => { throw new Error('unexpected launch'); };
  await assert.rejects(() => runAuthorScript('gta-sa-vr', { gamePackage: '/g.zip', audioSource: '/a.7z', serial: 'Q3' }, '/kit', '/work/gta-sa-vr', () => {},
    linuxOptions({ spawnImpl, checkHostTools: async () => { throw new Error('Missing system tools needed to build on Linux: xz (package xz).'); } })), /xz \(package xz\)/);
  await assert.rejects(() => runAuthorScript('rdr1-vr', { gamePackage: '/g.zip', serial: 'Q3' }, '/kit', '/work/rdr1-vr', () => {},
    linuxOptions({ spawnImpl, resolveLinuxTools: async () => { throw new Error('Build tools are not set up. Click "Set up build tools" first.'); } })), /Set up build tools/);
});

test('Linux hands APKM to the creator script as ZIP and cleans it up', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '.personal-apkm-linux-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'owned-game.apkm');
  const bytes = Buffer.from('PK\x03\x04 owned APKM fixture');
  await fs.writeFile(source, bytes);
  const roots = { cacheRoot: path.join(root, 'source'), workRoot: path.join(root, 'selected drive') };
  const sha = 'f'.repeat(40);
  let prepared;
  await runPersonalBuild('rdr1-vr', { gamePackage: source, audioSource: null, serial: 'Q3' }, roots, () => {}, linuxOptions({
    fetchImpl: async (url) => new Response(url.includes('/commits/') ? JSON.stringify({ sha }) : 'source zip'),
    extract: linuxKit('rdr1-vr'),
    spawnImpl: (_program, args) => {
      prepared = args[args.indexOf('--game-package') + 1];
      assert.ok(prepared.startsWith(path.join(roots.workRoot, 'rdr1-vr', '.tmp') + path.sep));
      assert.equal(path.extname(prepared), '.zip');
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      fs.readFile(prepared).then((actual) => { assert.deepEqual(actual, bytes); child.emit('close', 0, null); }).catch((error) => child.emit('error', error));
      return child;
    },
  }));
  assert.equal(await fs.stat(prepared).catch(() => null), null);
  assert.deepEqual(await fs.readdir(path.join(roots.workRoot, 'rdr1-vr', '.tmp')), []);
  // Linux shares one physical tools folder next to the per-game folders.
  assert.ok((await fs.lstat(path.join(roots.workRoot, 'shared', '.android-sdk'))).isDirectory());
});
