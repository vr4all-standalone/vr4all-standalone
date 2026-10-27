const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');
const { selectRelease } = require('../src/core');
const { inspectDevice } = require('../src/device-library');
const mok = () => getCatalog().find((g) => g.id === 'mok-vr');

test('MOK keeps its existing card and file mappings while using the standalone release', () => {
  const game = mok();
  assert.equal(getCatalog().filter((g) => g.id === 'mok-vr').length, 1);
  assert.equal(game.source.repo, 'vr4all-standalone/mok-vr');
  assert.equal(game.projectUrl, 'https://github.com/vr4all-standalone/mok-vr');
  assert.equal(game.fileAccessPackage, 'com.vrlightgunhub.mok');
  assert.deepEqual([game.console, game.genre], ['Arcade', 'Rail shooter']);
  assert.deepEqual(game.data.map(({id,destination,optional}) => [id,destination,Boolean(optional)]), [
    ['mok', '/sdcard/Download/mok.zip', false],
    ['chd', '/sdcard/Download/mok/gds-0022.chd', false],
    ['naomi', '/sdcard/Download/naomi.zip', true],
  ]);
  assert.match(game.afterInstall, /staff/i);
  assert.ok(fs.statSync(path.join(__dirname, '..', 'public', game.art.slice(1))).size > 0);
});

test('MOK selects only its Quest APK and leaves the upstream HOTD2 selector separate', () => {
  const names = ['mok-vr-pcvr.zip', 'hotd2-vr-quest.apk', 'mok-vr-quest.apk'];
  const releases = [{tag_name:'v1.0.0', assets:names.map((name) => ({name,browser_download_url:`https://github.com/vr4all-standalone/mok-vr/releases/download/v1.0.0/${name}`}))}];
  assert.equal(selectRelease(releases,mok().source)?.assetName,'mok-vr-quest.apk');
  const hotd = getCatalog().find((g) => g.id === 'hotd2-dreamcast-vr');
  assert.equal(hotd.source.repo,'mikermak/hotd2-vr');
  assert.equal(selectRelease(releases,hotd.source)?.assetName,'hotd2-vr-quest.apk');
});

test('MOK requires its own installed package and both game files on rescan', async () => {
  let own=false, zip=true, chd=true;
  const adb={async run(args){const cmd=args.slice(2).join(' ');
    if(cmd==='shell pm list packages -3')return `package:com.flycast.emulator.vr${own?'\npackage:com.vrlightgunhub.mok':''}`;
    if(cmd==='shell dumpsys package com.vrlightgunhub.mok')return 'versionName=1.0.0-gabc123';
    if(cmd==='shell dumpsys package com.flycast.emulator.vr')return 'versionName=v0.4-test1';
    if(cmd==='shell ls -1 /sdcard/Download')return zip?'mok.zip\nnaomi.zip':'naomi.zip';
    if(cmd==='shell ls -1 /sdcard/Download/mok')return chd?'gds-0022.chd':'';
    throw Error(`Unexpected probe ${cmd}`);
  }};
  assert.equal((await inspectDevice(adb,'TEST',[mok()]))['mok-vr'], undefined);
  own=true;
  let scan=(await inspectDevice(adb,'TEST',[mok()]))['mok-vr'];
  assert.equal(scan.packageId,'com.vrlightgunhub.mok');
  assert.equal(scan.dataReady,true);
  assert.equal(scan.versionComparable,true);
  chd=false;assert.equal((await inspectDevice(adb,'TEST',[mok()]))['mok-vr'].dataReady,false);
  chd=true;zip=false;assert.equal((await inspectDevice(adb,'TEST',[mok()]))['mok-vr'].dataReady,false);
});
