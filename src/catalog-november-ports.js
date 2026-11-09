// Quest releases and input requirements checked against the creators' pages on 8 November 2026.
const download = '/sdcard/Download/';
const n64 = ['.z64', '.n64', '.v64'];

const novemberPorts = [
  {
    id: 'south-park-vr', title: 'South Park VR', gameName: 'South Park', series: 'VistaLargaGames', category: 'Nintendo 64', color: '#88b5dd',
    description: 'The Nintendo 64 South Park game in standalone Quest VR, with head aim and an experimental co-op mode.',
    projectUrl: 'https://github.com/VistaLargaGames/South-Park-Quest-VR',
    source: { repo: 'VistaLargaGames/South-Park-Quest-VR', assetPattern: '^SouthParkVR-Quest-[0-9.]+\\.apk$' },
    data: [{ id: 'rom', label: 'Owned South Park USA N64 ROM', kind: 'file', extensions: n64, destination: download, renameOnHeadset: true, note: 'Original South Park (USA) cartridge ROM. Choose it inside the Quest app; the creator checks the ROM.' }],
    guidance: 'The creator documents Quest 3. Some geometry can flicker, and co-op is beta.',
  },
  {
    id: 'mario64mr', variantOf: 'sm64-vr', portLabel: 'Mario 64 MR', artId: 'sm64-vr', title: 'Mario 64 MR', gameName: 'Super Mario 64', series: 'Lucas Martinic', category: 'Nintendo 64', color: '#84b4d6',
    description: 'Mixed reality Super Mario 64 for Quest 2, 3 and 3S.',
    projectUrl: 'https://github.com/lucas-martinic/mario64mr', externalInstaller: true,
    data: [],
    guidance: 'This port needs a ROM-specific native build before the Quest APK can run the game. The creator’s Python tool requires Linux, macOS or WSL, Android NDK and the exact US ROM SHA-1 9bef1128717f958171a4afac3ed78ee2bb4e86ce. VR4ALL cannot yet perform that build, so installation is disabled here rather than claiming the APK alone is playable.',
  },
  {
    id: 'lsd-vr-beta', title: 'LSD VR beta', gameName: 'LSD: Dream Emulator', series: 'Community beta', category: 'PlayStation', color: '#ad84bf',
    description: 'User-submitted Quest APK; creator and game-file requirements are not verified.',
    projectUrl: 'https://www.mediafire.com/file/oxc8xpqkqdv7av5/lsd-vr-beta.apk/file',
    data: [],
    guidance: 'This MediaFire APK has no verified creator page or update feed. Download it yourself and select Local APK to install it with VR4ALL. Treat it as an unverified beta; VR4ALL cannot confirm its contents or update it automatically.',
  },
  {
    id: 'bully-vr', title: 'Bully VR (Recovery pre-alpha)', gameName: 'Bully: Scholarship Edition', series: 'crtx01', category: 'Wii', color: '#b98b61',
    description: 'Early standalone VR preview of the Wii edition. The full campaign is not yet validated.',
    projectUrl: 'https://github.com/crtx01/BullyVR',
    source: { repo: 'crtx01/BullyVR', assetPattern: '^BullyVR-Recovery-Test-r[0-9]+\\.apk$' },
    data: [{ id: 'disc', label: 'Owned US Bully: Scholarship Edition Wii disc', kind: 'file', extensions: ['.iso'], destination: '/sdcard/Bully VR/Bully.iso', note: 'US Wii RB7E54. Choose the copied disc from the game’s file picker. Other regions and revisions are untested.' }],
    guidance: 'VR4ALL selects the Recovery test APK, not the older exploration demo. This is an incomplete pre-alpha: some weapons, vehicles, cutscenes and long sessions are unfinished.',
  },
  {
    id: 'lba2-quest', title: 'Little Big Adventure 2 VR', gameName: 'Little Big Adventure 2', series: 'simsas-experiments', category: 'PC', color: '#8cae9a',
    description: 'Experimental native Quest port of Twinsen’s Odyssey.',
    projectUrl: 'https://github.com/simsas-experiments/lba2-classic-quest',
    source: { repo: 'simsas-experiments/lba2-classic-quest', releasePattern: '^v[0-9]', assetPattern: '^lba2cc-[0-9.]+-quest-arm64-v8a\\.apk$' },
    fileAccessPackage: 'org.lbalab.lba2cc',
    data: [{ id: 'game', label: 'Owned Little Big Adventure 2 data folder', kind: 'directory', destination: '/sdcard/lba2cc/lba2/', requiredEntries: ['lba2.hqr'], note: 'Choose the folder containing lba2.hqr and the other HQR, music, video and voice files. The creator’s Quest layout is /sdcard/lba2cc/lba2/.' }],
    guidance: 'VR4ALL uses a tagged Quest ARM64 release rather than the untested rolling build, copies your owned data and grants the documented all-files access.',
  },
  {
    id: 'xonotic-vr', title: 'Xonotic VR', gameName: 'Xonotic', series: 'SgtBilko76', category: 'PC', color: '#b55b68',
    description: 'The free arena shooter runs standalone on Quest with its game data in one APK.',
    projectUrl: 'https://github.com/SgtBilko76/Xonotic-VR',
    source: { repo: 'SgtBilko76/Xonotic-VR', assetPattern: '^Xonotic-VR-full-release\\.apk$' },
    data: [], guidance: 'The creator bundles Xonotic 0.8.6 in the APK. Leave about 3 GB free for first-run extraction. Supports Quest 2, 3, 3S and Pro according to the creator.',
  },
  {
    id: 'primedgun-echoes', title: 'PrimedGun Echoes', gameName: 'Metroid Prime 2: Echoes', series: 'iChris4', category: 'GameCube', color: '#8c81c4',
    description: 'Native Metroid Prime 2 VR on Quest, currently in alpha/beta testing.',
    projectUrl: 'https://github.com/iChris4/MetroidPrime2PortVR',
    source: { repo: 'iChris4/MetroidPrime2PortVR', assetPattern: '^PrimedGunEchoes-v[0-9A-Za-z.-]+-Quest\\.apk$' },
    data: [{ id: 'disc', label: 'Owned Metroid Prime 2 disc image', kind: 'file', extensions: ['.iso', '.gcm', '.rvz', '.wia', '.ciso', '.wbfs'], destination: download, renameOnHeadset: true, note: 'GameCube USA G2ME01 is creator-tested; PAL and Trilogy discs are experimental. Choose the copied image with Select Game in the headset.' }],
    guidance: 'VR4ALL installs the Quest APK and copies your disc to Download. Import it with the app’s Select Game button. Install updates over the existing APK to preserve saves.',
  },
  {
    id: 'urban-terror-vr', title: 'Urban Terror VR', gameName: 'Urban Terror 4.3', series: 'SgtBilko76', category: 'PC', color: '#6b9d9c',
    description: 'Standalone tactical shooter for Quest with online play.',
    projectUrl: 'https://github.com/SgtBilko76/UrbanTerror4-VR',
    source: { repo: 'SgtBilko76/UrbanTerror4-VR', assetPattern: '^UrbanTerror4-VR-v[0-9.]+\\.apk$' },
    data: [], guidance: 'After APK install, open the app and approve its first-run download of the free Urban Terror 4.3.4 data from FrozenSand. It verifies the 1.4 GB download; leave about 3 GB free.',
  },
  {
    id: 'openarena-vr', title: 'OpenArena VR', gameName: 'OpenArena', series: 'SgtBilko76', category: 'PC', color: '#6799ad',
    description: 'The complete free arena shooter in a standalone Quest APK.',
    projectUrl: 'https://github.com/SgtBilko76/OpenArena-VR',
    source: { repo: 'SgtBilko76/OpenArena-VR', assetPattern: '^OpenArena-VR-v[0-9.]+\\.apk$' },
    data: [], guidance: 'The APK contains the full OpenArena 0.8.8 game. First launch unpacks about 400 MB; allow file access when prompted. The creator lists Quest 2, 3, 3S and Pro.',
  },
  {
    id: 'project-honeydew-2', title: 'Project Honeydew 2', gameName: 'Pikmin 2', series: 'Project Honeydew', category: 'GameCube', color: '#b9ae69',
    description: 'Pikmin 2 in standalone VR on Quest 3 and 3S.',
    projectUrl: 'https://projecthoneydew.com/#honeydew2-install-quest', source: { provider: 'project-honeydew-2' }, verifyApkHash: true, reuseInstalledData: true,
    data: [{ id: 'disc', label: 'Owned Pikmin 2 GameCube disc', kind: 'file', extensions: ['.iso', '.gcm'], destination: download, renameOnHeadset: true, note: 'Plain USA GPVE01 or Europe GPVP01 ISO/GCM. The Quest app imports it on first launch; convert RVZ/WIA/GCZ/CISO/NKit to ISO first.' }],
    guidance: 'VR4ALL downloads the creator’s checksum-verified Quest APK and copies your disc. Choose it inside the app and allow about 1.2 GB free for the import. This is an experimental preview.',
  },
  {
    id: 'openmohaa-vr', title: 'OpenMoHAA VR', gameName: 'Medal of Honor: Allied Assault', series: 'bearstonem', category: 'PC', color: '#8d927d',
    description: 'Quest 3 prerelease of Medal of Honor: Allied Assault in room-scale VR.',
    projectUrl: 'https://github.com/bearstonem/openmohaa-vr',
    source: { repo: 'bearstonem/openmohaa-vr', assetPattern: '^openmohaa-vr-quest3-[0-9.]+\\.apk$' },
    data: [
      { id: 'game', label: 'Owned Allied Assault main folder', kind: 'directory', destination: '/sdcard/Android/data/org.openmoh.openmohaa/files/main/', requiredEntries: ['pak0.pk3'], note: 'Choose the complete retail main folder. On a fresh install, launch the Quest app once so it creates its files directory before transferring.' },
      { id: 'config', label: 'Creator autoexec.cfg from the same release', kind: 'file', extensions: ['.cfg'], destination: '/sdcard/Android/data/org.openmoh.openmohaa/files/main/autoexec.cfg', note: 'Download autoexec.cfg from the creator’s release beside the APK. It provides the current lighting workaround and normal startup menu.' },
    ],
    guidance: 'The current 0.2.0 Quest 3 build is a prerelease. Both your original main folder and the matching creator autoexec.cfg are required; install once, open the app, then transfer. Other Quest models and full campaign coverage are unverified.',
  },
  {
    id: 'lets-go-jungle-vr', title: 'Let’s Go Jungle! VR', gameName: 'Let’s Go Jungle!', series: 'lialan', category: 'Arcade', color: '#80ac75',
    description: 'Experimental Sega Lindbergh lightgun game on Quest.',
    projectUrl: 'https://github.com/lialan/lindbergh-recomp-ports/blob/main/docs/lgj/QUEST.md',
    source: { repo: 'lialan/lindbergh-recomp-ports', assetPattern: '^LetsGoJungleVR-v[0-9.]+-quest3\\.apk$' }, fileAccessPackage: 'org.lindbergh.lgj.vr',
    data: [{ id: 'game', label: 'Owned Let’s Go Jungle arcade folder', kind: 'directory', destination: '/sdcard/LetsGoJungle/', requiredEntries: ['lgj_final'], requiredDirectories: ['data', 'shader', 'extraShader'], note: 'The creator requires the exact lgj_final executable SHA-256 3edbf6a4c5c97cc37e0ff353cacd265360da42c3b5efa4d1370dfa5e63f58ec9.' }],
    guidance: 'The creator’s newest Let’s Go Jungle APK is v0.2.7, separate from the other Lindbergh games’ v0.4.0 release. It is still experimental and may be buggy.',
  },
  {
    id: 'hotd4-special-vr', title: 'The House of the Dead 4 Special VR', gameName: 'The House of the Dead 4 Special', series: 'lialan', category: 'Arcade', color: '#a9656b',
    description: 'The Lindbergh Special edition in standalone VR on Quest 3, 3S and Pro.',
    projectUrl: 'https://github.com/lialan/lindbergh-recomp-ports/blob/main/docs/hotd4sp/QUEST.md',
    source: { repo: 'lialan/lindbergh-recomp-ports', assetPattern: '^HouseOfTheDead4SpecialVR-v[0-9.]+-quest3\\.apk$' }, fileAccessPackage: 'org.lindbergh.hotd4sp.vr',
    data: [{ id: 'game', label: 'Owned House of the Dead 4 Special folder', kind: 'directory', destination: '/sdcard/HouseOfTheDead4Special/', requiredDirectories: ['elf', 'fs'], note: 'Choose the folder containing elf and fs. The creator requires elf/hod4M.elf SHA-256 b84c70d9940d5f5fa7d287fd8c6b050444fdcbc2fd742d3afc74a1099bbec5fe.' }],
    guidance: 'VR4ALL installs this title’s own Quest APK, copies the original arcade data and grants the documented all-files access.',
  },
];

const novemberPortFacets = {
  'south-park-vr': ['Nintendo 64', 'Shooter'], mario64mr: ['Nintendo 64', 'Platformer'], 'lsd-vr-beta': ['PlayStation', 'Adventure'],
  'bully-vr': ['Wii', 'Adventure'], 'lba2-quest': ['PC', 'Adventure'], 'xonotic-vr': ['PC', 'Shooter'],
  'primedgun-echoes': ['GameCube', 'Shooter'], 'urban-terror-vr': ['PC', 'Shooter'], 'openarena-vr': ['PC', 'Shooter'],
  'project-honeydew-2': ['GameCube', 'Strategy'], 'openmohaa-vr': ['PC', 'Shooter'],
  'lets-go-jungle-vr': ['Arcade', 'Rail shooter'], 'hotd4-special-vr': ['Arcade', 'Rail shooter'],
};

module.exports = { novemberPorts, novemberPortFacets };
