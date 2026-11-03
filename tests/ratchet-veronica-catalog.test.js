const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { selectRelease, buildInstallPlan } = require('../src/core');
const { inspectDevice, packages } = require('../src/device-library');

const byId = Object.fromEntries(getCatalog().map((game) => [game.id, game]));

test('Ratchet and Code: Veronica X select creator Quest APKs and require the correct original discs', () => {
  for (const [id, repo, asset, packageId, serial] of [
    ['ratchet-clank-quest-vr', 'moistman42069/RatchetAndClank-Quest-VR', 'RatchetQuestVR-0.1.9.apk', 'dev.ratchetquest.vr', 'SCES-50916 / SCUS-97199'],
    ['code-veronica-x-vr', 'neto1495mn-sudo/recvx-enhanced-port-pcvr', 'RE-Code-Veronica-X-VR-v1.4.3.apk', 'org.recvx.vr', 'SLUS-20184'],
  ]) {
    const game = byId[id];
    assert.ok(game, id);
    assert.equal(game.source.repo, repo);
    assert.equal(packages[id], packageId);
    assert.equal(game.data.length, 1);
    assert.equal(game.data[0].kind, 'file');
    assert.deepEqual(game.data[0].extensions, ['.iso']);
    for (const supportedSerial of serial.split(' / ')) assert.ok(game.data[0].note.includes(supportedSerial));
    assert.equal(game.data[0].destination, '/sdcard/Download/');
    assert.match(game.art, /\.jpg$/);
    const selected = selectRelease([{ tag_name: 'v1', published_at: '2026-11-02T00:00:00Z', assets: [
      { name: 'windows-pcvr.zip', browser_download_url: 'https://github.com/creator/repo/releases/download/v1/windows-pcvr.zip' },
      { name: asset, browser_download_url: `https://github.com/${repo}/releases/download/v1/${asset}` },
    ] }], game.source);
    assert.equal(selected?.assetName, asset);
    const plan = buildInstallPlan(game, { serial: 'Q3', apkPath: 'C:\\port.apk', files: { disc: 'C:\\Games\\disc.iso' } });
    assert.deepEqual(plan.map((step) => step.label), ['Install APK', 'Create /sdcard/Download', 'Copy disc']);
  }
  assert.ok(byId['survivor2-code-veronica-vr']);
});

test('the two new ports are ready only while their owned ISO is available on the headset', async () => {
  const games = [byId['ratchet-clank-quest-vr'], byId['code-veronica-x-vr']];
  let files = '';
  const adb = { async run(args) {
    const command = args.slice(2).join(' ');
    if (command === 'shell pm list packages -3') return 'package:dev.ratchetquest.vr\npackage:org.recvx.vr';
    if (command.startsWith('shell dumpsys package')) return 'versionName=1.4.3';
    if (command === 'shell ls -1 /sdcard/Download/') return files;
    return '';
  } };
  let state = await inspectDevice(adb, 'Q3', games);
  assert.equal(state['ratchet-clank-quest-vr'].dataReady, false);
  assert.equal(state['code-veronica-x-vr'].dataReady, false);
  files = 'Ratchet and Clank (SCES-50916).iso\nResident Evil Code Veronica X (SLUS-20184).iso';
  state = await inspectDevice(adb, 'Q3', games);
  assert.equal(state['ratchet-clank-quest-vr'].dataReady, true);
  assert.equal(state['code-veronica-x-vr'].dataReady, true);
});
