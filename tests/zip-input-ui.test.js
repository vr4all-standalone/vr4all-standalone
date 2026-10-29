const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getCatalog } = require('../src/catalog');

function appHarness() {
  const requests = [];
  const elements = new Map();
  const listeners = new Map();
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, checked: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, handler) { listeners.set(`${key}:${type}`, handler); },
      setAttribute() {}, scrollIntoView() {}, showModal() {}, close() {}, querySelector() { return null; },
    });
    return elements.get(key);
  }
  const document = {
    body: { dataset: {} },
    querySelector: (selector) => selector === '#personalBuildButton' ? null : element(selector),
    querySelectorAll: () => [],
    getElementById: (id) => element(`#${id}`),
    addEventListener(type, handler) { listeners.set(`document:${type}`, handler); },
  };
  async function fetch(url, options = {}) {
    requests.push({ url, options });
    let body = {};
    if (url === '/api/pick') body = { path: 'C:\\Owned\\timecris' };
    else if (url === '/api/local-paths') body = { path: `C:\\Saved\\${JSON.parse(options.body).path.split(/[\\/]/).at(-1)}`, available: true };
    else if (url === '/api/validate-file') body = { path: 'C:\\Owned\\timecris', verification: { message: 'Packed folder contents into ZIP' } };
    else if (url === '/api/bulk-sessions') body = { id: 'session-fixture' };
    else if (url.startsWith('/api/bulk-upload?')) body = { path: new URL(url, 'http://localhost').searchParams.get('path') };
    else if (url === '/api/package-uploaded') body = { path: 'C:\\Temp\\timecris.zip', verification: { message: 'Packed 2 dropped files into ZIP' } };
    return { ok: true, json: async () => body };
  }
  const context = vm.createContext({ document, window: { QUESTDESK_TOKEN: 'test-token', addEventListener() {} }, fetch, setTimeout: () => 1, clearTimeout() {}, setInterval() {}, console });
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').replace(/\nboot\(\);/, '\n');
  vm.runInContext(source, context);
  const game = getCatalog().find((item) => item.id === 'time-crisis-vr');
  context.game = game;
  vm.runInContext('state.games = [game]; state.selectedId = game.id', context);
  return { context, game, elements, listeners, requests };
}

for (const id of ['confidential-mission-vr','hotd2-vr','lupin-the-third-vr','ninja-assault-vr','death-crimson-ox-vr','mok-vr','survivor2-code-veronica-vr','carnevil-vr','teraburst-vr','vcop-vr','vcop2-vr']) {
  test(`${id}: older APK offers update and matching installed bytes show current`, () => {
    const { context } = appHarness();
    context.port = getCatalog().find(g => g.id === id);
    assert.ok(context.port);
    vm.runInContext("state.selectedSerial='QUEST'; state.deviceLibrary.QUEST={ [port.id]: {packageId:port.fileAccessPackage, dataReady:true,versionComparable:true,versionName:'0.0.1'} }; state.releases[port.id]={ tag:'v9.0.0', verifiedSerial:'QUEST', installedApkMatchesRelease:false }",context);
    assert.equal(vm.runInContext('versionStatus(port)',context),'status-update');
    vm.runInContext('state.releases[port.id].installedApkMatchesRelease=true',context);
    assert.equal(vm.runInContext('versionStatus(port)',context),'status-current');
    vm.runInContext('state.releases[port.id].stale=true',context);
    assert.equal(vm.runInContext('versionStatus(port)',context),'status-installed');
  });
}

for (const [id, version] of Object.entries({'confidential-mission-vr':'1.2.7','hotd2-vr':'1.0.6','lupin-the-third-vr':'1.0.6','ninja-assault-vr':'1.0.6','death-crimson-ox-vr':'1.0.5','mok-vr':'1.0.6','survivor2-code-veronica-vr':'1.0.6'})) {
  test(`${id}: same-version rebuilt APK is offered when installed bytes differ`, () => {
    const { context } = appHarness();context.port=getCatalog().find(g=>g.id===id);context.version=version;
    vm.runInContext("state.selectedSerial='QUEST'; state.deviceLibrary.QUEST={ [port.id]: {dataReady:true,versionComparable:true,versionName:version+'-golderbuild'} }; state.releases[port.id]={ tag:'v'+version, verifiedSerial:'QUEST', installedApkMatchesRelease:false }",context);
    assert.equal(vm.runInContext('versionStatus(port)',context),'status-update');
  });
}

test('ZIP field exposes Browse folder and preserves the chosen local folder path', async () => {
  const { context, elements, requests } = appHarness();
  const html = vm.runInContext('detailHtml(game)', context);
  assert.match(html, /data-picker="directory" data-target="data-timecris">Browse folder/);
  await vm.runInContext("browse('directory', 'data-timecris')", context);
  assert.equal(elements.get('#data-timecris').value, 'C:\\Saved\\timecris');
  assert.equal(JSON.parse(requests.find((entry) => entry.url === '/api/validate-file').options.body).path, 'C:\\Owned\\timecris');
  assert.equal(vm.runInContext("state.staged[game.id].timecris", context), 'C:\\Saved\\timecris');
});

test('a saved shared BIOS choice immediately fills the matching game card', async () => {
  const { context, game } = appHarness();
  context.dirt = getCatalog().find((entry) => entry.id === 'dirt-dash-vr');
  vm.runInContext('state.games = [game, dirt]', context);
  context.fetch = async (url) => ({ ok: true, json: async () => url === '/api/local-paths'
    ? { path: 'C:/Owned/namcoc71.zip', available: true, linked: [
      { gameId: game.id, key: 'namcoc71', path: 'C:/Owned/namcoc71.zip', available: true },
      { gameId: context.dirt.id, key: 'namcoc71', path: 'C:/Owned/namcoc71.zip', available: true },
    ] } : {} });
  await vm.runInContext("saveLocalPath(game, 'namcoc71', 'C:/Owned/namcoc71.zip')", context);
  assert.equal(vm.runInContext('state.savedPaths[dirt.id].namcoc71', context), 'C:/Owned/namcoc71.zip');
  assert.equal(vm.runInContext('state.inputs[dirt.id].namcoc71', context), 'C:/Owned/namcoc71.zip');
  assert.equal(vm.runInContext('state.staged[dirt.id].namcoc71', context), 'C:/Owned/namcoc71.zip');
});

test('game folder fields accept archives and Bulk install has no recent failures panel', () => {
  const { context } = appHarness();
  context.amnesia = getCatalog().find((item) => item.id === 'sclerosis-vr');
  const detail = vm.runInContext('detailHtml(amnesia)', context);
  assert.match(detail, /FOLDER \/ ZIP \/ 7Z \/ RAR/);
  assert.match(detail, /data-picker="file" data-target="data-gamePath">Browse archive/);
  assert.match(detail, /Drop your Installed Amnesia: The Dark Descent folder here · folder, ZIP, 7z, or RAR/);
  const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(shell, /bulkRecentFailures|Recent failures/);
});

test('Rave Racer BIOS field accepts BIN, ZIP, 7z, and RAR drops', () => {
  const { context } = appHarness();
  context.rave = getCatalog().find((item) => item.id === 'rave-racer-vr');
  const html = vm.runInContext('detailHtml(rave)', context);
  assert.match(html, /\.bin \/ \.zip \/ \.7z \/ \.rar/);
  assert.match(html, /Drop your Namco C71 BIOS here · plain file, ZIP, 7z, or RAR/);
  assert.equal(vm.runInContext("dropTargetFor(rave, { name: 'Namco C71 BIOS.7z' }, null)?.id", context), 'bios');
});

test('plain ROM inputs also accept wrapped ZIP, 7z, and RAR files', () => {
  const { context } = appHarness();
  context.mario = getCatalog().find((item) => item.id === 'sm64-vr');
  const html = vm.runInContext('detailHtml(mario)', context);
  assert.match(html, /\.z64 \/ \.zip \/ \.7z \/ \.rar/);
  assert.match(html, /plain file, ZIP, 7z, or RAR/);
  assert.equal(vm.runInContext("dropTargetFor(mario, { name: 'Super Mario 64.7z' }, null)?.id", context), 'rom');
});

test('Metal Gear Solid and Wipeout cards provide their required game-file drop targets', () => {
  const { context } = appHarness();
  context.mgs = getCatalog().find((item) => item.id === 'mgs-vr');
  context.wipeout = getCatalog().find((item) => item.id === 'wipeout-vr');
  const mgsHtml = vm.runInContext('detailHtml(mgs)', context);
  const wipeoutHtml = vm.runInContext('detailHtml(wipeout)', context);
  for (const field of ['disc1Bin', 'disc1Cue', 'disc2Bin', 'disc2Cue']) {
    assert.match(mgsHtml, new RegExp(`id="data-${field}"`));
  }
  assert.match(wipeoutHtml, /id="data-gameData"/);
  assert.match(wipeoutHtml, /Drop your Owned Wipeout disc or game-data folder here · BIN, CUE, CHD, folder, ZIP, 7z, or RAR/);
  assert.equal(vm.runInContext("dropTargetFor(wipeout, { name: 'WipEout (USA).chd' }, null)?.id", context), 'gameData');
});

test('sidebar uses direct appearance and feedback actions while keeping connection setup reachable', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="changeThemeButton"[^>]*>[^<]*<span[^>]*>[^<]*<\/span>\s*Change theme/);
  assert.match(html, /id="changeThemeButton"[\s\S]*?id="pcBuildFolderButton"[^>]*>[^<]*<span[^>]*>[^<]*<\/span>\s*PC build folder/);
  assert.match(html, /id="connectionHelpButton"/);
  assert.match(html, /issues\/new\?template=port_suggestion\.yml/);
  assert.match(html, /issues\/new\?template=bug_report\.yml/);
  assert.match(html, /docs\/user-guide\.md/);
  assert.doesNotMatch(html, /id="addGameButton"|id="addGameDialog"|id="settingsButton"/);
  const { context, listeners } = appHarness();
  vm.runInContext("let openedSection = ''; openSettings = async (section) => { openedSection = section; }", context);
  await listeners.get('#changeThemeButton:click')();
  assert.equal(vm.runInContext('openedSection', context), 'appearance');
  await listeners.get('#pcBuildFolderButton:click')();
  assert.equal(vm.runInContext('openedSection', context), 'workspace');
  await listeners.get('#connectionHelpButton:click')();
  assert.equal(vm.runInContext('openedSection', context), 'connection');
});

