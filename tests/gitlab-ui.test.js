const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getCatalog } = require('../src/catalog');

test('Max Payne card offers both ports and identifies GitLab as the mpvr APK source', () => {
  const context = vm.createContext({
    document: { querySelector: () => ({ hidden: true, value: '', addEventListener() {} }),
      querySelectorAll: () => [], getElementById: () => ({ hidden: true, value: '', addEventListener() {} }),
      addEventListener() {}, body: { dataset: {} } },
    window: { QUESTDESK_TOKEN: 'test', addEventListener() {} },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, console,
  });
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').replace(/\nboot\(\);/, '\n');
  vm.runInContext(script, context);
  const games = getCatalog().filter((game) => ['max-payne-nightmare-vr', 'max-payne-mpvr'].includes(game.id));
  context.games = games;
  vm.runInContext('state.games = games; state.selectedId = "max-payne-mpvr"', context);
  const html = vm.runInContext('detailHtml(games.find((game) => game.id === "max-payne-mpvr"))', context);
  assert.match(html, /Nightmare Edition/);
  assert.match(html, /Gandork \(mpvr\)/);
  assert.match(html, /Latest on GitLab/);
});
