const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { withSharedBuildTools, findSharedJavaHome, buildToolsDir } = require('../src/shared-build-tools');

// The junction layout is the Windows behaviour; force it so these tests mean the same on every host.
const withJunctions = (dir, operation, log = () => {}) => withSharedBuildTools(dir, operation, log, { platform: 'win32' });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-shared-tools-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('three games reuse downloaded tools while retaining separate build output and SDK versions', async (t) => {
  const root = await fixture(t);
  for (const game of ['vice-city-vr', 'rdr1-vr', 'gta-sa-vr']) {
    await withJunctions(path.join(root, game), async (work) => {
      const sdk = path.join(work, '.android-sdk');
      if (game === 'vice-city-vr') {
        await fs.mkdir(path.join(sdk, 'build-tools', '34.0.0'), { recursive: true });
        await fs.writeFile(path.join(work, '.downloads', 'jdk.zip'), 'downloaded once');
      } else {
        assert.equal(await fs.readFile(path.join(work, '.downloads', 'jdk.zip'), 'utf8'), 'downloaded once');
        assert.ok((await fs.stat(path.join(sdk, 'build-tools', '34.0.0'))).isDirectory());
        await fs.mkdir(path.join(sdk, 'build-tools', '35.0.0'), { recursive: true });
      }
      await fs.writeFile(path.join(work, 'game-output.txt'), game);
    });
  }
  assert.equal(await fs.readFile(path.join(root, 'vice-city-vr', 'game-output.txt'), 'utf8'), 'vice-city-vr');
  assert.deepEqual((await fs.readdir(path.join(root, 'shared', '.android-sdk', 'build-tools'))).sort(), ['34.0.0', '35.0.0']);
  assert.deepEqual(await fs.readdir(path.join(root, 'shared', '.downloads')), ['jdk.zip']);
});

test('existing tools from another game are adopted without copying or overwriting conflicting files', async (t) => {
  const root = await fixture(t);
  const old = path.join(root, 'rdr1-vr', '.tools');
  await fs.mkdir(old, { recursive: true });
  await fs.writeFile(path.join(old, 'jdk.txt'), 'already downloaded');
  await withJunctions(path.join(root, 'gta-sa-vr'), async (work) => {
    assert.equal(await fs.readFile(path.join(work, '.tools', 'jdk.txt'), 'utf8'), 'already downloaded');
  });
  await fs.mkdir(path.join(root, 'vice-city-vr', '.tools'), { recursive: true });
  await fs.writeFile(path.join(root, 'vice-city-vr', '.tools', 'jdk.txt'), 'older copy');
  await fs.writeFile(path.join(root, 'vice-city-vr', '.tools', 'unique.txt'), 'keep this');
  const logs = [];
  await withJunctions(path.join(root, 'vice-city-vr'), async (work) => {
    assert.equal(await fs.readFile(path.join(work, '.tools', 'jdk.txt'), 'utf8'), 'already downloaded');
    assert.equal(await fs.readFile(path.join(work, '.tools', 'unique.txt'), 'utf8'), 'keep this');
  }, (line) => logs.push(line));
  const preserved = (await fs.readdir(path.join(root, 'vice-city-vr'))).find((name) => name.startsWith('.tools.previous-'));
  assert.ok(preserved);
  assert.equal(await fs.readFile(path.join(root, 'vice-city-vr', preserved, 'jdk.txt'), 'utf8'), 'older copy');
  assert.ok(logs.some((line) => line.includes(preserved)));
});

