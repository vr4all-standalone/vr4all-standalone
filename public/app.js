const $ = (selector) => document.querySelector(selector);
const state = { games: [], sources: {}, installed: {}, deviceLibrary: {}, devices: [], selectedSerial: '', selectedId: '', portChoices: {}, detailLayout: 'docked', theme: 'graphite', palette: 'blue', browseMode: 'console', libraryScope: 'all', sortMode: 'name-asc', installedFirst: false, category: 'All games', search: '', releases: {}, discovery: {}, releaseErrors: {}, inputs: {}, savedPaths: {}, pathAvailability: {}, fileChecks: {}, apkChecks: {}, staged: {}, bulkApks: {}, bulkMatches: [], bulkMode: 'new', managedFiles: [], bulkSessionId: '', bulkUploading: false, bulkUpdatePreparing: false, jobFiles: {}, jobApks: {}, mode: {}, jobs: [], activeJobId: null, installSubmitting: false, bulkRunning: false, updateChecking: false, settings: { adbPath: '', sources: {}, theme: 'graphite', palette: 'blue' } };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.method === 'POST' ? { 'x-questdesk-token': window.QUESTDESK_TOKEN } : {}), ...(options.headers || {}) } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

let toastTimer;
function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

const activities = new Map();
let sdkSetupJobId = '';
let sdkSetupSubmitting = false;
const phoneExportDataEdits = new Map();
let sdkLicenseSubmitting = false;
let phoneExportGameId = '';
let phoneExportJobId = '';
let phoneExportSubmitting = false;
let phoneExportCheckEpoch = 0;
let phoneExportCheckTask = null;
let phoneExportReadiness = null;
let activitySequence = 0;
function renderActivity() {
  const status = $('#updateStatus');
  const current = [...activities.values()].sort((left, right) =>
    Number(right.active) - Number(left.active) || right.priority - left.priority || right.sequence - left.sequence)[0];
  status.hidden = !current;
  status.textContent = current?.message || '';
  status.classList.toggle('checking', Boolean(current?.active));
  status.classList.toggle('error', Boolean(current?.error));
}
function setActivity(key, message, active = true, error = false) {
  const previous = activities.get(key);
  if (previous?.timer) clearTimeout(previous.timer);
  if (!message) activities.delete(key);
  else {
    const queuedJob = key.startsWith('job:') && state.jobs.find((job) => job.id === key.slice(4))?.status === 'queued';
    const priority = key.startsWith('job:') ? queuedJob ? 2 : 4 : key.startsWith('bulk') ? 3 : key === 'updates' ? 2 : 1;
    const entry = { message, active, error, priority, sequence: ++activitySequence, timer: null };
    if (!active) entry.timer = setTimeout(() => {
      if (activities.get(key) === entry) { activities.delete(key); renderActivity(); }
    }, 8000);
    activities.set(key, entry);
  }
  renderActivity();
}

