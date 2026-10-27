const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getCatalog } = require('../src/catalog');
const { scanLibraryFolder, scanLibraryPaths } = require('../src/library-folder');
const { inspectDirectoryArchive, inspectSingleFileArchive } = require('../src/archive-conversion');
const runFile = promisify(execFile);
const bundledZip = path.join(__dirname, '..', 'vendor', '7zip', '7z.exe');

test('one folder matches official APK names and verifies Nintendo 64 game identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-library-'));
  try {
    const rom = Buffer.alloc(128);
    rom.writeUInt32BE(0x80371240, 0);
    rom.write('NSME', 0x3b, 'ascii');
    await fs.writeFile(path.join(root, 'Mario.z64'), rom);
    await fs.writeFile(path.join(root, 'SM64-Co-Op-DX-VR-Quest-1.2.apk'), 'apk');
    await fs.writeFile(path.join(root, 'RoadRashJailbreak-0.1.0.zip'), 'zip');
    const result = await scanLibraryFolder(root, getCatalog());
    const mario = result.matches.find((match) => match.gameId === 'sm64-vr');
    assert.equal(path.basename(mario.files.rom), 'Mario.z64');
    assert.equal(path.basename(mario.apkPath), 'SM64-Co-Op-DX-VR-Quest-1.2.apk');
    assert.equal(result.matches.find((match) => match.gameId === 'road-rash-vr')?.apkPath, undefined);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('folder scan does not assign a generic disc image to multiple games', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-library-'));
  try {
    await fs.writeFile(path.join(root, 'game.iso'), 'data');
    const result = await scanLibraryFolder(root, getCatalog());
    assert.equal(result.matches.some((match) => Object.values(match.files).includes(path.join(root, 'game.iso'))), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('large installed-game trees do not hide sibling ROMs or their own game folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-large-library-'));
  try {
    const rom = Buffer.alloc(128);
    rom.writeUInt32BE(0x80371240, 0);
    rom.write('NSME', 0x3b, 'ascii');
    await fs.writeFile(path.join(root, 'Super Mario 64 (USA).z64'), rom);
    const amnesia = path.join(root, 'Amnesia');
    for (const name of ['config', 'maps', 'entities']) await fs.mkdir(path.join(amnesia, name), { recursive: true });
    for (let start = 0; start < 5001; start += 100) {
      await Promise.all(Array.from({ length: Math.min(100, 5001 - start) }, (_, index) =>
        fs.writeFile(path.join(amnesia, 'maps', `asset-${start + index}.map`), 'owned fixture')));
    }
    const result = await scanLibraryFolder(root, getCatalog());
    assert.equal(result.matches.find((match) => match.gameId === 'sm64-vr')?.files.rom, path.join(root, 'Super Mario 64 (USA).z64'));
    assert.equal(result.matches.find((match) => match.gameId === 'sclerosis-vr')?.files.gamePath, amnesia);
    assert.match(result.warnings.join(' '), /scan limit/i);
    const dropped = await scanLibraryPaths([root], getCatalog());
    assert.equal(dropped.matches.find((match) => match.gameId === 'sm64-vr')?.files.rom, path.join(root, 'Super Mario 64 (USA).z64'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('folder scan matches separate game data folders by their expected destination names', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-library-'));
  try {
    await fs.mkdir(path.join(root, 'Quake', 'id1'), { recursive: true });
    await fs.writeFile(path.join(root, 'Quake', 'id1', 'pak0.pak'), 'data');
    await fs.mkdir(path.join(root, 'Half-Life', 'valve'), { recursive: true });
    await fs.writeFile(path.join(root, 'Half-Life', 'valve', 'pak0.pak'), 'data');
    const result = await scanLibraryFolder(root, getCatalog());
    assert.equal(result.matches.find((match) => match.gameId === 'quakequest').files.id1, path.join(root, 'Quake', 'id1'));
    assert.equal(result.matches.find((match) => match.gameId === 'lambda1vr').files.valve, path.join(root, 'Half-Life', 'valve'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Downloads scan matches 18 Wheeler CHD or a complete GDI folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-wheeler-scan-'));
  try {
    const gdi = path.join(root, '18 Wheeler USA');
    await fs.mkdir(gdi);
    await fs.writeFile(path.join(gdi, 'disc.gdi'), 'index');
    await fs.writeFile(path.join(gdi, 'track01.bin'), 'track');
    await fs.writeFile(path.join(root, '18 Wheeler USA.chd'), 'disc');
    const result = await scanLibraryFolder(root, getCatalog());
    const match = result.matches.find((entry) => entry.gameId === '18-wheeler-vr');
    assert.equal(match.files.chd, path.join(root, '18 Wheeler USA.chd'));
    assert.equal(match.files.gdi, gdi);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Downloads scan finds a zipped Amnesia game but ignores its installer ZIP', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-amnesia-scan-'));
  try {
    const game = path.join(root, 'Amnesia The Dark Descent');
    for (const folder of ['config', 'maps', 'entities']) {
      await fs.mkdir(path.join(game, folder), { recursive: true });
      await fs.writeFile(path.join(game, folder, 'data.bin'), 'owned fixture');
    }
    const archive = path.join(root, 'Amnesia The Dark Descent.7z');
    await runFile(bundledZip, ['a', '-t7z', archive, 'Amnesia The Dark Descent'], { cwd: root, windowsHide: true });
    await fs.writeFile(path.join(root, 'setup.exe'), 'installer');
    await runFile(bundledZip, ['a', '-tzip', path.join(root, 'Amnesia installer.zip'), 'setup.exe'], { cwd: root, windowsHide: true });
    const result = await scanLibraryFolder(root, getCatalog(), {}, { inspectDirectoryArchive });
    const match = result.matches.find((entry) => entry.gameId === 'sclerosis-vr');
    assert.equal(match.files.gamePath, game);
    await fs.rm(game, { recursive: true, force: true });
    const archived = await scanLibraryFolder(root, getCatalog(), {}, { inspectDirectoryArchive });
    assert.equal(archived.matches.find((entry) => entry.gameId === 'sclerosis-vr').files.gamePath, archive);
    await fs.rm(archive);
    const installerOnly = await scanLibraryFolder(root, getCatalog(), {}, { inspectDirectoryArchive });
    assert.equal(installerOnly.matches.find((entry) => entry.gameId === 'sclerosis-vr')?.files.gamePath, undefined);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('APK package ID separates overlapping Time Crisis filename patterns', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-library-'));
  try {
    await fs.writeFile(path.join(root, 'TimeCrisisVR-v0.9.4-quest3.apk'), 'apk');
    const result = await scanLibraryFolder(root, getCatalog(), {}, { inspectApk: async () => 'org.timecrisis.quest' });
    assert.equal(result.matches.find((match) => match.gameId === 'dr89-time-crisis')?.apkPath.endsWith('.apk'), true);
    assert.equal(result.matches.find((match) => match.gameId === 'time-crisis-vr')?.apkPath, undefined);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('new ROM matches keep revision uncertainty visible and reject fake Pokémon data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-library-'));
  try {
    const wave = Buffer.alloc(128);
    wave.writeUInt32BE(0x80371240, 0);
    await fs.writeFile(path.join(root, 'Wave Race 64 USA.z64'), wave);
    await fs.writeFile(path.join(root, 'Pokemon Blue.gb'), Buffer.alloc(1024 * 1024));
    const result = await scanLibraryFolder(root, getCatalog());
    const matched = result.matches.find((match) => match.gameId === 'wave-race-vr');
    assert.equal(path.basename(matched.files.rom), 'Wave Race 64 USA.z64');
    assert.match(matched.checks.rom, /not verified/i);
    assert.equal(result.matches.find((match) => match.gameId === 'pokemon-gen1-vr'), undefined);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('scan identifies a Mega Man 64 cartridge by its header even when its file name differs from the port title', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-megaman-scan-'));
  try {
    const rom = Buffer.alloc(128);
    rom.writeUInt32BE(0x80371240, 0);
    rom.write('NM6E', 0x3b, 'ascii');
    await fs.writeFile(path.join(root, 'backup.z64'), rom);
    const result = await scanLibraryFolder(root, getCatalog());
    assert.equal(result.matches.find((match) => match.gameId === 'mega-man-64-vr')?.files.rom, path.join(root, 'backup.z64'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('scan matches downloaded duplicate numbered arcade ZIPs to their destination names', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-numbered-zip-'));
  try {
    await fs.writeFile(path.join(root, 'rom.bin'), 'owned fixture');
    const archive = path.join(root, 'namcoc71 (1).zip');
    await runFile(bundledZip, ['a', '-tzip', archive, 'rom.bin'], { cwd: root, windowsHide: true });
    const result = await scanLibraryFolder(root, getCatalog());
    assert.equal(result.matches.find((match) => match.gameId === 'time-crisis-vr')?.files.namcoc71, archive);
    assert.equal(result.matches.find((match) => match.gameId === 'dirt-dash-vr')?.files.namcoc71, archive);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('scan matches a C71 BIOS archive only when it contains c71.bin', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-c71-scan-'));
  try {
    await fs.writeFile(path.join(root, 'c71.bin'), 'owned BIOS fixture');
    await fs.writeFile(path.join(root, 'unrelated.bin'), 'other fixture');
    const good = path.join(root, 'Namco C71 BIOS.7z');
    const bad = path.join(root, 'c71-invalid.zip');
    await runFile(bundledZip, ['a', '-t7z', good, 'c71.bin'], { cwd: root, windowsHide: true });
    await runFile(bundledZip, ['a', '-tzip', bad, 'unrelated.bin'], { cwd: root, windowsHide: true });
    await fs.rm(path.join(root, 'c71.bin'));
    const scanned = await scanLibraryFolder(root, getCatalog(), {}, { inspectDirectoryArchive, inspectSingleFileArchive });
    assert.equal(scanned.matches.find((match) => match.gameId === 'rave-racer-vr')?.files.bios, good);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('scan matches an archived single ROM to its game', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-rom-archive-scan-'));
  try {
    const rom = Buffer.alloc(128);
    rom.writeUInt32BE(0x80371240, 0);
    rom.write('NSME', 0x3b, 'ascii');
    await fs.writeFile(path.join(root, 'Mario.z64'), rom);
    const archive = path.join(root, 'Super Mario 64.7z');
    await runFile(bundledZip, ['a', '-t7z', archive, 'Mario.z64'], { cwd: root, windowsHide: true });
    await fs.rm(path.join(root, 'Mario.z64'));
    const scanned = await scanLibraryFolder(root, getCatalog(), {}, { inspectSingleFileArchive });
    assert.equal(scanned.matches.find((match) => match.gameId === 'sm64-vr')?.files.rom, archive);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a creator-hosted APK can match its catalog port by the verified package ID', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-apk-id-'));
  try {
    const apk = path.join(root, 'BenMcLean.Wolf3D.VR_android-meta-quest.apk');
    await fs.writeFile(apk, 'test APK');
    const result = await scanLibraryFolder(root, getCatalog(), {}, { inspectApk: async () => 'net.benmclean.wolf3d' });
    assert.equal(result.matches.find((match) => match.gameId === 'wolfsharp')?.apkPath, apk);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('folder scan recognizes a verified F-Zero ROM and creator package as build inputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-fzero-scan-'));
  try {
    const rom = path.join(root, 'F-Zero X (U).z64');
    const bundle = path.join(root, 'FZeroXVR-Public-Quest-R10.zip');
    await fs.writeFile(rom, 'ROM fixture');
    await fs.writeFile(bundle, 'creator fixture');
    const result = await scanLibraryFolder(root, getCatalog(), {}, { validateFzeroInput: async (input) => {
      assert.equal(input.gamePackage, rom);
      assert.equal(input.audioSource, bundle);
      return input;
    } });
    assert.deepEqual(result.matches.find((match) => match.gameId === 'fzero-x-virtuavr')?.buildInputs, { gamePackage: rom, audioSource: bundle });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