test('failed install offers Retry and reuses the existing installer only for its selected Quest', async () => {
  const { context, game, elements } = appHarness();
  vm.runInContext("state.selectedSerial = 'QUEST'; state.jobs = [{ id: 'failed', gameId: game.id, title: game.title, serial: 'QUEST', status: 'error', error: 'ADB disconnected', log: ['ADB disconnected'] }]; state.activeJobId = 'failed'; renderJob(); let installCalls = 0; install = async () => { installCalls++; }", context);
  assert.match(elements.get('#jobContainer').innerHTML, /id="retryJobButton"/);
  await vm.runInContext('retryFailedJob()', context);
  assert.equal(vm.runInContext('installCalls', context), 1);
  vm.runInContext("state.selectedSerial = 'OTHER'", context);
  await vm.runInContext('retryFailedJob()', context);
  assert.equal(vm.runInContext('installCalls', context), 1);
});

test('another game can be queued while one is installing on the selected Quest', () => {
  const { context, game, elements } = appHarness();
  vm.runInContext("state.selectedSerial = 'QUEST'; state.jobs = [{ id: 'running', gameId: 'other-game', serial: 'QUEST', status: 'running', log: [] }]; updateInstallEnabled()", context);
  assert.equal(elements.get('#installButton').disabled, false);
  vm.runInContext("state.jobs[0].gameId = game.id; updateInstallEnabled()", context);
  assert.equal(elements.get('#installButton').disabled, true);
});

test('an unchanged headset poll keeps existing game cards in the DOM', async () => {
  const { context, elements } = appHarness();
  vm.runInContext('renderGrid()', context);
  const grid = elements.get('#gameGrid');
  let html = grid.innerHTML;
  let replacements = 0;
  Object.defineProperty(grid, 'innerHTML', {
    get() { return html; },
    set(value) { html = value; replacements++; },
  });
  await vm.runInContext('refreshDevices({ scanLibrary: false })', context);
  await vm.runInContext('refreshDevices({ scanLibrary: false })', context);
  assert.equal(replacements, 0, 'polling should preserve hovered card elements when the headset is unchanged');
});

test('one card exposes both developer ports and follows the installed choice', () => {
  const { context } = appHarness();
  const games = getCatalog();
  for (const [baseId, alternateId] of [
    ['time-crisis-vr', 'dr89-time-crisis'],
    ['time-crisis-2-vr', 'dr89-time-crisis-2'],
    ['pokemon-gen1-vr', 'pokemon-gen1-recomp'],
    ['halo-ce', 'mjolnir-vr'],
  ]) {
    context.base = games.find((item) => item.id === baseId);
    context.alternate = games.find((item) => item.id === alternateId);
    vm.runInContext(`state.games = [base, alternate]; state.selectedSerial = 'QUEST'; state.deviceLibrary = { QUEST: { [alternate.id]: { dataReady: true, versionName: '1.0' } } }; state.portChoices = {}`, context);
    assert.equal(vm.runInContext('libraryGames().length', context), 1);
    assert.equal(vm.runInContext('cardProfile(base).id', context), alternateId);
    const html = vm.runInContext('portChoiceHtml(alternate)', context);
    assert.match(html, new RegExp(`data-port-id="${baseId}"`));
    assert.match(html, new RegExp(`data-port-id="${alternateId}"`));
  }
});

test('Virtua Cop has one card with the VR4ALL port selected by default', () => {
  const { context } = appHarness();
  const games = getCatalog();
  context.virtua = games.find((entry) => entry.id === 'vcop-vr');
  context.port0r = games.find((entry) => entry.id === 'cop-vr');
  vm.runInContext("state.games = [virtua, port0r]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { [port0r.id]: { dataReady: true } }; state.portChoices = {}", context);
  assert.equal(vm.runInContext('libraryGames().length', context), 1);
  assert.equal(vm.runInContext('cardProfile(virtua).id', context), 'vcop-vr');
  const html = vm.runInContext('portChoiceHtml(virtua)', context);
  assert.match(html, /data-port-id="vcop-vr"/);
  assert.match(html, /data-port-id="cop-vr"/);
  assert.match(html, /VR4ALL standalone/);
});

test('F-Zero X exposes only the creator’s Quest installer', () => {
  const { context } = appHarness();
  const games = getCatalog();
  context.virtua = games.find((item) => item.id === 'fzero-x-virtuavr');
  vm.runInContext("state.games = [virtua]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {}; state.portChoices = {'fzero-x-vr': 'fzero-x-vr'}", context);
  assert.equal(vm.runInContext('libraryGames().length', context), 1);
  assert.equal(vm.runInContext('cardProfile(virtua).id', context), 'fzero-x-virtuavr');
  assert.equal(vm.runInContext('portChoiceHtml(virtua)', context), '');
});

test('F-Zero X shows ready after its APK and prepared files are found on the Quest', () => {
  const { context } = appHarness();
  context.fzero = getCatalog().find((item) => item.id === 'fzero-x-virtuavr');
  vm.runInContext("state.games = [fzero]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { 'fzero-x-virtuavr': { packageId: 'dev.gdiffuser.quest', versionName: '1.0.0', dataReady: true, versionComparable: true } }; state.inputs[fzero.id] = { gamePackage: 'C:/Games/F-Zero X.z64', audioSource: 'C:/Downloads/Quest-R10.zip' }", context);
  assert.equal(vm.runInContext('versionStatus(fzero)', context), 'status-current');
  assert.equal(vm.runInContext('cardStatus(fzero)', context), 'status-current');
  assert.match(vm.runInContext('releaseLabel(fzero)', context), />READY</);
  assert.match(vm.runInContext('statusExplanation(fzero)', context), /prepared.*files.*found/i);
});

test('installed APK and required game files show ready with an unverified version', () => {
  const { context, game } = appHarness();
  vm.runInContext("state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { [game.id]: { packageId: 'com.example.timecrisis', versionName: '1.0', dataReady: true, versionComparable: false } }", context);
  assert.equal(vm.runInContext('versionStatus(game)', context), 'status-installed');
  assert.equal(vm.runInContext('cardStatus(game)', context), 'status-ready-unverified');
  assert.match(vm.runInContext('releaseLabel(game)', context), /READY · VERSION UNVERIFIED/);
  assert.match(vm.runInContext('statusExplanation(game)', context), /release has not been checked yet/);
});

test('a private ROM that cannot be checked does not claim ready', () => {
  const { context, game } = appHarness();
  context.privateGame = { ...game, id: 'private-rom', reuseInstalledData: true };
  vm.runInContext("state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { 'private-rom': { packageId: 'com.example.private', dataReady: false } }", context);
  assert.equal(vm.runInContext('cardStatus(privateGame)', context), 'status-installed');
  assert.doesNotMatch(vm.runInContext('releaseLabel(privateGame)', context), /READY/);
  assert.match(vm.runInContext('releaseLabel(privateGame)', context), /ROM UNVERIFIED/);
});

test('installed Pokémon ports with detected game data use the ready version-unverified style', () => {
  const { context, elements } = appHarness();
  const ports = getCatalog().filter((game) => ['pokemon-gen1-vr', 'pokemon-gen1-recomp'].includes(game.id));
  context.ports = ports;
  vm.runInContext("state.games = ports; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { 'pokemon-gen1-vr': { packageId: 'com.heurazy.gen1pokemonvr.quest', dataReady: true, versionComparable: true }, 'pokemon-gen1-recomp': { packageId: 'com.theboisclub.pokemonred', dataReady: true, versionComparable: true } }; renderGrid()", context);
  const card = elements.get('#gameGrid').innerHTML;
  assert.match(card, /class="game-card status-ready-unverified"/);
  assert.match(card, /READY · VERSION UNVERIFIED/);
  assert.doesNotMatch(card, /<span class="status-pill installed">VERSION UNVERIFIED<\/span>/);
});

test('every installed catalog port with detected data has a ready label when its version is unverified', () => {
  const { context } = appHarness();
  const games = getCatalog();
  context.catalogGames = games;
  vm.runInContext("state.games = catalogGames; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = Object.fromEntries(catalogGames.map((game) => [game.id, { packageId: 'test.' + game.id, dataReady: true, versionComparable: false }])); state.releases = {}; state.staged = {}; state.inputs = {}; state.bulkApks = {}", context);
  for (const game of games) {
    context.checkedGame = game;
    const label = vm.runInContext('releaseLabel(checkedGame)', context);
    assert.match(label, /READY/, game.id);
    assert.doesNotMatch(label, /<span class="status-pill installed">VERSION UNVERIFIED<\/span>/, game.id);
  }
});

test('installed personal builds show ready with an unverified build when headset data checks pass', () => {
  const { context, game } = appHarness();
  for (const id of ['crazy-taxi-vr', 'vice-city-vr']) {
    context.personalGame = getCatalog().find((item) => item.id === id);
    vm.runInContext("state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { [personalGame.id]: { packageId: 'com.example.personal', dataReady: true, versionComparable: false } }", context);
    assert.equal(vm.runInContext('cardStatus(personalGame)', context), 'status-ready-unverified');
    assert.match(vm.runInContext('releaseLabel(personalGame)', context), /READY · BUILD UNVERIFIED/);
    assert.match(vm.runInContext('statusExplanation(personalGame)', context), /Ready to play/);
  }
  context.personalGame = { ...game, id: 'personal-build', personalBuild: {} };
  vm.runInContext("state.deviceLibrary.QUEST = { 'personal-build': { packageId: 'com.example.personal', dataReady: false, versionComparable: false } }", context);
  assert.equal(vm.runInContext('cardStatus(personalGame)', context), 'status-incomplete');
  assert.doesNotMatch(vm.runInContext('releaseLabel(personalGame)', context), /READY/);
});

test('BioShock shows a current creator install as ready and a newer installer as update ready', () => {
  const { context } = appHarness();
  context.bio = getCatalog().find((item) => item.id === 'bioshock-vr');
  vm.runInContext("state.games = [bio]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { 'bioshock-vr': { packageId: 'com.winlator.cmod', versionName: '1', dataReady: true, versionComparable: false } }; state.installed.QUEST = { 'bioshock-vr': { packageId: 'com.winlator.cmod', tag: 'initial-release' } }; state.releases['bioshock-vr'] = { tag: 'initial-release', stale: false }", context);
  assert.equal(vm.runInContext('cardStatus(bio)', context), 'status-current');
  assert.match(vm.runInContext('releaseLabel(bio)', context), /READY/);
  vm.runInContext("state.releases['bioshock-vr'] = { tag: 'newer-release', stale: false }", context);
  assert.equal(vm.runInContext('cardStatus(bio)', context), 'status-update');
  assert.match(vm.runInContext('releaseLabel(bio)', context), /UPDATE READY/);
  assert.equal(vm.runInContext('installType(bio)', context), 'special');
});