function sourceFor(game) { return state.sources[game.id] || game.source; }
function acceptedGameExtensions(item) {
  const extensions = item.extensions || [];
  return item.kind === 'file' && extensions.length
    ? [...new Set([...extensions, '.zip', '.7z', '.rar'])] : extensions;
}
function selectedGame() { return state.games.find((game) => game.id === state.selectedId); }
function applyDetailLayout() {
  document.body.dataset.detailLayout = state.detailLayout;
  document.body.dataset.detailOpen = $('#detailPanel').hidden ? 'false' : 'true';
}
function applyTheme(theme) {
  const selected = theme === 'classic' ? 'graphite' : theme === 'console' ? 'y2k' : theme;
  state.theme = ['graphite', 'y2k', 'frost'].includes(selected) ? selected : 'graphite';
  document.body.dataset.theme = state.theme;
  const input = $('#themeInput');
  if (input) input.value = state.theme;
  for (const option of document.querySelectorAll('[data-theme-choice]')) {
    option.setAttribute('aria-pressed', String(option.dataset.themeChoice === state.theme));
  }
  updateAppearanceSummary();
}
function applyPalette(palette) {
  state.palette = ['blue', 'mint', 'iris', 'rose', 'amber', 'silver'].includes(palette) ? palette : 'blue';
  document.body.dataset.palette = state.palette;
  const input = $('#paletteInput');
  if (input) input.value = state.palette;
  for (const option of document.querySelectorAll('[data-palette-choice]')) {
    option.setAttribute('aria-pressed', String(option.dataset.paletteChoice === state.palette));
  }
  updateAppearanceSummary();
}
function updateAppearanceSummary() {
  const summary = $('#appearanceSummary');
  const themes = { y2k: 'Glass', graphite: 'Graphite', frost: 'Frost' };
  const palettes = { blue: 'Glacier', mint: 'Mint', iris: 'Iris', rose: 'Rose', amber: 'Amber', silver: 'Silver' };
  if (summary) summary.textContent = `${themes[state.theme]} · ${palettes[state.palette] || 'Glacier'}`;
}
function parentId(game) { return game.variantOf || game.id; }
function portFamily(game) { return state.games.filter((entry) => parentId(entry) === parentId(game)); }
function libraryGames() { return state.games.filter((game) => !game.variantOf); }
function cardProfile(game) {
  const family = portFamily(game);
  const saved = family.find((entry) => entry.id === state.portChoices[game.id]);
  const preferred = family.find((entry) => entry.id === game.defaultPortId) || game;
  if (state.libraryScope === 'available') {
    const available = saved && isAvailableForInstall(saved) ? saved
      : isAvailableForInstall(preferred) ? preferred : family.find(isAvailableForInstall);
    if (available) return available;
  }
  if (saved) return saved;
  if (game.preferDefaultPort) return preferred;
  return family.find((entry) => state.deviceLibrary[state.selectedSerial]?.[entry.id]) || preferred;
}
function cardPresentation(game) {
  const selected = cardProfile(game);
  const installed = [selected, ...portFamily(game).filter((entry) => entry.id !== selected.id)]
    .filter((entry) => state.deviceLibrary[state.selectedSerial]?.[entry.id]);
  if (!installed.length) return { profile: selected, status: cardStatus(selected) };
  const priority = { 'status-update': 4, 'status-current': 3, 'status-ready-unverified': 2, 'status-incomplete': 1, 'status-installed': 0 };
  return installed.map((profile) => ({ profile, status: headsetDisplayStatus(profile) }))
    .reduce((best, candidate) => priority[candidate.status] > priority[best.status] ? candidate : best);
}
function portChoiceHtml(game) {
  const family = portFamily(game);
  if (family.length < 2) return '';
  return `<div class="port-picker"><div class="port-picker-label">Choose the developer’s port</div><div class="port-picker-options">${family.map((entry) => `<button type="button" class="port-choice ${entry.id === game.id ? 'active' : ''}" data-port-id="${escapeHtml(entry.id)}" aria-pressed="${entry.id === game.id}"><strong>${escapeHtml(entry.portLabel || entry.series)}</strong><small>${state.deviceLibrary[state.selectedSerial]?.[entry.id] ? 'Installed on this headset' : 'Separate Quest app'}</small></button>`).join('')}</div><p class="field-help">Each port has its own APK, game-file rules and update status. Choose one to see its setup.</p></div>`;
}
function localPathAvailable(game, key) {
  const value = state.inputs[game.id]?.[key];
  return Boolean(value) && (state.savedPaths[game.id]?.[key] !== value || state.pathAvailability[game.id]?.[key] !== false);
}
async function saveLocalPath(game, key, localPath) {
  if (!game) return;
  const result = await api('/api/local-paths', { method: 'POST', body: JSON.stringify({ gameId: game.id, key, path: localPath }) });
  const linked = result.linked?.length ? result.linked : [{ gameId: game.id, key, path: result.path, available: result.available }];
  for (const entry of linked) {
    state.savedPaths[entry.gameId] ||= {};
    state.pathAvailability[entry.gameId] ||= {};
    state.inputs[entry.gameId] ||= {};
    state.staged[entry.gameId] ||= {};
    if (entry.path) state.savedPaths[entry.gameId][entry.key] = entry.path;
    else delete state.savedPaths[entry.gameId][entry.key];
    state.pathAvailability[entry.gameId][entry.key] = entry.available;
    if (entry.gameId !== game.id || state.inputs[entry.gameId][entry.key] === localPath) state.inputs[entry.gameId][entry.key] = entry.path;
    if (!entry.path) delete state.staged[entry.gameId][entry.key];
    else if (entry.gameId !== game.id && entry.available) {
      state.staged[entry.gameId][entry.key] = entry.path;
      state.fileChecks[entry.gameId] ||= {};
      state.fileChecks[entry.gameId][entry.key] = 'Shared game file found on PC · checked again before install';
    }
  }
  renderGrid();
  updateInstallEnabled();
  return result.path;
}
function persistLocalPath(game, key, localPath) {
  saveLocalPath(game, key, localPath).catch((error) => toast(`Could not remember this path: ${error.message}`, true));
}
function stagedGameFileReady(game, item) {
  const values = state.inputs[game.id] || {};
  const staged = state.staged[game.id] || {};
  return Boolean(values[item.id]) && staged[item.id] === values[item.id] && localPathAvailable(game, item.id);
}
function hasRequiredLocalGameFiles(game) {
  return game.data.filter((item) => !item.optional).every((item) => stagedGameFileReady(game, item))
    && (!game.requireOneOf?.length || game.requireOneOf.some((id) => game.data.some((item) => item.id === id && stagedGameFileReady(game, item))));
}
function hasPendingGameFiles(game) {
  const onHeadset = state.deviceLibrary[state.selectedSerial]?.[game.id];
  if (onHeadset?.dataReady) return false;
  return hasRequiredLocalGameFiles(game) && game.data.some((item) => stagedGameFileReady(game, item));
}
function hasLocalInstallFile(game) {
  if (game.personalBuild) return false;
  const localApk = state.bulkApks[game.id] || (state.pathAvailability[game.id]?.apkPath ? state.savedPaths[game.id]?.apkPath : '');
  const onHeadset = state.deviceLibrary[state.selectedSerial]?.[game.id];
  if (!onHeadset?.dataReady && !hasRequiredLocalGameFiles(game)) return false;
  if ((!sourceFor(game) && !game.playerInstall || game.localPlayerInstall === 'sclerosis' || game.manualRelease && !game.playerInstall) && !localApk) return false;
  const apkVersion = parsedVersion(localApk?.split(/[\\/]/).at(-1));
  const release = state.releases[game.id];
  const matchedRelease = release && !release.stale && release.verifiedSerial === state.selectedSerial && release.installedApkMatchesRelease === true;
  const installedVersion = parsedVersion(matchedRelease ? release.tag : onHeadset?.versionName);
  const apkPending = Boolean(localApk) && (!onHeadset || Boolean(apkVersion && installedVersion && compareVersionParts(apkVersion, installedVersion) > 0));
  return apkPending || hasPendingGameFiles(game);
}
function parsedVersion(value) {
  const matches = [...String(value || '').matchAll(/(?:^|[^\d])v?(\d+(?:\.\d+){1,3})(-[a-z][a-z\d.-]*)?/gi)];
  const match = matches.at(-1);
  return match ? { parts: match[1].split('.').map(Number), suffix: (match[2] || '').toLowerCase() } : null;
}
function compareVersionParts(left, right) {
  for (let i = 0; i < Math.max(left.parts.length, right.parts.length); i++) {
    const difference = (left.parts[i] || 0) - (right.parts[i] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
function versionStatus(game) {
  const device = state.deviceLibrary[state.selectedSerial]?.[game.id];
  const release = state.releases[game.id];
  if (!device) return '';
  if (!device.dataReady) return game.reuseInstalledData ? 'status-installed' : 'status-incomplete';
  if (game.localPlayerInstall === 'sclerosis') return 'status-current';
  if (game.id === 'fzero-x-virtuavr' && device.packageId === 'dev.gdiffuser.quest') return 'status-current';
  if (release && !release.stale && release.verifiedSerial === state.selectedSerial && release.installedApkMatchesRelease === true) return 'status-current';
  const completed = state.installed?.[state.selectedSerial]?.[game.id];
  if (game.releaseKind === 'installer' && release && !release.stale && completed?.tag === release.tag
    && completed.packageId === device.packageId && completed.versionName && completed.versionName === device.versionName) return 'status-current';
  if (game.verifyApkHash) {
    if (!release || release.stale || release.verifiedSerial !== state.selectedSerial) return 'status-installed';
    if (release.installedApkMatchesRelease === true) return 'status-current';
    return release.installedApkMatchesRelease === false ? 'status-update' : 'status-installed';
  }
  if (game.manualRelease || !device.versionComparable || !release || release.stale || !device.versionName) return 'status-installed';
  const installed = parsedVersion(device.versionName);
  const latest = parsedVersion(release.tag);
  if (!installed || !latest) return 'status-installed';
  const compared = compareVersionParts(installed, latest);
  if (compared < 0) return 'status-update';
  if (compared > 0) return 'status-installed';
  return installed.suffix === latest.suffix || game.id === 'halo-ce' && installed.suffix.startsWith('-test') && !latest.suffix || game.id === 'xrkart-64' && installed.suffix === '-on-device-extraction' && !latest.suffix ? 'status-current' : 'status-installed';
}
function statusExplanation(game) {
  const device = state.deviceLibrary[state.selectedSerial]?.[game.id];
  if (!device) return state.selectedSerial ? 'This port APK was not found on the selected headset.' : 'Connect and scan a Quest to check this game.';
  if (!device.dataReady) return game.id === 'beef-raider-xr' ? 'Beef Raider XR demo is installed. Extract your owned Tomb Raider files with the author’s tool, then transfer its mod folder for the full game.' : game.id === 'halo-ce' ? 'OpenCE is installed, but no complete imported Halo game version is selected. Add your owned Xbox disc image, then import it under Game files & versions in the headset.' : game.reuseInstalledData ? 'Port APK found. This port imports its ROM privately, so VR4ALL cannot check the ROM over USB.' : 'Port APK found, but the required game files were not found at the expected location on the headset.';
  const status = versionStatus(game);
  if (game.localPlayerInstall === 'sclerosis' && status === 'status-current') return 'Sclerosis APK and required Amnesia game folders found on this Quest. Creator APK updates require a manual download.';
  if (game.id === 'fzero-x-virtuavr' && status === 'status-current') return 'Quest APK and all three prepared F-Zero files found. Ready to play; creator releases are downloaded manually.';
  if (status === 'status-current') return 'Port APK and game files found; the installed build matches the latest checked GitHub release.';
  if (status === 'status-update') return 'Port APK and game files found; a newer checked Quest APK is available.';
  if (game.personalBuild) return 'Quest package found and required data checks passed. Ready to play; VR4ALL cannot confirm this build against the author’s latest source.';
  const release = state.releases[game.id];
  if (!sourceFor(game)) return 'Port APK and game files found. No release source is configured, so VR4ALL cannot confirm the version.';
  if (game.manualRelease) return 'Port APK and game files found. The official release is an installer ZIP, so VR4ALL cannot compare its APK automatically.';
  if (state.releaseErrors[game.id]) return `Port APK and game files found. Release check failed: ${state.releaseErrors[game.id]}`;
  if (!release) return 'Port APK and game files found. GitHub release has not been checked yet.';
  if (release.stale) return release.installedApkMatchesRelease === true
    ? 'The installed APK matches the last cached official release, but GitHub could not be refreshed to confirm it is still latest.'
    : 'Port APK and game files found. GitHub could not be refreshed; the cached release may be old.';
  if (game.verifyApkHash) return 'Port APK and game files found. The installed APK could not be matched to the release checksum.';
  if (!device.versionComparable) return 'Port APK and game files found. The headset and release use different version formats, so the build cannot be compared.';
  return 'Port APK and game files found. The installed version could not be matched to the GitHub release.';
}
function headsetDisplayStatus(game) {
  const status = versionStatus(game);
  return status === 'status-installed' && state.deviceLibrary[state.selectedSerial]?.[game.id]?.dataReady
    ? 'status-ready-unverified' : status;
}
function hasBuildInputs(game) {
  return localPathAvailable(game, 'gamePackage')
    && (!game.personalBuild.audioLabel || game.personalBuild.audioOptional || localPathAvailable(game, 'audioSource'));
}
function cardStatus(game) {
  if (game.personalBuild && !state.deviceLibrary[state.selectedSerial]?.[game.id] && hasBuildInputs(game)) return 'status-staged';
  return hasLocalInstallFile(game) ? 'status-staged' : headsetDisplayStatus(game);
}
function githubDownloads(game) {
  const totals = portFamily(game).map((entry) => state.releases[entry.id]?.totalDownloads ?? state.discovery[entry.id]?.totalDownloads);
  return totals.some((count) => Number.isSafeInteger(count) && count >= 0)
    ? totals.reduce((sum, count) => sum + (Number.isSafeInteger(count) && count >= 0 ? count : 0), 0) : null;
}
function installType(game) {
  if (game.personalBuild) return 'build';
  if (game.playerInstall) return 'special';
  if (!game.source) return 'manual-apk';
  if (game.manualDataSetup) return 'guided';
  return game.data.length ? 'apk-files' : 'apk-included';
}
function isAvailableForInstall(game) {
  if (state.deviceLibrary[state.selectedSerial]?.[game.id]) return false;
  if (game.personalBuild) return hasBuildInputs(game);
  if (game.externalInstaller || game.manualDataSetup) return false;
  return installType(game) === 'apk-included' && !game.manualRelease || hasLocalInstallFile(game);
}
function matchesScope(game) {
  if (state.libraryScope === 'all') return true;
  if (state.libraryScope === 'available') return portFamily(game).some(isAvailableForInstall);
  if (state.libraryScope === 'new') return libraryGames().slice(-10).some((entry) => entry.id === game.id);
  if (['apk-files', 'apk-included', 'build', 'special', 'manual-apk', 'guided'].includes(state.libraryScope)) {
    return portFamily(game).some((entry) => installType(entry) === state.libraryScope);
  }
  if (!state.selectedSerial || !(state.selectedSerial in state.deviceLibrary)) return false;
  const installed = portFamily(game).some((entry) => Boolean(state.deviceLibrary[state.selectedSerial]?.[entry.id]));
  if (state.libraryScope === 'installed') return installed;
  if (state.libraryScope === 'updates') return portFamily(game).some((entry) => versionStatus(entry) === 'status-update');
  return false;
}
function renderLibraryScopeOptions() {
  const headset = state.devices.find((device) => device.serial === state.selectedSerial && device.state === 'device');
  if (!headset && ['installed', 'updates'].includes(state.libraryScope)) state.libraryScope = 'all';
  const select = $('#libraryScope');
  select.innerHTML = '<option value="all">All games</option><option value="available">Available to install</option><option value="new">New games</option>'
    + '<optgroup label="Install type"><option value="apk-files">APK + game files</option><option value="apk-included">APK includes game files</option><option value="build">Build or patch</option><option value="special">Special installer</option><option value="manual-apk">Manual APK download</option><option value="guided">Guided game-data setup</option></optgroup>'
    + (headset ? `<optgroup label="${escapeHtml(headset.model || 'Headset')}"><option value="installed">Installed games</option><option value="updates">Update available</option></optgroup>` : '');
  select.value = state.libraryScope;
}
function releaseLabel(game, status = cardStatus(game)) {
  const source = sourceFor(game);
  const onHeadset = Boolean(state.deviceLibrary[state.selectedSerial]?.[game.id]);
  if (status === 'status-staged') return '<span class="status-pill staged">INSTALL AVAILABLE</span>';
  if (status === 'status-incomplete') return `<span class="status-pill incomplete">${game.reuseInstalledData ? 'ROM UNVERIFIED' : 'GAME FILES MISSING'}</span>`;
  if (status === 'status-installed' && onHeadset && game.reuseInstalledData && !state.deviceLibrary[state.selectedSerial]?.[game.id]?.dataReady) return '<span class="status-pill installed">ROM UNVERIFIED</span>';
  if (game.personalBuild) {
    if (status === 'status-current') return '<span class="status-pill current">READY</span>';
    if (status === 'status-ready-unverified') return '<span class="status-pill ready-unverified">READY · BUILD UNVERIFIED</span>';
    if (onHeadset) return '<span class="status-pill installed">BUILD UNVERIFIED</span>';
    const ready = localPathAvailable(game, 'gamePackage') && (!game.personalBuild.audioLabel || game.personalBuild.audioOptional || localPathAvailable(game, 'audioSource'));
    const missing = ['gamePackage', 'audioSource'].some((key) => state.savedPaths[game.id]?.[key] && state.pathAvailability[game.id]?.[key] === false);
    return `<span class="status-pill ${ready ? 'update' : 'local'}">${ready ? 'BUILD INPUTS READY' : missing ? 'CHECK SAVED FILE' : 'BUILD FROM GAME'}</span>`;
  }
  if (status === 'status-ready-unverified') return '<span class="status-pill ready-unverified">READY · VERSION UNVERIFIED</span>';
  if (status === 'status-current') return '<span class="status-pill current">READY</span>';
  if (game.manualRelease) return `<span class="status-pill local">${onHeadset ? 'INSTALLED · ' : ''}GITHUB ZIP</span>`;
  if (!source) return `<span class="status-pill ${onHeadset ? 'installed' : 'local'}">${onHeadset ? 'VERSION UNVERIFIED' : game.manualBuild ? 'BUILD / PATCH GUIDE' : game.externalInstaller ? 'SETUP GUIDE' : game.projectUrl ? 'CREATOR DOWNLOAD' : 'LOCAL APK'}</span>`;
  const release = state.releases[game.id];
  if (status === 'status-update') return '<span class="status-pill update">UPDATE READY</span>';
  if (onHeadset && release?.stale && release.installedApkMatchesRelease === true) return '<span class="status-pill installed">CACHED BUILD MATCH</span>';
  if (onHeadset) return '<span class="status-pill installed">VERSION UNVERIFIED</span>';
  if (state.releaseErrors[game.id]) return '<span class="status-pill local">CHECK FAILED</span>';
  if (release?.stale) return '<span class="status-pill local">CACHED RELEASE</span>';
  if (installType(game) === 'apk-included') return '<span class="status-pill staged">INSTALL AVAILABLE</span>';
  return `<span class="status-pill">${release ? 'GITHUB RELEASE' : 'GITHUB LINKED'}</span>`;
}

function renderCategories() {
  const facet = state.browseMode;
  const scoped = libraryGames().filter(matchesScope);
  const order = facet === 'console' ? ['Arcade', 'Game Boy', 'Nintendo 64', 'GameCube', 'Wii', 'Dreamcast', 'Xbox', 'PlayStation', 'PC', 'Android', 'Other'] : ['Rail shooter', 'Racing', 'Adventure', 'Shooter', 'Space combat', 'Strategy', 'Platformer', 'Fighting', 'Sports', 'Stealth', 'Other'];
  const values = [...new Set(libraryGames().map((game) => game[facet] || 'Other'))];
  const categories = ['All games', ...values.sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b))];
  const icons = { 'All games': '▦', Arcade: '◎', 'Game Boy': '◈', 'Nintendo 64': '✦', GameCube: '◇', Wii: '◌', Dreamcast: '✳', Xbox: '⬢', PlayStation: '◈', PC: '▤', Android: '◈', 'Rail shooter': '⊕', Racing: '↗', Adventure: '◆', Shooter: '◎', 'Space combat': '✦', Strategy: '◆', Platformer: '★', Fighting: '✦', Sports: '⬡', Stealth: '◢', Other: '◌' };
  $('#categoryNav').innerHTML = categories.map((name) => `<button class="nav-item ${state.category === name ? 'active' : ''}" data-category="${escapeHtml(name)}"><span class="nav-icon">${icons[name] || '◌'}</span>${escapeHtml(name)}<span class="nav-count">${name === 'All games' ? scoped.length : scoped.filter((game) => (game[facet] || 'Other') === name).length}</span></button>`).join('');
  $('#crumbCategory').textContent = `${facet === 'console' ? 'Console' : 'Genre'} / ${state.category}`;
  $('#browseConsole').classList.toggle('active', facet === 'console');
  $('#browseGenre').classList.toggle('active', facet === 'genre');
  $('#browseConsole').setAttribute('aria-pressed', String(facet === 'console'));
  $('#browseGenre').setAttribute('aria-pressed', String(facet === 'genre'));
}

function renderGrid() {
  const query = state.search.toLowerCase().trim();
  const games = libraryGames().filter((game) => matchesScope(game) && (state.category === 'All games' || (game[state.browseMode] || 'Other') === state.category) && (!query || `${game.title} ${game.gameName || ''} ${portFamily(game).map((entry) => entry.portLabel || entry.series).join(' ')} ${game.console} ${game.genre} ${game.description}`.toLowerCase().includes(query)));
  const byName = (a, b) => (a.gameName || a.title).localeCompare(b.gameName || b.title, undefined, { numeric: true }) || a.title.localeCompare(b.title);
  const latestTime = (game) => Math.max(0, ...portFamily(game).map((entry) => {
    const release = state.releases[entry.id];
    return release && !release.stale ? Date.parse(release.publishedAt || '') || 0 : 0;
  }));
  const onHeadset = (game) => portFamily(game).some((entry) => Boolean(state.deviceLibrary[state.selectedSerial]?.[entry.id]));
  const hasHeadsetLibrary = Boolean(state.selectedSerial && state.selectedSerial in state.deviceLibrary);
  const installedToggle = $('#installedFirst');
  installedToggle.checked = state.installedFirst;
  installedToggle.disabled = !hasHeadsetLibrary;
  const compareSort = (a, b) => state.sortMode === 'name-desc' ? -byName(a, b)
    : state.sortMode === 'latest' ? latestTime(b) - latestTime(a) || byName(a, b)
      : state.sortMode === 'downloads' ? (githubDownloads(b) ?? -1) - (githubDownloads(a) ?? -1) || byName(a, b)
        : byName(a, b);
  games.sort((a, b) => state.installedFirst && hasHeadsetLibrary ? Number(onHeadset(b)) - Number(onHeadset(a)) || compareSort(a, b) : compareSort(a, b));
  $('#gameCount').textContent = `${games.length} game${games.length === 1 ? '' : 's'}`;
  const scopeNote = $('#libraryScopeNote');
  scopeNote.textContent = [state.libraryScope === 'available' ? 'Ready from saved game files or a Quest APK with game files included.' : state.libraryScope === 'new' ? 'The 10 most recently added games in VR4ALL.' : '', state.sortMode === 'downloads' ? 'Quest release download counts. Check updates to refresh.' : ''].filter(Boolean).join(' ');
  scopeNote.hidden = !scopeNote.textContent;
  $('#emptyState').hidden = games.length > 0;
  $('#emptyState').textContent = !state.selectedSerial && ['installed', 'updates'].includes(state.libraryScope) ? 'Connect a Quest and scan it to use this view.' : state.libraryScope === 'updates' ? 'No confirmed APK updates in this view. Use Check updates to refresh GitHub.' : state.libraryScope === 'available' ? 'No new games have complete install inputs yet. Add files to a game card.' : 'No games match this view.';
  $('#gameGrid').innerHTML = games.map((game) => {
    const profile = cardProfile(game);
    const presentation = cardPresentation(game);
    const requiredFiles = profile.data.filter((item) => !item.optional).length;
    const contents = profile.manualBuild ? 'Build or patch required' : profile.externalInstaller ? 'Guided setup' : requiredFiles ? `${requiredFiles} game file${requiredFiles === 1 ? '' : 's'}` : 'APK install';
    const variants = portFamily(game).length > 1 ? ` · ${portFamily(game).length} ports` : '';
    const count = state.sortMode === 'downloads' ? githubDownloads(game) : null;
    const downloads = count === null ? '' : `<div class="card-downloads">${count.toLocaleString()} GitHub downloads</div>`;
    return `<button class="game-card ${presentation.status}" data-id="${escapeHtml(game.id)}" title="${escapeHtml(statusExplanation(presentation.profile))}" style="--accent:${escapeHtml(game.color || '#aaa6ff')}"><div class="card-art"><img src="${escapeHtml(game.art || '/art/custom.svg')}" alt="Artwork for ${escapeHtml(game.title)}" loading="lazy"><span class="card-tag">${escapeHtml(game[state.browseMode] || 'Other')}</span></div><div class="card-info"><div class="card-series">${escapeHtml(game.console || 'Other')} · ${escapeHtml(game.genre || 'Other')}</div><div class="card-title-row"><span class="card-title">${escapeHtml(game.gameName || game.title)}</span><span class="card-arrow">↗</span></div>${downloads}<div class="card-bottom"><span>${contents}${variants}</span>${releaseLabel(presentation.profile, presentation.status)}</div></div></button>`;
  }).join('');
  updateBulkUpdateButton();
}

function confirmedBulkUpdates() {
  if (!state.selectedSerial || !(state.selectedSerial in state.deviceLibrary)) return [];
  return state.games.filter((game) => state.deviceLibrary[state.selectedSerial]?.[game.id]
    && sourceFor(game) && !state.releaseErrors[game.id] && !game.manualRelease && !game.personalBuild && !game.playerInstall && !game.externalInstaller
    && versionStatus(game) === 'status-update');
}
function updateBulkUpdateButton() {
  const button = $('#bulkUpdateButton');
  if (!button) return;
  const installButton = $('#bulkInstallNewButton');
  if (installButton) installButton.disabled = state.bulkRunning || state.bulkUpdatePreparing || state.bulkUploading;
  const count = confirmedBulkUpdates().length;
  const hasHeadsetLibrary = Boolean(state.selectedSerial && state.selectedSerial in state.deviceLibrary);
  const panel = $('#bulkUpdatePanel');
  panel.hidden = !hasHeadsetLibrary || !(count || state.bulkRunning || state.bulkUpdatePreparing);
  if (panel.hidden) {
    $('#bulkUpdateStatus').hidden = true;
    $('#bulkUpdateStatusText').textContent = '';
  }
  button.disabled = !count || state.bulkRunning || state.bulkUpdatePreparing || state.updateChecking;
  button.innerHTML = `<span>↥</span> Update all installed games${count ? ` <b class="sidebar-count">${count}</b>` : ''}`;
  button.title = count ? `${count} confirmed APK update${count === 1 ? '' : 's'} ready` : 'Scan a headset and check releases to find confirmed APK updates';
}
function bulkUpdateProgress(message, active = true) {
  const box = $('#bulkUpdateStatus');
  if (!box) return;
  box.hidden = !message || $('#bulkUpdatePanel').hidden;
  box.classList.toggle('active', active);
  $('#bulkUpdateStatusText').textContent = box.hidden ? '' : message;
  setActivity('bulk-update', message, active, !active && /fail|error|stopped/i.test(message));
}

async function refreshDeviceLibrary(serial) {
  if (!serial) return;
  try {
    const result = await api(`/api/device-library?serial=${encodeURIComponent(serial)}`);
    state.deviceLibrary[serial] = result.games || {};
    renderCategories(); renderGrid();
    if (!state.bulkRunning) renderBulkMatches();
    renderExistingFilesNote();
    renderReadinessNote();
    for (const game of state.games.filter((item) => result.games?.[item.id]?.dataReady && sourceFor(item))) {
      if (serial !== state.selectedSerial) break;
      const error = await checkRelease(game);
      if (error && /rate limit|403/.test(error)) break;
    }
  } catch (error) { toast(`Could not read headset library: ${error.message}`, true); }
}

async function refreshDevices({ scanLibrary = true } = {}) {
  const result = await api('/api/devices');
  const previousSelected = state.selectedSerial;
  const wasReady = state.devices.some((device) => device.serial === previousSelected && device.state === 'device');
  state.devices = result.devices || [];
  const ready = state.devices.filter((device) => device.state === 'device');
  const waiting = state.devices.filter((device) => device.state !== 'device');
  if (!ready.some((device) => device.serial === state.selectedSerial)) state.selectedSerial = ready[0]?.serial || '';
  const select = $('#deviceSelect');
  select.innerHTML = ready.length
    ? [...ready.map((device) => `<option value="${escapeHtml(device.serial)}">${escapeHtml(device.model)} · ${escapeHtml(device.serial.slice(-6))}</option>`), ...waiting.map((device) => `<option disabled>${escapeHtml(device.model)} · ${escapeHtml(device.state)}</option>`)].join('')
    : `<option value="">${waiting.length ? 'USB approval needed' : 'No headset connected'}</option>${waiting.map((device) => `<option disabled>${escapeHtml(device.model)} · ${escapeHtml(device.state)}</option>`).join('')}`;
  select.value = state.selectedSerial;
  const banner = $('#deviceBanner');
  const hero = $('#heroDeviceStatus');
  const panel = $('.headsets-panel');
  panel.classList.toggle('connected', ready.length > 0);
  panel.classList.toggle('attention', ready.length === 0 && waiting.length > 0);
  $('#headsetCount').textContent = `${ready.length} ready${waiting.length ? ` · ${waiting.length} waiting` : ''}`;
  if (ready.length) {
    const selected = ready.find((device) => device.serial === state.selectedSerial);
    banner.className = 'device-banner good';
    banner.innerHTML = `<span class="banner-icon">✓</span><span><strong>${escapeHtml(selected.model)} connected.</strong> Install target: ${escapeHtml(selected.serial)}. ${ready.length > 1 ? 'Choose a headset in the left sidebar.' : 'Ready for USB installs.'}</span>`;
    hero.textContent = `${selected.model} connected`;
    $('#sidebarDeviceStatus').textContent = `${selected.model} selected for installs`;
    $('#topbarDeviceName').textContent = selected.model;
  } else if (state.devices.some((device) => device.state === 'unauthorized')) {
    banner.className = 'device-banner warn';
    banner.innerHTML = '<span class="banner-icon">!</span><span>Headset detected, but USB debugging is not authorized. Put it on, approve the computer, then refresh.</span>';
    hero.textContent = 'USB approval needed';
    $('#sidebarDeviceStatus').textContent = 'Approve USB debugging in headset';
    $('#topbarDeviceName').textContent = 'USB approval needed';
  } else if (waiting.length) {
    banner.className = 'device-banner warn';
    banner.innerHTML = `<span class="banner-icon">!</span><span>Headset detected but ${escapeHtml(waiting[0].state)}. Reconnect the USB cable, then refresh.</span>`;
    hero.textContent = 'Headset waiting for USB';
    $('#sidebarDeviceStatus').textContent = `${waiting[0].state} · reconnect USB`;
    $('#topbarDeviceName').textContent = 'Headset not ready';
  } else {
    banner.className = 'device-banner';
    banner.innerHTML = `<span class="banner-icon">◌</span><span>${escapeHtml(result.error || 'Connect a Quest with a USB data cable, enable Developer Mode, and approve USB debugging in the headset.')}${result.adbPath ? '' : ' Use Connection help to set the ADB path if needed.'}</span>`;
    hero.textContent = 'Waiting for USB headset';
    $('#sidebarDeviceStatus').textContent = result.error ? 'ADB unavailable · Connection help' : 'Connect a Quest with USB';
    $('#topbarDeviceName').textContent = 'No headset connected';
  }
  if (state.selectedSerial !== previousSelected || ready.length > 0 && !wasReady) {
    renderLibraryScopeOptions(); renderCategories(); renderGrid();
  }
  if (state.selectedId) updateInstallEnabled();
  if (state.selectedSerial && (scanLibrary || state.selectedSerial !== previousSelected || !wasReady)) refreshDeviceLibrary(state.selectedSerial);
}

function updateInstallEnabled() {
  const button = $('#installButton');
  if (button) button.disabled = state.installSubmitting || !state.selectedSerial || (state.selectedId === 'halo-ce' && !state.deviceLibrary[state.selectedSerial]?.['halo-ce']?.dataReady && !hasRequiredLocalGameFiles(selectedGame())) || state.jobs.some((job) => job.serial === state.selectedSerial && job.gameId === state.selectedId && ['queued', 'running'].includes(job.status));
  const buildButton = $('#personalBuildButton');
  if (buildButton) {
    const game = selectedGame();
    const values = state.inputs[game?.id] || {};
    buildButton.disabled = state.installSubmitting || !state.selectedSerial || !localPathAvailable(game, 'gamePackage') || game.personalBuild.audioLabel && !game.personalBuild.audioOptional && !localPathAvailable(game, 'audioSource') || state.jobs.some((job) => ['queued', 'running'].includes(job.status) && (job.serial === state.selectedSerial && job.gameId === game.id || job.kind === 'build-tools' && job.gameId === game.id));
  }
}

function renderExistingFilesNote() {
  const note = $('#existingFilesNote');
  const game = selectedGame();
  if (!note || !game) return;
  const installed = state.deviceLibrary[state.selectedSerial]?.[game.id];
  note.textContent = game.id === 'beef-raider-xr'
    ? installed?.dataReady ? 'Full-game data was found on this Quest. VR4ALL leaves it in place.' : 'The demo APK works without game data. For the full game, launch it once and grant permissions, then choose the official extractor’s mod folder.'
    : installed
    ? installed.dataReady
      ? 'Already installed with game files on this Quest. Leave the game file fields blank to update only the APK and keep the files on the headset.'
      : game.reuseInstalledData
        ? 'The port APK is installed, but its privately imported game data cannot be checked over USB. Confirm the game runs in the headset before updating without its ROM.'
        : 'The port APK is installed, but required game data was not found. Add your owned game file before installing.'
    : game.data.some((item) => item.kind === 'directory')
      ? 'For a first install, choose or drop the required game folder here. VR4ALL remembers its location for Bulk install.'
      : 'For a first install, provide the required game files. Drop a file onto its field or use Browse.';
  note.classList.toggle('reuse', Boolean(installed));
}

function renderReadinessNote() {
  const game = selectedGame();
  const detail = $('#detailBody');
  if (!game || !detail) return;
  detail.querySelector('.readiness-note')?.remove();
  const description = detail.querySelector('.detail-description');
  if (!description) return;
  const note = document.createElement('p');
  note.className = `readiness-note ${headsetDisplayStatus(game) || 'status-unscanned'}`;
  note.textContent = statusExplanation(game);
  description.after(note);
}

function rememberInputs() {
  const game = selectedGame();
  if (!game) return;
  const values = state.inputs[game.id] || {};
  const apk = $('#apkPath');
  if (apk) values.apkPath = apk.value;
  const buildGame = $('#buildGamePath');
  const buildAudio = $('#buildAudioPath');
  const jediGame = $('#jediGameSelect');
  if (buildGame) values.gamePackage = buildGame.value.trim();
  if (buildAudio) values.audioSource = buildAudio.value.trim();
  if (jediGame) values.jediGame = jediGame.value;
  for (const item of game.data) {
    const input = document.getElementById(`data-${item.id}`);
    if (input) values[item.id] = input.value;
  }
  state.inputs[game.id] = values;
}

function personalBuildHtml(game) {
  const values = state.inputs[game.id] || {};
  const build = game.personalBuild;
  const phoneExportCard = ['rdr1-vr', 'gta-sa-vr'].includes(game.id) ? `<div class="sdk-setup-card"><strong>Game installed on your Android phone?</strong><p class="field-help">${game.id === 'rdr1-vr' ? 'Check your Google Play or Netflix installation over USB before copying. Complete phone APKs need no extra source. If world, cutscene or audio packs are private, you need matching Additional RDR game data or existing root access. VR4ALL does not supply a data download, and another edition is not guaranteed to fix missing files.' : 'Export the complete Google Play game over USB, then VR4ALL selects the saved folder for you.'}</p><button id="exportPhoneButton" type="button" class="small-button">Export game from phone</button></div>` : '';
  const inputBlock = (target, label, hint, value) => `<div class="requirement build-requirement"><div class="requirement-top"><span class="requirement-name">${escapeHtml(label)}</span><span class="format-chip">${build.fileOnly && target === 'gamePackage' ? 'FILE' : 'FILE OR FOLDER'}</span></div><p class="field-help">${escapeHtml(hint)}</p>${target === 'audioSource' && build.audioDownloadUrl ? `<div class="build-pickers"><a class="small-button" href="${escapeHtml(build.audioDownloadUrl)}" target="_blank" rel="noopener noreferrer">Download required audio pack ↗</a></div><p class="field-help">Expected file: <code>${escapeHtml(build.audioFileName)}</code></p>` : ''}<input id="${target === 'gamePackage' ? 'buildGamePath' : 'buildAudioPath'}" class="text-input build-path-input" value="${escapeHtml(value || '')}" placeholder="Choose or drop your own ${escapeHtml(label.toLowerCase())}"><div class="build-pickers"><button type="button" class="small-button build-browse-btn" data-build-kind="file" data-build-target="${target}">Choose file</button>${build.fileOnly && target === 'gamePackage' ? '' : `<button type="button" class="small-button build-browse-btn" data-build-kind="directory" data-build-target="${target}">Choose folder</button>`}</div><div class="drop-zone build-drop-zone" data-build-target="${target}">Drop ${escapeHtml(label.toLowerCase())} here</div>${state.savedPaths[game.id]?.[target] && state.pathAvailability[game.id]?.[target] === false ? '<p class="file-check error">Saved path is missing or has the wrong format. Reconnect its drive or choose it again.</p>' : ''}</div>`;
  return `<div class="detail-art"><img src="${escapeHtml(game.art)}" alt="Artwork for ${escapeHtml(game.title)}"></div><div class="detail-series">${escapeHtml(game.console)} · ${escapeHtml(game.genre)} · ${escapeHtml(game.series)}</div><h2 class="detail-title">${escapeHtml(game.title)}</h2><p class="detail-description">${escapeHtml(game.description)}</p>${portChoiceHtml(game)}<div class="detail-divider"></div><div class="detail-step"><span class="step-number">1</span> ${escapeHtml(build.inputStep || 'Drop your original game export')}</div>${phoneExportCard}${inputBlock('gamePackage', build.gameLabel, build.gameHint, values.gamePackage)}${build.audioLabel ? `<div class="detail-step build-second-step"><span class="step-number">2</span> ${escapeHtml(build.audioStep || (game.id === 'fzero-x-virtuavr' ? 'Add the creator’s installer package' : 'Add the required audio pack'))}</div>${inputBlock('audioSource', build.audioLabel, build.audioHint, values.audioSource)}` : ''}<div class="guide-note">${escapeHtml(game.guidance)}</div><p class="field-help"><a href="${escapeHtml(game.projectUrl)}" target="_blank" rel="noopener noreferrer">${game.id === 'fzero-x-virtuavr' ? 'Download official Quest R10 package' : "Read the author's requirements"} ↗</a>${build.toolUrl ? ` · <a href="${escapeHtml(build.toolUrl)}" target="_blank" rel="noopener noreferrer">Official DeltaPatcher on GitHub ↗</a>` : ''}${build.decoderUrl ? ` · <a href="${escapeHtml(build.decoderUrl)}" target="_blank" rel="noopener noreferrer">xdelta3 decoder source ↗</a>` : ''}. ${escapeHtml(build.processDescription || 'VR4ALL downloads the author’s current source, validates your files through the official builder, and installs only to the selected Quest. First builds can download several GB of tools.')}</p>${game.releaseKind === 'patch' ? '<div id="releaseCard" class="release-card"></div>' : ''}<div class="detail-divider"></div><div class="detail-step"><span class="step-number">${build.audioLabel ? '3' : '2'}</span> ${escapeHtml(build.actionLabel || 'Build and install')} to your Quest</div><button type="button" id="personalBuildButton" class="primary-button install-button">${escapeHtml(build.actionLabel || 'Build and install')} <span>→</span></button>${game.afterInstall ? `<p class="after-note">${escapeHtml(game.afterInstall)}</p>` : ''}<div id="jobContainer"></div>`;
}

function detailHtml(game) {
  const source = sourceFor(game);
  const values = state.inputs[game.id] || {};
  const mode = !source ? 'local' : state.mode[game.id] || (!game.manualRelease || game.playerInstall ? 'github' : 'local');
  state.mode[game.id] = mode;
  if (game.personalBuild) {
    const html = personalBuildHtml(game);
    if (!['vice-city-vr', 'rdr1-vr', 'gta-sa-vr'].includes(game.id)) return html;
    const setup = '<div class="sdk-setup-card"><strong>Build tools</strong><p class="field-help">Vice City, RDR and San Andreas reuse tools from the same download folder. Setup checks what is already installed and downloads only missing versions.</p><button id="setupBuildToolsButton" type="button" class="small-button">Set up build tools</button></div>';
    return html.replace('<button type="button" id="personalBuildButton"', `${setup}<button type="button" id="personalBuildButton"`);
  }
  if (game.externalInstaller) return `<div class="detail-art"><img src="${escapeHtml(game.art || '/art/custom.svg')}" alt="Artwork for ${escapeHtml(game.title)}"></div><div class="detail-series">${escapeHtml(game.console)} · ${escapeHtml(game.genre)} · ${escapeHtml(game.series)}</div><h2 class="detail-title">${escapeHtml(game.title)}</h2><p class="detail-description">${escapeHtml(game.description)}</p><div class="detail-divider"></div><div class="guide-note">${escapeHtml(game.guidance)}</div><a class="primary-button install-button" href="${escapeHtml(game.projectUrl)}" target="_blank" rel="noopener noreferrer">Open official setup ↗</a>`;
  return `<div class="detail-art"><img src="${escapeHtml(game.art || '/art/custom.svg')}" alt="Artwork for ${escapeHtml(game.title)}"></div><div class="detail-series">${escapeHtml(game.console || 'Other')} · ${escapeHtml(game.genre || 'Other')} · ${escapeHtml(game.series)}</div><h2 class="detail-title">${escapeHtml(game.title)}</h2><p class="detail-description">${escapeHtml(game.description)}</p>${portChoiceHtml(game)}<div class="detail-divider"></div>
    <div class="detail-step"><span class="step-number">1</span> ${game.playerInstall ? 'Use the official player release' : 'Choose the port APK'}</div>
    ${game.playerInstall ? `<p class="guide-note">${game.playerInstall === 'beef-raider' ? 'VR4ALL installs the official Quest APK for the demo. For the full game, use the author’s extractor on your owned files, then VR4ALL transfers its output after you launch the app once.' : `VR4ALL downloads ${['road-rash', 'harry-potter'].includes(game.playerInstall) ? 'the official player installer ZIP' : game.playerInstall === 'jkxr' ? 'both official Quest APKs' : game.playerInstall === 'official-zip' ? 'the official Quest player ZIP' : 'the official Quest APK'} and prepares your owned game files.`}</p>` : game.manualRelease ? '<p class="guide-note">The official GitHub release is an installer ZIP, not a directly installable APK. Follow its installer instructions to prepare the game, then select a local APK here.</p>' : source ? `<div class="source-toggle"><button type="button" class="source-choice ${mode === 'github' ? 'active' : ''}" data-mode="github">Latest on GitHub</button><button type="button" class="source-choice ${mode === 'local' ? 'active' : ''}" data-mode="local">Local APK</button></div>` : `<div class="guide-note"><strong>Manual creator APK.</strong> This mod does not publish a verified Quest APK through a GitHub release that VR4ALL can auto-update. Download the APK from the creator, then drop it below. VR4ALL remembers its path for later installs.</div>`}
    <div id="releaseCard" class="release-card" ${mode === 'local' && !game.manualRelease ? 'hidden' : ''}></div>
    ${game.playerInstall ? '' : `<div id="localApkGroup" ${mode === 'github' ? 'hidden' : ''}><label class="field-label" for="apkPath">Quest APK or archive on your computer</label><div class="input-row"><input id="apkPath" class="text-input" value="${escapeHtml(values.apkPath || '')}" placeholder="C:\\Games\\Port.apk"><button type="button" class="small-button browse-btn" data-picker="file" data-target="apkPath">Browse</button></div><div class="drop-zone apk-drop-zone" data-apk="true">Drop APK, ZIP, 7z, or RAR for ${escapeHtml(game.title)} here</div><p id="apkCheck" class="file-check ${state.apkChecks[game.id]?.startsWith('Rejected:') ? 'error' : ''}">${escapeHtml(state.apkChecks[game.id] || '')}</p>${game.projectUrl ? `<p class="field-help"><a href="${escapeHtml(game.projectUrl)}" target="_blank" rel="noopener noreferrer">${game.manualBuild ? 'Open the official build guide' : source ? 'Open the official project release' : 'Open creator download'} ↗</a> — ${game.manualBuild ? 'prepare your own APK with the developer’s steps before selecting it here.' : source ? 'follow its installer instructions to obtain the APK.' : 'download the creator APK once, then VR4ALL remembers its path for future installs.'}</p>` : ''}</div>`}
    ${source ? '<div style="margin-top:11px"><button type="button" id="editSourceButton" class="inline-link">Edit GitHub source</button></div>' : ''}
    <div class="detail-divider"></div><div class="detail-step"><span class="step-number">2</span> ${game.data.length ? 'Add your game files' : 'Review game data'}</div>
    ${game.data.length ? '<p id="existingFilesNote" class="existing-files-note"></p>' : ''}
    ${game.playerInstall === 'jkxr' ? `<label class="field-label" for="jediGameSelect">Your Jedi game</label><select id="jediGameSelect" class="text-input"><option value="jk2" ${values.jediGame === 'jk3' ? '' : 'selected'}>Jedi Outcast</option><option value="jk3" ${values.jediGame === 'jk3' ? 'selected' : ''}>Jedi Academy</option></select>` : ''}
    ${game.data.map((item) => `<div class="requirement"><div class="requirement-top"><span class="requirement-name">${escapeHtml(item.label)}${item.optional ? ' · optional' : ''}</span><span class="format-chip">${escapeHtml(item.discImages ? 'BIN / CUE / CHD / FOLDER / ARCHIVE' : item.kind === 'directory' ? 'FOLDER / ZIP / 7Z / RAR' : acceptedGameExtensions(item).join(' / '))}</span></div><p class="field-help">${escapeHtml(item.note || '')}${item.sharedInput ? ' · This choice fills the same file field in other ports.' : ''}</p><div class="input-row" style="margin-top:10px"><input id="data-${escapeHtml(item.id)}" class="text-input" value="${escapeHtml(values[item.id] || '')}" placeholder="${item.discImages ? 'Choose your BIN, CUE, CHD, or prepared game files' : item.kind === 'directory' ? 'Choose a game folder or archive' : item.archiveMember ? 'Choose the BIOS file or archive' : item.extensions?.includes('.zip') ? 'Choose a ZIP, archive, or folder' : 'Choose a file'}"><button type="button" class="small-button browse-btn" data-picker="${item.kind}" data-target="data-${escapeHtml(item.id)}">Browse ${item.kind === 'directory' ? 'folder' : 'file'}</button>${item.kind === 'directory' || item.kind === 'file' && item.extensions?.includes('.zip') ? `<button type="button" class="small-button browse-btn" data-picker="${item.kind === 'directory' ? 'file' : 'directory'}" data-target="data-${escapeHtml(item.id)}">Browse ${item.kind === 'directory' ? item.discImages ? 'disc / archive' : 'archive' : 'folder'}</button>` : ''}</div><div class="drop-zone" data-item-id="${escapeHtml(item.id)}">Drop your ${escapeHtml(item.label)} here${item.discImages ? ' · BIN, CUE, CHD, folder, ZIP, 7z, or RAR' : item.kind === 'directory' ? ' · folder, ZIP, 7z, or RAR' : ' · plain file, ZIP, 7z, or RAR'}</div><p id="check-${escapeHtml(item.id)}" class="file-check ${state.fileChecks[game.id]?.[item.id]?.startsWith('Rejected:') ? 'error' : ''}">${escapeHtml(state.fileChecks[game.id]?.[item.id] || '')}</p><p class="field-help">→ ${escapeHtml(item.destination)}</p></div>`).join('')}
    ${game.guidance ? `<div class="guide-note">${escapeHtml(game.guidance)}</div>` : '<p class="field-help">Use game files from a copy you own. VR4ALL checks the selected format before transfer.</p>'}
    ${game.playerInstall === 'beef-raider' ? '<p class="field-help"><a href="https://github.com/DrBeef/BeefRaiderXR/releases/download/1.0.0/BeefRaiderXR-1.0.0.7z" target="_blank" rel="noopener noreferrer">Download the official Beef Raider Extraction Tool ↗</a></p>' : ''}
    <div class="detail-divider"></div><div class="detail-step"><span class="step-number">3</span> Install to your Quest</div><p class="after-note">${escapeHtml(game.afterInstall || 'Open the game under Unknown Sources after installing.')}</p>
    <button type="button" id="installButton" class="primary-button install-button">${game.playerInstall ? 'Prepare & install' : mode === 'github' ? 'Download & install' : 'Install port'} <span>→</span></button><div id="jobContainer"></div>`;
}

function renderReleaseCard() {
  const game = selectedGame();
  if (!game) return;
  const card = $('#releaseCard');
  if (!card) return;
  const source = sourceFor(game);
  const release = state.releases[game.id];
  const error = state.releaseErrors[game.id];
  if (!source) { card.textContent = 'This port has no verified GitHub release source. Use the creator download above.'; return; }
  if (error) { card.innerHTML = `Release check failed: ${escapeHtml(error)}<br><a href="https://github.com/${escapeHtml(source.repo)}/releases" target="_blank" rel="noopener noreferrer">Open releases ↗</a>`; return; }
  if (!release) { card.textContent = 'Checking GitHub releases…'; return; }
  const checked = release.checkedAt ? new Date(release.checkedAt).toLocaleString() : 'this session';
  const published = release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : 'date unknown';
  card.innerHTML = `<strong>${escapeHtml(release.title || release.tag)}</strong>${escapeHtml(release.assetName)}<br>${release.stale ? 'Cached release; GitHub could not be refreshed' : game.releaseKind === 'patch' ? 'Verified supported xdelta patch' : game.manualRelease || game.releaseKind === 'installer' ? 'Latest official Quest installer ZIP' : 'Latest matching Quest APK'} in ${escapeHtml(source.repo)}${release.prerelease ? ' · prerelease' : ''}<br>Published ${escapeHtml(published)} · checked ${escapeHtml(checked)}<br><a href="${escapeHtml(release.url)}" target="_blank" rel="noopener noreferrer">View release ↗</a>`;
}

function renderJob() {
  const container = $('#jobContainer');
  if (!container) return;
  const job = state.jobs.find((entry) => entry.id === state.activeJobId && entry.gameId === state.selectedId);
  if (!job) { container.innerHTML = ''; return; }
  const canRetry = job.kind !== 'phone-export' && job.status === 'error' && job.serial === state.selectedSerial && !state.installSubmitting && !state.jobs.some((entry) => entry.serial === state.selectedSerial && entry.gameId === job.gameId && ['queued', 'running'].includes(entry.status));
  container.innerHTML = `<div class="job-box"><div class="job-title"><span>Activity</span><span class="job-state">${escapeHtml(job.status)}</span></div><div class="job-log">${escapeHtml((job.log || []).join('\n') || job.error || 'Queued…')}</div>${job.status === 'success' && job.afterInstall ? `<p class="after-note">${escapeHtml(job.afterInstall)}</p>` : ''}${canRetry ? '<div class="job-actions"><button id="retryJobButton" type="button" class="small-button">Retry install</button></div>' : ''}</div>`;
  container.querySelector('.job-log')?.scrollTo(0, 99999);
  updateInstallEnabled();
}

async function retryFailedJob() {
  const job = state.jobs.find((entry) => entry.id === state.activeJobId && entry.gameId === state.selectedId);
  if (!job || job.status !== 'error' || !state.selectedSerial || job.serial !== state.selectedSerial || state.installSubmitting || state.jobs.some((entry) => entry.serial === state.selectedSerial && entry.gameId === job.gameId && ['queued', 'running'].includes(entry.status))) return;
  const game = selectedGame();
  if (game?.personalBuild) await buildPersonalGame();
  else await install();
}

function selectGame(id) {
  rememberInputs();
  const requested = state.games.find((entry) => entry.id === id);
  state.selectedId = requested && !requested.variantOf ? cardProfile(requested).id : id;
  const game = selectedGame();
  if (!game) return;
  state.activeJobId = state.jobs.find((job) => job.gameId === id)?.id || null;
  $('#detailBody').innerHTML = detailHtml(game);
  renderReadinessNote();
  $('#detailPanel').hidden = false;
  applyDetailLayout();
  renderReleaseCard();
  renderJob();
  renderExistingFilesNote();
  updateInstallEnabled();
  if (sourceFor(game) && !(game.id in state.releases) && !state.releaseErrors[game.id]) checkRelease(game);
  renderGrid();
}

async function checkRelease(game, force = false, origin = 'automatic') {
  if (!sourceFor(game)) return null;
  try {
    const installed = state.selectedSerial && state.deviceLibrary[state.selectedSerial]?.[game.id];
    const release = (await api(`/api/releases?gameId=${encodeURIComponent(game.id)}${installed ? `&serial=${encodeURIComponent(state.selectedSerial)}` : ''}${force ? '&refresh=1' : ''}&origin=${encodeURIComponent(origin)}`)).release;
    state.releases[game.id] = release;
    if (release && Number.isSafeInteger(release.totalDownloads)) state.discovery[game.id] = { totalDownloads: release.totalDownloads, publishedAt: release.publishedAt, checkedAt: release.checkedAt };
    if (release) delete state.releaseErrors[game.id];
    else state.releaseErrors[game.id] = game.releaseKind === 'patch' ? 'No matching patch release found' : game.releaseKind === 'installer' ? 'No matching Quest installer ZIP found' : 'No matching APK release found';
  }
  catch (error) { state.releaseErrors[game.id] = error.message; }
  if (state.selectedId === game.id) { renderReleaseCard(); renderReadinessNote(); }
  renderCategories(); renderGrid();
  return state.releaseErrors[game.id] || null;
}

async function checkAllReleases() {
  if (state.updateChecking) return;
  state.updateChecking = true;
  updateBulkUpdateButton();
  const button = $('#sidebarUpdatesButton');
  button.disabled = true;
  button.innerHTML = '<span>↻</span> Checking…';
  setActivity('updates', 'Checking GitHub releases…');
  const games = state.games.filter((game) => sourceFor(game)).sort((left, right) =>
    Number(Boolean(state.deviceLibrary[state.selectedSerial]?.[right.id])) - Number(Boolean(state.deviceLibrary[state.selectedSerial]?.[left.id])));
  const checkedRepos = new Set();
  let checked = 0;
  let stopped = false;
  try {
    for (const game of games) {
      setActivity('updates', `Checking ${checked + 1} of ${games.length}: ${game.title}…`);
      const repo = sourceFor(game).repo;
      const installed = Boolean(state.deviceLibrary[state.selectedSerial]?.[game.id]);
      const error = await checkRelease(game, installed && !checkedRepos.has(repo), 'manual');
      checked++;
      if (error && /rate limit|403/.test(error)) { stopped = true; break; }
      checkedRepos.add(repo);
    }
    const failures = games.slice(0, checked).filter((game) => state.releaseErrors[game.id]).length;
    setActivity('updates', stopped ? `Checked ${checked} of ${games.length} GitHub sources · stopped after a GitHub limit. Details saved to update-checks.txt.` : `Checked ${checked} GitHub source${checked === 1 ? '' : 's'}${failures ? ` · ${failures} failed` : ''}. Details saved to update-checks.txt.`, false, stopped || failures > 0);
  } catch (error) {
    setActivity('updates', `Update check stopped: ${error.message}. Details saved to update-checks.txt.`, false, true);
    toast(error.message, true);
  } finally {
    state.updateChecking = false;
    updateBulkUpdateButton();
    button.disabled = false;
    button.innerHTML = '<span>↻</span> Check updates';
  }
}

function applyBulkScan(result) {
  for (const old of state.bulkMatches) {
    for (const [itemId, local] of Object.entries({ ...old.files, ...old.buildInputs })) {
      if (state.staged[old.gameId]?.[itemId] === local) delete state.staged[old.gameId][itemId];
      if (state.inputs[old.gameId]?.[itemId] === local) delete state.inputs[old.gameId][itemId];
    }
  }
  state.bulkMatches = result.matches || [];
  state.bulkApks = {};
  for (const match of state.bulkMatches) {
    state.inputs[match.gameId] ||= {};
    state.staged[match.gameId] ||= {};
    for (const [itemId, local] of Object.entries(match.files || {})) {
      state.inputs[match.gameId][itemId] = local;
      state.staged[match.gameId][itemId] = local;
      state.fileChecks[match.gameId] ||= {};
      state.fileChecks[match.gameId][itemId] = `Matched on PC · ${match.checks[itemId] || 'Review before install'}`;
    }
    for (const [itemId, local] of Object.entries(match.buildInputs || {})) state.inputs[match.gameId][itemId] = local;
    if (match.apkPath) {
      state.bulkApks[match.gameId] = match.apkPath;
      state.inputs[match.gameId].apkPath = match.apkPath;
      state.mode[match.gameId] = 'local';
    }
  }
  const available = libraryGames().filter((game) => portFamily(game).some(isAvailableForInstall)).length;
  $('#bulkScanSummary').textContent = `${available} game${available === 1 ? '' : 's'} available to install.${result.warnings?.length ? ` Check saved paths: ${result.warnings.join(' · ')}` : ''}`;
  renderBulkMatches();
  renderCategories(); renderGrid();
  if (state.selectedId && selectedGame()) {
    $('#detailBody').innerHTML = detailHtml(selectedGame());
    renderReadinessNote(); renderReleaseCard(); renderExistingFilesNote(); renderJob(); updateInstallEnabled();
  }
}

function bulkUseLocalApk(game, match) {
  return Boolean(match.apkPath && (state.bulkMode === 'new' || !sourceFor(game) || game.manualRelease));
}

function bulkMatchFor(game) {
  const scanned = state.bulkMatches.find((entry) => entry.gameId === game.id);
  const match = { gameId: game.id, apkPath: scanned?.apkPath || state.bulkApks[game.id] || '', files: { ...(scanned?.files || {}) }, buildInputs: { ...(scanned?.buildInputs || {}) }, checks: { ...(scanned?.checks || {}) } };
  const saved = state.savedPaths[game.id] || {};
  const available = state.pathAvailability[game.id] || {};
  for (const item of game.data || []) {
    if (!match.files[item.id] && saved[item.id] && available[item.id] && stagedGameFileReady(game, item)) match.files[item.id] = saved[item.id];
  }
  if (game.personalBuild) for (const key of ['gamePackage', 'audioSource']) {
    if (!match.buildInputs[key] && saved[key] && available[key] && localPathAvailable(game, key)) match.buildInputs[key] = saved[key];
  }
  if (!match.apkPath && saved.apkPath && available.apkPath) match.apkPath = saved.apkPath;
  return match;
}

function bulkCandidate(match) {
  const game = state.games.find((entry) => entry.id === match.gameId);
  if (!game) return { game: null, reason: 'Unknown game' };
  const device = state.deviceLibrary[state.selectedSerial]?.[game.id];
  const missing = (game.data || []).filter((item) => !item.optional && !match.files?.[item.id]);
  if (!state.selectedSerial) return { game, reason: 'Connect and scan a Quest first' };
  if (state.bulkMode === 'new' && device || state.bulkMode === 'update' && !device) return { game, hidden: true, reason: '' };
  if (state.bulkMode === 'update' && versionStatus(game) !== 'status-update') return { game, reason: 'No confirmed APK update for this port' };
  if (game.personalBuild) {
    const inputs = match.buildInputs || {};
    if (!inputs.gamePackage) return { game, reason: `Add ${game.personalBuild.gameLabel || 'the original game files'} on this game's card` };
    if (game.personalBuild.audioLabel && !game.personalBuild.audioOptional && !inputs.audioSource) return { game, reason: `Add ${game.personalBuild.audioLabel} on this game's card` };
    return { game, reason: '' };
  }
  if (game.localPlayerInstall === 'sclerosis') return { game, reason: match.apkPath && (match.files?.gamePath || device?.dataReady) ? '' : 'Add the creator APK and owned Amnesia folder' };
  if (game.externalInstaller) return { game, reason: 'Official build guide required' };
  if (!device && game.requireOneOf?.length && !game.requireOneOf.some((id) => match.files?.[id])) return { game, reason: 'Add one of the supported game-file options' };
  if (!device?.dataReady && !(game.reuseInstalledData && device) && missing.length) return { game, reason: `Missing ${missing.map((item) => item.label).join(', ')}` };
  if (game.playerInstall === 'road-rash') return { game, reason: match.files?.discImage ? '' : 'Add your owned Road Rash disc' };
  if (game.playerInstall === 'harry-potter') return { game, reason: match.files?.gamePath ? '' : 'Add your owned Harry Potter PC game' };
  if (game.playerInstall === 'descent3') return { game, reason: match.files?.gamePath || device?.dataReady ? '' : 'Add your owned Descent 3 folder' };
  if (['official-zip', 'magic-carpet', 'astroquest', 'galaxyquest'].includes(game.playerInstall)) return { game, reason: match.files?.gamePath || device?.dataReady ? '' : 'Add your owned game file or folder' };
  if (game.playerInstall === 'jkxr') return { game, reason: 'Open JKXR to choose Jedi Outcast or Jedi Academy' };
  if (!game.playerInstall && !bulkUseLocalApk(game, match) && (!sourceFor(game) || game.manualRelease)) return { game, reason: 'Choose a local APK for this port' };
  if (state.bulkMode === 'update' && !bulkUseLocalApk(game, match) && !game.playerInstall) {
    if (state.releaseErrors[game.id]) return { game, reason: `GitHub check failed: ${state.releaseErrors[game.id]}` };
    if (!state.releases[game.id] || state.releases[game.id].stale) return { game, reason: 'Confirm the current GitHub release before updating' };
  }
  if (device?.dataReady && versionStatus(game) === 'status-current' && (state.bulkMode === 'update' || !hasLocalInstallFile(game))) return { game, reason: 'Already ready on headset' };
  return { game, reason: '' };
}

function renderBulkMatches() {
  const host = $('#bulkMatches');
  if (!host) return;
  const matches = state.bulkMatches.map((match) => {
    const game = state.games.find((entry) => entry.id === match.gameId);
    return game ? bulkMatchFor(game) : match;
  });
  if (state.bulkMode === 'new') for (const game of state.games) {
    if (isAvailableForInstall(game) && !matches.some((match) => match.gameId === game.id)) matches.push(bulkMatchFor(game));
  }
  if (state.bulkMode === 'update') for (const game of state.games) {
    if (state.deviceLibrary[state.selectedSerial]?.[game.id] && !matches.some((match) => match.gameId === game.id)) matches.push(bulkMatchFor(game));
  }
  let visible = 0;
  host.innerHTML = matches.map((match) => {
    const { game, reason, hidden } = bulkCandidate(match);
    if (!game || hidden) return '';
    visible++;
    const files = Object.keys(match.files || {}).length + Object.keys(match.buildInputs || {}).length;
    const details = `${game.personalBuild ? 'Build from your saved game files' : bulkUseLocalApk(game, match) ? 'Local APK' : sourceFor(game) && (!game.manualRelease || game.playerInstall) ? 'Official GitHub release' : 'APK needed'}${installType(game) === 'apk-included' ? ' · Game files included' : ''}${files ? ` · ${files} saved game file${files > 1 ? 's' : ''}` : ''}${bulkUseLocalApk(game, match) && match.checks?.apk ? ` · ${match.checks.apk}` : ''}`;
    const placements = (game.data || []).filter((item) => match.files?.[item.id]).map((item) => `${item.label}: ${match.files[item.id].split(/[\\/]/).at(-1)} → ${item.destination}`).join(' · ');
    return `<label class="bulk-match ${reason ? 'unavailable' : ''}"><input type="checkbox" class="bulk-select" value="${escapeHtml(game.id)}" ${reason || state.bulkRunning ? 'disabled' : ''}><span><strong>${escapeHtml(game.title)}</strong><small>${escapeHtml(details)}${reason ? ` · ${escapeHtml(reason)}` : ''}</small>${placements ? `<small>${escapeHtml(placements)}</small>` : ''}</span></label>`;
  }).join('');
  if (!visible) host.innerHTML = state.bulkMode === 'new' ? '<p class="field-help">No new games have saved files yet. Open a game card and choose or drop its required files.</p>' : '<p class="field-help">No installed games were found on the selected headset. Scan the headset after connecting it.</p>';
  $('#bulkRunButton').disabled = true;
}

function rememberedLibraryFiles() {
  const files = [];
  const shared = new Set();
  for (const [gameId, values] of Object.entries(state.savedPaths)) {
    const game = state.games.find((entry) => entry.id === gameId);
    if (!game) continue;
    for (const [key, local] of Object.entries(values || {})) {
      if (!local) continue;
      const field = game.data.find((item) => item.id === key);
      const sharedKey = field?.sharedInput ? `${field.sharedInput}\u0000${local}` : '';
      if (sharedKey && shared.has(sharedKey)) continue;
      if (sharedKey) shared.add(sharedKey);
      files.push({ id: `${gameId}:${key}`, path: local, originalName: local.split(/[\\/]/).at(-1), label: field?.sharedInput ? `${field.label} · shared game file` : `${game.title} · ${field?.label || key}`, shared: Boolean(field?.sharedInput) });
    }
  }
  return files;
}

function forgetRememberedChoice(id) {
  const split = id.lastIndexOf(':');
  const game = state.games.find((entry) => entry.id === id.slice(0, split));
  const key = id.slice(split + 1);
  if (!game) return;
  const sharedInput = game.data.find((item) => item.id === key)?.sharedInput;
  const choices = sharedInput
    ? state.games.flatMap((entry) => entry.data.filter((item) => item.sharedInput === sharedInput).map((item) => ({ gameId: entry.id, key: item.id })))
    : [{ gameId: game.id, key }];
  for (const choice of choices) {
    const old = state.savedPaths[choice.gameId]?.[choice.key];
    delete state.savedPaths[choice.gameId]?.[choice.key];
    delete state.pathAvailability[choice.gameId]?.[choice.key];
    if (state.inputs[choice.gameId]?.[choice.key] === old) delete state.inputs[choice.gameId][choice.key];
    if (state.staged[choice.gameId]?.[choice.key] === old) delete state.staged[choice.gameId][choice.key];
    if (choice.key === 'apkPath' && state.bulkApks[choice.gameId] === old) delete state.bulkApks[choice.gameId];
  }
  state.bulkMatches = [];
  state.managedFiles = rememberedLibraryFiles();
  renderBulkMatches();
  renderSavedLibraryFiles();
  renderCategories(); renderGrid();
}

function renderSavedLibraryFiles() {
  const host = $('#savedLibraryFiles');
  if (!host) return;
  host.innerHTML = state.managedFiles.length
    ? `<div class="field-help">Remembered paths · ${state.managedFiles.length}</div>${state.managedFiles.map((item) => `<div class="saved-file"><span title="${escapeHtml(item.path)}">${escapeHtml(item.label || item.originalName)} · ${escapeHtml(item.path)}</span><button type="button" class="inline-link remove-saved-file" data-id="${escapeHtml(item.id)}" title="${item.shared ? 'Forget this shared choice in all matching ports; keep the file' : 'Forget this path; keep the file'}">Forget</button></div>`).join('')}`
    : '<p class="field-help">No paths remembered yet. Choose or drop files on a game card to link them.</p>';
}

async function collectDropEntry(entry, prefix, files) {
  if (files.length >= 5000) throw new Error('Drop up to 5,000 files at once');
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    files.push({ file, relativePath: `${prefix}${entry.name}` });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    while (true) {
      const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!children.length) break;
      for (const child of children) await collectDropEntry(child, `${prefix}${entry.name}/`, files);
    }
  }
}

