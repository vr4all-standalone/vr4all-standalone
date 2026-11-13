const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getCatalog } = require('../src/catalog');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').replace(/\nboot\(\);/, '\n');
const video = { youtubeId: 'F7Ig3bwq7K8' };

function appContext() {
  const elements = new Map();
  const handlers = new Map();
  const listeners = {};
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', hidden: true, innerHTML: '', classList: { toggle() {} },
      addEventListener(name, callback) { handlers.set(selector + name, callback); },
    });
    return elements.get(selector);
  };
  const context = vm.createContext({
    document: {
      body: { dataset: {} },
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener(name, callback) { listeners[name] = callback; },
    },
    window: { addEventListener() {} },
    setTimeout() {}, clearTimeout() {}, setInterval() {},
    console,
  });
  vm.runInContext(app, context);
  context.game = {
    id: 'test-game', title: 'Test Game', description: 'Test port', data: [],
    art: '/art/test.png', externalInstaller: true, video,
  };
  vm.runInContext('state.games = [game]; state.selectedId = game.id;', context);
  return { context, element, handlers, listeners };
}

test('detail poster creates the selected video player only after an explicit click', async () => {
  const { context, listeners } = appContext();
  const html = vm.runInContext('detailHtml(game)', context);
  assert.match(html, /<button[^>]+data-play-card-video/);
  assert.doesNotMatch(html, /<iframe/);
  const art = { innerHTML: html };
  const play = { closest: (selector) => selector === '.detail-art' ? art : null };
  await listeners.click({ target: { closest: (selector) => selector === '[data-play-card-video]' ? play : null } });
  assert.match(art.innerHTML, /<iframe[^>]+src="https:\/\/www\.youtube-nocookie\.com\/embed\/F7Ig3bwq7K8\?autoplay=1&amp;playsinline=1"/);
  assert.match(art.innerHTML, /https:\/\/www\.youtube\.com\/watch\?v=F7Ig3bwq7K8/);
});

test('the detail panel removes the player when closed', () => {
  const { element, handlers } = appContext();
  element('#detailBody').innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/F7Ig3bwq7K8"></iframe>';
  handlers.get('#closeDetailclick')();
  assert.equal(element('#detailBody').innerHTML, '');
});

test('the library advertises an available preview without creating a video for every card', () => {
  const { context, element } = appContext();
  vm.runInContext('renderGrid()', context);
  assert.match(element('#gameGrid').innerHTML, /<button[^>]+data-preview-game="test-game"/);
  assert.doesNotMatch(element('#gameGrid').innerHTML, /<video|<iframe/);
});

test('a profile without footage keeps its standard artwork', () => {
  const { context } = appContext();
  const html = vm.runInContext('detailHtml({ ...game, video: undefined })', context);
  assert.match(html, /<img src="\/art\/test\.png"/);
  assert.doesNotMatch(html, /data-play-card-video|<iframe/);
});

test('a creator-hosted clip opens in the native player after a click', async () => {
  const { context, listeners } = appContext();
  context.game.video = { clipUrl: 'https://v.redd.it/44cqiho1esvh1/CMAF_1080.mp4?source=fallback' };
  assert.match(vm.runInContext('detailHtml(game)', context), /data-play-card-video/);
  const art = { innerHTML: '' };
  const play = { closest: () => art };
  await listeners.click({ target: { closest: (selector) => selector === '[data-play-card-video]' ? play : null } });
  assert.match(art.innerHTML, /<video[^>]+src="https:\/\/v\.redd\.it\/44cqiho1esvh1\/CMAF_1080\.mp4\?source=fallback"/);
});

test('catalog video entries have a valid source and cards without verified footage show no video control', () => {
  const { context } = appContext();
  context.catalog = getCatalog();
  const invalid = vm.runInContext('catalog.filter(g => g.video && !youtubeVideoId(g) && !creatorClipUrl(g)).map(g => g.id)', context);
  assert.equal(invalid.length, 0, invalid.join(', '));
  for (const id of ['bugdom-vr', 'bugdom2-vr']) {
    context.game = context.catalog.find((game) => game.id === id);
    assert.equal(context.game.video, undefined, id);
    assert.doesNotMatch(vm.runInContext('detailHtml(game)', context), /data-play-card-video/, id);
  }
});

test('a separate guided MR card keeps its video preview', () => {
  const { context } = appContext();
  context.catalog = getCatalog();
  const html = vm.runInContext('state.games = catalog; detailHtml(catalog.find(g => g.id === "mario64mr"))', context);
  assert.doesNotMatch(html, /data-port-id="sm64-vr"/);
  assert.match(html, /data-play-card-video/);
});
