const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { findOnPath } = require('./find-tool');
const { runLogged } = require('./run-logged');
const { findWineLauncher, runWindowsTool, windowsPath, wineInvocation } = require('./wine');

// Port of the creator's tools/INSTALL-HPVR.ps1 (release v0.1.4.1). The five hpvr_*.exe helpers run under Wine,
// ffmpeg decodes the audio, and every adb step the PowerShell script runs happens here in Node.
const PACKAGE = 'io.github.hpvr.quest';
const REMOTE_ROOT = `/sdcard/Android/data/${PACKAGE}/files/HP`;
const PERMISSION_ROOT = `/storage/emulated/0/Android/data/${PACKAGE}/files/HP`;
const PERMISSION_GUARD = `test ! -L '/storage/emulated/0/Android/data/${PACKAGE}' && test ! -L '/storage/emulated/0/Android/data/${PACKAGE}/files' || exit 1; `;
const APP_READ_PROBE_VERSION = 72;
const BATCH = 24;
const MINUTE = 60 * 1000;

const HELPERS = {
  graph: 'tools/hpvr_hp1_package_graph.exe',
  sound: 'tools/hpvr_hp1_sound_probe.exe',
  frontend: 'tools/hpvr_quest_frontend_probe.exe',
  intro: 'tools/hpvr_quest_intro_probe.exe',
  prepare: 'tools/hpvr_quest_prepare_assets.exe',
};
// Release map id -> level file. Map 0 is always installed; 1 challenge, 2 broom, 3 charms, 4 return.
const MAP_FILES = ['Lev_Tut1.unr', 'Lev_Tut1b.unr', 'Lev_Tut2.unr', 'Lev_Tut3.unr', 'Lev_Tut3b.unr'];
// Minimum app versionCode for a release that declares this many maps.
const MIN_VERSION_BY_MAP_COUNT = [0, 0, 38, 57, 71, 85];
const OWNED_KINDS = {
  system: { dir: 'system', extensions: ['.u', '.int'] },
  maps: { dir: 'Maps', extensions: ['.unr'] },
  textures: { dir: 'Textures', extensions: ['.utx'] },
  sounds: { dir: 'Sounds', extensions: ['.uax'] },
  music: { dir: 'Music', extensions: ['.umx'] },
};
const FIXED_FILES = ['system/HPBase.u', 'system/HarryPotter.u', 'system/HPMenu.u', 'system/HPParticle.u', 'system/HProps.u', 'system/HPSounds.u',
  'system/hpmenu.int', 'system/hpdialog.int', 'Textures/MenuArt.utx', 'Textures/StoryBookTest.utx',
  'Sounds/AllDialog.uax', 'Sounds/Magic_sfx.uax', 'Sounds/Ambient.uax', 'Sounds/Menu_sfx.uax', 'Sounds/Hub1_sfx.uax',
  'Music/JS_HP_Title_Screen_v2.umx', 'Music/JS_StoryBook_v2_mx.umx', 'Music/JS_Opening_Castle_Fly_Through_mx.umx', 'Music/happy_hogwarts_mxlp1.umx'];
const SUPPLEMENTAL_CLIPS = [
  ['AllDialog.uax', ['111DumbledoreInfo1', '111DumbledoreInfo2', '111DumbledoreInfo3', '111DumbledoreInfo4', 'Dumbledore_01']],
  ['Magic_sfx.uax', ['spell_tracing_loop', 'wand_ready_loop', 'spell_cast', 'flipendo_no']],
];

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function isRegularFile(file) {
  const stat = await fs.lstat(file).catch(() => null);
  return Boolean(stat?.isFile());
}

function assertSafeRelative(relative) {
  const segments = String(relative).split('/');
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_. /-]*$/.test(relative) || segments.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new Error(`Unsafe path in the Harry Potter data: ${relative}`);
  }
}