async function runBulkInstall(idsOverride = null) {
  const ids = idsOverride || [...document.querySelectorAll('.bulk-select:checked')].map((input) => input.value);
  if (!ids.length || state.bulkRunning || state.bulkUploading) return;
  const targetSerial = state.selectedSerial;
  state.bulkRunning = true;
  setActivity('bulk-install', state.bulkMode === 'update' ? `Starting 1/${ids.length} updates…` : `Checking headset before ${ids.length} installs…`);
  $('#bulkProgress').classList.add('active');
  $('#bulkProgress').textContent = state.bulkMode === 'update' ? `Starting 1 of ${ids.length} updates…` : `Checking headset before ${ids.length} installs…`;
  updateBulkUpdateButton();
  $('#bulkRunButton').disabled = true;
  $('#closeBulkButton').disabled = true;
  let succeeded = 0;
  if (state.bulkMode !== 'update') {
    try {
      const scan = await api(`/api/device-library?serial=${encodeURIComponent(targetSerial)}`);
      state.deviceLibrary[targetSerial] = scan.games || {};
    } catch (error) {
      state.bulkRunning = false;
      $('#bulkProgress').classList.remove('active');
      $('#bulkProgress').textContent = `Headset scan failed: ${error.message}`;
      $('#closeBulkButton').disabled = false;
      renderBulkMatches();
      updateBulkUpdateButton();
      setActivity('bulk-install', `Headset scan failed: ${error.message}`, false, true);
      return toast(`Could not rescan the selected Quest: ${error.message}`, true);
    }
  }
  for (let index = 0; index < ids.length; index++) {
    const gameId = ids[index];
    const game = state.games.find((entry) => entry.id === gameId);
    if (!game) continue;
    const match = bulkMatchFor(game);
    const candidate = bulkCandidate(match);
    if (candidate.hidden || candidate.reason) { toast(`${game.title}: ${candidate.reason || 'Headset status changed; review this game again'}`, true); continue; }
    $('#bulkProgress').textContent = `${state.bulkMode === 'update' ? 'Updating' : 'Installing'} ${index + 1} of ${ids.length}: ${game.title}…`;
    setActivity('bulk-install', `${state.bulkMode === 'update' ? 'Updating' : 'Installing'} ${index + 1}/${ids.length}: ${game.title}…`);
    if (state.bulkMode === 'update') bulkUpdateProgress(`Updating ${index + 1}/${ids.length}: ${game.title}`);
    try {
      const device = state.deviceLibrary[targetSerial]?.[gameId];
      const files = device?.dataReady || game.reuseInstalledData && device ? {} : match.files;
      const result = game.personalBuild
        ? await api('/api/personal-build', { method: 'POST', body: JSON.stringify({ gameId, serial: targetSerial, gamePackage: match.buildInputs.gamePackage, audioSource: match.buildInputs.audioSource }) })
        : game.localPlayerInstall === 'sclerosis'
        ? await api('/api/sclerosis-install', { method: 'POST', body: JSON.stringify({ gameId, serial: targetSerial, apkPath: match.apkPath, gamePath: files.gamePath }) })
        : game.playerInstall
        ? await api({ 'road-rash': '/api/road-rash-install', 'harry-potter': '/api/harry-potter-install', descent3: '/api/descent3-install', 'beef-raider': '/api/beef-raider-install', 'official-zip': '/api/official-player-install', 'magic-carpet': '/api/magic-carpet-install', astroquest: '/api/astroquest-install', galaxyquest: '/api/galaxyquest-install' }[game.playerInstall], { method: 'POST', body: JSON.stringify({ gameId, serial: targetSerial, discImage: match.files.discImage, gamePath: files.gamePath }) })
        : await api('/api/install', { method: 'POST', body: JSON.stringify({ gameId, serial: targetSerial, apkMode: bulkUseLocalApk(game, match) ? 'local' : 'github', apkPath: bulkUseLocalApk(game, match) ? match.apkPath : '', files }) });
      state.jobs.unshift(result.job);
      state.activeJobId = result.job.id;
      let job = result.job;
      while (['queued', 'running'].includes(job.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        job = (await api(`/api/jobs/${encodeURIComponent(job.id)}`)).job;
        $('#bulkProgress').textContent = `${index + 1} of ${ids.length}: ${game.title} · ${job.log?.at(-1) || job.status}`;
        setActivity('bulk-install', `${index + 1}/${ids.length} ${game.title}: ${job.log?.at(-1) || job.status}`);
        if (state.bulkMode === 'update') bulkUpdateProgress(`${index + 1}/${ids.length} ${game.title}: ${job.log?.at(-1) || job.status}`);
      }
      const jobIndex = state.jobs.findIndex((entry) => entry.id === job.id);
      if (jobIndex >= 0) state.jobs[jobIndex] = job;
      if (job.status === 'success') { succeeded++; delete state.bulkApks[gameId]; }
      else toast(`${game.title}: ${job.error || 'Install failed'}`, true);
    } catch (error) { toast(`${game.title}: ${error.message}`, true); }
  }
  state.bulkRunning = false;
  $('#bulkProgress').classList.remove('active');
  updateBulkUpdateButton();
  $('#closeBulkButton').disabled = false;
  $('#bulkProgress').textContent = `${succeeded} of ${ids.length} selected games ${state.bulkMode === 'update' ? 'updated' : 'installed'}. Open each on your Quest to confirm it plays.`;
  setActivity('bulk-install', `${succeeded}/${ids.length} games ${state.bulkMode === 'update' ? 'updated' : 'installed'}. Open them on your Quest to confirm.`, false, succeeded !== ids.length);
  if (state.bulkMode === 'update') bulkUpdateProgress(`${succeeded}/${ids.length} updates installed${succeeded === ids.length ? '' : ' · see failures in the queue'}`, false);
  try { state.installed = (await api('/api/catalog')).installed || {}; }
  catch (error) { toast(`Could not refresh saved install status: ${error.message}`, true); }
  await refreshDeviceLibrary(targetSerial);
  renderBulkMatches();
  toast(`${succeeded} of ${ids.length} ${state.bulkMode === 'update' ? 'updates' : 'installations'} completed`, succeeded !== ids.length);
}

async function browse(kind, target) {
  try {
    const locationField = ['sdkDownloadLocation', 'phoneExportLocation', 'phoneExportDataSource', 'buildWorkspaceInput'].includes(target);
    const defaultPath = locationField ? document.getElementById(target).value.trim() || undefined : undefined;
    const result = await api('/api/pick', { method: 'POST', body: JSON.stringify({ kind, defaultPath }) });
    if (result.path) {
      document.getElementById(target).value = result.path;
      if (target === 'phoneExportDataSource') { setPhoneExportDataSource(result.path); await checkExportPhone(); return; }
      if (locationField) return;
      rememberInputs();
      if (target.startsWith('data-')) {
        const game = selectedGame();
        if (game) await validateSelectedFile(game, target.slice(5), result.path);
      }
      if (target === 'apkPath') await validateSelectedApk(selectedGame(), result.path);
      if (target === 'buildGamePath' || target === 'buildAudioPath') setBuildPath(selectedGame(), target === 'buildGamePath' ? 'gamePackage' : 'audioSource', result.path);
    }
  } catch (error) { toast(`${error.message} — you can paste the path instead.`, true); }
}

function setBuildPath(game, target, localPath) {
  if (!game?.personalBuild || !['gamePackage', 'audioSource'].includes(target)) return;
  state.inputs[game.id] ||= {};
  state.inputs[game.id][target] = localPath;
  if (game.id === 'rdr1-vr' && target === 'audioSource') phoneExportDataEdits.set(game.id, localPath);
  const input = $(target === 'gamePackage' ? '#buildGamePath' : '#buildAudioPath');
  if (input) input.value = localPath;
  persistLocalPath(game, target, localPath);
  renderGrid();
  updateInstallEnabled();
}

function showFileCheck(game, itemId, message) {
  state.fileChecks[game.id] ||= {};
  state.fileChecks[game.id][itemId] = message;
  if (state.selectedId !== game.id) return;
  const check = document.getElementById(`check-${itemId}`);
  if (check) { check.textContent = message; check.classList.toggle('error', message.startsWith('Rejected:')); }
}

function showApkCheck(game, message) {
  state.apkChecks[game.id] = message;
  if (state.selectedId !== game.id) return;
  const check = $('#apkCheck');
  if (check) { check.textContent = message; check.classList.toggle('error', message.startsWith('Rejected:')); }
}

async function validateSelectedApk(game, localPath) {
  if (!game) return;
  state.inputs[game.id] ||= {};
  state.inputs[game.id].apkPath = localPath;
  const activityKey = `apk:${game.id}`;
  if (!localPath) { setActivity(activityKey, ''); await saveLocalPath(game, 'apkPath', ''); return showApkCheck(game, ''); }
  showApkCheck(game, 'Checking APK…');
  setActivity(activityKey, `Checking ${game.title} APK…`);
  try {
    const result = await api('/api/validate-apk', { method: 'POST', body: JSON.stringify({ gameId: game.id, path: localPath }) });
    if (state.inputs[game.id]?.apkPath !== localPath) return;
    const saved = await saveLocalPath(game, 'apkPath', localPath);
    state.inputs[game.id].apkPath = saved;
    if (state.selectedId === game.id) $('#apkPath').value = saved;
    showApkCheck(game, `Path remembered · ${result.verification.message}`);
    setActivity(activityKey, `${game.title} APK ready: ${result.verification.message}`, false);
  } catch (error) {
    if (state.inputs[game.id]?.apkPath === localPath) {
      showApkCheck(game, `Rejected: ${error.message}`);
      setActivity(activityKey, `${game.title} APK rejected: ${error.message}`, false, true);
    }
  }
}

async function uploadDroppedApk(game, file) {
  if (!/\.apk$/i.test(file.name)) return toast('Drop an APK file on the APK field.', true);
  const zone = $('.apk-drop-zone');
  zone?.classList.add('uploading');
  showApkCheck(game, 'Checking dropped APK…');
  setActivity(`apk:${game.id}`, `Checking ${game.title} APK: ${file.name}…`);
  try {
    if (window.vr4allDesktop?.pathForFile) {
      const localPath = await window.vr4allDesktop.pathForFile(file);
      if (!localPath) throw new Error('Could not read the local APK path');
      state.mode[game.id] = 'local';
      await validateSelectedApk(game, localPath);
      if (state.selectedId === game.id) selectGame(game.id);
      return;
    }
    const url = `/api/upload-apk?gameId=${encodeURIComponent(game.id)}&name=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-questdesk-token': window.QUESTDESK_TOKEN }, body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'APK check failed');
    rememberInputs();
    state.inputs[game.id] ||= {};
    state.inputs[game.id].apkPath = result.path;
    const saved = await saveLocalPath(game, 'apkPath', result.path);
    state.inputs[game.id].apkPath = saved;
    state.mode[game.id] = 'local';
    state.bulkApks[game.id] = saved;
    showApkCheck(game, result.verification.message);
    if (state.selectedId === game.id) {
      $('#detailBody').innerHTML = detailHtml(game);
      renderReadinessNote(); renderReleaseCard(); renderExistingFilesNote(); renderJob(); updateInstallEnabled();
    }
    renderGrid();
    toast(`${file.name}: ${result.verification.message}`);
    setActivity(`apk:${game.id}`, `${game.title} APK ready: ${result.verification.message}`, false);
  } catch (error) {
    showApkCheck(game, `Rejected: ${error.message}`);
    toast(`${file.name}: ${error.message}`, true);
    setActivity(`apk:${game.id}`, `${game.title} APK rejected: ${error.message}`, false, true);
  } finally { zone?.classList.remove('uploading'); }
}

async function validateSelectedFile(game, itemId, localPath) {
  const item = game.data.find((entry) => entry.id === itemId);
  if (!item) return;
  state.inputs[game.id] ||= {};
  state.inputs[game.id][itemId] = localPath;
  state.staged[game.id] ||= {};
  delete state.staged[game.id][itemId];
  renderGrid();
  const activityKey = `file:${game.id}:${itemId}`;
  if (!localPath) { setActivity(activityKey, ''); await saveLocalPath(game, itemId, ''); showFileCheck(game, itemId, ''); return; }
  showFileCheck(game, itemId, 'Checking local path…');
  setActivity(activityKey, `Checking ${game.title} ${item.label}…`);
  try {
    const result = await api('/api/validate-file', { method: 'POST', body: JSON.stringify({ gameId: game.id, itemId, path: localPath }) });
    if (state.inputs[game.id]?.[itemId] !== localPath) return;
    const saved = await saveLocalPath(game, itemId, localPath);
    state.inputs[game.id][itemId] = saved;
    state.staged[game.id][itemId] = saved;
    const input = document.getElementById(`data-${itemId}`);
    if (input) input.value = saved;
    showFileCheck(game, itemId, `Path remembered · ${result.verification.message}`);
    setActivity(activityKey, `${game.title} ${item.label} ready: ${result.verification.message}`, false);
    renderGrid();
  } catch (error) {
    if (state.inputs[game.id]?.[itemId] !== localPath) return;
    showFileCheck(game, itemId, `Rejected: ${error.message}`);
    setActivity(activityKey, `${game.title} ${item.label} rejected: ${error.message}`, false, true);
    toast(`${item.label}: ${error.message}`, true);
  }
}

async function uploadDroppedFile(game, item, file) {
  const zone = document.querySelector(`.drop-zone[data-item-id="${item.id}"]`);
  zone?.classList.add('uploading');
  state.inputs[game.id] ||= {};
  state.inputs[game.id][item.id] = '';
  state.staged[game.id] ||= {};
  delete state.staged[game.id][item.id];
  renderGrid();
  state.fileChecks[game.id] ||= {};
  state.fileChecks[game.id][item.id] = 'Checking dropped file…';
  setActivity(`file:${game.id}:${item.id}`, `Checking ${game.title} ${item.label}: ${file.name}…`);
  if (state.selectedId === game.id) {
    const input = document.getElementById(`data-${item.id}`);
    if (input) input.value = '';
    const check = document.getElementById(`check-${item.id}`);
    if (check) { check.textContent = 'Checking dropped file…'; check.classList.remove('error'); }
  }
  try {
    if (window.vr4allDesktop?.pathForFile) {
      const localPath = await window.vr4allDesktop.pathForFile(file);
      if (!localPath) throw new Error('Could not read the local game file path');
      await validateSelectedFile(game, item.id, localPath);
      return;
    }
    const url = `/api/upload?gameId=${encodeURIComponent(game.id)}&itemId=${encodeURIComponent(item.id)}&name=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-questdesk-token': window.QUESTDESK_TOKEN }, body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'File check failed');
    state.inputs[game.id][item.id] = result.path;
    const saved = await saveLocalPath(game, item.id, result.path);
    state.inputs[game.id][item.id] = saved;
    state.staged[game.id][item.id] = saved;
    state.fileChecks[game.id][item.id] = result.verification.message;
    if (state.selectedId === game.id) {
      const input = document.getElementById(`data-${item.id}`);
      if (input) input.value = saved;
      const check = document.getElementById(`check-${item.id}`);
      if (check) check.textContent = result.verification.message;
    }
    toast(`${file.name}: ${result.verification.message}`);
    setActivity(`file:${game.id}:${item.id}`, `${game.title} ${item.label} ready: ${result.verification.message}`, false);
    renderGrid();
  } catch (error) {
    state.fileChecks[game.id][item.id] = `Rejected: ${error.message}`;
    if (state.selectedId === game.id) {
      const check = document.getElementById(`check-${item.id}`);
      if (check) { check.textContent = state.fileChecks[game.id][item.id]; check.classList.add('error'); }
    }
    toast(`${file.name}: ${error.message}`, true);
    setActivity(`file:${game.id}:${item.id}`, `${game.title} ${item.label} rejected: ${error.message}`, false, true);
  }
  finally { zone?.classList.remove('uploading'); }
}

async function uploadDroppedZipContents(game, item, entries, droppedFiles) {
  const zone = document.querySelector(`.drop-zone[data-item-id="${item.id}"]`);
  zone?.classList.add('uploading');
  state.inputs[game.id] ||= {};
  state.staged[game.id] ||= {};
  state.inputs[game.id][item.id] = '';
  delete state.staged[game.id][item.id];
  const input = document.getElementById(`data-${item.id}`);
  if (input) input.value = '';
  showFileCheck(game, item.id, 'Packing dropped game files into ZIP…');
  setActivity(`file:${game.id}:${item.id}`, `Packing ${game.title} game files into ZIP…`);
  renderGrid();
  try {
    const files = [];
    if (entries.length) {
      for (const entry of entries) await collectDropEntry(entry, '', files);
      if (entries.length === 1 && entries[0].isDirectory) {
        const prefix = `${entries[0].name}/`;
        for (const file of files) file.relativePath = file.relativePath.slice(prefix.length);
      }
    } else {
      for (const file of droppedFiles) files.push({ file, relativePath: file.webkitRelativePath || file.name });
    }
    if (!files.length) throw new Error('Dropped folder contains no readable files');
    const session = await api('/api/bulk-sessions', { method: 'POST', body: '{}' });
    for (const { file, relativePath } of files) {
      const url = `/api/bulk-upload?session=${encodeURIComponent(session.id)}&path=${encodeURIComponent(relativePath)}`;
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-questdesk-token': window.QUESTDESK_TOKEN }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(`${relativePath}: ${result.error || 'Could not stage file'}`);
    }
    const result = await api('/api/package-uploaded', { method: 'POST', body: JSON.stringify({ gameId: game.id, itemId: item.id, session: session.id }) });
    state.inputs[game.id][item.id] = result.path;
    const saved = await saveLocalPath(game, item.id, result.path);
    state.inputs[game.id][item.id] = saved;
    state.staged[game.id][item.id] = saved;
    if (input) input.value = saved;
    showFileCheck(game, item.id, `Ready on PC · ${result.verification.message}`);
    renderGrid();
    toast(`${item.label}: ${result.verification.message}`);
    setActivity(`file:${game.id}:${item.id}`, `${game.title} ${item.label} ready: ${result.verification.message}`, false);
  } catch (error) {
    showFileCheck(game, item.id, `Rejected: ${error.message}`);
    toast(`${item.label}: ${error.message}`, true);
    setActivity(`file:${game.id}:${item.id}`, `${game.title} ${item.label} rejected: ${error.message}`, false, true);
  } finally { zone?.classList.remove('uploading'); }
}

function dropTargetFor(game, file, zone) {
  if (zone) return game.data.find((item) => item.id === zone.dataset.itemId);
  const extension = `.${file.name.split('.').at(-1).toLowerCase()}`;
  const folders = game.data.filter((item) => item.kind === 'directory');
  const candidates = game.data.filter((item) => item.kind === 'file' && acceptedGameExtensions(item).some((ext) => ext.toLowerCase() === extension));
  if (!candidates.length && folders.length === 1 && (['.zip', '.7z', '.rar'].includes(extension) || folders[0].extensions?.includes(extension))) return folders[0];
  if (candidates.length === 1) return candidates[0];
  const named = candidates.filter((item) => {
    const target = item.destination.split('/').at(-1)?.toLowerCase();
    if (file.name.toLowerCase() === target) return true;
    if (item.archiveMember && /(?:c71|bios)/i.test(file.name)) return true;
    return ['.7z', '.rar'].includes(extension) && target?.endsWith('.zip') && file.name.slice(0, -extension.length).toLowerCase() === target.slice(0, -4);
  });
  return named.length === 1 ? named[0] : null;
}

$('#detailPanel').addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  event.target.closest('.drop-zone')?.classList.add('dragging');
});
$('#detailPanel').addEventListener('dragleave', (event) => { event.target.closest('.drop-zone')?.classList.remove('dragging'); });
$('#detailPanel').addEventListener('drop', async (event) => {
  event.preventDefault();
  document.querySelectorAll('.drop-zone.dragging').forEach((zone) => zone.classList.remove('dragging'));
  const game = selectedGame();
  if (!game) return;
  const zone = event.target.closest('.drop-zone');
  const files = [...(event.dataTransfer?.files || [])];
  const entries = [...(event.dataTransfer?.items || [])].map((item) => item.webkitGetAsEntry?.() || item.getAsEntry?.()).filter(Boolean);
  if (!files.length && !entries.length) return;
  if (game.personalBuild) {
    if (!window.vr4allDesktop?.pathForFile) return toast('Open the VR4ALL EXE to drag large game exports, or use Choose file / Choose folder here.', true);
    try {
      for (const file of files) {
        const target = zone?.dataset.buildTarget || (game.personalBuild.audioLabel && /gta-sa-ps2-style|audio/i.test(file.name) ? 'audioSource' : 'gamePackage');
        const localPath = await window.vr4allDesktop.pathForFile(file);
        if (!localPath) throw new Error(`Could not read the local path for ${file.name}; use Choose file or Choose folder`);
        setBuildPath(game, target, localPath);
      }
    } catch (error) { toast(error.message, true); }
    return;
  }
  if (zone?.dataset.itemId && game.data.find((item) => item.id === zone.dataset.itemId)?.kind === 'directory') {
    try {
      const selected = files[0];
      if (!selected || !window.vr4allDesktop?.pathForFile) throw new Error('Drop a game folder or archive in the VR4ALL EXE, or use Browse');
      const localPath = await window.vr4allDesktop.pathForFile(selected);
      if (!localPath) throw new Error('Could not read the game path; use Browse');
      await validateSelectedFile(game, zone.dataset.itemId, localPath);
    } catch (error) { toast(error.message, true); }
    return;
  }
  const zipFields = game.data.filter((item) => item.kind === 'file' && item.extensions?.some((extension) => extension.toLowerCase() === '.zip'));
  const zipTarget = zone?.dataset.itemId ? zipFields.find((item) => item.id === zone.dataset.itemId) : zipFields.length === 1 ? zipFields[0] : null;
  if (zipTarget && (files.length > 1 || entries.some((entry) => entry.isDirectory))) {
    if (window.vr4allDesktop?.pathForFile && files.length === 1 && entries.length === 1 && entries[0].isDirectory) {
      const localPath = await window.vr4allDesktop.pathForFile(files[0]);
      if (localPath) { await validateSelectedFile(game, zipTarget.id, localPath); return; }
    }
    await uploadDroppedZipContents(game, zipTarget, entries, files);
    return;
  }
  if (zone && files.length > 1) return toast('Drop one file on each game file field.', true);
  for (const file of files) {
    if (zone?.dataset.apk === 'true' || /\.apk$/i.test(file.name)) { uploadDroppedApk(game, file); continue; }
    const item = dropTargetFor(game, file, zone);
    if (!item) { toast(`Choose the matching game file field for ${file.name}.`, true); continue; }
    if (item.kind === 'directory') {
      if (!window.vr4allDesktop?.pathForFile) { toast('Open the VR4ALL EXE to link game archives, or use Browse archive.', true); continue; }
      const localPath = await window.vr4allDesktop.pathForFile(file);
      if (localPath) await validateSelectedFile(game, item.id, localPath);
      continue;
    }
    uploadDroppedFile(game, item, file);
  }
});
window.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
window.addEventListener('drop', (event) => event.preventDefault());

