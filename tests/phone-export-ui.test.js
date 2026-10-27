const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getCatalog } = require('../src/catalog');

function harness(gameId = 'rdr1-vr') {
  const elements = new Map(), requests = [];
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, open: false,
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, querySelector() { return null; },
      showModal() { this.open = true; }, close() { this.open = false; } });
    return elements.get(key);
  };
  for (const key of ['#phoneExportDataField', '#phoneExportDataSource', '#phoneExportDataFileButton', '#phoneExportDataFolderButton']) element(key);
  element('#phoneExportDataField').hidden = true;
  const context = vm.createContext({ document: { querySelector: element, querySelectorAll: () => [], getElementById: (id) => element(`#${id}`), addEventListener() {}, body: { dataset: {} } },
    window: { QUESTDESK_TOKEN: 'fixture', addEventListener() {} }, setTimeout() {}, clearTimeout() {}, setInterval() {}, console,
    fetch: async (url, options = {}) => {
      requests.push({ url, input: options.body && JSON.parse(options.body) });
      const result = url === '/api/pick' ? { path: 'D:\\Game exports' } : url === '/api/local-paths' ? { path: JSON.parse(options.body).path, available: true } : url === '/api/phone-export/location' ? { downloadLocation: 'E:\\Owned Games' }
        : url === '/api/phone-export/check' ? { readiness: { status: 'complete', canExport: true, apkCount: 7, missing: [], message: 'All game data is present.' } }
        : url === '/api/phone-export/devices' ? { devices: [{ serial: 'PHONE', model: 'Pixel 8', state: 'device' }] }
          : { job: { id: 'export-job', kind: 'phone-export', gameId, status: 'queued', serial: 'PHONE', log: [], downloadLocation: 'E:\\Owned Games' } };
      return { ok: true, json: async () => result };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').replace(/\nboot\(\);/, '\n'), context);
  context.game = getCatalog().find((entry) => entry.id === gameId);
  vm.runInContext("state.games = [game]; state.selectedId = game.id; state.inputs[game.id] = { gamePackage: 'E:\\\\Owned Games\\\\game.apkm' }; renderJob = () => {}; renderGrid = () => {}; updateInstallEnabled = () => {};", context);
  return { context, elements, requests };
}

test('RDR automatically checks before transfer and missing data blocks export until a source is selected', async () => {
  const { context, elements, requests } = harness();
  const original = context.fetch;
  context.fetch = async (url, options) => url === '/api/phone-export/check'
    ? { ok: true, json: async () => ({ readiness: { status: 'additional-data-required', canExport: Boolean(JSON.parse(options.body).audioSource), apkCount: 3, missing: ['assets/game/audio_android.rpf'], message: 'Missing game data in private storage.' } }) }
    : original(url, options);
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportStartButton').disabled, true);
  assert.match(elements.get('#phoneExportReadiness').textContent, /3 APK|private storage/);
  assert.match(elements.get('#phoneExportStatus').textContent, /paused|additional.*data/i);
  await vm.runInContext('exportFromPhone()', context);
  assert.equal(requests.some((request) => request.url === '/api/phone-export'), false);
  elements.get('#phoneExportDataSource').value = 'D:/matching-data';
  vm.runInContext('pollJob = async () => {};', context);
  await vm.runInContext('exportFromPhone()', context);
  assert.equal(requests.find((request) => request.url === '/api/phone-export').input.audioSource, 'D:/matching-data');
});

test('an earlier RDR readiness result cannot enable export for a changed edition', async () => {
  const { context, elements } = harness();
  await vm.runInContext('startPhoneExport()', context);
  let resolveCheck;
  context.fetch = async () => new Promise((resolve) => { resolveCheck = () => resolve({ ok: true, json: async () => ({ readiness: { status: 'complete', canExport: true, apkCount: 7, message: 'old edition' } }) }); });
  const pending = vm.runInContext('checkExportPhone()', context);
  await new Promise((resolve) => setImmediate(resolve));
  elements.get('#phoneExportEdition').value = 'netflix';
  resolveCheck(); await pending;
  assert.equal(elements.get('#phoneExportStartButton').disabled, true);
  assert.notEqual(elements.get('#phoneExportReadiness').textContent, 'old edition');
});

test('an export waiting for a check cannot submit a different phone selection', async () => {
  const { context, elements, requests } = harness();
  await vm.runInContext('startPhoneExport()', context);
  elements.get('#phoneExportEdition').value = 'netflix';
  let resolveCheck;
  const original = context.fetch;
  context.fetch = async (url, options) => url === '/api/phone-export/check'
    ? new Promise((resolve) => { resolveCheck = () => resolve({ ok: true, json: async () => ({ readiness: { canExport: true, status: 'complete' } }) }); })
    : original(url, options);
  vm.runInContext('pollJob = async () => {};', context);
  const pending = vm.runInContext('exportFromPhone()', context);
  await new Promise((resolve) => setImmediate(resolve));
  elements.get('#phoneExportDevice').value = 'OTHER-PHONE';
  vm.runInContext("phoneExportReadiness = { key: JSON.stringify(phoneExportCheckInput()), canExport: true };", context);
  resolveCheck(); await pending;
  assert.equal(requests.some((entry) => entry.url === '/api/phone-export'), false);
});

for (const gameId of ['rdr1-vr', 'gta-sa-vr']) {
  test(`${gameId} phone export asks for source and destination before any copying starts`, async () => {
    const { context, elements, requests } = harness(gameId);
    assert.match(vm.runInContext('detailHtml(game)', context), /id="exportPhoneButton"/);
    await vm.runInContext('startPhoneExport()', context);
    assert.equal(elements.get('#phoneExportDialog').open, true);
    assert.equal(elements.get('#phoneExportLocation').value, 'E:\\Owned Games');
    assert.equal(elements.get('#phoneExportDevice').value, 'PHONE');
    assert.equal(requests.some((entry) => entry.url === '/api/phone-export'), false);
    vm.runInContext('pollJob = async () => {};', context);
    await vm.runInContext('exportFromPhone()', context);
    assert.deepEqual(requests.find((entry) => entry.url === '/api/phone-export').input, { gameId, serial: 'PHONE', downloadLocation: 'E:\\Owned Games' });
  });
}

test('completed phone export selects its game input and keeps an unrelated selected game unchanged', () => {
  const { context, elements } = harness();
  vm.runInContext("state.selectedId = 'gta-sa-vr'; state.inputs['gta-sa-vr'] = { gamePackage: 'D:/keep-gta.apkm' }; phoneExportJobId = 'done';", context);
  elements.set('#buildGamePath', { value: 'D:/keep-gta.apkm' });
  context.job = { id: 'done', kind: 'phone-export', gameId: 'rdr1-vr', status: 'success', exportPath: 'E:/RDR export', log: [] };
  vm.runInContext('finishPhoneExport(job)', context);
  assert.equal(vm.runInContext("state.inputs['rdr1-vr'].gamePackage", context), 'E:/RDR export');
  assert.equal(vm.runInContext("state.savedPaths['rdr1-vr'].gamePackage", context), 'E:/RDR export');
  assert.equal(elements.get('#buildGamePath').value, 'D:/keep-gta.apkm');
  assert.equal(vm.runInContext("state.inputs['gta-sa-vr'].gamePackage", context), 'D:/keep-gta.apkm');
});

test('export folder picker starts in the chosen game location', async () => {
  const { context, elements, requests } = harness();
  await vm.runInContext('startPhoneExport()', context);
  await vm.runInContext("browse('directory', 'phoneExportLocation')", context);
  assert.equal(requests.find((entry) => entry.url === '/api/pick').input.defaultPath, 'E:\\Owned Games');
  assert.equal(elements.get('#phoneExportLocation').value, 'D:\\Game exports');
});

test('RDR shows its additional game-data requirement and passes the selected source to phone export', async () => {
  const { context, elements, requests } = harness();
  const html = vm.runInContext('detailHtml(game)', context);
  assert.match(html, /Additional RDR game data/);
  assert.match(html, /Wi-Fi/);
  elements.set('#buildAudioPath', { value: 'D:/my-rdr-game-data.apks' });
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportDataField').hidden, false);
  assert.equal(elements.get('#phoneExportDataSource').value, 'D:/my-rdr-game-data.apks');
  vm.runInContext('pollJob = async () => {};', context);
  await vm.runInContext('exportFromPhone()', context);
  assert.equal(requests.find((entry) => entry.url === '/api/phone-export').input.audioSource, 'D:/my-rdr-game-data.apks');
});

test('RDR data can be selected directly inside the export dialog and that exact source reaches the exporter', async () => {
  const { context, elements, requests } = harness();
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportDataField').hidden, false);
  elements.get('#phoneExportDataSource').value = 'D:/selected-in-export/source-data-apks';
  vm.runInContext('pollJob = async () => {};', context);
  await vm.runInContext('exportFromPhone()', context);
  assert.equal(requests.find((entry) => entry.url === '/api/phone-export').input.audioSource, 'D:/selected-in-export/source-data-apks');
  assert.equal(vm.runInContext('state.inputs[game.id].audioSource', context), 'D:/selected-in-export/source-data-apks');
});

test('RDR export dialog visibly restores its saved data source when the game field is blank', async () => {
  const { context, elements } = harness();
  vm.runInContext("api = async (url) => url === '/api/phone-export/location' ? { downloadLocation: 'E:/exports', additionalDataSource: 'D:/saved-data' } : { devices: [] };", context);
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportDataSource').value, 'D:/saved-data');
});

test('an explicit RDR data-source clear survives reopening while the save is pending', async () => {
  const { context, elements } = harness();
  vm.runInContext("api = async (url) => url === '/api/phone-export/location' ? { downloadLocation: 'E:/exports', additionalDataSource: 'D:/old-data' } : url === '/api/local-paths' ? new Promise(() => {}) : { devices: [] };", context);
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportDataSource').value, 'D:/old-data');
  vm.runInContext("setPhoneExportDataSource('');", context);
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportDataSource').value, '');
  vm.runInContext("setBuildPath(game, 'audioSource', '');", context);
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportDataSource').value, '');
});

test('RDR export data picker persists its source; GTA SA hides and ignores that input', async () => {
  const rdr = harness();
  await vm.runInContext('startPhoneExport()', rdr.context);
  await vm.runInContext("browse('directory', 'phoneExportDataSource')", rdr.context);
  assert.equal(vm.runInContext('state.inputs[game.id].audioSource', rdr.context), 'D:\\Game exports');
  const gta = harness('gta-sa-vr');
  await vm.runInContext('startPhoneExport()', gta.context);
  assert.equal(gta.elements.get('#phoneExportDataField').hidden, true);
  gta.elements.get('#phoneExportDataSource').value = 'D:/unrelated-rdr-data';
  vm.runInContext('pollJob = async () => {};', gta.context);
  await vm.runInContext('exportFromPhone()', gta.context);
  assert.equal(gta.requests.find((entry) => entry.url === '/api/phone-export').input.audioSource, undefined);
});

test('an active RDR export displays and locks the data source belonging to its own job', async () => {
  const { context, elements } = harness();
  vm.runInContext("state.jobs = [{ id: 'active', kind: 'phone-export', gameId: game.id, serial: 'PHONE', status: 'running', downloadLocation: 'E:/exports', additionalDataSource: 'D:/active-data', log: [] }];", context);
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportDataSource').value, 'D:/active-data');
  assert.equal(elements.get('#phoneExportDataSource').disabled, true);
  assert.equal(elements.get('#phoneExportDataFileButton').disabled, true);
  assert.equal(elements.get('#phoneExportDataFolderButton').disabled, true);
});

test('complete RDR exports do not require an extra input while GTA SA still requires its audio pack', () => {
  for (const gameId of ['rdr1-vr', 'gta-sa-vr']) {
    const { context } = harness(gameId);
    vm.runInContext("state.selectedSerial = 'QUEST'; state.inputs[game.id] = { gamePackage: 'D:/complete-export' }; state.pathAvailability[game.id] = { gamePackage: true };", context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').match(/function updateInstallEnabled\(\) \{[\s\S]*?\n\}/)[0], context);
    vm.runInContext('updateInstallEnabled()', context);
    assert.equal(vm.runInContext("document.querySelector('#personalBuildButton').disabled", context), gameId === 'gta-sa-vr');
  }
});

test('reopening an active export restores its own phone and destination', async () => {
  const { context, elements } = harness();
  vm.runInContext("state.jobs = [{ id: 'active-rdr', kind: 'phone-export', gameId: game.id, serial: 'RDR-PHONE', status: 'running', downloadLocation: 'D:/RDR exports', log: [] }];", context);
  await vm.runInContext('startPhoneExport()', context);
  elements.get('#phoneExportDevice').value = 'GTA-PHONE';
  elements.get('#phoneExportLocation').value = 'E:/GTA exports';
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportDevice').value, 'RDR-PHONE');
  assert.equal(elements.get('#phoneExportLocation').value, 'D:/RDR exports');
  assert.equal(elements.get('#phoneExportLocation').disabled, true);
});

test('RDR lets the user select Netflix while GTA SA keeps its existing single-edition flow', async () => {
  const { context, elements, requests } = harness('rdr1-vr');
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportEditionField').hidden, false);
  assert.equal(elements.get('#phoneExportEdition').value, 'auto');
  elements.get('#phoneExportEdition').value = 'netflix';
  vm.runInContext('pollJob = async () => {};', context);
  await vm.runInContext('exportFromPhone()', context);
  assert.equal(requests.find((entry) => entry.url === '/api/phone-export').input.edition, 'netflix');
  const gta = harness('gta-sa-vr');
  await vm.runInContext('startPhoneExport()', gta.context);
  assert.equal(gta.elements.get('#phoneExportEditionField').hidden, true);
});

test('reopening an active Netflix export retains the edition and locks it during transfer', async () => {
  const { context, elements } = harness();
  vm.runInContext("state.jobs = [{ id: 'active-netflix', kind: 'phone-export', gameId: game.id, edition: 'netflix', serial: 'PHONE', status: 'running', downloadLocation: 'D:/RDR exports', log: [] }];", context);
  await vm.runInContext('startPhoneExport()', context);
  assert.equal(elements.get('#phoneExportEdition').value, 'netflix');
  assert.equal(elements.get('#phoneExportEdition').disabled, true);
});