async function findCaseInsensitive(directory, name) {
  const entries = await fs.readdir(directory);
  if (entries.includes(name)) return name;
  const lower = name.toLowerCase();
  return entries.find((entry) => entry.toLowerCase() === lower) ?? null;
}

// The staged name keeps the spelling the engine asks for; the owned file is found case-insensitively because
// the Windows game folder may have been copied with different case.
async function ownedInput(ownedRoot, directory, file) {
  if (!directory || !file) throw new Error('Unexpected Harry Potter game path in the dependency scan.');
  const kind = OWNED_KINDS[directory.toLowerCase()];
  if (!kind || !kind.extensions.includes(path.extname(file).toLowerCase())) throw new Error(`Unexpected Harry Potter game file: ${directory}/${file}`);
  const relative = `${kind.dir}/${file}`;
  assertSafeRelative(relative);
  const realDirectory = await findCaseInsensitive(ownedRoot, directory);
  const directoryPath = realDirectory && path.join(ownedRoot, realDirectory);
  const realFile = directoryPath && (await fs.lstat(directoryPath)).isDirectory() ? await findCaseInsensitive(directoryPath, file) : null;
  const source = realFile && path.join(directoryPath, realFile);
  if (!source || !(await isRegularFile(source))) throw new Error(`Your Harry Potter game is missing a required file: ${relative}`);
  return { relative, source };
}