async function install() {
  if (state.installSubmitting) return;
  const game = selectedGame();
  if (!game) return;
  rememberInputs();
  const values = state.inputs[game.id] || {};
  const mode = state.mode[game.id];
  if (!state.selectedSerial) return toast('Connect and select an authorized Quest first.', true);
  if (game.playerInstall) {
    const localInput = game.playerInstall === 'road-rash' ? values.discImage : values.gamePath;
    if (!localInput && game.playerInstall !== 'beef-raider' && (['road-rash', 'harry-potter'].includes(game.playerInstall) || !state.deviceLibrary[state.selectedSerial]?.[game.id]?.dataReady)) return toast(game.playerInstall === 'road-rash' ? 'Choose your owned Road Rash disc image.' : 'Choose your owned game file or folder for the first install.', true);
    state.installSubmitting = true;
    setActivity('submit', `Preparing ${game.title} installation…`);
    updateInstallEnabled();
    try {
      const route = { 'road-rash': '/api/road-rash-install', 'harry-potter': '/api/harry-potter-install', descent3: '/api/descent3-install', jkxr: '/api/jkxr-install', 'beef-raider': '/api/beef-raider-install', 'official-zip': '/api/official-player-install', 'magic-carpet': '/api/magic-carpet-install', astroquest: '/api/astroquest-install', galaxyquest: '/api/galaxyquest-install' }[game.playerInstall];
      const result = await api(route, { method: 'POST', body: JSON.stringify({ gameId: game.id, serial: state.selectedSerial, discImage: values.discImage, gamePath: values.gamePath, jediGame: values.jediGame || 'jk2' }) });
      state.jobs.unshift(result.job);
      state.activeJobId = result.job.id;
      renderJob();
      pollJob(result.job.id);
      toast(`Preparing ${game.title}…`);
    } catch (error) { setActivity('submit', `${game.title}: ${error.message}`, false, true); toast(error.message, true); }
    finally { state.installSubmitting = false; updateInstallEnabled(); }
    return;
  }
  if (game.localPlayerInstall === 'sclerosis') {
    if (!values.apkPath) return toast('Drop the creator-hosted Sclerosis APK first.', true);
    if (!values.gamePath && !state.deviceLibrary[state.selectedSerial]?.[game.id]?.dataReady) return toast('Drop your owned Amnesia game folder for the first install.', true);
    state.installSubmitting = true;
    setActivity('submit', 'Preparing Sclerosis installation…');
    updateInstallEnabled();
    try {
      const result = await api('/api/sclerosis-install', { method: 'POST', body: JSON.stringify({ gameId: game.id, serial: state.selectedSerial, apkPath: values.apkPath, gamePath: values.gamePath }) });
      state.jobs.unshift(result.job);
      state.jobFiles[result.job.id] = { gamePath: values.gamePath };
      if (state.bulkApks[game.id] === values.apkPath) state.jobApks[result.job.id] = values.apkPath;
      state.activeJobId = result.job.id;
      renderJob();
      pollJob(result.job.id);
      toast('Installing Sclerosis…');
    } catch (error) { setActivity('submit', `Sclerosis: ${error.message}`, false, true); toast(error.message, true); }
    finally { state.installSubmitting = false; updateInstallEnabled(); }
    return;
  }
  if (mode === 'local' && !values.apkPath) return toast('Choose a local APK.', true);
  if (mode === 'github' && !state.releases[game.id]) return toast('No matching GitHub APK is available. Choose a local APK.', true);
  if (mode === 'github' && state.releases[game.id].stale) return toast('GitHub could not be refreshed. Try again later or choose a local APK.', true);
  const files = Object.fromEntries(game.data.map((item) => [item.id, values[item.id] || '']));
  state.installSubmitting = true;
  setActivity('submit', `Preparing ${game.title} installation…`);
  updateInstallEnabled();
  try {
    const result = await api('/api/install', { method: 'POST', body: JSON.stringify({ gameId: game.id, serial: state.selectedSerial, apkMode: mode, apkPath: values.apkPath, files }) });
    state.jobs.unshift(result.job);
    state.jobFiles[result.job.id] = { ...files };
    if (state.bulkApks[game.id] === values.apkPath) state.jobApks[result.job.id] = values.apkPath;
    state.activeJobId = result.job.id;
    renderJob();
    pollJob(result.job.id);
    toast(`Installing ${game.title}…`);
  } catch (error) { setActivity('submit', `${game.title}: ${error.message}`, false, true); toast(error.message, true); }
  finally { state.installSubmitting = false; updateInstallEnabled(); }
}

