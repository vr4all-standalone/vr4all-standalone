const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chooseGalaxyWorkRoot } = require('../src/galaxyquest-runner');

const gib = 1024n ** 3n;

test('GalaxyQuest uses the selected build folder, never the ROM drive', async () => {
  const mkdirs = [];
  const romDir = path.resolve(path.sep, 'games');
  await assert.rejects(() => chooseGalaxyWorkRoot(path.join(romDir, 'Galaxy.zip'), path.resolve(path.sep, 'appdata', 'builds', 'galaxyquest'), {
    statfs: async (directory) => ({ bsize: Number(gib), bavail: directory.startsWith(romDir) ? 40 : 9 }),
    mkdir: async (directory) => mkdirs.push(directory),
  }), /16 GB free.*build folder/i);
  assert.deepEqual(mkdirs, []);
});

test('GalaxyQuest uses a build folder selected by the user', async () => {
  const mkdirs = [];
  const buildDir = path.resolve(path.sep, 'vr4all builds', 'galaxyquest');
  const chosen = await chooseGalaxyWorkRoot(path.resolve(path.sep, 'games', 'Galaxy.rvz'), buildDir, {
    statfs: async (directory) => ({ bsize: Number(gib), bavail: directory === path.parse(buildDir).root ? 30 : 5 }),
    mkdir: async (directory) => mkdirs.push(directory),
  });
  assert.equal(chosen, buildDir);
  assert.deepEqual(mkdirs, [chosen]);
});