async function readReleaseManifest(bundleRoot) {
  let manifest;
  try { manifest = JSON.parse((await fs.readFile(path.join(bundleRoot, 'release-manifest.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new Error('The Harry Potter VR release manifest is missing or unreadable.'); }
  if (manifest.schema !== 1 || manifest.packageName !== PACKAGE || !/^[A-Za-z0-9_.-]+\.apk$/.test(manifest.apk || '') || !Array.isArray(manifest.files)) {
    throw new Error('The Harry Potter VR release manifest is not the supported format.');
  }
  const hashes = new Map();
  for (const entry of manifest.files) {
    assertSafeRelative(entry?.path);
    if (!/^[0-9a-fA-F]{64}$/.test(entry.sha256 || '')) throw new Error(`The release manifest has an invalid SHA-256 for ${entry.path}.`);
    const key = entry.path.toLowerCase();
    if (hashes.has(key)) throw new Error(`The release manifest lists ${entry.path} twice.`);
    const file = path.join(bundleRoot, ...entry.path.split('/'));
    if (!(await isRegularFile(file)) || await sha256File(file) !== entry.sha256.toLowerCase()) {
      throw new Error(`Official release file failed verification: ${entry.path}. Download the player again.`);
    }
    hashes.set(key, entry.sha256.toLowerCase());
  }
  for (const required of [manifest.apk, HELPERS.graph, HELPERS.sound, HELPERS.frontend, HELPERS.intro]) {
    if (!hashes.has(required.toLowerCase())) throw new Error(`The release manifest does not list ${required}.`);
  }
  if (!Number.isInteger(manifest.versionCode)) throw new Error('The release manifest has no versionCode.');
  if (manifest.preparedSceneVersion !== undefined && (manifest.preparedSceneVersion !== 1 || manifest.versionCode < 43 || !hashes.has(HELPERS.prepare))) {
    throw new Error('The release manifest declares unsupported prepared scenes.');
  }
  const mapIds = manifest.mapIds === undefined ? [0] : manifest.mapIds;
  if (!Array.isArray(mapIds) || mapIds.length < 1 || mapIds.length > 5 || mapIds.some((id, index) => id !== index)) {
    throw new Error('The release manifest lists an unsupported set of maps.');
  }
  if (manifest.versionCode < MIN_VERSION_BY_MAP_COUNT[mapIds.length]) throw new Error('The release manifest lists more maps than its app version supports.');
  return { apk: manifest.apk, versionCode: manifest.versionCode, hashes, mapIds, scenes: manifest.preparedSceneVersion === 1 };
}

// The five graph lines the creator parses; anything else is shown only in dependency-report.txt.
const PACKAGE_LINE = /^package=\S+ kind=data path=(.+) version=\d+ direct_dependencies=\d+ native_companion=[01]$/;

async function runtimeProbe(launcher, bundleRoot, { winePrefix, cwd, runner }) {
  const probe = await runWindowsTool(launcher, path.join(bundleRoot, ...HELPERS.graph.split('/')), [], { prefixRoot: winePrefix, cwd, timeoutMs: 10 * MINUTE, runner });
  if (probe.code !== 0 && probe.tail.some((line) => /usage/i.test(line))) return;
  const { prefixDir } = wineInvocation(launcher, '', [], winePrefix);
  throw new Error('Wine could not run the Harry Potter helper tools. Install the Microsoft Visual C++ 2015-2022 runtime into '
    + `VR4ALL's Wine prefix, then retry: WINEPREFIX="${prefixDir}" winetricks vcrun2022`);
}

function parseAudioPlan(text, passRoot) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const plan = new Map();
  for (const line of lines) {
    const match = /^([A-Za-z0-9_]+\.[0-9a-f]{8}(\.stereo)?\.s16)\t([12])$/.exec(line);
    const channels = Number(match?.[3]);
    if (!match || match[1].includes('.stereo.') !== (channels === 2) || plan.has(match[1])) throw new Error(`Invalid frontend audio conversion plan. (${path.basename(passRoot)})`);
    plan.set(match[1], channels);
  }
  return plan;
}

function batches(items) {
  const groups = [];
  for (let index = 0; index < items.length; index += BATCH) groups.push(items.slice(index, index + BATCH));
  return groups;
}

const quoted = (items) => items.map((item) => `'${item}'`).join(' ');

function permissionCommands(manifestPaths, appReadProbe) {
  const files = manifestPaths.map((relative) => `${PERMISSION_ROOT}/${relative}`).sort();
  const directories = new Set([PERMISSION_ROOT]);
  for (const relative of manifestPaths) {
    const parts = relative.split('/');
    for (let depth = 1; depth < parts.length; depth++) directories.add(`${PERMISSION_ROOT}/${parts.slice(0, depth).join('/')}`);
  }
  const modeCheck = (bits) => (appReadProbe ? '' : `; mode=$(stat -c %a "$p") || exit 1; case "$mode" in ${bits}) ;; *) echo "DATA_PERMISSION_FAILURE: $p mode=$mode"; exit 1 ;; esac`);
  const loop = (group, test, chmod, bits) => `${PERMISSION_GUARD}for p in ${quoted(group)}; do test ! -L "$p" && ${test} "$p" && chmod ${chmod} "$p" || exit 1${modeCheck(bits)}; done`;
  const sortedDirectories = [...directories].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  return [
    ...batches(sortedDirectories).map((group) => loop(group, 'test -d', 'o+rx', '*[57]')),
    ...batches(files).map((group) => loop(group, 'test -f', 'o+r', '*[4567]')),
  ];
}

async function installHarryPotterLinux({ bundleRoot, gameRoot, serial, adb, staging, onLog = () => {}, winePrefix }, { findWine = findWineLauncher, findTool = findOnPath, ffmpegPath, runner = runLogged } = {}) {
  const S = ['-s', serial];
  const release = await readReleaseManifest(bundleRoot);
  const launcher = findWine();
  if (!launcher) throw new Error('Harry Potter VR on Linux needs Wine. Install wine (Arch: pacman -S wine) and retry.');
  const ffmpeg = ffmpegPath || findTool(['ffmpeg']);
  if (!ffmpeg) throw new Error('Harry Potter VR on Linux needs ffmpeg. Install ffmpeg (Arch: pacman -S ffmpeg) and retry.');

  // prepare_assets rejects links on every path component, so hand the helpers fully resolved folders.
  const stagingRoot = await fs.realpath(staging);
  const ownedRoot = await fs.realpath(gameRoot);
  onLog('Checking that Wine can run the Harry Potter helper tools. The first run creates a Wine prefix and can take a minute...');
  await runtimeProbe(launcher, bundleRoot, { winePrefix, cwd: stagingRoot, runner });

  const maps = release.mapIds.map((id) => MAP_FILES[id]);
  onLog(`Selected release maps: ${release.mapIds.join(', ')}.`);
  const mapInputs = [];
  for (const map of maps) mapInputs.push(await ownedInput(ownedRoot, 'Maps', map));

  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
  const privateRun = path.join(stagingRoot, 'work', `import-${stamp}-${crypto.randomBytes(4).toString('hex')}`);
  const stagedGame = path.join(privateRun, 'HP');
  const audioCache = path.join(stagedGame, 'Cache', 'Audio');
  const encodedRoot = path.join(privateRun, 'encoded-private');
  await fs.mkdir(audioCache, { recursive: true });
  await fs.mkdir(encodedRoot, { recursive: true });

  const exe = (key) => path.join(bundleRoot, ...HELPERS[key].split('/'));
  async function helper(label, key, args, { timeoutMs, report, onLine } = {}) {
    const result = await runWindowsTool(launcher, exe(key), args, { prefixRoot: winePrefix, cwd: privateRun, timeoutMs, onLine, captureStdout: true, runner });
    if (result.code !== 0) throw new Error(`${label} failed (exit ${result.code}): ${result.tail.slice(-3).join(' | ')}`);
    if (report) await fs.writeFile(path.join(privateRun, report), result.stdout);
    return result;
  }

  // 2. Dependency scan: every package each selected map needs.
  const required = new Map();
  const addRequired = (entry) => required.set(entry.relative.toLowerCase(), entry);
  const report = [];
  for (const [mapIndex, map] of maps.entries()) {
    const result = await helper('The Harry Potter dependency scan', 'graph', [windowsPath(ownedRoot), windowsPath(mapInputs[mapIndex].source)], { timeoutMs: 10 * MINUTE });
    report.push(...result.stdout.split(/\r?\n/));
    const found = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const raw = PACKAGE_LINE.exec(line)?.[1];
      if (!raw) continue;
      const [directory, file] = raw.split(/[\\/]/).filter(Boolean).slice(-2);
      found.push(await ownedInput(ownedRoot, directory, file));
    }
    if (found.length < 3 || !found.some((entry) => entry.relative.toLowerCase() === `maps/${map.toLowerCase()}`)) {
      throw new Error(`The dependency scan of ${map} did not list its packages. Check that this is the US 2001 PC game.`);
    }
    found.forEach(addRequired);
  }
  // The level files keep the spelling the app asks for, whatever the scan printed.
  mapInputs.forEach(addRequired);
  const fixed = [...FIXED_FILES];
  if (release.mapIds.includes(3)) fixed.push('Textures/HP_FX.utx');
  if (release.mapIds.includes(4)) fixed.push('system/pickup.int');
  for (const relative of fixed) addRequired(await ownedInput(ownedRoot, ...relative.split('/')));
  await fs.writeFile(path.join(privateRun, 'dependency-report.txt'), report.join('\n'));
  const inputs = [...required.values()].sort((a, b) => (a.relative.toLowerCase() < b.relative.toLowerCase() ? -1 : 1));

  // 3. Stage only the required owned files.
  const manifest = [];
  for (const [index, input] of inputs.entries()) {
    const target = path.join(stagedGame, ...input.relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const sourceHash = await sha256File(input.source);
    await fs.copyFile(input.source, target);
    const [targetHash, sourceAfter] = await Promise.all([sha256File(target), sha256File(input.source)]);
    if (targetHash !== sourceHash || sourceAfter !== sourceHash) throw new Error(`The owned file changed or did not copy correctly: ${input.relative}`);
    manifest.push({ path: input.relative, sha256: sourceHash, bytes: (await fs.stat(target)).size });
    if ((index + 1) % 25 === 0) onLog(`Staged ${index + 1}/${inputs.length} game files...`);
  }
  onLog(`Staged ${inputs.length} required game-data files; no EXE, DLL, user config, or save was copied.`);

  // 4. Frontend audio plan: one pass per selected map, or a single pass for map 0 / the challenge.
  const plan = new Map();
  const copyEncoded = async (source, key) => {
    const destination = path.join(encodedRoot, `${key}.mp2`);
    if (source === destination) return;
    if (await isRegularFile(destination)) {
      if (await sha256File(destination) !== await sha256File(source)) throw new Error(`Conflicting encoded audio source: ${key}`);
    } else {
      await fs.copyFile(source, destination);
      if (await sha256File(destination) !== await sha256File(source)) throw new Error(`Encoded audio changed or failed to copy: ${key}`);
    }
  };
  const passes = release.mapIds.includes(4) ? [0, 1, 2, 3, 4] : release.mapIds.includes(3) ? [0, 1, 2, 3] : release.mapIds.includes(2) ? [0, 1, 2] : [-1];
  for (const pass of passes) {
    const passRoot = pass < 0 ? encodedRoot : path.join(privateRun, `encoded-map-${pass}`);
    const flags = pass >= 0 ? ['--map', String(pass)] : release.mapIds.includes(1) ? ['--challenge'] : [];
    onLog(pass >= 0 ? `Preparing the audio plan for level ${pass}...` : 'Preparing the audio plan...');
    await helper('The Harry Potter audio probe', 'frontend', [windowsPath(stagedGame), windowsPath(passRoot), ...flags], { timeoutMs: 30 * MINUTE, report: pass >= 0 ? `frontend-${pass}-report.txt` : 'frontend-report.txt' });
    const passPlan = parseAudioPlan(await fs.readFile(path.join(passRoot, 'audio-plan.tsv'), 'utf8'), passRoot);
    if (passPlan.size < 20) throw new Error(`The frontend audio plan is incomplete for pass ${pass}.`);
    for (const [key, channels] of passPlan) {
      if (plan.has(key) && plan.get(key) !== channels) throw new Error(`Conflicting audio channel counts for ${key}.`);
      await copyEncoded(path.join(passRoot, `${key}.mp2`), key);
      plan.set(key, channels);
    }
  }

  // 5. Supplemental clips the frontend probe does not list.
  for (const [archive, objects] of SUPPLEMENTAL_CLIPS) {
    for (const object of objects) {
      const extra = path.join(encodedRoot, `${object}.extra.mp2`);
      const result = await helper(`The Harry Potter sound export (${object})`, 'sound', [windowsPath(path.join(stagedGame, 'Sounds', archive)), '--export-mpeg', object, windowsPath(extra)], { timeoutMs: 10 * MINUTE });
      const names = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^cache_name=[A-Za-z0-9_]+\.[0-9a-f]{8}\.s16$/.test(line));
      if (names.length !== 1) throw new Error(`Missing source fingerprint for ${object}`);
      const key = names[0].slice('cache_name='.length);
      const encoded = path.join(encodedRoot, `${key}.mp2`);
      if (await isRegularFile(encoded)) {
        if (await sha256File(encoded) !== await sha256File(extra)) throw new Error(`Conflicting encoded source: ${key}`);
      } else await fs.copyFile(extra, encoded);
      plan.set(key, 1);
    }
  }

  // 6. Decode with the system ffmpeg.
  const keys = [...plan.keys()].sort();
  for (const [index, key] of keys.entries()) {
    const output = path.join(audioCache, key);
    const decoded = await runner(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(encodedRoot, `${key}.mp2`),
      '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', String(plan.get(key)), '-ar', '48000', output], { cwd: privateRun, timeoutMs: 5 * MINUTE });
    if (decoded.code !== 0) throw new Error(`Audio decoding failed: ${key} ${decoded.tail.slice(-2).join(' | ')}`);
    const pcm = await fs.readFile(output);
    if (pcm.length < 960 || pcm.length > 57_600_000 || pcm.length % (2 * plan.get(key)) !== 0) throw new Error(`Decoded audio has an unexpected size: ${key}`);
    if (!pcm.some((byte) => byte !== 0)) throw new Error(`Decoded audio is entirely silent: ${key}`);
    manifest.push({ path: `Cache/Audio/${key}`, sha256: crypto.createHash('sha256').update(pcm).digest('hex'), bytes: pcm.length });
    if ((index + 1) % 25 === 0) onLog(`Decoded ${index + 1}/${keys.length} audio clips...`);
  }

  // 7. Prepared scenes, so the headset loads them instead of building them.
  let preparedScenes = 0;
  if (release.scenes) {
    const toolPath = exe('prepare');
    if (await sha256File(toolPath) !== release.hashes.get(HELPERS.prepare)) throw new Error('The scene preparation tool changed after verification.');
    const preparedDir = path.join(privateRun, 'PreparedScenes');
    const sceneDir = path.join(stagedGame, 'Cache', 'Scenes');
    await fs.mkdir(preparedDir, { recursive: true });
    await fs.mkdir(sceneDir, { recursive: true });
    for (const id of release.mapIds) {
      onLog(`Preparing level ${id} on this PC so the headset can load prepared assets. This can take several minutes; no game is being launched.`);
      const args = [windowsPath(stagedGame), '--output', windowsPath(preparedDir), '--map', String(id)];
      await helper(`Scene preparation of level ${id}`, 'prepare', args, { timeoutMs: 60 * MINUTE, report: `prepared-scene-${id}.txt`, onLine: onLog });
      const prepared = path.join(preparedDir, `map-${id}.hpvc`);
      if (!(await isRegularFile(prepared)) || (await fs.stat(prepared)).size < 32) throw new Error(`Scene preparation did not produce a complete map-${id}.hpvc.`);
      await helper(`Scene verification of level ${id}`, 'prepare', [...args, '--verify'], { timeoutMs: 60 * MINUTE, report: `prepared-scene-${id}-verify.txt` });
      const verifiedHash = await sha256File(prepared);
      const copy = path.join(sceneDir, `map-${id}.hpvc`);
      await fs.copyFile(prepared, copy);
      if (await sha256File(copy) !== verifiedHash || await sha256File(prepared) !== verifiedHash) throw new Error(`The prepared scene map-${id}.hpvc changed while copying.`);
      manifest.push({ path: `Cache/Scenes/map-${id}.hpvc`, sha256: verifiedHash, bytes: (await fs.stat(copy)).size });
      preparedScenes++;
    }
    const expected = release.mapIds.map((id) => `map-${id}.hpvc`).sort();
    for (const directory of [preparedDir, sceneDir]) {
      if (JSON.stringify((await fs.readdir(directory)).sort()) !== JSON.stringify(expected)) throw new Error('The prepared scene folders hold unexpected files.');
    }
  }

  // 8. The creator's own check of the staged scenes and audio.
  await helper('Staged scene/audio validation', 'intro', [windowsPath(stagedGame), windowsPath(audioCache)], { timeoutMs: 30 * MINUTE, report: 'scene-report.txt' });

  // 9. APK and device import.
  const apk = path.join(bundleRoot, release.apk);
  if (await sha256File(apk) !== release.hashes.get(release.apk.toLowerCase())) throw new Error('APK changed during preparation.');
  await adb.run([...S, 'install', '--no-incremental', '-r', apk]).catch((error) => {
    throw new Error(`APK installation failed. If Android reports UPDATE_INCOMPATIBLE, uninstall the existing Harry Potter VR on the headset (this removes its saves) and retry. ${error.message}`);
  });
  const installedPaths = (await adb.run([...S, 'shell', 'pm', 'path', PACKAGE])).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const installedApk = installedPaths.length === 1 ? /^package:(\/data\/app\/[A-Za-z0-9_./~+=-]+\/base\.apk)\s*$/.exec(installedPaths[0])?.[1] : null;
  if (!installedApk) throw new Error('Expected exactly one installed Harry Potter VR APK path.');
  const remoteHash = async (file) => /^([0-9a-fA-F]{64})\s/.exec(`${await adb.run([...S, 'shell', `sha256sum '${file}'`])} `)?.[1]?.toLowerCase();
  if (await remoteHash(installedApk) !== release.hashes.get(release.apk.toLowerCase())) throw new Error('Installed APK hash verification failed.');
  await adb.run([...S, 'shell', 'am', 'force-stop', PACKAGE]);
  await adb.run([...S, 'shell', `mkdir -p '${REMOTE_ROOT}'`]);
  const folders = ['system', 'Maps', 'Textures', 'Sounds', 'Music', 'Cache/Audio', ...(release.scenes ? ['Cache/Scenes'] : [])];
  for (const folder of folders) await adb.run([...S, 'shell', `mkdir -p '${REMOTE_ROOT}/${folder}'`]);

  onLog(`Copying ${manifest.length} files to the headset...`);
  for (const [index, entry] of manifest.entries()) {
    assertSafeRelative(entry.path);
    if (!/^(system|Maps|Textures|Sounds|Music|Cache)\//.test(entry.path)) throw new Error(`Unexpected data path: ${entry.path}`);
    const local = path.join(stagedGame, ...entry.path.split('/'));
    if (await sha256File(local) !== entry.sha256) throw new Error(`Prepared data changed: ${entry.path}`);
    await adb.run([...S, 'push', '--sync', local, `${REMOTE_ROOT}/${entry.path}`]);
    if (await remoteHash(`${REMOTE_ROOT}/${entry.path}`) !== entry.sha256) {
      throw new Error(`Headset data verification failed: ${entry.path}. Re-run the installer to retry. Saves have not been touched.`);
    }
    if ((index + 1) % 25 === 0) onLog(`Copied ${index + 1}/${manifest.length} files...`);
  }

  const appReadProbe = release.versionCode >= APP_READ_PROBE_VERSION;
  const manifestPaths = manifest.map((entry) => entry.path);
  for (const command of permissionCommands(manifestPaths, appReadProbe)) {
    await adb.run([...S, 'shell', command]).catch((error) => { throw new Error(`The imported files could not be made readable by the app: ${error.message}`); });
  }
  if (appReadProbe) {
    for (const group of batches(manifestPaths)) {
      const reply = await adb.run([...S, 'shell', `am broadcast --receiver-foreground --include-stopped-packages -n ${PACKAGE}/.ImportAccessReceiver -a ${PACKAGE}.VERIFY_DATA --es paths '${group.join('|')}'`]);
      if (!reply.includes(`Broadcast completed: result=-1, data="HPVR_DATA_ACCESS=PASS files=${group.length}"`)) {
        throw new Error('The installed application cannot read the imported files. Data access verification failed; installation is not complete.');
      }
    }
    onLog(`DATA_ACCESS=PASS files=${manifestPaths.length} verifier=APP_UID vr_activity=NOT_STARTED`);
  } else onLog('DATA_PERMISSIONS=PASS verifier=MODE_BITS. This older APK has no application-UID read probe.');

  onLog(`INSTALL=PASS DATA_IMPORT=PASS files=${manifest.length} audio_clips=${plan.size} prepared_scenes=${preparedScenes} device=${serial}`);
  onLog('APP_LAUNCH=NOT_PERFORMED. Start Harry Potter VR yourself from Unknown Sources on the headset.');
  return { exitCode: 0 };
}

module.exports = { installHarryPotterLinux, permissionCommands };
