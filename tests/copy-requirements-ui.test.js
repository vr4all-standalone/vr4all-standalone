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