test('shared tools serialize different games and release the queue after an error', async (t) => {
  const root = await fixture(t);
  let release, entered;
  const enteredFirst = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const events = [];
  const first = withJunctions(path.join(root, 'rdr1-vr'), async () => { events.push('first'); entered(); await gate; throw new Error('build failed'); });
  const rejected = assert.rejects(first, /build failed/);
  await enteredFirst;
  const second = withJunctions(path.join(root, 'gta-sa-vr'), async () => { events.push('second'); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first']);
  release(); await rejected; await second;
  assert.deepEqual(events, ['first', 'second']);
});

test('an empty current cache does not hide complete tools already installed for another game', async (t) => {
  const root = await fixture(t);
  const vice = path.join(root, 'vice-city-vr');
  const rdr = path.join(root, 'rdr1-vr');
  await fs.mkdir(path.join(vice, '.android-sdk'), { recursive: true });
  await fs.mkdir(path.join(rdr, '.android-sdk', 'ndk', '27.2.12479018'), { recursive: true });
  await fs.writeFile(path.join(rdr, '.android-sdk', 'ndk', '27.2.12479018', 'ready'), 'already installed');
  await withJunctions(vice, async (work) => {
    assert.equal(await fs.readFile(path.join(work, '.android-sdk', 'ndk', '27.2.12479018', 'ready'), 'utf8'), 'already installed');
  });
});

test('a partial zero-byte shared download reuses the complete copy in a previously unbound game', async (t) => {
  const root = await fixture(t);
  const vice = path.join(root, 'vice-city-vr');
  await withJunctions(vice, async (work) => fs.writeFile(path.join(work, '.downloads', 'java.zip'), ''));
  const rdr = path.join(root, 'rdr1-vr');
  await fs.mkdir(path.join(rdr, '.downloads'), { recursive: true });
  await fs.writeFile(path.join(rdr, '.downloads', 'java.zip'), 'complete download');
  await withJunctions(vice, async (work) => {
    assert.equal(await fs.readFile(path.join(work, '.downloads', 'java.zip'), 'utf8'), 'complete download');
  });
});

test('an existing cache link outside the selected folder is rejected without touching its target', async (t) => {
  const root = await fixture(t);
  const outside = path.join(root, 'unrelated');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'untouched');
  const work = path.join(root, 'rdr1-vr');
  await fs.mkdir(work);
  await fs.symlink(outside, path.join(work, '.tools'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(withJunctions(work, async () => { throw new Error('must not run'); }), /link|outside|unexpected/i);
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'untouched');
});

test('the installed command-line tools and Java are reused across the author naming differences', async (t) => {
  const root = await fixture(t);
  await withJunctions(path.join(root, 'rdr1-vr'), async (work) => {
    const cli = path.join(work, '.android-sdk', 'cmdline-tools', '15859902');
    await fs.mkdir(path.join(cli, 'lib'), { recursive: true });
    await fs.mkdir(path.join(cli, 'bin'));
    await fs.writeFile(path.join(cli, 'lib', 'sdkmanager-classpath.jar'), 'official CLI');
    await fs.writeFile(path.join(cli, 'bin', 'sdkmanager.bat'), 'official launcher');
    await fs.writeFile(path.join(cli, 'source.properties'), 'Pkg.Revision=22.0\n');
    const java = path.join(work, '.tools', 'temurin-jdk-21.0.11+10', 'bin');
    await fs.mkdir(java, { recursive: true });
    await fs.writeFile(path.join(java, 'java.exe'), 'java');
    await fs.writeFile(path.join(java, 'javac.exe'), 'javac');
  });
  await withJunctions(path.join(root, 'vice-city-vr'), async (work) => {
    assert.equal(await fs.readFile(path.join(work, '.android-sdk', 'cmdline-tools', 'latest', 'lib', 'sdkmanager-classpath.jar'), 'utf8'), 'official CLI');
    assert.equal(await findSharedJavaHome(work, { platform: 'win32' }), path.join(work, '.tools', 'temurin-jdk-21.0.11+10'));
  });
});

test('an older latest CLI is not relabeled as the newer pinned release', async (t) => {
  const root = await fixture(t);
  const work = path.join(root, 'vice-city-vr');
  await withJunctions(work, async () => {
    const latest = path.join(work, '.android-sdk', 'cmdline-tools', 'latest');
    await fs.mkdir(path.join(latest, 'lib'), { recursive: true });
    await fs.mkdir(path.join(latest, 'bin'));
    await fs.writeFile(path.join(latest, 'lib', 'sdkmanager-classpath.jar'), 'older CLI');
    await fs.writeFile(path.join(latest, 'bin', 'sdkmanager.bat'), 'older launcher');
    await fs.writeFile(path.join(latest, 'source.properties'), 'Pkg.Revision=21.0\n');
  });
  assert.equal(await fs.lstat(path.join(work, '.android-sdk', 'cmdline-tools', '15859902')).catch(() => null), null);
});

// ---- Linux: one physical shared directory, no links -------------------------------------------

const linux = (dir, operation, log = () => {}) => withSharedBuildTools(dir, operation, log, { platform: 'linux' });

test('Linux games share one physical directory and no link is ever created', async (t) => {
  const root = await fixture(t);
  for (const game of ['vice-city-vr', 'rdr1-vr', 'gta-sa-vr']) {
    await linux(path.join(root, game), async (work) => {
      assert.equal(work, path.join(root, game));
      assert.equal(buildToolsDir(work, { platform: 'linux' }), path.join(root, 'shared'));
      const marker = path.join(root, 'shared', '.downloads', `${game}.txt`);
      await fs.writeFile(marker, game);
    });
  }
  const shared = path.join(root, 'shared');
  for (const name of ['.tools', '.downloads', '.android-sdk', '.gradle', '.tmp']) assert.ok((await fs.lstat(path.join(shared, name))).isDirectory(), name);
  assert.deepEqual((await fs.readdir(path.join(shared, '.downloads'))).sort(), ['gta-sa-vr.txt', 'rdr1-vr.txt', 'vice-city-vr.txt']);
  assert.equal(await fs.lstat(path.join(shared, '.android-user')).catch(() => null), null, 'Linux must not create the Windows-only user dir');
  for (const entry of await fs.readdir(root, { recursive: true })) assert.equal((await fs.lstat(path.join(root, entry))).isSymbolicLink(), false, entry);
});

test('Linux rejects a shared tool directory that is a link without touching its target', async (t) => {
  const root = await fixture(t);
  const outside = path.join(root, 'unrelated');
  await fs.mkdir(outside);
  await fs.mkdir(path.join(root, 'shared'));
  await fs.symlink(outside, path.join(root, 'shared', '.tools'), 'dir');
  await assert.rejects(linux(path.join(root, 'rdr1-vr'), async () => { throw new Error('must not run'); }), /link|unexpected/i);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('Linux serializes different games and releases the queue after an error', async (t) => {
  const root = await fixture(t);
  let release, entered;
  const enteredFirst = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const events = [];
  const logs = [];
  const rejected = assert.rejects(linux(path.join(root, 'rdr1-vr'), async () => { events.push('first'); entered(); await gate; throw new Error('build failed'); }), /build failed/);
  await enteredFirst;
  const second = linux(path.join(root, 'gta-sa-vr'), async () => { events.push('second'); }, (line) => logs.push(line));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(events, ['first']);
  release(); await rejected; await second;
  assert.deepEqual(events, ['first', 'second']);
  assert.ok(logs.some((line) => /Waiting for the other build/.test(line)));
});

test('Linux aliases the pinned command-line tools between latest and the versioned name and finds the newest JDK 21', { skip: process.platform === 'win32' && 'Linux-only install path (POSIX paths, file modes or shell tools)' }, async (t) => {
  const root = await fixture(t);
  const options = { platform: 'linux' };
  await linux(path.join(root, 'rdr1-vr'), async (work) => {
    const cli = path.join(buildToolsDir(work, options), '.android-sdk', 'cmdline-tools', '15859902');
    await fs.mkdir(path.join(cli, 'lib'), { recursive: true });
    await fs.mkdir(path.join(cli, 'bin'));
    await fs.writeFile(path.join(cli, 'lib', 'sdkmanager-classpath.jar'), 'official CLI');
    await fs.writeFile(path.join(cli, 'bin', 'sdkmanager'), '#!/bin/sh\n');
    await fs.writeFile(path.join(cli, 'source.properties'), 'Pkg.Revision=22.0\n');
    for (const [name, executable] of [['jdk-21.0.9+10-linux-x64', true], ['jdk-21.0.11+10-linux-x64', true], ['jdk-21.0.12+1-linux-x64', false]]) {
      const bin = path.join(buildToolsDir(work, options), '.tools', name, 'bin');
      await fs.mkdir(bin, { recursive: true });
      for (const file of ['java', 'javac']) await fs.writeFile(path.join(bin, file), '#!/bin/sh\n', { mode: executable ? 0o755 : 0o644 });
    }
  });
  await linux(path.join(root, 'vice-city-vr'), async (work) => {
    const latest = path.join(root, 'shared', '.android-sdk', 'cmdline-tools', 'latest');
    assert.equal(await fs.readFile(path.join(latest, 'lib', 'sdkmanager-classpath.jar'), 'utf8'), 'official CLI');
    assert.equal(await findSharedJavaHome(work, options), path.join(root, 'shared', '.tools', 'jdk-21.0.11+10-linux-x64'));
  });
});

test('Linux ignores a JDK folder that lacks working java and javac', async (t) => {
  const root = await fixture(t);
  const work = path.join(root, 'gta-sa-vr');
  await linux(work, async () => {
    await fs.mkdir(path.join(root, 'shared', '.tools', 'jdk-21.0.11+10-linux-x64', 'bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'shared', '.tools', 'jdk-21.0.11+10-linux-x64', 'bin', 'java'), '', { mode: 0o755 });
  });
  assert.equal(await findSharedJavaHome(work, { platform: 'linux' }), null);
});
