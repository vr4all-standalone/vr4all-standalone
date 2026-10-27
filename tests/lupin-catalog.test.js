const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease } = require('../src/core');
const { inspectDevice } = require('../src/device-library');
function lupin() { const game = getCatalog().find((g) => g.id === 'lupin-the-third-vr'); assert.ok(game, 'Lupin is in the VR4ALL library'); return game; }

test('Lupin has its own Arcade card and local project artwork', () => {
  const game = lupin();
  assert.equal(game.title, 'Lupin the Third VR');
  assert.deepEqual([game.console, game.genre], ['Arcade', 'Rail shooter']);
  assert.equal(game.variantOf, undefined);
  assert.equal(game.projectUrl, 'https://github.com/vr4all-standalone/lupin-the-third-vr');
  assert.ok(fs.statSync(path.join(__dirname, '..', 'public', game.art.slice(1))).size > 0);
});
test('Lupin release selection takes only its standalone Quest APK', () => {
  const game = lupin();
  assert.equal(game.source.repo, 'vr4all-standalone/lupin-the-third-vr');
  const assets = ['lupin-the-third-vr-pcvr.zip', 'VR4ALL-0.3.25-lupin-win-x64.exe', 'confidential-mission-vr-quest.apk', 'lupin-the-third-vr-quest.apk'].map((name) => ({ name, browser_download_url: `https://github.com/${game.source.repo}/releases/download/v1.0.0/${name}` }));
  assert.equal(selectRelease([{tag_name:'v1.0.0', assets}], game.source)?.assetName, 'lupin-the-third-vr-quest.apk');
});
test('Lupin transfers the original ZIP and CHD to its canonical lowercase paths', () => {
  const game = lupin();
  assert.equal(game.fileAccessPackage, 'com.vrlightgunhub.lupin');
  assert.deepEqual(game.data.map(({ id, destination, optional }) => [id, destination, Boolean(optional)]), [
    ['game', '/sdcard/Download/lupinshoo.zip', false],
    ['chd', '/sdcard/Download/lupinshoo/gds-0018.chd', false],
    ['naomi', '/sdcard/Download/naomi.zip', true],
  ]);
  assert.match(game.guidance, /GDS-0018/);
  assert.match(game.guidance, /Rev A.*not supported/i);
});
test('Lupin rescan recognizes its separate package and requires both original file paths', async () => {
  let zip=true, chd=true;
  const game=lupin();
  const adb={async run(args){const cmd=args.slice(2).join(' ');
    if(cmd==='shell pm list packages -3')return 'package:com.vrlightgunhub.lupin\npackage:com.vrlightgunhub.confmiss';
    if(cmd==='shell dumpsys package com.vrlightgunhub.lupin')return 'versionName=1.0.0-g00706171d';
    if(cmd==='shell ls -1 /sdcard/Download')return zip?'lupinshoo.zip\nnaomi.zip':'naomi.zip';
    if(cmd==='shell ls -1 /sdcard/Download/lupinshoo')return chd?'gds-0018.chd':'';
    throw new Error(`Unexpected probe ${cmd}`);
  }};
  let scan=await inspectDevice(adb,'TEST',[game]);
  assert.equal(scan[game.id]?.packageId,'com.vrlightgunhub.lupin');assert.equal(scan[game.id]?.dataReady,true);
  chd=false;assert.equal((await inspectDevice(adb,'TEST',[game]))[game.id]?.dataReady,false);
  chd=true;zip=false;assert.equal((await inspectDevice(adb,'TEST',[game]))[game.id]?.dataReady,false);
});