test('Sclerosis is ready when its APK and owned game folders are on the Quest, even if the creator APK remains saved on PC', () => {
  const { context } = appHarness();
  context.sclerosis = getCatalog().find((item) => item.id === 'sclerosis-vr');
  vm.runInContext("state.games = [sclerosis]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { 'sclerosis-vr': { packageId: 'com.CreaTeam.Sclerosis', versionName: '1.10.7', dataReady: true, versionComparable: true } }; state.inputs[sclerosis.id] = { apkPath: 'C:/Downloads/Sclerosis.apk', gamePath: 'C:/Games/Amnesia' }; state.staged[sclerosis.id] = { gamePath: 'C:/Games/Amnesia' }; state.bulkApks[sclerosis.id] = 'C:/Downloads/Sclerosis.apk'; state.bulkMatches = [{ gameId: sclerosis.id, apkPath: 'C:/Downloads/Sclerosis.apk', files: { gamePath: 'C:/Games/Amnesia' } }]", context);
  assert.equal(vm.runInContext('cardStatus(sclerosis)', context), 'status-current');
  assert.match(vm.runInContext('releaseLabel(sclerosis)', context), />READY</);
  assert.match(vm.runInContext('statusExplanation(sclerosis)', context), /APK and.*Amnesia.*found/i);
});

test('Sclerosis stays ready after restart when a remembered PC folder is staged but already exists on the Quest', () => {
  const { context } = appHarness();
  context.sclerosis = getCatalog().find((item) => item.id === 'sclerosis-vr');
  vm.runInContext("state.games = [sclerosis]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { 'sclerosis-vr': { packageId: 'com.CreaTeam.Sclerosis', versionName: '1.10.7', dataReady: true, versionComparable: true } }; state.savedPaths[sclerosis.id] = { apkPath: 'C:/Downloads/Sclerosis_v1.10.7.apk', gamePath: 'C:/Downloads/Amnesia The Dark Descent' }; state.pathAvailability[sclerosis.id] = { apkPath: true, gamePath: true }; state.inputs[sclerosis.id] = { ...state.savedPaths[sclerosis.id] }; state.staged[sclerosis.id] = { gamePath: state.savedPaths[sclerosis.id].gamePath }; state.bulkApks[sclerosis.id] = state.savedPaths[sclerosis.id].apkPath; state.bulkMatches = []", context);
  assert.equal(vm.runInContext('cardStatus(sclerosis)', context), 'status-current');
  assert.match(vm.runInContext('releaseLabel(sclerosis)', context), />READY</);
});

test('Sclerosis needs both its game folder and creator APK before offering installation', () => {
  const { context } = appHarness();
  context.sclerosis = getCatalog().find((item) => item.id === 'sclerosis-vr');
  vm.runInContext("state.games = [sclerosis]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {}; state.inputs[sclerosis.id] = { gamePath: 'C:/Downloads/Amnesia The Dark Descent' }; state.staged[sclerosis.id] = { gamePath: 'C:/Downloads/Amnesia The Dark Descent' }", context);
  assert.notEqual(vm.runInContext('cardStatus(sclerosis)', context), 'status-staged');
  assert.doesNotMatch(vm.runInContext('releaseLabel(sclerosis)', context), /INSTALL AVAILABLE/);
  vm.runInContext("state.savedPaths[sclerosis.id] = { apkPath: 'C:/Downloads/Sclerosis.apk' }; state.pathAvailability[sclerosis.id] = { apkPath: true }", context);
  assert.equal(vm.runInContext('cardStatus(sclerosis)', context), 'status-staged');
  assert.match(vm.runInContext('releaseLabel(sclerosis)', context), /INSTALL AVAILABLE/);
});

test('a shared board ZIP or port APK alone cannot mark a multi-file arcade game installable', () => {
  const { context, game } = appHarness();
  vm.runInContext("state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {}; state.inputs[game.id] = { namcoc71: 'C:/Games/namcoc71.zip' }; state.staged[game.id] = { namcoc71: 'C:/Games/namcoc71.zip' }; state.bulkMatches = [{ gameId: game.id, files: { namcoc71: 'C:/Games/namcoc71.zip' } }]", context);
  assert.notEqual(vm.runInContext('cardStatus(game)', context), 'status-staged');
  assert.doesNotMatch(vm.runInContext('releaseLabel(game)', context), /INSTALL AVAILABLE/);
  vm.runInContext("state.bulkApks[game.id] = 'C:/Games/TimeCrisisVR.apk'", context);
  assert.notEqual(vm.runInContext('cardStatus(game)', context), 'status-staged');
  vm.runInContext("state.inputs[game.id].timecris = 'C:/Games/timecris.zip'; state.staged[game.id].timecris = 'C:/Games/timecris.zip'", context);
  assert.equal(vm.runInContext('cardStatus(game)', context), 'status-staged');
  assert.match(vm.runInContext('releaseLabel(game)', context), /INSTALL AVAILABLE/);
});

test('Dirt Dash stays unavailable until its own arcade set joins the shared Namco board ZIP', () => {
  const { context } = appHarness();
  context.dirt = getCatalog().find((item) => item.id === 'dirt-dash-vr');
  vm.runInContext("state.games = [dirt]; state.inputs[dirt.id] = { namcoc71: 'C:/Games/namcoc71.zip' }; state.staged[dirt.id] = { namcoc71: 'C:/Games/namcoc71.zip' }", context);
  assert.doesNotMatch(vm.runInContext('releaseLabel(dirt)', context), /INSTALL AVAILABLE/);
  vm.runInContext("state.inputs[dirt.id].dirtdash = 'C:/Games/dirtdash.zip'; state.staged[dirt.id].dirtdash = 'C:/Games/dirtdash.zip'", context);
  assert.match(vm.runInContext('releaseLabel(dirt)', context), /INSTALL AVAILABLE/);
});

test('missing saved game file does not show Install available, but an APK update can reuse headset game files', () => {
  const { context, game } = appHarness();
  vm.runInContext("state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {}; state.inputs[game.id] = { timecris: 'C:/Games/timecris.zip', namcoc71: 'C:/Games/namcoc71.zip' }; state.staged[game.id] = { ...state.inputs[game.id] }; state.savedPaths[game.id] = { timecris: state.inputs[game.id].timecris }; state.pathAvailability[game.id] = { timecris: false }", context);
  assert.doesNotMatch(vm.runInContext('releaseLabel(game)', context), /INSTALL AVAILABLE/);
  vm.runInContext("state.deviceLibrary.QUEST[game.id] = { packageId: 'example.timecrisis', dataReady: true, versionName: '1.0.0' }; state.bulkApks[game.id] = 'C:/Games/TimeCrisisVR-2.0.0-quest.apk'", context);
  assert.match(vm.runInContext('releaseLabel(game)', context), /INSTALL AVAILABLE/);
});

test('Halo needs its owned disc before it is available to install', () => {
  const { context } = appHarness();
  const catalog = getCatalog();
  context.rally = catalog.find((item) => item.id === 'rally-vr');
  context.halo = catalog.find((item) => item.id === 'halo-ce');
  vm.runInContext("state.games = [rally, halo]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {}; state.inputs[rally.id] = { segabill: 'C:/Games/segabill.zip' }; state.staged[rally.id] = { segabill: 'C:/Games/segabill.zip' }", context);
  assert.notEqual(vm.runInContext('cardStatus(rally)', context), 'status-staged');
  vm.runInContext("state.inputs[rally.id].srallyc = 'C:/Games/srallyc.zip'; state.staged[rally.id].srallyc = 'C:/Games/srallyc.zip'", context);
  assert.equal(vm.runInContext('cardStatus(rally)', context), 'status-staged');
  assert.notEqual(vm.runInContext('cardStatus(halo)', context), 'status-staged');
  assert.equal(vm.runInContext('isAvailableForInstall(halo)', context), false);
  vm.runInContext("state.inputs[halo.id] = { disc: 'C:/Games/Halo.iso' }; state.staged[halo.id] = { disc: 'C:/Games/Halo.iso' }", context);
  assert.equal(vm.runInContext('cardStatus(halo)', context), 'status-staged');
});

test('Sclerosis install clears staged PC inputs after the Quest transfer succeeds', async () => {
  const { context } = appHarness();
  context.sclerosis = getCatalog().find((item) => item.id === 'sclerosis-vr');
  context.mockApi = async (url) => {
    if (url === '/api/sclerosis-install') return { job: { id: 'sclerosis-job', gameId: 'sclerosis-vr', title: 'Sclerosis', serial: 'QUEST', status: 'queued', log: [] } };
    if (url === '/api/jobs/sclerosis-job') return { job: { id: 'sclerosis-job', gameId: 'sclerosis-vr', title: 'Sclerosis', serial: 'QUEST', status: 'success', log: ['Sclerosis installation completed'] } };
    if (url === '/api/catalog') return { installed: {} };
    throw new Error(`Unexpected ${url}`);
  };
  vm.runInContext("state.games = [sclerosis]; state.selectedId = sclerosis.id; state.selectedSerial = 'QUEST'; state.inputs[sclerosis.id] = { apkPath: 'C:/Downloads/Sclerosis.apk', gamePath: 'C:/Games/Amnesia' }; state.staged[sclerosis.id] = { gamePath: 'C:/Games/Amnesia' }; state.bulkApks[sclerosis.id] = 'C:/Downloads/Sclerosis.apk'; api = mockApi; rememberInputs = () => {}; renderJob = () => {}; toast = () => {}; refreshDeviceLibrary = async (serial) => { state.deviceLibrary[serial] = { 'sclerosis-vr': { packageId: 'com.CreaTeam.Sclerosis', versionName: '1.10.7', dataReady: true, versionComparable: true } }; }; const livePollJob = pollJob; pollJob = () => {}", context);
  await vm.runInContext('install()', context);
  await vm.runInContext("livePollJob('sclerosis-job')", context);
  assert.equal(vm.runInContext("state.staged['sclerosis-vr'].gamePath", context), undefined);
  assert.equal(vm.runInContext("state.bulkApks['sclerosis-vr']", context), undefined);
  assert.equal(vm.runInContext('cardStatus(sclerosis)', context), 'status-current');
});

