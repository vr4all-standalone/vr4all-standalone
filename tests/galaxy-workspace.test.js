const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseGalaxyWorkRoot } = require('../src/galaxyquest-runner');

const gib = 1024n ** 3n;

test('GalaxyQuest uses the selected build folder, never the ROM drive', async () => {
  const mkdirs = [];
  await assert.rejects(() => chooseGalaxyWorkRoot('E:\\Games\\Galaxy.zip', 'C:\\AppData\\builds\\galaxyquest', {
    statfs: async (directory) => ({ bsize: Number(gib), bavail: directory.startsWith('E:') ? 40 : 9 }),
    mkdir: async (directory) => mkdirs.push(directory),
  }), /16 GB free.*build folder/i);
  assert.deepEqual(mkdirs, []);
});

test('GalaxyQuest uses a build folder selected by the user', async () => {
  const mkdirs = [];
  const chosen = await chooseGalaxyWorkRoot('E:\\Games\\Galaxy.rvz', 'D:\\VR4ALL Builds\\galaxyquest', {
    statfs: async (directory) => ({ bsize: Number(gib), bavail: directory.startsWith('D:') ? 30 : 5 }),
    mkdir: async (directory) => mkdirs.push(directory),
  });
  assert.equal(chosen, 'D:\\VR4ALL Builds\\galaxyquest');
  assert.deepEqual(mkdirs, [chosen]);
});
