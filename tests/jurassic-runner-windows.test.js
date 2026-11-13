const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { bashArgs } = require('../src/jurassic-runner');
const exec = promisify(execFile);

test('Jurassic launcher converts PC paths for native Windows tools and preserves Quest install paths',
  { skip: process.platform !== 'win32' }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-jurassic paths-'));
    const bash = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
    const sdk = path.join(root, 'Android SDK');
    const javaHome = path.join(root, 'Microsoft JDK 17');
    const gamePackage = path.join(root, 'Owned Games');
    const audioSource = path.join(root, 'PhysX libs');
    try {
      for (const dir of [sdk, javaHome, gamePackage, audioSource]) await fs.mkdir(dir);
      await fs.writeFile(path.join(root, 'requirements.txt'), 'native-path-ok');
      await fs.writeFile(path.join(root, 'probe.cjs'), `
        const fs = require('node:fs');
        console.log(JSON.stringify({ args: process.argv.slice(2), javaHome: process.env.JAVA_HOME,
          javaExists: fs.existsSync(process.env.JAVA_HOME),
          contents: process.argv[2] === '/sdcard/Android/data/com.jp2015.vr/files' ? null : fs.readFileSync(process.argv[2], 'utf8') }));
      `);
      await fs.writeFile(path.join(root, 'build.sh'), `#!/bin/sh
set -eu
ROOT=$(pwd)
"$VR4ALL_TEST_NODE" "$ROOT/probe.cjs" "$ROOT/requirements.txt" "-I$ANDROID_SDK" "$1" "$2"
`);
      // The author's install.sh scopes this override to ADB, converting its PC files explicitly.
      await fs.writeFile(path.join(root, 'install.sh'), `#!/bin/sh
set -eu
export MSYS_NO_PATHCONV=1
"$VR4ALL_TEST_NODE" "$(cygpath -m "$(pwd)/probe.cjs")" /sdcard/Android/data/com.jp2015.vr/files "$(cygpath -m "$1")"
`);
      const env = { ...process.env, VR4ALL_TEST_NODE: process.execPath,
        VR4ALL_SDK_WIN: sdk, VR4ALL_JAVA_WIN: javaHome, VR4ALL_ADB_WIN: process.execPath,
        MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*', MSYS2_ENV_CONV_EXCL: 'JAVA_HOME' };
      const result = await exec(bash, bashArgs({ script: 'build.sh', inputs: ['gamePackage', 'audioSource'] },
        { gamePackage, audioSource }), { cwd: root, env, windowsHide: true, timeout: 30000 });
      const built = JSON.parse(result.stdout);
      assert.equal(built.contents, 'native-path-ok');
      assert.equal(path.win32.normalize(built.args[0]), path.join(root, 'requirements.txt'));
      assert.equal(path.win32.normalize(built.args[1].slice(2)), sdk);
      assert.equal(path.win32.normalize(built.args[2]), gamePackage);
      assert.equal(path.win32.normalize(built.args[3]), audioSource);
      assert.equal(path.win32.normalize(built.javaHome), javaHome);
      assert.equal(built.javaExists, true);

      const installed = JSON.parse((await exec(bash,
        bashArgs({ script: 'install.sh', inputs: ['gamePackage'] }, { gamePackage }),
        { cwd: root, env, windowsHide: true, timeout: 30000 })).stdout);
      assert.equal(installed.args[0], '/sdcard/Android/data/com.jp2015.vr/files');
      assert.equal(path.win32.normalize(installed.args[1]), gamePackage);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
