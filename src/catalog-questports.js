// Standalone Quest projects from their creators' own download pages.
const download = '/sdcard/Download/';

const questports = [
  {
    id: 'daggerfall-unity-vr', title: 'Daggerfall Unity VR', gameName: 'The Elder Scrolls II: Daggerfall', series: 'rwcrosk-arch', category: 'PC', color: '#b6a179',
    description: 'The original Daggerfall world in an experimental native Quest 3 VR build.',
    projectUrl: 'https://github.com/rwcrosk-arch/dfu-quest3',
    source: { repo: 'rwcrosk-arch/dfu-quest3', assetPattern: '^DFU-Quest3VR-beta[0-9]+\\.apk$' },
    data: [{ id: 'game', label: 'Original Daggerfall ARENA2 folder', kind: 'directory', destination: '/sdcard/Android/data/com.dfworkshop.dfuquest3/files/Daggerfall/arena2/', requiredEntries: ['ARCH3D.BSA', 'TEXTURE.000'], note: 'Use the ARENA2 folder from the free original DOS Daggerfall. Choose the folder itself or an archive containing it.' }],
    guidance: 'The creator currently targets Quest 3. VR4ALL installs the beta APK and copies your original ARENA2 files into the app folder. Leave antialiasing off in the game settings for correct stereo.',
  },
  {
    id: 'star-fox-enhanced-vr', title: 'Star Fox Enhanced VR', gameName: 'Star Fox', series: 'kandowontu2', category: 'Super Nintendo', color: '#698dc5',
    description: 'Experimental Quest 3 OpenXR build of the original SNES Star Fox.',
    projectUrl: 'https://github.com/kandowontu2/starfox-enhanced',
    source: { repo: 'kandowontu2/starfox-enhanced', assetPattern: '^StarFoxEnhanced-[0-9.]+-quest-arm64\\.zip$' }, sourceArchive: 'single-apk',
    data: [{ id: 'rom', label: 'Owned Star Fox / Starwing SNES ROM', kind: 'file', extensions: ['.sfc', '.smc'], destination: download, renameOnHeadset: true, note: 'Supported retail Japan, US or Europe revision. The Quest app imports the ROM on first launch; Star Fox 2, hacks and unknown revisions are not supported.' }],
    guidance: 'VR4ALL extracts the Quest APK from the creator’s Quest ZIP, not the generic Android APK. The creator calls this VR build experimental.',
  },
  {
    id: 'questcraft', title: 'QuestCraft', gameName: 'Minecraft: Java Edition', series: 'QuestCraftPlusPlus', category: 'PC', color: '#80ab73',
    description: 'Standalone Minecraft Java launcher for Quest.',
    projectUrl: 'https://github.com/QuestCraftPlusPlus/QuestCraft',
    source: { repo: 'QuestCraftPlusPlus/QuestCraft', assetPattern: '^QCXR-[0-9.]+\\.apk$' },
    data: [],
    guidance: 'VR4ALL installs the official QuestCraft launcher APK. On the headset, sign in with the Microsoft account that owns Minecraft: Java Edition; the launcher downloads the game files itself. First setup needs internet.',
  },
  {
    id: 'outlaws-vr', title: 'Outlaws VR', gameName: 'Outlaws Remastered', series: 'outlawshub-arch', category: 'PC', color: '#b87f58',
    description: 'A standalone Quest recreation of LucasArts’ Outlaws with your own Remastered data.',
    projectUrl: 'https://github.com/outlawshub-arch/OutlawsVR',
    source: { repo: 'outlawshub-arch/OutlawsVR', assetPattern: '^OutlawsVR-v[0-9.]+-[a-f0-9]+\\.zip$' }, sourceArchive: 'single-apk',
    data: [{ id: 'game', label: 'Owned Outlaws Remastered data folder', kind: 'directory', destination: '/sdcard/Android/data/com.outlawsvr.OutlawsUE/files/Outlaws/',
      requiredEntries: ['olgeo.lab', 'olobj.lab', 'oltex.lab', 'Common.kpf', 'UI.kpf'], copyExtensions: ['.lab', '.kpf'],
      note: 'Choose the folder containing olgeo.lab, Common.kpf and UI.kpf from your Steam or GOG Outlaws Remastered install. VR4ALL copies the game archives only.' }],
    guidance: 'VR4ALL extracts the official Quest APK from the creator’s release ZIP and copies your original LAB/KPF files. The creator’s optional movie and music conversion is not yet automated here; the game can run without those extras.',
    afterInstall: 'Open Outlaws VR under Unknown Sources. Keep the app installed when updating so its saves remain on the headset.',
  },
  {
    id: 'age-of-joy', catalogGroup: 'emulator', title: 'AGE of Joy', gameName: 'AGE of Joy', series: 'curif', category: 'Arcade', color: '#ba6b7b',
    description: 'A walkable VR arcade gallery that runs your own MAME games.',
    projectUrl: 'https://github.com/curif/AgeOfJoy-2022.1',
    source: { repo: 'curif/AgeOfJoy-2022.1', assetPattern: '^AgeOfJoy\\.apk$' },
    data: [], guidance: 'VR4ALL installs the official gallery APK. Launch it once to create its folders, then add your own compatible arcade ROMs and cabinets using the creator’s guide. The APK does not include arcade games.',
  },
  {
    id: 'citravr', catalogGroup: 'emulator', title: 'CitraVR', gameName: 'Nintendo 3DS', series: 'amwatson', category: 'Nintendo 3DS', color: '#829ee0',
    description: 'Nintendo 3DS emulation with stereoscopic screens on Quest.',
    projectUrl: 'https://github.com/amwatson/CitraVR',
    source: { repo: 'amwatson/CitraVR', assetPattern: '^CitraVR-v[0-9.]+\\.apk$' },
    data: [], guidance: 'VR4ALL installs the official CitraVR APK. Add your own decrypted 3DS game backups or homebrew in the emulator after first launch; no games are included.',
  },
  {
    id: 'dolphinxr', catalogGroup: 'emulator', title: 'DolphinXR', gameName: 'GameCube and Wii', series: 'iChris4', category: 'GameCube', color: '#6faab9',
    description: 'Experimental GameCube and Wii emulator for standalone Quest.',
    projectUrl: 'https://github.com/iChris4/dolphinXR',
    source: { repo: 'iChris4/dolphinXR', assetPattern: '^Dolphin-VR-Redux-app-quest-debug\\.apk$' },
    data: [], guidance: 'VR4ALL installs the creator’s Quest APK. Add your own GameCube or Wii discs in DolphinXR and configure controls on the headset. No games are included.',
  },
  {
    id: 'ppsspp-vr', catalogGroup: 'emulator', title: 'PPSSPP VR', gameName: 'PlayStation Portable', series: 'PPSSPP', category: 'PlayStation Portable', color: '#7fa3c1',
    description: 'The official PSP emulator’s experimental VR build for Quest.',
    projectUrl: 'https://www.ppsspp.org/download/',
    data: [], guidance: 'Download the Quest/VR APK from the official PPSSPP site and drop it in Local APK once. VR4ALL remembers the file path. Add your own PSP backups inside PPSSPP; no games are included.',
  },
  {
    id: 'winlatorxr', catalogGroup: 'emulator', title: 'WinlatorXR', gameName: 'Windows games on Quest', series: 'WinlatorXR', category: 'PC', color: '#8c9bb9',
    description: 'Windows compatibility runtime for standalone Quest headsets.',
    projectUrl: 'https://github.com/WinlatorXR/WinlatorXR',
    source: { repo: 'WinlatorXR/WinlatorXR', assetPattern: '^WinlatorXR-[A-Za-z0-9.-]+\\.apk$' },
    data: [], guidance: 'VR4ALL installs the creator’s APK. Set up a container and supply your own compatible Windows game files inside WinlatorXR; game compatibility varies.',
  },
];

const questportFacets = {
  'daggerfall-unity-vr': ['PC', 'RPG'], 'star-fox-enhanced-vr': ['Super Nintendo', 'Space combat'],
  questcraft: ['PC', 'Sandbox'], 'outlaws-vr': ['PC', 'Shooter'],
  'age-of-joy': ['Arcade', 'Arcade gallery'], citravr: ['Nintendo 3DS', 'Emulator'],
  dolphinxr: ['GameCube', 'Emulator'], 'ppsspp-vr': ['PlayStation Portable', 'Emulator'],
  winlatorxr: ['PC', 'Compatibility runtime'],
};

module.exports = { questports, questportFacets };