test('library views keep popularity in Sort and add headset choices only while connected', () => {
  const { context, elements } = appHarness();
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const initialSelect = html.match(/<select id="libraryScope"[^>]*>(.*?)<\/select>/s)?.[1] || '';
  const sortSelect = html.match(/<select id="librarySort"[^>]*>(.*?)<\/select>/s)?.[1] || '';
  assert.match(initialSelect, /All games.*New games/s);
  assert.doesNotMatch(initialSelect, /Most downloaded/);
  assert.match(sortSelect, /A–Z.*Z–A.*Latest release.*Most downloaded/s);
  assert.doesNotMatch(sortSelect, /Installed first/);
  assert.match(html, /<select id="librarySort"[\s\S]*?<input id="installedFirst" type="checkbox"[\s\S]*?Installed first/);
  assert.doesNotMatch(initialSelect, /Build or patch required|Manual download required/);
  assert.doesNotMatch(initialSelect, /Games not installed|Installed games|Needs update/);
  vm.runInContext('renderLibraryScopeOptions()', context);
  assert.doesNotMatch(elements.get('#libraryScope').innerHTML, /HEADSET|Installed games/);
  vm.runInContext("state.selectedSerial = 'Q3'; state.devices = [{ serial: 'Q3', model: 'Quest 3', state: 'device' }]; renderLibraryScopeOptions()", context);
  assert.match(elements.get('#libraryScope').innerHTML, /<optgroup label="Quest 3">.*Installed games.*Update available.*<\/optgroup>/s);
  vm.runInContext("state.libraryScope = 'installed'; state.selectedSerial = ''; state.devices = []; renderLibraryScopeOptions()", context);
  assert.equal(vm.runInContext('state.libraryScope', context), 'all');
  assert.equal(elements.get('#libraryScope').value, 'all');
});

test('install-type views filter actual ports without a connected headset and include alternate port choices', () => {
  const { context, elements } = appHarness();
  context.catalogGames = getCatalog();
  vm.runInContext('state.games = catalogGames; renderLibraryScopeOptions()', context);
  const options = elements.get('#libraryScope').innerHTML;
  assert.match(options, /<optgroup label="Install type">/);
  for (const label of ['APK + game files', 'APK includes game files', 'Build or patch', 'Special installer', 'Manual APK download', 'Guided game-data setup']) {
    assert.ok(options.includes(label), label);
  }
  const visibleIds = (scope) => {
    context.scope = scope;
    vm.runInContext('state.libraryScope = scope; renderGrid()', context);
    return [...elements.get('#gameGrid').innerHTML.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]);
  };
  assert.ok(visibleIds('apk-files').includes('lambda1vr'));
  assert.ok(visibleIds('apk-files').includes('mgs-vr'));
  assert.ok(visibleIds('apk-files').includes('wipeout-vr'));
  assert.ok(visibleIds('apk-included').includes('time-crisis-vr'));
  assert.ok(visibleIds('apk-included').includes('crisis-zone-vr'));
  assert.ok(!visibleIds('apk-included').includes('mgs-vr'));
  assert.ok(visibleIds('build').includes('vice-city-vr'));
  assert.ok(visibleIds('special').includes('road-rash-vr'));
  assert.ok(visibleIds('manual-apk').includes('rave-racer-vr'));
  assert.ok(visibleIds('apk-files').includes('avp-vr'));
  assert.ok(visibleIds('apk-files').includes('sourcevr'));
  vm.runInContext("state.libraryScope = 'build'; renderLibraryScopeOptions()", context);
  assert.equal(vm.runInContext('state.libraryScope', context), 'build');
});

test('Available to install sits between All and New and shows only complete install inputs', () => {
  const { context, elements, listeners } = appHarness();
  const catalog = getCatalog();
  context.ports = ['time-crisis-vr', 'dr89-time-crisis', 'mgs-vr', 'vice-city-vr', 'wave-race-vr'].map((id) => catalog.find((game) => game.id === id));
  vm.runInContext("state.games = ports; renderLibraryScopeOptions(); state.libraryScope = 'available'; renderGrid()", context);
  assert.match(elements.get('#libraryScope').innerHTML, /All games<\/option><option value="available">Available to install<\/option><option value="new">New games/);
  const ids = () => [...elements.get('#gameGrid').innerHTML.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids(), ['time-crisis-vr']);
  assert.equal(vm.runInContext("cardProfile(ports[0]).id", context), 'dr89-time-crisis');
  vm.runInContext("state.inputs['time-crisis-vr'] = { namcoc71: 'C:/Games/namcoc71.zip' }; state.staged['time-crisis-vr'] = { ...state.inputs['time-crisis-vr'] }; state.inputs['vice-city-vr'] = { gamePackage: 'C:/Games/Vice City' }; renderGrid()", context);
  assert.equal(vm.runInContext("isAvailableForInstall(ports[0])", context), false, 'shared board file alone is insufficient');
  assert.deepEqual(ids().sort(), ['time-crisis-vr', 'vice-city-vr'].sort());
  vm.runInContext("state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { 'dr89-time-crisis': { dataReady: true } }; state.inputs['time-crisis-vr'].timecris = 'C:/Games/timecris.zip'; state.staged['time-crisis-vr'].timecris = 'C:/Games/timecris.zip'; renderGrid()", context);
  assert.equal(vm.runInContext("cardProfile(ports[0]).id", context), 'time-crisis-vr');
  assert.deepEqual(ids().sort(), ['time-crisis-vr', 'vice-city-vr'].sort());
  vm.runInContext("state.deviceLibrary.QUEST['time-crisis-vr'] = { dataReady: true }; renderGrid()", context);
  assert.deepEqual(ids(), ['vice-city-vr']);
  vm.runInContext("delete state.deviceLibrary.QUEST['time-crisis-vr']; state.search = ''; renderGrid()", context);
  listeners.get('#sidebarSearchInput:input')({ target: { value: 'Time Crisis' } });
  assert.equal(vm.runInContext('state.libraryScope', context), 'available');
  assert.deepEqual(ids(), ['time-crisis-vr']);
});

test('Time Crisis cards choose DR-89 by default while an explicit port choice persists', () => {
  const { context } = appHarness();
  const catalog = getCatalog();
  for (const [parentId, preferredId] of [['time-crisis-vr', 'dr89-time-crisis'], ['time-crisis-2-vr', 'dr89-time-crisis-2']]) {
    context.parent = catalog.find((game) => game.id === parentId);
    context.alternate = catalog.find((game) => game.id === preferredId);
    vm.runInContext('state.games = [parent, alternate]; state.portChoices = {}; state.libraryScope = "all"', context);
    assert.equal(vm.runInContext('cardProfile(parent).id', context), preferredId);
    vm.runInContext('state.portChoices[parent.id] = parent.id', context);
    assert.equal(vm.runInContext('cardProfile(parent).id', context), parentId);
  }
});

test('standalone HOTD2 and MOK defaults remain selected when only the older port is installed', () => {
  const { context } = appHarness();
  const catalog = getCatalog();
  for (const [rootId, olderId] of [['hotd2-vr', 'hotd2-dreamcast-vr'], ['mok-vr', 'mok-upstream-vr']]) {
    context.root = catalog.find((game) => game.id === rootId);
    context.older = catalog.find((game) => game.id === olderId);
    vm.runInContext('state.games = [root, older].filter(Boolean); state.portChoices = {}; state.libraryScope = "all"; state.selectedSerial = "QUEST"; state.deviceLibrary.QUEST = {}', context);
    assert.equal(vm.runInContext('cardProfile(root).source.repo', context), rootId === 'hotd2-vr' ? 'vr4all-standalone/hotd2-arcade-vr' : 'vr4all-standalone/mok-vr');
    vm.runInContext(`state.deviceLibrary.QUEST['${olderId}'] = { dataReady: true }`, context);
    assert.equal(vm.runInContext('cardProfile(root).id', context), rootId);
    assert.match(vm.runInContext('portChoiceHtml(root)', context), new RegExp(`data-port-id="${olderId}"`));
    vm.runInContext(`state.portChoices[root.id] = '${olderId}'`, context);
    assert.equal(vm.runInContext('cardProfile(root).id', context), olderId);
  }
});

test('Maze of the Kings card shows its installed port as ready while another developer port is selected', () => {
  const { context, elements } = appHarness();
  const catalog = getCatalog();
  context.mok = catalog.find((game) => game.id === 'mok-vr');
  context.upstream = catalog.find((game) => game.id === 'mok-upstream-vr');
  vm.runInContext("state.games = [mok, upstream]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { [mok.id]: { packageId: 'com.vrlightgunhub.mok', dataReady: true, versionComparable: false } }; state.portChoices[mok.id] = upstream.id; renderGrid()", context);
  assert.equal(vm.runInContext('cardProfile(mok).id', context), 'mok-upstream-vr', 'the chosen port should remain selected for setup');
  const card = elements.get('#gameGrid').innerHTML;
  assert.match(card, /class="game-card status-ready-unverified"[^>]*data-id="mok-vr"/);
  assert.match(card, /READY · VERSION UNVERIFIED/);
  assert.doesNotMatch(card, /INSTALL AVAILABLE/);
});

test('Maze of the Kings card prioritizes a confirmed update for its installed port', () => {
  const { context, elements } = appHarness();
  const catalog = getCatalog();
  context.mok = catalog.find((game) => game.id === 'mok-vr');
  context.upstream = catalog.find((game) => game.id === 'mok-upstream-vr');
  vm.runInContext("state.games = [mok, upstream]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { [mok.id]: { packageId: 'com.vrlightgunhub.mok', dataReady: true, versionComparable: false } }; state.portChoices[mok.id] = upstream.id; state.releases[mok.id] = { stale: false, verifiedSerial: 'QUEST', installedApkMatchesRelease: false, tag: 'v1.2.0' }; renderGrid()", context);
  assert.equal(vm.runInContext('versionStatus(mok)', context), 'status-update');
  const card = elements.get('#gameGrid').innerHTML;
  assert.match(card, /class="game-card status-update"[^>]*data-id="mok-vr"/);
  assert.match(card, /UPDATE READY/);
  assert.doesNotMatch(card, /INSTALL AVAILABLE/);
});

test('existing Time Crisis families still show the installed port ahead of their normal default', () => {
  const { context } = appHarness();
  context.ports = getCatalog().filter((game) => ['time-crisis-vr', 'dr89-time-crisis'].includes(game.id));
  vm.runInContext('state.games = ports; state.selectedSerial = "QUEST"; state.deviceLibrary.QUEST = { "time-crisis-vr": { dataReady: true } }', context);
  assert.equal(vm.runInContext('cardProfile(ports[0]).id', context), 'time-crisis-vr');
});

test('all five self-contained Quest APK cards say Install available before installation', () => {
  const { context } = appHarness();
  const catalog = getCatalog();
  const ids = ['dr89-time-crisis', 'dr89-time-crisis-2', 'crisis-zone-vr', 'xwing-revival-vr', 'forsaken-vr'];
  for (const id of ids) {
    context.selfContained = catalog.find((game) => game.id === id);
    assert.ok(context.selfContained, id);
    assert.equal(vm.runInContext('installType(selfContained)', context), 'apk-included');
    assert.match(vm.runInContext('releaseLabel(selfContained)', context), /INSTALL AVAILABLE/, id);
  }
});