async function buildPersonalGame() {
  if (state.installSubmitting) return;
  const game = selectedGame();
  if (!game?.personalBuild) return;
  rememberInputs();
  const values = state.inputs[game.id] || {};
  if (!state.selectedSerial) return toast('Connect and select an authorized Quest first.', true);
  if (!values.gamePackage) return toast(`Choose your ${game.personalBuild.gameLabel}.`, true);
  if (game.personalBuild.audioLabel && !game.personalBuild.audioOptional && !values.audioSource) return toast(`Choose ${game.personalBuild.audioLabel}.`, true);
  state.installSubmitting = true;
  setActivity('submit', `Preparing ${game.title} build…`);
  updateInstallEnabled();
  try {
    if (['vice-city-vr', 'rdr1-vr', 'gta-sa-vr'].includes(game.id)) {
      const location = await api('/api/build-tools/location', { method: 'POST', body: JSON.stringify({ gameId: game.id, gamePackage: values.gamePackage }) });
      if (!location.configured) { await startBuildTools(); return; }
    }
    const result = await api('/api/personal-build', { method: 'POST', body: JSON.stringify({ gameId: game.id, serial: state.selectedSerial, gamePackage: values.gamePackage, audioSource: values.audioSource }) });
    state.jobs.unshift(result.job);
    state.activeJobId = result.job.id;
    renderJob();
    pollJob(result.job.id);
    toast(`${game.id === 'crazy-taxi-vr' || game.id === 'fzero-x-virtuavr' ? 'Preparing' : 'Building'} ${game.title} from your game files…`);
  } catch (error) { setActivity('submit', `${game.title}: ${error.message}`, false, true); toast(error.message, true); }
  finally { state.installSubmitting = false; updateInstallEnabled(); }
}

