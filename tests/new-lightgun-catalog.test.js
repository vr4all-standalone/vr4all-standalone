const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');
const { inspectDevice } = require('../src/device-library');
const { selectRelease, buildInstallPlan } = require('../src/core');
test('Confidential Mission installed outside VR4ALL is discovered without prior installer history', async () => {
  const game=getCatalog().find(g=>g.id==='confidential-mission-vr');
  const adb={async run(args){
    const cmd=args.slice(2).join(' ');
    if(cmd==='shell pm list packages -3')return 'package:com.vrlightgunhub.confmiss';
    if(cmd==='shell dumpsys package com.vrlightgunhub.confmiss')return 'versionName=1.2.7-gbc648405';
    if(cmd==='shell ls -1 /sdcard/Download')return 'confmiss.zip';
    if(cmd==='shell ls -1 /sdcard/Download/confmiss')return 'gds-0001.chd';
    throw new Error(cmd);
  }};
  const state=(await inspectDevice(adb,'QUEST',[game]))[game.id];
  assert.equal(state?.packageId,'com.vrlightgunhub.confmiss');
  assert.equal(state.dataReady,true);
});
test('VC1 transfers separate game, I/O firmware and LCD firmware archives without manual merging',()=>{
  const game=getCatalog().find(g=>g.id==='vcop-vr');
  assert.equal(game.data.find(f=>f.id==='hd44780')?.optional,true);
  const plan=buildInstallPlan(game,{serial:'QUEST',apkPath:'C:/Quest.apk',files:{game:'C:/vcop.zip',model1io2:'C:/model1io2.zip',hd44780:'C:/hd44780.zip'}});
  assert.deepEqual(plan.filter(s=>s.args[2]==='push').map(s=>s.args.at(-1)),['/sdcard/Download/vcop-vr/vcop.zip','/sdcard/Download/vcop-vr/model1io2.zip','/sdcard/Download/vcop-vr/hd44780.zip']);
});
for (const [id, pkg, version, destinations] of [
  ['teraburst-vr', 'com.vrlightgunhub.teraburst', '0.1.1', ['/sdcard/Download/terabrst.zip']],
  ['vcop-vr', 'com.vrlightgunhub.vcop', '0.1.6', ['/sdcard/Download/vcop-vr/vcop.zip']],
  ['vcop2-vr', 'com.vrlightgunhub.vcop2', '0.2.11', ['/sdcard/Download/vcop2.zip']],
]) {
  test(`${id}: public Quest release, correct package and combined-media install/update readiness`, async () => {
    const game = getCatalog().find(g => g.id === id);
    assert.ok(game, 'released game must be in the shipped catalog');
    assert.equal(game.fileAccessPackage, pkg);
    assert.equal(game.source.repo, `vr4all-standalone/${id}`);
    const release = selectRelease([{ tag_name: `v${version}`, assets: [
      { name: `${id}-pcvr.zip`, browser_download_url: `https://github.com/vr4all-standalone/${id}/releases/download/v${version}/${id}-pcvr.zip` },
      { name: `${id}-quest.apk`, browser_download_url: `https://github.com/vr4all-standalone/${id}/releases/download/v${version}/${id}-quest.apk` },
    ] }], game.source);
    assert.equal(release.assetName, `${id}-quest.apk`);
    const plan = buildInstallPlan(game, { serial: 'QUEST', apkPath: 'C:/Quest.apk', files: { game: 'C:/combined.zip' } });
    assert.deepEqual(plan.filter(s => s.args[2] === 'push').map(s => s.args.at(-1)), destinations);
    const adb = { async run(args) {
      const cmd = args.slice(2).join(' ');
      if (cmd === 'shell pm list packages -3') return `package:${pkg}`;
      if (cmd === `shell dumpsys package ${pkg}`) return `versionName=${version}`;
      if (cmd.startsWith('shell ls -1 ')) return destinations.map(p => p.split('/').at(-1)).join('\n');
      throw new Error(cmd);
    } };
    const state = (await inspectDevice(adb, 'QUEST', [game]))[id];
    assert.equal(state?.packageId, pkg);
    assert.equal(state.versionName, version);
    assert.equal(state.dataReady, true);
    assert.equal(state.versionComparable, true);
  });
}
