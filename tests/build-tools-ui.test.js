const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getCatalog } = require('../src/catalog');

function harness(gameId = 'vice-city-vr') {
  const elements = new Map();
  const requests = [];
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, {
      value: '', textContent: '', hidden: false, disabled: false, open: false,
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, addEventListener() {},
      showModal() { this.open = true; }, close() { this.open = false; },
    });
    return elements.get(key);
  };
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [], getElementById: (id) => element(`#${id}`), addEventListener() {}, body: { dataset: {} } },
    window: { QUESTDESK_TOKEN: 'fixture', addEventListener() {} },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, console,
    fetch: async (url, options = {}) => {
      requests.push({ url, input: options.body && JSON.parse(options.body) });
      const result = url === '/api/build-tools/location' ? { downloadLocation: 'D:\\Games\\Vice City', configured: false }
        : url === '/api/pick' ? { path: 'E:\\VR tools' }
          : { job: { id: 'setup-job', gameId, kind: 'build-tools', status: 'queued', log: [], downloadLocation: 'E:\\VR tools' } };
      return { ok: true, json: async () => result };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').replace(/\nboot\(\);/, '\n'), context);
  context.game = getCatalog().find((game) => game.id === gameId);
  vm.runInContext("state.games = [game]; state.selectedId = game.id; state.inputs[game.id] = { gamePackage: 'D:\\\\Games\\\\Vice City' }; renderJob = () => {}; pollJob = async () => {};", context);
  return { context, elements, requests };
}

test('opening build tools asks for a location before starting any downloads', async () => {
  const { context, elements, requests } = harness();
  await vm.runInContext('startBuildTools()', context);
  assert.equal(elements.get('#sdkSetupDialog').open, true);
  assert.equal(elements.get('#sdkDownloadLocation').value, 'D:\\Games\\Vice City');
  assert.equal(elements.get('#sdkStartButton').hidden, false);
  assert.equal(requests.some((request) => request.url === '/api/build-tools'), false);
  await vm.runInContext("$('#sdkSetupDialog').close()", context);
  assert.equal(requests.some((request) => request.url === '/api/build-tools'), false);
});

test('browsing starts in the displayed folder and the chosen location is sent only on Install', async () => {
  const { context, elements, requests } = harness();
  await vm.runInContext('startBuildTools()', context);
  await vm.runInContext("browse('directory', 'sdkDownloadLocation')", context);
  assert.deepEqual(requests.find((request) => request.url === '/api/pick').input, { kind: 'directory', defaultPath: 'D:\\Games\\Vice City' });
  assert.equal(elements.get('#sdkDownloadLocation').value, 'E:\\VR tools');
  assert.equal(requests.some((request) => request.url === '/api/build-tools'), false);
  await vm.runInContext('installBuildTools()', context);
  assert.deepEqual(requests.find((request) => request.url === '/api/build-tools').input, { gameId: 'vice-city-vr', downloadLocation: 'E:\\VR tools' });
  assert.equal(elements.get('#sdkDownloadLocation').disabled, true);
});

for (const [gameId, title] of [['rdr1-vr', 'Red Dead Redemption'], ['gta-sa-vr', 'GTA: San Andreas']]) {
test(`${title} has the same location and license setup as Vice City`, async () => {
  const { context, elements, requests } = harness(gameId);
  assert.match(vm.runInContext('detailHtml(game)', context), /id="setupBuildToolsButton"/);
  await vm.runInContext('startBuildTools()', context);
  assert.equal(elements.get('#sdkSetupDialog').open, true);
  assert.ok(elements.get('#sdkSetupTitle').textContent.includes(title));
  assert.equal(requests.find((entry) => entry.url === '/api/build-tools/location').input.gameId, gameId);
  assert.equal(requests.some((entry) => entry.url === '/api/build-tools'), false);
  elements.get('#sdkDownloadLocation').value = 'D:\\RDR tools';
  await vm.runInContext('installBuildTools()', context);
  assert.deepEqual(requests.find((entry) => entry.url === '/api/build-tools').input, { gameId, downloadLocation: 'D:\\RDR tools' });
});
}