function renderPhoneExportJob(job) {
  if (!job || job.id !== phoneExportJobId) return;
  const busy = ['queued', 'running'].includes(job.status);
  $('#phoneExportCheckButton').disabled = busy;
  if (busy) { phoneExportCheckEpoch++; phoneExportReadiness = null; $('#phoneExportReadiness').hidden = true; }
  if (busy) {
    $('#phoneExportEdition').value = job.edition || 'auto';
    $('#phoneExportDataSource').value = job.additionalDataSource || '';
    $('#phoneExportLocation').value = job.downloadLocation || '';
    $('#phoneExportDevice').innerHTML = `<option value="${escapeHtml(job.serial)}">${escapeHtml(job.serial)}</option>`;
    $('#phoneExportDevice').value = job.serial;
  }
  $('#phoneExportStatus').textContent = job.status === 'success' ? 'Export saved and selected. Connect your Quest, then choose Build and install.'
    : job.status === 'error' ? job.error || 'Phone export stopped.' : 'Copying and verifying the game. Keep your phone connected and unlocked.';
  $('#phoneExportLog').textContent = (job.log || []).join('\n');
  $('#phoneExportStartButton').hidden = job.status === 'success';
  for (const selector of ['#phoneExportEdition', '#phoneExportDevice', '#phoneExportLocation', '#phoneExportBrowseButton', '#phoneExportRefreshButton', '#phoneExportStartButton', '#phoneExportDataSource', '#phoneExportDataFileButton', '#phoneExportDataFolderButton']) $(selector).disabled = busy;
}

