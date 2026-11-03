const test = require('node:test');
const assert = require('node:assert/strict');
const { pickPath, linuxPickerCommand } = require('../src/picker');

test('zenity builds a file or folder dialog', () => {
  assert.deepEqual(linuxPickerCommand('/usr/bin/zenity', 'file', ''), ['/usr/bin/zenity', ['--file-selection', '--title=Choose game file']]);
  assert.deepEqual(linuxPickerCommand('/usr/bin/zenity', 'directory', '/home/me'), ['/usr/bin/zenity', ['--file-selection', '--directory', '--title=Choose game data folder', '--filename=/home/me/']]);
});

test('kdialog builds a file or folder dialog', () => {
  assert.deepEqual(linuxPickerCommand('/usr/bin/kdialog', 'file', ''), ['/usr/bin/kdialog', ['--getopenfilename', '.']]);
  assert.deepEqual(linuxPickerCommand('/usr/bin/kdialog', 'directory', '/home/me'), ['/usr/bin/kdialog', ['--getexistingdirectory', '/home/me']]);
});

test('zenity is preferred when found, kdialog otherwise', async () => {
  const calls = [];
  const run = async (command, args) => { calls.push([command, args]); return '/home/me/game.iso\n'; };
  const both = async (names) => `/usr/bin/${names[0]}`;
  assert.equal(await pickPath('file', '', { platform: 'linux', run, find: both }), '/home/me/game.iso');
  assert.equal(calls[0][0], '/usr/bin/zenity');
  const kdialogOnly = async (names) => (names.includes('kdialog') ? '/usr/bin/kdialog' : null);
  assert.equal(await pickPath('file', '', { platform: 'linux', run, find: kdialogOnly }), '/home/me/game.iso');
  assert.equal(calls[1][0], '/usr/bin/kdialog');
});

test('a cancelled dialog returns null and no picker tool gives a clear error', async () => {
  const find = async (names) => `/usr/bin/${names[0]}`;
  assert.equal(await pickPath('directory', '', { platform: 'linux', run: async () => '', find }), null);
  await assert.rejects(async () => pickPath('file', '', { platform: 'linux', run: async () => 'x', find: async () => null }), /zenity or kdialog/);
});
