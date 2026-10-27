const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { validatePersonalBuildInput, buildPowerShellArgs, acquireSourceKit, runAuthorScript, runPersonalBuild, withCompatibleGamePackage } = require('../src/personal-build');

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
  const first = await acquireSourceKit('rdr1-vr', root, () => {}, { fetchImpl, extract });
  const second = await acquireSourceKit('rdr1-vr', root, () => {}, { fetchImpl, extract });
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
  const kit = await acquireSourceKit('rdr1-vr', root, () => {}, { fetchImpl, extract });
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
  await assert.rejects(() => runAuthorScript('rdr1-vr', { gamePackage: 'C:\\game.xapk', serial: 'Q3' }, 'C:\\kit', 'C:\\work', (line) => lines.push(line), { spawnImpl, platform: 'linux' }), /failed \(exit 1\)/);
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
        platform: 'linux',
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
    'C:\\kit', 'C:\\work', () => {}, { spawnImpl, platform: 'linux' }), /the game data is incomplete.*world and audio/);
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
    'C:\\kit', 'C:\\work', () => {}, { spawnImpl, platform: 'linux' }), /Required Windows build command is unavailable/);
});

test('7z personal game archives reach the builder as ZIP and clean up on failure', { skip: process.platform !== 'win32' }, async (t) => {
  const { promisify } = require('node:util');
  const runFile = promisify(require('node:child_process').execFile);
  const binary = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');
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