function setPhoneExportDataSource(value) {
  const game = state.games.find((entry) => entry.id === phoneExportGameId);
  if (game?.id !== 'rdr1-vr') return;
  state.inputs[game.id] ||= {};
  state.inputs[game.id].audioSource = value;
  phoneExportDataEdits.set(game.id, value);
  if (state.selectedId === game.id && $('#buildAudioPath')) $('#buildAudioPath').value = value;
  persistLocalPath(game, 'audioSource', value);
}

async function refreshExportPhones() {
  const devices = (await api('/api/phone-export/devices')).devices;
  const ready = devices.filter((device) => device.state === 'device');
  const select = $('#phoneExportDevice');
  const previous = select.value;
  select.innerHTML = `<option value="">${ready.length ? 'Choose the phone with the game' : 'No authorized phone found — unlock it and approve USB debugging'}</option>${devices.map((device) => `<option value="${escapeHtml(device.serial)}" ${device.state !== 'device' ? 'disabled' : ''}>${escapeHtml(device.model || 'Android phone')} · ${escapeHtml(device.serial)}${device.state !== 'device' ? ` · ${escapeHtml(device.state)}` : ''}</option>`).join('')}`;
  select.value = ready.some((device) => device.serial === previous) ? previous : ready.length === 1 ? ready[0].serial : '';
  $('#phoneExportStatus').textContent = ready.length ? 'Choose the export folder, then select Export game.' : 'Connect an Android phone with USB debugging enabled, unlock it, approve this computer, then refresh phones.';
  await checkExportPhone();
}

function phoneExportCheckInput() {
  return { gameId: phoneExportGameId, serial: $('#phoneExportDevice').value, edition: $('#phoneExportEdition').value || 'auto', audioSource: $('#phoneExportDataSource').value.trim() };
}

async function checkExportPhone() {
  if (phoneExportGameId !== 'rdr1-vr') return null;
  if (state.jobs.some((job) => job.id === phoneExportJobId && ['queued', 'running'].includes(job.status))) return null;
  const epoch = ++phoneExportCheckEpoch;
  const input = phoneExportCheckInput(), key = JSON.stringify(input);
  phoneExportReadiness = null;
  $('#phoneExportReadiness').hidden = false;
  $('#phoneExportStartButton').disabled = true;
  $('#phoneExportReadiness').textContent = input.serial ? 'Checking game-data entries on the phone. No game files are being copied.' : 'Choose an authorized phone to check its game data.';
  $('#phoneExportStatus').textContent = input.serial ? 'Checking the phone before export.' : 'Choose an authorized phone first.';
  const previous = phoneExportCheckTask;
  const task = (async () => {
    // Serialize previews so changing edition/source does not fight an older
    // preview for the server's phone lock. Only the latest selection may render.
    if (previous) await previous;
    const current = () => epoch === phoneExportCheckEpoch && key === JSON.stringify(phoneExportCheckInput());
    if (!input.serial || !current()) return null;
    try {
      const { readiness } = await api('/api/phone-export/check', { method: 'POST', body: JSON.stringify(input) });
      if (!current()) return null;
      if (!readiness || typeof readiness.canExport !== 'boolean') throw new Error('Could not read the phone check. Select Check phone to retry.');
      phoneExportReadiness = { key, ...readiness };
      $('#phoneExportReadiness').textContent = `${readiness.apkCount} APK files on ${readiness.model || 'the phone'}. ${readiness.message}`;
      $('#phoneExportStartButton').disabled = !readiness.canExport;
      $('#phoneExportStatus').textContent = readiness.canExport ? 'Choose the export folder, then select Export game. Files will be verified during export.' : 'Export paused: matching additional game data is required. Read the phone check above, then check again after resolving it.';
      return readiness;
    } catch (error) {
      if (current()) { $('#phoneExportReadiness').textContent = error.message; $('#phoneExportStatus').textContent = 'Phone check stopped. Resolve the message above, then select Check phone.'; }
      return null;
    }
  })();
  phoneExportCheckTask = task;
  return task;
}

async function startPhoneExport() {
  const game = selectedGame();
  if (phoneExportSubmitting || !['rdr1-vr', 'gta-sa-vr'].includes(game?.id)) return;
  phoneExportSubmitting = true;
  phoneExportGameId = game.id;
  try {
    $('#phoneExportTitle').textContent = `Export ${game.title} from phone`;
    $('#phoneExportEditionField').hidden = game.id !== 'rdr1-vr';
    $('#phoneExportDataField').hidden = game.id !== 'rdr1-vr';
    $('#phoneExportCheckField').hidden = game.id !== 'rdr1-vr';
    $('#phoneExportReadiness').hidden = game.id !== 'rdr1-vr';
    $('#phoneExportEditionNote').textContent = game.id === 'rdr1-vr'
      ? 'RDR 1.58.63226194, ARM64: Google Play or Netflix. Enter gameplay on the phone after all downloads finish. VR4ALL checks whether its APKs include the required data before copying. Either edition can need extra files; the edition or APK count alone does not prove compatibility.'
      : 'Install Google Play GTA SA 2.11.311 on an ARM64 Android phone or tablet. No root is needed. The separate audio pack is still required afterward.';
    const active = state.jobs.find((job) => job.kind === 'phone-export' && job.gameId === game.id && ['queued', 'running'].includes(job.status));
    if (active) { phoneExportJobId = active.id; renderPhoneExportJob(active); }
    else {
      rememberInputs(); phoneExportJobId = '';
      phoneExportCheckEpoch++; phoneExportReadiness = null;
      $('#phoneExportCheckButton').disabled = false;
      $('#phoneExportEdition').value = 'auto';
      const location = await api('/api/phone-export/location', { method: 'POST', body: JSON.stringify({ gameId: game.id, gamePackage: state.inputs[game.id]?.gamePackage }) });
      $('#phoneExportLocation').value = location.downloadLocation;
      $('#phoneExportDataSource').value = game.id === 'rdr1-vr' ? phoneExportDataEdits.has(game.id) ? phoneExportDataEdits.get(game.id) : state.inputs[game.id]?.audioSource || location.additionalDataSource || '' : '';
      $('#phoneExportLog').textContent = '';
      $('#phoneExportStartButton').hidden = false;
      for (const selector of ['#phoneExportEdition', '#phoneExportDevice', '#phoneExportLocation', '#phoneExportBrowseButton', '#phoneExportRefreshButton', '#phoneExportStartButton', '#phoneExportDataSource', '#phoneExportDataFileButton', '#phoneExportDataFolderButton']) $(selector).disabled = false;
      await refreshExportPhones();
    }
    if (!$('#phoneExportDialog').open) $('#phoneExportDialog').showModal();
  } catch (error) { toast(error.message, true); }
  finally { phoneExportSubmitting = false; }
}

async function exportFromPhone() {
  if (phoneExportSubmitting || !['rdr1-vr', 'gta-sa-vr'].includes(phoneExportGameId)) return;
  const serial = $('#phoneExportDevice').value;
  const downloadLocation = $('#phoneExportLocation').value.trim();
  if (!serial || !downloadLocation) return toast('Choose an authorized phone and an export folder first.', true);
  phoneExportSubmitting = true;
  $('#phoneExportStartButton').disabled = true;
  try {
    if (phoneExportGameId === 'rdr1-vr') {
      const requestedKey = JSON.stringify(phoneExportCheckInput());
      if (phoneExportReadiness?.key !== requestedKey) await checkExportPhone();
      if (!phoneExportReadiness?.canExport || phoneExportReadiness.key !== requestedKey || requestedKey !== JSON.stringify(phoneExportCheckInput())) return;
    }
    const edition = phoneExportGameId === 'rdr1-vr' ? $('#phoneExportEdition').value || 'auto' : 'auto';
    const audioSource = phoneExportGameId === 'rdr1-vr' ? $('#phoneExportDataSource').value.trim() : null;
    if (phoneExportGameId === 'rdr1-vr' && state.inputs[phoneExportGameId]?.audioSource !== audioSource) setPhoneExportDataSource(audioSource);
    const { job } = await api('/api/phone-export', { method: 'POST', body: JSON.stringify({ gameId: phoneExportGameId, serial, downloadLocation, ...(edition !== 'auto' ? { edition } : {}), ...(audioSource ? { audioSource } : {}) }) });
    state.jobs.unshift(job); state.activeJobId = job.id; phoneExportJobId = job.id;
    renderPhoneExportJob(job); renderJob(); await pollJob(job.id);
  } catch (error) { $('#phoneExportStartButton').disabled = false; toast(error.message, true); }
  finally { phoneExportSubmitting = false; }
}

function finishPhoneExport(job) {
  if (job.status !== 'success' || !job.exportPath) return;
  state.inputs[job.gameId] ||= {}; state.savedPaths[job.gameId] ||= {}; state.pathAvailability[job.gameId] ||= {};
  state.inputs[job.gameId].gamePackage = job.exportPath;
  state.savedPaths[job.gameId].gamePackage = job.exportPath;
  state.pathAvailability[job.gameId].gamePackage = true;
  if (state.selectedId === job.gameId && $('#buildGamePath')) $('#buildGamePath').value = job.exportPath;
  renderGrid(); updateInstallEnabled();
}

function renderBuildToolsJob(job) {
  if (!job || job.id !== sdkSetupJobId) return;
  $('#sdkSetupTitle').textContent = job.title;
  const waiting = Boolean(job.license);
  $('#sdkDownloadLocation').value = job.downloadLocation || '';
  $('#sdkDownloadLocation').disabled = true;
  $('#sdkBrowseButton').disabled = true;
  $('#sdkStartButton').hidden = true;
  $('#sdkSetupStatus').textContent = waiting ? 'Review the license below to continue.'
    : job.status === 'success' ? 'Tools are ready. Close this window and choose Build and install.'
      : job.status === 'error' ? job.error || 'Tool setup stopped.' : 'Preparing and downloading build tools. This can take several minutes.';
  $('#sdkLicenseSection').hidden = !waiting;
  $('#sdkLicenseText').textContent = job.license?.text || '';
  $('#sdkSetupLog').textContent = (job.log || []).join('\n');
  $('#sdkAcceptButton').disabled = !waiting || sdkLicenseSubmitting;
  $('#sdkDeclineButton').disabled = !waiting || sdkLicenseSubmitting;
  $('#sdkLicenseActions').hidden = !waiting;
}

async function startBuildTools() {
  const game = selectedGame();
  if (sdkSetupSubmitting || !['vice-city-vr', 'rdr1-vr', 'gta-sa-vr'].includes(game?.id)) return;
  sdkSetupSubmitting = true;
  try {
    const job = state.jobs.find((entry) => entry.gameId === game.id && entry.kind === 'build-tools' && ['queued', 'running'].includes(entry.status));
    if (job) {
      sdkSetupJobId = job.id;
      renderBuildToolsJob(job);
    } else {
      rememberInputs();
      const gamePackage = state.inputs[game.id]?.gamePackage;
      const location = await api('/api/build-tools/location', { method: 'POST', body: JSON.stringify({ gameId: game.id, gamePackage }) });
      sdkSetupJobId = '';
      $('#sdkSetupTitle').textContent = `${game.title} build tools`;
      $('#sdkDownloadLocation').value = location.downloadLocation || '';
      $('#sdkDownloadLocation').disabled = false;
      $('#sdkBrowseButton').disabled = false;
      $('#sdkStartButton').hidden = false;
      $('#sdkStartButton').disabled = false;
      $('#sdkSetupStatus').textContent = 'Choose a download folder, then select Download and set up tools.';
      $('#sdkLicenseSection').hidden = true;
      $('#sdkLicenseActions').hidden = true;
      $('#sdkLicenseText').textContent = '';
      $('#sdkSetupLog').textContent = '';
    }
    if (!$('#sdkSetupDialog').open) $('#sdkSetupDialog').showModal();
  } catch (error) { toast(error.message, true); }
  finally { sdkSetupSubmitting = false; }
}

async function installBuildTools() {
  const game = selectedGame();
  if (sdkSetupSubmitting || !['vice-city-vr', 'rdr1-vr', 'gta-sa-vr'].includes(game?.id)) return;
  const downloadLocation = $('#sdkDownloadLocation').value.trim();
  if (!downloadLocation) return toast('Choose a download folder first.', true);
  sdkSetupSubmitting = true;
  $('#sdkStartButton').disabled = true;
  $('#sdkDownloadLocation').disabled = true;
  $('#sdkBrowseButton').disabled = true;
  try {
    const { job } = await api('/api/build-tools', { method: 'POST', body: JSON.stringify({ gameId: game.id, downloadLocation }) });
    state.jobs.unshift(job);
    sdkSetupJobId = job.id;
    state.activeJobId = job.id;
    renderBuildToolsJob(job);
    renderJob();
    await pollJob(job.id);
  } catch (error) {
    $('#sdkDownloadLocation').disabled = false;
    $('#sdkBrowseButton').disabled = false;
    $('#sdkStartButton').disabled = false;
    toast(error.message, true);
  } finally { sdkSetupSubmitting = false; }
}

async function answerBuildToolsLicense(accepted) {
  const job = state.jobs.find((entry) => entry.id === sdkSetupJobId);
  if (!job?.license || sdkLicenseSubmitting) return;
  sdkLicenseSubmitting = true;
  renderBuildToolsJob(job);
  try {
    await api(`/api/build-tools/${encodeURIComponent(job.id)}/license`, { method: 'POST', body: JSON.stringify({ licenseId: job.license.id, accepted }) });
    job.license = null;
  } catch (error) { toast(error.message, true); }
  finally { sdkLicenseSubmitting = false; renderBuildToolsJob(job); }
}

async function pollJob(id) {
  setActivity('submit', '');
  const starting = state.jobs.find((entry) => entry.id === id);
  if (starting && ['queued', 'running'].includes(starting.status)) setActivity(`job:${id}`, `${starting.title}: ${starting.log?.at(-1) || 'Preparing on your Quest…'}`);
  try {
    const { job } = await api(`/api/jobs/${encodeURIComponent(id)}`);
    const index = state.jobs.findIndex((entry) => entry.id === id);
    if (index >= 0) state.jobs[index] = job;
    setActivity(`job:${id}`, `${job.title}: ${job.log?.at(-1) || job.status}`, ['queued', 'running'].includes(job.status), job.status === 'error');
    renderJob();
    if (job.kind === 'phone-export') {
      renderPhoneExportJob(job);
      if (['queued', 'running'].includes(job.status)) setTimeout(() => pollJob(id), 900);
      else { finishPhoneExport(job); toast(job.status === 'success' ? 'Phone export saved and selected. Connect your Quest to build.' : job.error || 'Phone export stopped', job.status === 'error'); }
      return;
    }
    if (job.kind === 'build-tools') {
      renderBuildToolsJob(job);
      if (['queued', 'running'].includes(job.status)) setTimeout(() => pollJob(id), 900);
      else toast(job.status === 'success' ? 'Build tools are ready. You can now build the game.' : job.error || 'Tool setup stopped', job.status === 'error');
      return;
    }
    if (['queued', 'running'].includes(job.status)) setTimeout(() => pollJob(id), 900);
    else {
      if (job.status === 'success') {
        const outcome = job.gameId === 'beef-raider-xr'
          ? job.stage === 'full-game' ? 'full-game data transferred to your Quest' : 'demo APK installed; launch it once, then return to transfer full-game data'
          : job.gameId === 'crazy-taxi-vr' ? 'installed to your Quest'
            : job.stage === 'patched' ? 'patched and installed to your Quest'
            : state.games.find((game) => game.id === job.gameId)?.personalBuild ? 'built and installed to your Quest' : 'transferred to your Quest';
        toast(`${job.title} ${outcome}`);
        for (const [itemId, localPath] of Object.entries(state.jobFiles[id] || {})) {
          if (!localPath || state.inputs[job.gameId]?.[itemId] !== localPath) continue;
          delete state.staged[job.gameId]?.[itemId];
          delete state.fileChecks[job.gameId]?.[itemId];
          if (state.savedPaths[job.gameId]?.[itemId]) continue;
          state.inputs[job.gameId][itemId] = '';
          if (state.selectedId === job.gameId) {
            const input = document.getElementById(`data-${itemId}`);
            const check = document.getElementById(`check-${itemId}`);
            if (input) input.value = '';
            if (check) check.textContent = '';
          }
        }
        const result = await api('/api/catalog');
        state.installed = result.installed || {};
        renderGrid();
        await refreshDeviceLibrary(job.serial);
      }
      else toast(job.error || 'Install failed', true);
      const stagedApk = state.jobApks[id];
      if (stagedApk && state.bulkApks[job.gameId] === stagedApk) {
        delete state.bulkApks[job.gameId];
        if (state.inputs[job.gameId]?.apkPath === stagedApk && !state.savedPaths[job.gameId]?.apkPath) {
          state.inputs[job.gameId].apkPath = '';
          if (state.selectedId === job.gameId && $('#apkPath')) $('#apkPath').value = '';
          showApkCheck({ id: job.gameId }, '');
        }
        renderGrid();
      }
      delete state.jobApks[id];
      delete state.jobFiles[id];
      updateInstallEnabled();
    }
  } catch (error) { toast(`Activity check failed: ${error.message}. Retrying…`, true); setTimeout(() => pollJob(id), 3000); }
}

