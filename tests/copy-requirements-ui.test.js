const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getCatalog } = require('../src/catalog');

function appContext({ desktopCopy, denyBrowserClipboard = false, fallbackCopy } = {}) {
  const listeners = {};
  const copied = [];
  const element = () => ({ hidden: true, value: '', addEventListener() {}, classList: { toggle() {} } });
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [], getElementById: element,
      addEventListener(name, handler) { listeners[name] = handler; },
      createElement: () => ({ value: '', select() {}, remove() {} }),
      execCommand: (name) => { if (name === 'copy' && fallbackCopy) return fallbackCopy(); return false; },
      body: { dataset: {}, appendChild() {} } },
    window: { QUESTDESK_TOKEN: 'test', addEventListener() {}, ...(desktopCopy ? { vr4allDesktop: { copyText: desktopCopy } } : {}) },
    navigator: { clipboard: { async writeText(value) {
      if (denyBrowserClipboard) throw new Error('Write permission denied');
      copied.push(value);
    } } },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, console,
  });
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').replace(/\nboot\(\);/, '\n');
  vm.runInContext(script, context);
  context.games = getCatalog();
  context.listeners = listeners;
  context.copied = copied;
  vm.runInContext('state.games = games', context);
  return context;
}

test('arcade requirement copies the exact set and revision, not an invented download URL', () => {
  const context = appContext();
  const text = vm.runInContext('requirementCopyText(games.find(g => g.id === "time-crisis-vr"), games.find(g => g.id === "time-crisis-vr").data[0])', context);
  assert.match(text, /timecris\.zip/);
  assert.match(text, /MAME 0\.289/);
  assert.doesNotMatch(text, /https?:\/\//);
  const html = vm.runInContext('detailHtml(games.find(g => g.id === "time-crisis-vr"))', context);
  assert.match(html, /data-copy-item="timecris"/);
});

test('Crazy Taxi copies the creator-documented APKM filename, not a generic game description', () => {
  const context = appContext();
  const taxi = context.games.find((game) => game.id === 'crazy-taxi-vr');
  const text = vm.runInContext('buildRequirementCopyText(games.find(g => g.id === "crazy-taxi-vr"))', context);
  assert.equal(text, 'com.sega.CrazyTaxiplayhaven_6.0-80_2arch_7dpi_24lang_1feat_017e8b1c582569ff9682193551b7e22c_apkmirror.com.apkm');
  assert.match(vm.runInContext('detailHtml(games.find(g => g.id === "crazy-taxi-vr"))', context), /com\.sega\.CrazyTaxiplayhaven_6\.0-80/);
  assert.equal(taxi.personalBuild.copyRequirement, text);
});

test('Crazy Taxi Copy requirement button sends the exact original APKM name to the clipboard', async () => {
  const context = appContext();
  vm.runInContext('state.selectedId = "crazy-taxi-vr"', context);
  await context.listeners.click({ target: { closest: (selector) => selector === '.copy-requirement'
    ? { dataset: { copyBuild: 'gamePackage' } } : null } });
  assert.equal(context.copied[0], 'com.sega.CrazyTaxiplayhaven_6.0-80_2arch_7dpi_24lang_1feat_017e8b1c582569ff9682193551b7e22c_apkmirror.com.apkm');
});

test('generic copied requirements retain all documented version and format details', () => {
  const context = appContext();
  const prime = vm.runInContext('requirementCopyText(games.find(g => g.id === "primedgun-2"), games.find(g => g.id === "primedgun-2").data[0])', context);
  assert.match(prime, /GM8E01 revisions 0–2/);
  assert.match(prime, /uncompressed ISO/);
  const maxPayne = vm.runInContext('requirementCopyText(games.find(g => g.id === "max-payne-mpvr"), games.find(g => g.id === "max-payne-mpvr").data[0])', context);
  assert.match(maxPayne, /version code 14/);
  assert.match(maxPayne, /mpvr checks the exact library build/);
});

test('official converter requirements do not advertise unsupported disc formats', () => {
  const context = appContext();
  const galaxy = context.games.find((game) => game.id === 'galaxyquest');
  const gt2 = context.games.find((game) => game.id === 'gt2-vr');
  const galaxyCopy = vm.runInContext('requirementCopyText(games.find(g => g.id === "galaxyquest"), games.find(g => g.id === "galaxyquest").data[0])', context);
  const gt2Copy = vm.runInContext('requirementCopyText(games.find(g => g.id === "gt2-vr"), games.find(g => g.id === "gt2-vr").data[0])', context);
  assert.match(galaxyCopy, /ISO.*RVZ.*WBFS/i);
  assert.doesNotMatch(galaxyCopy, /GCZ|WIA|CISO/i);
  assert.deepEqual(galaxy.data[0].extensions, ['.iso', '.rvz', '.wbfs']);
  assert.match(gt2Copy, /2352-byte.*BIN\/CUE/i);
  assert.doesNotMatch(gt2Copy, /(?:plain|2048-byte) ISO.*(?:supported|works)/i);
  assert.ok(!gt2.data[0].extensions.includes('.iso'));
});

test('creator-specific arcade requirements include documented revisions', () => {
  const context = appContext();
  const gunblade = vm.runInContext('requirementCopyText(games.find(g => g.id === "gunblade-ny-vr"), games.find(g => g.id === "gunblade-ny-vr").data[0])', context);
  assert.match(gunblade, /Gunblade NY.*gunblade\.zip.*Revision A/i);
});

test('copied game requirements include the creator documented edition and companion files', () => {
  const context = appContext();
  const copy = (gameId, itemId) => vm.runInContext(`requirementCopyText(games.find(g => g.id === ${JSON.stringify(gameId)}), games.find(g => g.id === ${JSON.stringify(gameId)}).data.find(i => i.id === ${JSON.stringify(itemId)}))`, context);
  assert.match(copy('oot-vr', 'rom'), /PAL 1\.0.*US.*1\.2.*GameCube/i);
  assert.match(copy('nfsu2-vr', 'disc'), /USA.*NFSUNDER.*ZDIR\.BIN.*ZZDATA0/i);
  assert.match(copy('road-rash-vr', 'discImage'), /SLUS_01053.*2352.*BIN/i);
  assert.match(copy('sourcevr', 'entropy'), /episodic.*ep2/i);
  assert.match(copy('questsam', 'game'), /\.gro.*Levels/i);
  assert.match(copy('freespace2-vr', 'game'), /nine.*\.vp.*data2.*data3/i);
});

test('copied arcade requirements describe conditional firmware and accepted set names', () => {
  const context = appContext();
  const copy = (gameId, itemId) => vm.runInContext(`requirementCopyText(games.find(g => g.id === ${JSON.stringify(gameId)}), games.find(g => g.id === ${JSON.stringify(gameId)}).data.find(i => i.id === ${JSON.stringify(itemId)}))`, context);
  assert.match(copy('rally-vr', 'segabill'), /segabill\.zip.*only.*srallyc\.zip/i);
  assert.match(copy('rave-racer-vr', 'race'), /raverace\.zip.*raveracw\.zip.*original filename/i);
  assert.match(copy('mok-vr', 'naomi'), /naomi\.zip.*only.*mok\.zip/i);
});

test('creator alternatives and full-game requirements are described without promising unsupported imports', () => {
  const context = appContext();
  const copy = (gameId, itemId) => vm.runInContext(`requirementCopyText(games.find(g => g.id === ${JSON.stringify(gameId)}), games.find(g => g.id === ${JSON.stringify(gameId)}).data.find(i => i.id === ${JSON.stringify(itemId)}))`, context);
  assert.match(copy('quest-strikers', 'disc'), /G4QE01.*tested.*G4QP01.*G4QJ01.*untested/i);
  assert.match(copy('hotd2-dreamcast-vr', 'disc'), /CHD.*CDI.*GDI.*CUE.*VR4ALL.*CHD\/CDI/i);
  assert.match(copy('primedgun-2', 'disc'), /GM8E01.*0–2.*VR4ALL.*ISO/i);
  assert.match(copy('smash-remix-vr', 'rom'), /USA.*Smash Remix 2\.0\.1/i);
  assert.match(copy('mega-man-64-vr', 'rom'), /US Rev 1.*\.z64.*\.n64.*\.v64.*VR4ALL.*\.z64/i);
  assert.match(copy('quake3quest', 'baseq3'), /full game.*all.*\.pk3.*demo/i);
  assert.match(copy('ut99-portroyale', 'game'), /System.*Maps.*Textures.*Sounds.*Music.*Help.*in.headset/i);
  assert.match(copy('preyvr', 'preybase'), /full game.*\.pk4.*1\.4.*demo/i);
  assert.match(copy('confidential-mission-vr', 'chd'), /gds-0001\.chd.*GDI.*CUE.*VR4ALL.*CHD/i);
});

test('clicking Copy requirement writes the selected port’s exact arcade set to the clipboard', async () => {
  const context = appContext();
  vm.runInContext('state.selectedId = "time-crisis-vr"', context);
  await context.listeners.click({ target: { closest: (selector) => selector === '.copy-requirement'
    ? { dataset: { copyItem: 'timecris' } } : null } });
  assert.match(context.copied[0], /timecris\.zip.*MAME 0\.289/);
});

test('desktop Copy requirement works when Chromium clipboard permission is denied', async () => {
  const copied = [];
  const context = appContext({
    denyBrowserClipboard: true,
    desktopCopy: async (value) => copied.push(value),
  });
  vm.runInContext('state.selectedId = "time-crisis-vr"', context);
  await context.listeners.click({ target: { closest: (selector) => selector === '.copy-requirement'
    ? { dataset: { copyItem: 'timecris' } } : null } });
  assert.match(copied[0], /timecris\.zip.*MAME 0\.289/);
});

test('web preview tries the selection fallback after clipboard permission denial', async () => {
  let fallbackCalls = 0;
  const context = appContext({ denyBrowserClipboard: true, fallbackCopy: () => { fallbackCalls++; return true; } });
  vm.runInContext('state.selectedId = "time-crisis-vr"', context);
  await context.listeners.click({ target: { closest: (selector) => selector === '.copy-requirement'
    ? { dataset: { copyItem: 'timecris' } } : null } });
  assert.equal(fallbackCalls, 1);
});

test('nonarcade and build profiles also show copyable owned-game requirements', () => {
  const context = appContext();
  const mpvr = vm.runInContext('detailHtml(games.find(g => g.id === "max-payne-mpvr"))', context);
  assert.match(mpvr, /data-copy-item="mobileApk"/);
  assert.match(mpvr, /data-copy-item="obb"/);
  const build = vm.runInContext('detailHtml(games.find(g => g.id === "vice-city-vr"))', context);
  assert.match(build, /data-copy-build="gamePackage"/);
});