test('sidebar game search is visible and finds a game across library categories', () => {
  const { context, elements, listeners } = appHarness();
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /<aside class="sidebar">[\s\S]*<input id="sidebarSearchInput" type="search"[^>]*aria-label="Search all games"/);
  const games = getCatalog();
  context.searchGames = games.filter((game) => ['dark-forces-vr', 'wave-race-vr'].includes(game.id));
  vm.runInContext("state.games = searchGames; state.libraryScope = 'manual'; state.category = 'Arcade'", context);
  listeners.get('#sidebarSearchInput:input')({ target: { value: 'dark forces' } });
  assert.equal(vm.runInContext('state.libraryScope', context), 'all');
  assert.equal(vm.runInContext('state.category', context), 'All games');
  assert.equal(elements.get('#searchInput').value, 'dark forces');
  assert.match(elements.get('#gameGrid').innerHTML, /Star Wars: Dark Forces/);
  assert.doesNotMatch(elements.get('#gameGrid').innerHTML, /Wave Race 64/);
  listeners.get('#searchInput:input')({ target: { value: 'wave race' } });
  assert.equal(elements.get('#sidebarSearchInput').value, 'wave race');
  assert.match(elements.get('#gameGrid').innerHTML, /Wave Race 64/);
  assert.doesNotMatch(elements.get('#gameGrid').innerHTML, /Star Wars: Dark Forces/);
});

test('settings previews material and palette, then restores both when cancelled', () => {
  const { context, listeners } = appHarness();
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="themeInput"/);
  assert.match(html, /id="paletteInput"/);
  assert.match(html, /<body data-theme="graphite"/);
  assert.match(html, /data-theme-choice="graphite"[\s\S]*?data-theme-choice="y2k"/);
  assert.match(html, /data-theme-choice="graphite"/);
  assert.match(html, /data-theme-choice="frost"/);
  assert.match(html, /href="\/themes\.css"/);
  vm.runInContext("state.settings = { theme: 'y2k', palette: 'blue' }; applyTheme('frost'); applyPalette('rose')", context);
  assert.equal(context.document.body.dataset.theme, 'frost');
  assert.equal(context.document.body.dataset.palette, 'rose');
  listeners.get('#settingsDialog:close')();
  assert.equal(context.document.body.dataset.theme, 'y2k');
  assert.equal(context.document.body.dataset.palette, 'blue');
  vm.runInContext("applyTheme('bad-value'); applyPalette('bad-value')", context);
  assert.equal(context.document.body.dataset.theme, 'graphite');
  assert.equal(context.document.body.dataset.palette, 'blue');
});

test('new games selects ten catalog cards while Most downloaded sorts the full view', () => {
  const { context, elements } = appHarness();
  const games = getCatalog();
  const rootGames = games.filter((game) => !game.variantOf);
  context.catalogGames = games;
  const newest = rootGames.slice(-10).map((game) => game.id);
  assert.ok(newest.includes('gt3-revisited'));
  vm.runInContext("state.games = catalogGames; state.libraryScope = 'new'; renderGrid()", context);
  const ids = () => [...elements.get('#gameGrid').innerHTML.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...ids()].sort(), [...newest].sort());
  assert.equal(elements.get('#librarySort').disabled, false);
  context.rootGames = rootGames;
  vm.runInContext("state.libraryScope = 'all'; state.sortMode = 'downloads'; state.discovery = { [rootGames[0].id]: { totalDownloads: 100 }, [rootGames[1].id]: { totalDownloads: 300 } }; renderGrid()", context);
  assert.deepEqual(ids().slice(0, 2), [rootGames[1].id, rootGames[0].id]);
  assert.equal(ids().length, games.filter((game) => !game.variantOf).length);
  assert.match(elements.get('#gameGrid').innerHTML, /GitHub downloads/);
});

test('bulk update is visible in every library view while any installed game has a confirmed update', () => {
  const { context, elements } = appHarness();
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html.match(/<div class="sidebar-tools">[\s\S]*?<\/div>/)?.[0] || '', /id="bulkUpdateButton"/);
  assert.match(html, /<section id="library"[\s\S]*id="bulkUpdatePanel"[\s\S]*id="bulkUpdateButton"[\s\S]*id="gameGrid"/);
  context.port = { id: 'port', title: 'Example', gameName: 'Example', console: 'PC', genre: 'Shooter', description: '', source: { repo: 'author/example' }, data: [] };
  context.otherGames = Array.from({ length: 11 }, (_, index) => ({ id: `other-${index}`, title: `Other ${index}`, console: 'Xbox', genre: 'Racing', description: '', data: [] }));
  vm.runInContext("state.libraryScope = 'all'; renderGrid()", context);
  assert.equal(elements.get('#bulkUpdatePanel').hidden, true);
  vm.runInContext("state.games = [port, ...otherGames]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { port: { dataReady: true, versionComparable: true, versionName: '1.0.0' } }; state.releases.port = { tag: 'v2.0.0', stale: false }", context);
  for (const scope of ['all', 'new', 'installed', 'updates']) {
    context.scope = scope;
    vm.runInContext('state.libraryScope = scope; renderGrid()', context);
    assert.equal(elements.get('#bulkUpdatePanel').hidden, false, scope);
    assert.equal(elements.get('#bulkUpdateButton').disabled, false, scope);
  }
  vm.runInContext("state.libraryScope = 'all'; state.category = 'Xbox'; renderGrid()", context);
  assert.equal(elements.get('#bulkUpdatePanel').hidden, false);
  vm.runInContext("state.browseMode = 'genre'; state.category = 'Racing'; renderGrid()", context);
  assert.equal(elements.get('#bulkUpdatePanel').hidden, false);
  vm.runInContext("state.releases.port.tag = 'v1.0.0'; state.libraryScope = 'new'; renderGrid()", context);
  assert.equal(elements.get('#bulkUpdatePanel').hidden, true);
  vm.runInContext("state.libraryScope = 'updates'; state.bulkRunning = true; renderGrid()", context);
  assert.equal(elements.get('#bulkUpdatePanel').hidden, false);
  vm.runInContext("bulkUpdateProgress('1/1 updates installed', false); state.bulkRunning = false; renderGrid()", context);
  assert.equal(elements.get('#bulkUpdatePanel').hidden, true);
  assert.equal(elements.get('#bulkUpdateStatus').hidden, true);
  assert.equal(elements.get('#bulkUpdateStatusText').textContent, '');
  assert.equal(elements.get('#bulkUpdateButton').disabled, true);
});

test('Check updates shows persistent progress while GitHub is still responding', async () => {
  const { context, elements, game } = appHarness();
  let complete;
  context.fetch = async (url) => {
    if (url.startsWith('/api/releases?')) return new Promise((resolve) => { complete = resolve; });
    return { ok: true, json: async () => ({}) };
  };
  context.game = game;
  vm.runInContext('state.games = [game]; state.selectedId = ""', context);
  const checking = vm.runInContext('checkAllReleases()', context);
  assert.equal(elements.get('#sidebarUpdatesButton').disabled, true);
  assert.equal(elements.get('#updateStatus').hidden, false);
  assert.match(elements.get('#updateStatus').textContent, /Checking 1 of 1/);
  complete({ ok: true, json: async () => ({ release: { tag: 'v2', assetName: 'Game.apk' } }) });
  await checking;
  assert.equal(elements.get('#sidebarUpdatesButton').disabled, false);
  assert.match(elements.get('#updateStatus').textContent, /Checked 1 GitHub source/);
});

test('Check updates checks VR4ALL after the game sources and offers the app update', async () => {
  const { context, game, elements } = appHarness();
  const order = [];
  context.checkGame = async () => { order.push('game'); return null; };
  context.window.vr4allDesktop = {
    async checkAppUpdate() { order.push('app-check'); return { available: true, version: '0.3.46' }; },
    async installAppUpdate() { order.push('app-offer'); return { cancelled: true }; },
  };
  vm.runInContext('state.games = [game]; checkRelease = checkGame', context);
  await vm.runInContext('checkAllReleases()', context);
  assert.deepEqual(order, ['game', 'app-check', 'app-offer']);
  assert.match(elements.get('#updateStatus').textContent, /VR4ALL 0\.3\.46/);
});

test('an app update check failure leaves game release results intact', async () => {
  const { context, game } = appHarness();
  let checked = 0;
  context.checkGame = async () => { vm.runInContext("state.releases[game.id] = { tag: 'v2.0.0' }", context); return null; };
  context.window.vr4allDesktop = { async checkAppUpdate() { checked++; throw new Error('GitHub unavailable'); } };
  vm.runInContext('state.games = [game]; checkRelease = checkGame', context);
  await vm.runInContext('checkAllReleases()', context);
  assert.equal(vm.runInContext('state.releases[game.id].tag', context), 'v2.0.0');
  assert.equal(checked, 1);
  assert.equal(vm.runInContext('state.updateChecking', context), false);
});

test('install jobs show live progress and completion in the bottom activity indicator', async () => {
  const { context, elements } = appHarness();
  context.jobResult = { id: 'job-activity', gameId: 'time-crisis-vr', title: 'Time Crisis VR', status: 'running', log: ['Downloading APK 50%'] };
  context.mockApi = async (url) => {
    assert.equal(url, '/api/jobs/job-activity');
    return { job: context.jobResult };
  };
  vm.runInContext("state.jobs = [{ id: 'job-activity', gameId: game.id, title: game.title, status: 'queued', log: [] }]; api = mockApi", context);
  await vm.runInContext("pollJob('job-activity')", context);
  assert.equal(elements.get('#updateStatus').hidden, false);
  assert.match(elements.get('#updateStatus').textContent, /Time Crisis VR: Downloading APK 50%/);
  assert.equal(vm.runInContext("activities.get('job:job-activity').active", context), true);
  context.jobResult = { ...context.jobResult, status: 'error', error: 'ADB disconnected', log: ['ADB disconnected'] };
  await vm.runInContext("pollJob('job-activity')", context);
  assert.match(elements.get('#updateStatus').textContent, /Time Crisis VR: ADB disconnected/);
  assert.equal(vm.runInContext("activities.get('job:job-activity').active", context), false);
  assert.equal(vm.runInContext("activities.get('job:job-activity').error", context), true);
});

test('game-file validation reports progress at the bottom', async () => {
  const { context, elements } = appHarness();
  await vm.runInContext("validateSelectedFile(game, 'timecris', 'C:/Games/timecris.zip')", context);
  assert.equal(elements.get('#updateStatus').hidden, false);
  assert.match(elements.get('#updateStatus').textContent, /Time Crisis VR.*Time Crisis arcade set.*Packed folder contents into ZIP/);
  assert.equal(vm.runInContext("activities.get('file:time-crisis-vr:timecris').active", context), false);
});