async function openSettings(section = 'appearance') {
  try { state.settings = await api('/api/settings'); } catch (error) { return toast(error.message, true); }
  applyTheme(state.settings.theme);
  applyPalette(state.settings.palette);
  $('#adbPathInput').value = state.settings.adbPath || '';
  $('#buildWorkspaceInput').value = state.settings.buildWorkspace || state.settings.defaultBuildWorkspace || '';
  $('#detailLayoutInput').value = state.detailLayout;
  const game = selectedGame();
  $('#sourceSettings').hidden = !game;
  if (game) { const source = sourceFor(game) || {}; $('#sourceGameName').textContent = game.title; $('#repoInput').value = source.repo || ''; $('#assetPatternInput').value = source.assetPattern || ''; }
  $('#settingsDialog').showModal();
  const heading = section === 'connection' ? $('#connectionHeading') : section === 'source' ? $('#sourceSettings') : section === 'workspace' ? $('#buildWorkspaceInput') : $('#appearanceHeading');
  heading?.scrollIntoView({ block: 'nearest' });
}

async function saveSettings() {
  const game = selectedGame();
  const sources = { ...state.settings.sources };
  if (game) {
    const repo = $('#repoInput').value.trim();
    const pattern = $('#assetPatternInput').value.trim();
    if (repo && !pattern) return toast('Add an APK filename pattern.', true);
    if (repo) sources[game.id] = { repo, assetPattern: pattern };
    else delete sources[game.id];
  }
  try {
    const buildWorkspace = $('#buildWorkspaceInput').value.trim();
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ adbPath: $('#adbPathInput').value.trim(), sources, buildWorkspace: buildWorkspace === state.settings.defaultBuildWorkspace ? '' : buildWorkspace, theme: state.theme, palette: state.palette }) });
    state.settings = { ...state.settings, adbPath: $('#adbPathInput').value.trim(), sources, buildWorkspace: buildWorkspace || state.settings.defaultBuildWorkspace, theme: state.theme, palette: state.palette };
    state.detailLayout = $('#detailLayoutInput').value;
    localStorage.setItem('vr4all-detail-layout', state.detailLayout);
    applyDetailLayout();
    state.sources = sources;
    state.releases = {};
    state.releaseErrors = {};
    $('#settingsDialog').close();
    await refreshDevices();
    if (game) selectGame(game.id);
    toast('Settings saved');
  } catch (error) { toast(error.message, true); }
}

document.addEventListener('click', (event) => {
  const port = event.target.closest('.port-choice');
  if (port) {
    const chosen = state.games.find((entry) => entry.id === port.dataset.portId);
    if (!chosen) return;
    state.portChoices[parentId(chosen)] = chosen.id;
    try { localStorage.setItem('vr4all-port-choices', JSON.stringify(state.portChoices)); } catch { /* Selection still works in memory. */ }
    selectGame(chosen.id);
    return;
  }
  const nav = event.target.closest('.nav-item');
  if (nav) { state.category = nav.dataset.category; renderCategories(); renderGrid(); return; }
  const card = event.target.closest('.game-card');
  if (card) { selectGame(card.dataset.id); return; }
  const choice = event.target.closest('.source-choice');
  if (choice) { rememberInputs(); state.mode[state.selectedId] = choice.dataset.mode; selectGame(state.selectedId); return; }
  const browseButton = event.target.closest('.browse-btn');
  if (browseButton) { browse(browseButton.dataset.picker, browseButton.dataset.target); return; }
  const buildBrowse = event.target.closest('.build-browse-btn');
  if (buildBrowse) { browse(buildBrowse.dataset.buildKind, buildBrowse.dataset.buildTarget === 'gamePackage' ? 'buildGamePath' : 'buildAudioPath'); return; }
  if (event.target.closest('#installButton')) { install(); return; }
  if (event.target.closest('#personalBuildButton')) { buildPersonalGame(); return; }
  if (event.target.closest('#setupBuildToolsButton')) { startBuildTools(); return; }
  if (event.target.closest('#exportPhoneButton')) { startPhoneExport(); return; }
  if (event.target.closest('#phoneExportStartButton')) { exportFromPhone(); return; }
  if (event.target.closest('#phoneExportCheckButton')) { checkExportPhone(); return; }
  if (event.target.closest('#phoneExportRefreshButton')) { refreshExportPhones().catch((error) => toast(error.message, true)); return; }
  if (event.target.closest('#closePhoneExportButton')) { $('#phoneExportDialog').close(); return; }
  if (event.target.closest('#sdkStartButton')) { installBuildTools(); return; }
  if (event.target.closest('#sdkAcceptButton')) { answerBuildToolsLicense(true); return; }
  if (event.target.closest('#sdkDeclineButton')) { answerBuildToolsLicense(false); return; }
  if (event.target.closest('#closeSdkSetupButton')) { $('#sdkSetupDialog').close(); return; }
  if (event.target.closest('#retryJobButton')) { retryFailedJob(); return; }
  if (event.target.closest('#editSourceButton')) { openSettings('source'); return; }
});
document.addEventListener('input', (event) => {
  if (!event.target.id?.startsWith('data-') || !state.selectedId) return;
  const itemId = event.target.id.slice(5);
  const game = selectedGame();
  rememberInputs();
  if (state.staged[game.id]?.[itemId] && state.staged[game.id][itemId] !== event.target.value) {
    delete state.staged[game.id][itemId];
    showFileCheck(game, itemId, '');
    renderGrid();
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'phoneExportDataSource') { setPhoneExportDataSource(event.target.value.trim()); checkExportPhone(); return; }
  if (['phoneExportEdition', 'phoneExportDevice'].includes(event.target.id)) { checkExportPhone(); return; }
  if (event.target.id === 'buildGamePath' || event.target.id === 'buildAudioPath') { setBuildPath(selectedGame(), event.target.id === 'buildGamePath' ? 'gamePackage' : 'audioSource', event.target.value.trim()); return; }
  if (event.target.id === 'apkPath' && state.selectedId) { validateSelectedApk(selectedGame(), event.target.value.trim()); return; }
  if (!event.target.id?.startsWith('data-') || !state.selectedId) return;
  validateSelectedFile(selectedGame(), event.target.id.slice(5), event.target.value.trim());
});
function setBrowseMode(mode) { state.browseMode = mode; state.category = 'All games'; renderCategories(); renderGrid(); }
$('#browseConsole').addEventListener('click', () => setBrowseMode('console'));
$('#browseGenre').addEventListener('click', () => setBrowseMode('genre'));
$('#libraryScope').addEventListener('change', (event) => { state.libraryScope = event.target.value; state.category = 'All games'; renderCategories(); renderGrid(); });
$('#closeDetail').addEventListener('click', () => { rememberInputs(); $('#detailPanel').hidden = true; state.selectedId = ''; applyDetailLayout(); });
$('#refreshDevices').addEventListener('click', () => refreshDevices().catch((error) => toast(error.message, true)));
$('#deviceSelect').addEventListener('change', (event) => { state.selectedSerial = event.target.value; refreshDevices().catch((error) => toast(error.message, true)); });
function updateGameSearch(value, scrollToResults = false) {
  const startingSearch = !state.search.trim() && Boolean(value.trim());
  state.search = value;
  $('#searchInput').value = value;
  $('#sidebarSearchInput').value = value;
  if (startingSearch) {
    if (state.libraryScope !== 'available') state.libraryScope = 'all';
    state.category = 'All games';
    renderLibraryScopeOptions();
    renderCategories();
  }
  renderGrid();
  if (startingSearch && scrollToResults) $('#library').scrollIntoView({ behavior: 'smooth' });
}
$('#searchInput').addEventListener('input', (event) => updateGameSearch(event.target.value));
$('#librarySort').addEventListener('change', (event) => {
  state.sortMode = event.target.value;
  try { localStorage.setItem('vr4all-library-sort', state.sortMode); } catch { /* Sorting still works in memory. */ }
  renderGrid();
});
$('#installedFirst').addEventListener('change', (event) => {
  state.installedFirst = event.target.checked;
  try { localStorage.setItem('vr4all-installed-first', String(state.installedFirst)); } catch { /* Checkbox still works in memory. */ }
  renderGrid();
});
$('#sidebarSearchInput').addEventListener('input', (event) => updateGameSearch(event.target.value, true));
$('#browseGames').addEventListener('click', () => $('#library').scrollIntoView({ behavior: 'smooth' }));
$('#sidebarUpdatesButton').addEventListener('click', () => checkAllReleases());
$('#scanHeadsetButton').addEventListener('click', async () => {
  setActivity('scan-headset', 'Scanning connected headsets and installed games…');
  try { await refreshDevices(); setActivity('scan-headset', state.selectedSerial ? 'Connected headset scan complete' : 'No authorized Quest found', false, !state.selectedSerial); if (state.selectedSerial) toast('Connected headset scanned'); }
  catch (error) { setActivity('scan-headset', `Headset scan failed: ${error.message}`, false, true); toast(error.message, true); }
});
async function openBulkDialog(mode) {
  if (state.bulkRunning || state.bulkUpdatePreparing || state.bulkUploading) return;
  if (mode === 'update' && !confirmedBulkUpdates().length) return;
  state.bulkMode = mode;
  $('#bulkDialogTitle').textContent = mode === 'update' ? 'Bulk update installed games' : 'Bulk install new games';
  $('#bulkRunButton').textContent = mode === 'update' ? 'Update selected installed games' : 'Install selected new games';
  if (mode === 'new') {
    setActivity('bulk-scan', '');
    state.bulkMatches = [];
    state.managedFiles = rememberedLibraryFiles();
    const available = libraryGames().filter((game) => portFamily(game).some(isAvailableForInstall)).length;
    $('#bulkScanSummary').textContent = `${available} game${available === 1 ? '' : 's'} available to install. Headset status is checked when you start installing.`;
    renderBulkMatches();
    renderSavedLibraryFiles();
    $('#bulkDialog').showModal();
    return;
  }
  const updates = confirmedBulkUpdates().map((game) => game.id);
  bulkUpdateProgress(`Preparing ${updates.length} update${updates.length === 1 ? '' : 's'}…`);
  try {
    await runBulkInstall(updates);
  } catch (error) {
    bulkUpdateProgress(`Bulk update failed: ${error.message}`, false);
    toast(error.message, true);
  }
}
$('#bulkInstallNewButton').addEventListener('click', () => openBulkDialog('new'));
$('#bulkUpdateButton').addEventListener('click', () => openBulkDialog('update'));
$('#closeBulkButton').addEventListener('click', () => { if (!state.bulkRunning && !state.bulkUploading) $('#bulkDialog').close(); });
$('#bulkDialog').addEventListener('cancel', (event) => { if (state.bulkRunning || state.bulkUploading) event.preventDefault(); });
$('#bulkMatches').addEventListener('change', () => { $('#bulkRunButton').disabled = state.bulkRunning || !document.querySelector('.bulk-select:checked'); });
$('#savedLibraryFiles').addEventListener('click', async (event) => {
  const button = event.target.closest('.remove-saved-file');
  if (!button || state.bulkRunning || state.bulkUploading) return;
  try {
    await api('/api/library/remove', { method: 'POST', body: JSON.stringify({ id: button.dataset.id }) });
    forgetRememberedChoice(button.dataset.id);
  } catch (error) { toast(error.message, true); }
});
$('#bulkRunButton').addEventListener('click', () => runBulkInstall().catch((error) => { state.bulkRunning = false; $('#closeBulkButton').disabled = false; toast(error.message, true); }));
$('#changeThemeButton').addEventListener('click', () => openSettings('appearance'));
$('#pcBuildFolderButton').addEventListener('click', () => openSettings('workspace'));
$('#connectionHelpButton').addEventListener('click', () => openSettings('connection'));
$('#settingsDialog').addEventListener('close', () => { applyTheme(state.settings.theme); applyPalette(state.settings.palette); });
$('#themeInput').addEventListener('change', (event) => applyTheme(event.target.value));
for (const option of document.querySelectorAll('[data-theme-choice]')) option.addEventListener('click', () => applyTheme(option.dataset.themeChoice));
$('#paletteInput').addEventListener('change', (event) => applyPalette(event.target.value));
for (const option of document.querySelectorAll('[data-palette-choice]')) option.addEventListener('click', () => applyPalette(option.dataset.paletteChoice));
$('#pickAdbButton').addEventListener('click', () => browse('file', 'adbPathInput'));
$('#pickBuildWorkspaceButton').addEventListener('click', () => browse('directory', 'buildWorkspaceInput'));
$('#resetBuildWorkspaceButton').addEventListener('click', () => { $('#buildWorkspaceInput').value = state.settings.defaultBuildWorkspace || ''; });
$('#saveSettingsButton').addEventListener('click', saveSettings);

async function boot() {
  try {
    const savedLayout = localStorage.getItem('vr4all-detail-layout');
    if (['docked', 'overlay', 'focus'].includes(savedLayout)) state.detailLayout = savedLayout;
    const savedSort = localStorage.getItem('vr4all-library-sort');
    if (['name-asc', 'name-desc', 'latest', 'downloads'].includes(savedSort)) state.sortMode = savedSort;
    if (savedSort === 'installed') state.installedFirst = true;
    const savedInstalledFirst = localStorage.getItem('vr4all-installed-first');
    if (savedInstalledFirst !== null) state.installedFirst = savedInstalledFirst === 'true';
    $('#librarySort').value = state.sortMode;
    applyDetailLayout();
    try { state.portChoices = JSON.parse(localStorage.getItem('vr4all-port-choices') || '{}') || {}; } catch { state.portChoices = {}; }
    const [{ games, sources, installed }, jobs, saved, settings, discovery] = await Promise.all([api('/api/catalog'), api('/api/jobs'), api('/api/local-paths'), api('/api/settings'), api('/api/discovery').catch(() => ({ stats: {} }))]);
    state.settings = settings;
    applyTheme(settings.theme);
    applyPalette(settings.palette);
    state.games = games; state.sources = sources || {}; state.installed = installed || {}; state.jobs = jobs.jobs || []; state.discovery = discovery.stats || {};
    state.savedPaths = saved.paths || {};
    state.pathAvailability = saved.availability || {};
    state.inputs = Object.fromEntries(Object.entries(state.savedPaths).map(([id, values]) => [id, { ...values }]));
    for (const game of state.games) {
      for (const item of game.data) {
        const local = state.savedPaths[game.id]?.[item.id];
        if (!local) continue;
        state.fileChecks[game.id] ||= {};
        if (state.pathAvailability[game.id]?.[item.id]) {
          state.staged[game.id] ||= {};
          state.staged[game.id][item.id] = local;
          state.fileChecks[game.id][item.id] = 'Saved game file found on PC · checked again before install';
        } else state.fileChecks[game.id][item.id] = 'Rejected: Saved path is missing or has the wrong format · Browse again';
      }
      if (state.savedPaths[game.id]?.apkPath && !state.pathAvailability[game.id]?.apkPath) state.apkChecks[game.id] = 'Rejected: Saved APK path is missing · Browse again';
    }
    renderCategories(); renderGrid(); await refreshDevices();
    const active = state.jobs.filter((job) => ['queued', 'running'].includes(job.status));
    const visibleJob = active[0] || state.jobs[0];
    if (visibleJob) selectGame(visibleJob.gameId);
    for (const job of active) pollJob(job.id);
  } catch (error) { toast(error.message, true); }
}
boot();
setInterval(() => {
  if (!document.hidden) refreshDevices({ scanLibrary: false }).catch(() => {});
}, 4000);
window.addEventListener('focus', () => refreshDevices({ scanLibrary: false }).catch(() => {}));