test('matching installed APK hash overrides an unrelated manifest version', () => {
  const { context } = appHarness();
  const game = getCatalog().find((item) => item.id === 'perfect-dark-vr');
  context.game = game;
  vm.runInContext("state.selectedSerial = 'QUEST'; state.deviceLibrary = { QUEST: { 'perfect-dark-vr': { dataReady: true, versionComparable: true, versionName: '1.0' } } }; state.releases = { 'perfect-dark-vr': { tag: 'v2.1', verifiedSerial: 'QUEST', installedApkMatchesRelease: true } }", context);
  assert.equal(vm.runInContext('versionStatus(game)', context), 'status-current');
  vm.runInContext("state.bulkApks['perfect-dark-vr'] = 'C:/Saved/Perfect_Dark_VR_Standalone_NTSC_v2.1.apk'", context);
  assert.equal(vm.runInContext('cardStatus(game)', context), 'status-current');
});

test('successful install rechecks the headset APK before retaining an update badge', async () => {
  const { context } = appHarness();
  const game = getCatalog().find((item) => item.id === 'perfect-dark-vr');
  context.game = game;
  let releaseChecks = 0;
  context.fetch = async (url) => {
    let body = {};
    if (url === '/api/jobs/job1') body = { job: { id: 'job1', gameId: game.id, title: game.title, serial: 'QUEST', status: 'success', log: ['Installed'] } };
    else if (url === '/api/catalog') body = { installed: {} };
    else if (url.startsWith('/api/device-library?')) body = { games: { [game.id]: { dataReady: true, versionComparable: true, versionName: '1.0' } } };
    else if (url.startsWith('/api/releases?')) { releaseChecks++; body = { release: { tag: 'v2.1', verifiedSerial: 'QUEST', installedApkMatchesRelease: true } }; }
    return { ok: true, json: async () => body };
  };
  vm.runInContext("state.games = [game]; state.selectedId = ''; state.selectedSerial = 'QUEST'; state.deviceLibrary = { QUEST: { 'perfect-dark-vr': { dataReady: true, versionComparable: true, versionName: '1.0' } } }; state.releases = { 'perfect-dark-vr': { tag: 'v2.1', verifiedSerial: 'QUEST', installedApkMatchesRelease: false } }; state.jobs = [{ id: 'job1', gameId: 'perfect-dark-vr', title: 'Perfect Dark VR', serial: 'QUEST', status: 'running' }]", context);
  await vm.runInContext("pollJob('job1')", context);
  assert.equal(releaseChecks, 1);
  assert.equal(vm.runInContext('versionStatus(game)', context), 'status-current');
});

test('dropping a folder on a ZIP field uploads its children at ZIP root', async () => {
  const { context, elements, listeners, requests } = appHarness();
  const children = ['game.bin', 'board.bin'].map((name) => ({ name, isFile: true, file(resolve) { resolve({ name }); } }));
  let read = false;
  const folder = { name: 'timecris', isDirectory: true, createReader: () => ({ readEntries(resolve) { resolve(read ? [] : children); read = true; } }) };
  const zone = { dataset: { itemId: 'timecris' }, classList: { add() {}, remove() {} } };
  const event = {
    preventDefault() {}, target: { closest(selector) { return selector === '.drop-zone' ? zone : null; } },
    dataTransfer: { files: [{ name: 'timecris' }], items: [{ webkitGetAsEntry: () => folder }] },
  };
  await listeners.get('#detailPanel:drop')(event);
  const uploaded = requests.filter((entry) => entry.url.startsWith('/api/bulk-upload?')).map((entry) => new URL(entry.url, 'http://localhost').searchParams.get('path'));
  assert.deepEqual(uploaded, ['game.bin', 'board.bin']);
  assert.equal(elements.get('#data-timecris').value, 'C:\\Saved\\timecris.zip');
  assert.equal(vm.runInContext("state.staged[game.id].timecris", context), 'C:\\Saved\\timecris.zip');
});

test('dropping several loose files on a ZIP field packages one ZIP', async () => {
  const { context, listeners, requests } = appHarness();
  const zone = { dataset: { itemId: 'timecris' }, classList: { add() {}, remove() {} } };
  await listeners.get('#detailPanel:drop')({
    preventDefault() {}, target: { closest(selector) { return selector === '.drop-zone' ? zone : null; } },
    dataTransfer: { files: [{ name: 'game.bin' }, { name: 'board.bin' }], items: [] },
  });
  assert.equal(requests.filter((entry) => entry.url.startsWith('/api/bulk-upload?')).length, 2);
  assert.equal(requests.filter((entry) => entry.url === '/api/package-uploaded').length, 1);
  assert.equal(vm.runInContext("state.staged[game.id].timecris", context), 'C:\\Saved\\timecris.zip');
});

test('Road Rash card asks for the owned disc and offers one click official installation', () => {
  const { context } = appHarness();
  const road = getCatalog().find((item) => item.id === 'road-rash-vr');
  context.road = road;
  const html = vm.runInContext('detailHtml(road)', context);
  assert.match(html, /data-discImage/);
  assert.match(html, /Prepare &amp; install|Prepare & install/);
  assert.doesNotMatch(html, /Choose a local APK/);
});

test('Harry Potter card accepts an owned game ZIP or folder and offers official installation', () => {
  const { context } = appHarness();
  const hp = getCatalog().find((item) => item.id === 'harry-potter-vr');
  context.hp = hp;
  const html = vm.runInContext('detailHtml(hp)', context);
  assert.match(html, /data-gamePath/);
  assert.match(html, /Prepare &amp; install|Prepare & install/);
  assert.doesNotMatch(html, /Open official setup/);
});

test('Descent 3 and JKXR cards collect owned folders for one-click Quest setup', () => {
  const { context } = appHarness();
  const descent = getCatalog().find((item) => item.id === 'descent3-vr');
  const jkxr = getCatalog().find((item) => item.id === 'jkxr');
  context.descent = descent;
  context.jkxr = jkxr;
  const descentHtml = vm.runInContext('detailHtml(descent)', context);
  const jediHtml = vm.runInContext('detailHtml(jkxr)', context);
  assert.match(descentHtml, /data-gamePath/);
  assert.match(descentHtml, /Drop your Installed Descent 3 game folder here/);
  assert.match(jediHtml, /jediGameSelect/);
  assert.match(jediHtml, /Jedi Outcast/);
  assert.match(jediHtml, /Jedi Academy/);
  assert.doesNotMatch(jediHtml, /Open official setup/);
});

test('Vice City card asks for one owned game input and builds inside VR4All', () => {
  const { context } = appHarness();
  const viceCity = getCatalog().find((item) => item.id === 'vice-city-vr');
  context.viceCity = viceCity;
  const html = vm.runInContext('detailHtml(viceCity)', context);
  assert.match(html, /buildGamePath/);
  assert.match(html, /Build and install/);
  assert.doesNotMatch(html, /buildAudioPath/);
  assert.doesNotMatch(html, /VR4All cannot prepare this port/);
});

test('Vice City offers tool setup before a headset or game files are selected', () => {
  const { context } = appHarness();
  context.viceCity = getCatalog().find((item) => item.id === 'vice-city-vr');
  const html = vm.runInContext('detailHtml(viceCity)', context);
  assert.match(html, /id="setupBuildToolsButton"/);
  assert.match(html, /Set up build tools/);
});

test('SDK setup displays license text safely and only sends acceptance after a user decision', async () => {
  const { context, elements, requests } = appHarness();
  const job = { id: 'sdk-job', gameId: 'vice-city-vr', title: 'Vice City build tools', kind: 'build-tools', status: 'running', log: [], license: { id: 'license-one', text: 'Google terms <script>unsafe()</script>' } };
  context.viceCity = getCatalog().find((item) => item.id === 'vice-city-vr');
  vm.runInContext("state.games = [viceCity]; state.selectedId = viceCity.id; state.selectedSerial = ''", context);
  context.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/build-tools/location') return { ok: true, json: async () => ({ downloadLocation: 'D:\\Games\\Vice City', configured: false }) };
    if (url === '/api/build-tools' || url === '/api/jobs/sdk-job') return { ok: true, json: async () => ({ job }) };
    if (url === '/api/build-tools/sdk-job/license') {
      job.license = null; job.status = 'success';
      return { ok: true, json: async () => ({ accepted: true }) };
    }
    throw new Error(`Unexpected SDK setup request: ${url}`);
  };
  await vm.runInContext('startBuildTools()', context);
  await vm.runInContext('installBuildTools()', context);
  assert.equal(elements.get('#sdkLicenseText').textContent, 'Google terms <script>unsafe()</script>');
  assert.equal(elements.get('#sdkLicenseText').innerHTML, '');
  assert.equal(elements.get('#sdkAcceptButton').disabled, false);
  assert.equal(requests.filter((entry) => entry.url.endsWith('/license')).length, 0);
  await vm.runInContext('answerBuildToolsLicense(true)', context);
  await vm.runInContext("pollJob('sdk-job')", context);
  assert.deepEqual(JSON.parse(requests.find((entry) => entry.url.endsWith('/license')).options.body), { licenseId: 'license-one', accepted: true });
  assert.equal(requests.some((entry) => entry.url === '/api/catalog' || entry.url.includes('device-library')), false, 'tool completion must not act like a headset install');
});

test('SDK decline sends a negative decision for the displayed prompt', async () => {
  const { context, requests } = appHarness();
  context.sdkJob = { id: 'sdk-decline', gameId: 'vice-city-vr', kind: 'build-tools', status: 'running', log: [], license: { id: 'decline-this', text: 'Terms' } };
  vm.runInContext("state.jobs = [sdkJob]; sdkSetupJobId = sdkJob.id", context);
  context.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/license') ? ({ accepted: false }) : ({ job: { ...context.sdkJob, license: null, status: 'error', error: 'License declined' } }) };
  };
  await vm.runInContext('answerBuildToolsLicense(false)', context);
  assert.deepEqual(JSON.parse(requests[0].options.body), { licenseId: 'decline-this', accepted: false });
});

test('Beef Raider card offers the official APK and extracted-data transfer', () => {
  const { context } = appHarness();
  const beef = getCatalog().find((item) => item.id === 'beef-raider-xr');
  context.beef = beef;
  const html = vm.runInContext('detailHtml(beef)', context);
  assert.match(html, /official Quest APK/);
  assert.match(html, /Beef Raider Extraction Tool/);
  assert.match(html, /data-gamePath/);
  assert.match(html, /Prepare &amp; install|Prepare & install/);
  assert.doesNotMatch(html, /Open official setup/);
});

test('Crazy Taxi card accepts one original package and links both official patch tools', () => {
  const { context } = appHarness();
  const taxi = getCatalog().find((item) => item.id === 'crazy-taxi-vr');
  context.taxi = taxi;
  const html = vm.runInContext('detailHtml(taxi)', context);
  assert.match(html, /buildGamePath/);
  assert.match(html, /Prepare and install/);
  assert.match(html, /already patched Crazy Taxi VR APK/);
  assert.match(html, /Baywilly\/Crazy-Taxi-VR-Standalone/);
  assert.match(html, /marco-calautti\/DeltaPatcher/);
  assert.doesNotMatch(html, /Choose folder/);
});

test('bulk install lists only absent games while bulk update lists only installed games', () => {
  const { context, elements } = appHarness();
  const mario = getCatalog().find((item) => item.id === 'sm64-vr');
  const wave = getCatalog().find((item) => item.id === 'wave-race-vr');
  context.mario = mario;
  context.wave = wave;
  vm.runInContext(`state.games = [mario, wave]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { 'sm64-vr': { dataReady: true } }; state.bulkMatches = [{ gameId: 'wave-race-vr', apkPath: '', files: { rom: 'C:\\\\Saved\\\\Wave.z64' }, checks: {} }]; state.bulkMode = 'new'; renderBulkMatches()`, context);
  assert.doesNotMatch(elements.get('#bulkMatches').innerHTML, /SM64 Co-Op/);
  assert.match(elements.get('#bulkMatches').innerHTML, /Wave Race/);
  vm.runInContext("state.bulkMode = 'update'; renderBulkMatches()", context);
  assert.match(elements.get('#bulkMatches').innerHTML, /SM64 Co-Op/);
  assert.doesNotMatch(elements.get('#bulkMatches').innerHTML, /Wave Race/);
});

test('bulk install offers all five self-contained Quest APKs without a local file match', () => {
  const { context, elements } = appHarness();
  const catalog = getCatalog();
  const included = catalog.filter((game) => !game.data.length && game.source && !game.manualDataSetup && !game.personalBuild && !game.playerInstall);
  assert.equal(included.length, 5);
  context.bulkGames = [...included, catalog.find((game) => game.id === 'mgs-vr'), catalog.find((game) => game.id === 'time-crisis-vr')];
  vm.runInContext("state.games = bulkGames; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {}; state.bulkMatches = []; state.bulkMode = 'new'; renderBulkMatches()", context);
  const html = elements.get('#bulkMatches').innerHTML;
  for (const game of included) {
    assert.ok(html.includes(`value="${game.id}"`), game.title);
    assert.ok(html.includes(game.title), game.title);
  }
  assert.equal((html.match(/class="bulk-select"/g) || []).length, 5);
  assert.doesNotMatch(html, /Metal Gear Solid VR|Time Crisis VR<\/strong>/);
  vm.runInContext("state.deviceLibrary.QUEST['time-crisis-vr'] = { dataReady: true }; renderBulkMatches()", context);
  assert.ok(elements.get('#bulkMatches').innerHTML.includes('value="dr89-time-crisis"'), 'the separate DR-89 port remains installable');
  vm.runInContext(`state.deviceLibrary.QUEST['${included[0].id}'] = { dataReady: true }; renderBulkMatches()`, context);
  assert.equal((elements.get('#bulkMatches').innerHTML.match(/class="bulk-select"/g) || []).length, 4);
});

test('bulk install includes every available game with remembered paths even when the saved-file scan omits matches', () => {
  const { context, elements } = appHarness();
  const ids = ['sm64-vr', 'wave-race-vr', 'questsam'];
  context.bulkGames = getCatalog().filter((game) => ids.includes(game.id));
  vm.runInContext(`
    state.games = bulkGames;
    state.selectedSerial = 'QUEST';
    state.deviceLibrary.QUEST = {};
    state.bulkMode = 'new';
    for (const game of bulkGames) {
      const field = game.data[0].id;
      const chosen = 'C:/Owned/' + game.id + '.zip';
      state.savedPaths[game.id] = { [field]: chosen };
      state.pathAvailability[game.id] = { [field]: true };
      state.inputs[game.id] = { [field]: chosen };
      state.staged[game.id] = { [field]: chosen };
    }
    state.bulkMatches = [{ gameId: 'sm64-vr', apkPath: '', files: { rom: state.savedPaths['sm64-vr'].rom }, checks: {} }];
    renderBulkMatches();
  `, context);
  const html = elements.get('#bulkMatches').innerHTML;
  assert.equal((html.match(/class="bulk-select"/g) || []).length, 3);
  for (const id of ids) {
    assert.match(html, new RegExp(`value="${id}"(?![^>]*disabled)`), `${id} should be selectable`);
  }
});

test('bulk install sends remembered game files when the saved-file scan omitted that game', async () => {
  const { context } = appHarness();
  context.mario = getCatalog().find((game) => game.id === 'sm64-vr');
  const installs = [];
  context.mockApi = async (url, options = {}) => {
    if (url.startsWith('/api/device-library')) return { games: {} };
    if (url === '/api/install') {
      installs.push(JSON.parse(options.body));
      return { job: { id: 'mario-job', gameId: 'sm64-vr', status: 'success', log: [] } };
    }
    if (url === '/api/catalog') return { installed: {} };
    throw new Error(`Unexpected ${url}`);
  };
  vm.runInContext(`
    state.games = [mario]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {};
    state.bulkMode = 'new'; state.bulkMatches = [];
    state.savedPaths[mario.id] = { rom: 'C:/Owned/Mario.z64' };
    state.pathAvailability[mario.id] = { rom: true };
    state.inputs[mario.id] = { rom: 'C:/Owned/Mario.z64' };
    state.staged[mario.id] = { rom: 'C:/Owned/Mario.z64' };
    api = mockApi; refreshDeviceLibrary = async () => {};
  `, context);
  await vm.runInContext("runBulkInstall(['sm64-vr'])", context);
  assert.equal(installs.length, 1);
  assert.equal(installs[0].files.rom, 'C:/Owned/Mario.z64');
});

test('official installer ports with saved game files are bulk selectable without a separate APK', () => {
  const { context, elements } = appHarness();
  context.road = getCatalog().find((game) => game.id === 'road-rash-vr');
  vm.runInContext(`
    state.games = [road]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {};
    state.bulkMode = 'new'; state.bulkMatches = [];
    state.savedPaths[road.id] = { discImage: 'C:/Owned/RoadRash.iso' };
    state.pathAvailability[road.id] = { discImage: true };
    state.inputs[road.id] = { discImage: 'C:/Owned/RoadRash.iso' };
    state.staged[road.id] = { discImage: 'C:/Owned/RoadRash.iso' };
    renderBulkMatches();
  `, context);
  assert.match(elements.get('#bulkMatches').innerHTML, /value="road-rash-vr"(?![^>]*disabled)/);
});

test('bulk installing a self-contained APK downloads the official build without ROM inputs', async () => {
  const { context, elements } = appHarness();
  context.port = getCatalog().find((game) => game.id === 'forsaken-vr');
  const installs = [];
  context.mockApi = async (url, options) => {
    if (url.startsWith('/api/device-library')) return { games: {} };
    if (url === '/api/install') {
      installs.push(JSON.parse(options.body));
      return { job: { id: 'forsaken-job', status: 'success', log: [] } };
    }
    if (url === '/api/catalog') return { installed: {} };
    throw new Error(`Unexpected ${url}`);
  };
  vm.runInContext("state.games = [port]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {}; state.bulkMatches = []; state.bulkMode = 'new'; api = mockApi; renderBulkMatches = () => {}; refreshDeviceLibrary = async () => {}; toast = () => {}", context);
  await vm.runInContext("runBulkInstall(['forsaken-vr'])", context);
  assert.deepEqual(installs, [{ gameId: 'forsaken-vr', serial: 'QUEST', apkMode: 'github', apkPath: '', files: {} }]);
  assert.match(elements.get('#bulkProgress').textContent, /1 of 1 selected games installed/);
});

test('bulk update prefers a fresh official release over an older saved APK', () => {
  const { context } = appHarness();
  const mario = getCatalog().find((item) => item.id === 'sm64-vr');
  context.mario = mario;
  vm.runInContext("state.bulkMode = 'update'", context);
  assert.equal(vm.runInContext("bulkUseLocalApk(mario, { apkPath: 'C:\\\\Saved\\\\sm64-old.apk' })", context), false);
  vm.runInContext("state.bulkMode = 'new'", context);
  assert.equal(vm.runInContext("bulkUseLocalApk(mario, { apkPath: 'C:\\\\Saved\\\\sm64-old.apk' })", context), true);
});

test('sort and Installed first checkbox combine across modes and ignore disconnected headsets', () => {
  const { context, elements, listeners } = appHarness();
  const games = getCatalog();
  context.mario = games.find((item) => item.id === 'sm64-vr');
  context.wave = games.find((item) => item.id === 'wave-race-vr');
  const ids = () => [...elements.get('#gameGrid').innerHTML.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]);
  vm.runInContext("state.games = [wave, mario]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { 'wave-race-vr': { dataReady: true } }; state.sortMode = 'name-asc'; renderGrid()", context);
  assert.deepEqual(ids(), ['sm64-vr', 'wave-race-vr']);
  assert.equal(elements.get('#installedFirst').disabled, false);
  listeners.get('#installedFirst:change')({ target: { checked: true } });
  assert.deepEqual(ids(), ['wave-race-vr', 'sm64-vr']);
  vm.runInContext("state.sortMode = 'name-desc'; renderGrid()", context);
  assert.deepEqual(ids(), ['wave-race-vr', 'sm64-vr']);
  vm.runInContext("state.releases = { 'sm64-vr': { publishedAt: '2026-10-22T00:00:00Z' }, 'wave-race-vr': { publishedAt: '2026-10-21T00:00:00Z' } }; state.sortMode = 'latest'; state.installedFirst = false; renderGrid()", context);
  assert.deepEqual(ids(), ['sm64-vr', 'wave-race-vr']);
  vm.runInContext("state.installedFirst = true; renderGrid()", context);
  assert.deepEqual(ids(), ['wave-race-vr', 'sm64-vr']);
  vm.runInContext("state.sortMode = 'downloads'; state.discovery = { 'sm64-vr': { totalDownloads: 400 }, 'wave-race-vr': { totalDownloads: 100 } }; state.installedFirst = false; renderGrid()", context);
  assert.deepEqual(ids(), ['sm64-vr', 'wave-race-vr']);
  vm.runInContext("state.installedFirst = true; renderGrid()", context);
  assert.deepEqual(ids(), ['wave-race-vr', 'sm64-vr']);
  vm.runInContext("state.selectedSerial = ''; renderGrid()", context);
  assert.equal(elements.get('#installedFirst').disabled, true);
  assert.deepEqual(ids(), ['sm64-vr', 'wave-race-vr']);
});

test('bulk update button enables only for confirmed updates on the selected headset', () => {
  const { context, elements } = appHarness();
  context.port = { id: 'port', title: 'Example', source: { repo: 'author/example' }, data: [] };
  vm.runInContext("state.games = [port]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { port: { dataReady: true, versionComparable: true, versionName: '1.0.0' } }; state.releases.port = { tag: 'v2.0.0', stale: false }; updateBulkUpdateButton()", context);
  assert.equal(elements.get('#bulkUpdateButton').disabled, false);
  assert.match(elements.get('#bulkUpdateButton').innerHTML, />1<\/b>/);
  vm.runInContext("state.releaseErrors.port = 'GitHub unavailable'; updateBulkUpdateButton()", context);
  assert.equal(elements.get('#bulkUpdateButton').disabled, true);
  vm.runInContext("delete state.releaseErrors.port; updateBulkUpdateButton()", context);
  assert.equal(elements.get('#bulkUpdateButton').disabled, false);
  vm.runInContext("state.releases.port.stale = true; updateBulkUpdateButton()", context);
  assert.equal(elements.get('#bulkUpdateButton').disabled, true);
  vm.runInContext("state.releases.port.stale = false; state.deviceLibrary.QUEST.port.versionName = '2.0.0'; updateBulkUpdateButton()", context);
  assert.equal(elements.get('#bulkUpdateButton').disabled, true);
});

test('bulk update runs confirmed installed games sequentially and reports each game', async () => {
  const { context, elements } = appHarness();
  context.ports = ['A', 'B'].map((id) => ({ id, title: `Game ${id}`, source: { repo: `author/${id}` }, data: [] }));
  const requests = [];
  context.mockApi = async (url, options) => {
    if (url.startsWith('/api/device-library')) throw new Error('Bulk update must use the displayed headset scan');
    if (url === '/api/install') {
      const { gameId } = JSON.parse(options.body);
      requests.push(gameId);
      return { job: { id: gameId, status: 'success', log: [] } };
    }
    if (url === '/api/catalog') return { installed: {} };
    throw new Error(`Unexpected ${url}`);
  };
  context.document.querySelectorAll = (selector) => selector === '.bulk-select:checked' ? [{ value: 'A' }, { value: 'B' }] : [];
  vm.runInContext("state.games = ports; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { A: { dataReady: true, versionComparable: true, versionName: '1.0.0' }, B: { dataReady: true, versionComparable: true, versionName: '1.0.0' } }; state.releases = { A: { tag: 'v2.0.0', stale: false }, B: { tag: 'v2.0.0', stale: false } }; state.bulkMatches = [{ gameId: 'A', files: {} }, { gameId: 'B', files: {} }]; state.bulkMode = 'update'; api = mockApi; renderBulkMatches = () => {}; refreshDeviceLibrary = async () => {}; toast = () => {}", context);
  await vm.runInContext('runBulkInstall()', context);
  assert.deepEqual(requests, ['A', 'B']);
  assert.match(elements.get('#bulkUpdateStatusText').textContent, /2\/2 updates installed/);
  assert.match(elements.get('#updateStatus').textContent, /2\/2 updates installed/);
  assert.equal(elements.get('#bulkUpdateButton').disabled, false);
});

test('one click bulk update starts from the update page without hiding progress behind a modal', async () => {
  const { context, elements } = appHarness();
  context.port = { id: 'port', title: 'Example', source: { repo: 'author/example' }, data: [] };
  const started = [];
  context.mockApi = async (url) => {
    throw new Error(`Unexpected ${url}`);
  };
  elements.get('#bulkDialog').showModal = () => { throw new Error('Update should stay on the update page'); };
  context.recordUpdate = async (ids) => { started.push(...ids); };
  vm.runInContext("state.games = [port]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { port: { dataReady: true, versionComparable: true, versionName: '1.0.0' } }; state.releases.port = { tag: 'v2.0.0', stale: false }; api = mockApi; checkRelease = async () => null; runBulkInstall = recordUpdate", context);
  await vm.runInContext("openBulkDialog('update')", context);
  assert.deepEqual(started, ['port']);
  assert.match(elements.get('#bulkUpdateStatusText').textContent, /Preparing 1 update/);
});

test('bulk update immediately starts every displayed update without rescanning all saved files or releases', async () => {
  const { context } = appHarness();
  context.ports = ['A', 'B'].map((id) => ({ id, title: `Game ${id}`, source: { repo: `author/${id}` }, data: [] }));
  const started = [];
  context.mockApi = async (url) => { throw new Error(`Unexpected preflight request ${url}`); };
  context.recordUpdate = async (ids) => { started.push(...ids); };
  vm.runInContext("state.games = ports; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = { A: { dataReady: true, versionComparable: true, versionName: '1.0.0' }, B: { dataReady: true, versionComparable: true, versionName: '1.0.0' } }; state.releases = { A: { tag: 'v2.0.0', stale: false }, B: { tag: 'v2.0.0', stale: false } }; api = mockApi; runBulkInstall = recordUpdate; checkRelease = () => { throw new Error('Do not recheck releases'); }", context);
  await vm.runInContext("openBulkDialog('update')", context);
  assert.deepEqual(started, ['A', 'B']);
});

test('Bulk install opens immediately from remembered paths without rescanning the headset or library', async () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(shell, /scanGameFolderButton|libraryScanButton|libraryChangeButton|bulkDropZone|bulkFileInput|Folder to scan/);
  const { context, elements, requests } = appHarness();
  const mario = getCatalog().find((entry) => entry.id === 'sm64-vr');
  context.mario = mario;
  context.mockApi = async (url) => { requests.push({ url }); return new Promise(() => {}); };
  vm.runInContext(`state.games = [mario]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {};
    state.savedPaths[mario.id] = { rom: 'C:/Owned/Mario.z64' };
    state.pathAvailability[mario.id] = { rom: true };
    state.inputs[mario.id] = { rom: 'C:/Owned/Mario.z64' };
    state.staged[mario.id] = { rom: 'C:/Owned/Mario.z64' }; api = mockApi`, context);
  let opened = false;
  elements.get('#bulkDialog').showModal = () => { opened = true; };
  const completed = await Promise.race([vm.runInContext("openBulkDialog('new')", context).then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 80))]);
  assert.equal(completed, true, 'opening the dialog must not wait for headset or saved-file validation');
  assert.equal(opened, true);
  assert.equal(requests.length, 0);
  assert.match(elements.get('#bulkMatches').innerHTML, /value="sm64-vr"/);
  assert.match(elements.get('#savedLibraryFiles').innerHTML, /Forget/);
  assert.equal(vm.runInContext('cardStatus(mario)', context), 'status-staged');
  assert.equal(vm.runInContext("state.libraryScope = 'available'; matchesScope(mario)", context), true);
});

test('forgetting a Bulk install choice updates the list without running the slow saved-file scan', async () => {
  const { context, elements, listeners, requests } = appHarness();
  context.mario = getCatalog().find((game) => game.id === 'sm64-vr');
  context.mockApi = async (url) => { requests.push({ url }); return { removed: true }; };
  vm.runInContext(`state.games = [mario]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {};
    state.savedPaths[mario.id] = { rom: 'C:/Owned/Mario.z64' };
    state.pathAvailability[mario.id] = { rom: true };
    state.inputs[mario.id] = { rom: 'C:/Owned/Mario.z64' };
    state.staged[mario.id] = { rom: 'C:/Owned/Mario.z64' }; api = mockApi`, context);
  await vm.runInContext("openBulkDialog('new')", context);
  await listeners.get('#savedLibraryFiles:click')({ target: { closest: () => ({ dataset: { id: 'sm64-vr:rom' } }) } });
  assert.deepEqual(requests.map((entry) => entry.url), ['/api/library/remove']);
  assert.doesNotMatch(elements.get('#savedLibraryFiles').innerHTML, /Mario\.z64/);
  assert.equal(vm.runInContext("state.savedPaths['sm64-vr'].rom", context), undefined);
});

test('Bulk install can build a game with its saved inputs, including RDR', async () => {
  const { context, elements } = appHarness();
  const rdr = getCatalog().find((entry) => entry.id === 'rdr1-vr');
  context.rdr = rdr;
  const requests = [];
  context.mockApi = async (url, options) => {
    if (url.startsWith('/api/device-library')) return { games: {} };
    if (url === '/api/personal-build') { requests.push(JSON.parse(options.body)); return { job: { id: 'rdr-build', gameId: rdr.id, status: 'success', log: [] } }; }
    if (url === '/api/catalog') return { installed: {} };
    throw new Error(`Unexpected ${url}`);
  };
  vm.runInContext("state.games = [rdr]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {}; state.bulkMode = 'new'; state.bulkMatches = [{ gameId: rdr.id, buildInputs: { gamePackage: 'C:\\\\Owned\\\\RDR', audioSource: 'C:\\\\Owned\\\\RDR-data' }, files: {} }]; api = mockApi; refreshDeviceLibrary = async () => {}; toast = () => {}", context);
  assert.equal(vm.runInContext('bulkCandidate(state.bulkMatches[0]).reason', context), '');
  await vm.runInContext("runBulkInstall(['rdr1-vr'])", context);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].gameId, 'rdr1-vr');
  assert.equal(requests[0].serial, 'QUEST');
  assert.match(requests[0].gamePackage, /RDR$/);
  assert.match(elements.get('#bulkProgress').textContent, /1 of 1 selected games installed/);
});

test('a complete saved personal build is marked Install available before headset installation', () => {
  const { context } = appHarness();
  const rdr = getCatalog().find((entry) => entry.id === 'rdr1-vr');
  context.rdr = rdr;
  vm.runInContext("state.games = [rdr]; state.selectedSerial = 'QUEST'; state.deviceLibrary.QUEST = {}; state.inputs[rdr.id] = { gamePackage: 'C:\\\\Owned\\\\RDR', audioSource: 'C:\\\\Owned\\\\RDR-data' }; state.savedPaths[rdr.id] = { ...state.inputs[rdr.id] }; state.pathAvailability[rdr.id] = { gamePackage: true, audioSource: true }", context);
  assert.equal(vm.runInContext('cardStatus(rdr)', context), 'status-staged');
  assert.match(vm.runInContext('releaseLabel(rdr)', context), /INSTALL AVAILABLE/);
  assert.equal(vm.runInContext("state.libraryScope = 'available'; matchesScope(rdr)", context), true);
  vm.runInContext("state.pathAvailability[rdr.id].gamePackage = false", context);
  assert.notEqual(vm.runInContext('cardStatus(rdr)', context), 'status-staged');
});
