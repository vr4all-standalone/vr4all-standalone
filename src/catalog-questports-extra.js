// Creator releases and install notes checked on 8 November 2026.
const questportsExtra = [
  {
    id: 'fate-of-the-galaxy-vr', title: 'Fate of the Galaxy VR', gameName: 'Fate of the Galaxy', series: 'SgtBilko76', category: 'PC', color: '#7594c8',
    description: 'Standalone Quest 3 port of the free FreeSpace 2 Fate of the Galaxy mod.',
    projectUrl: 'https://github.com/SgtBilko76/FotG-VR', source: { repo: 'SgtBilko76/FotG-VR', assetPattern: '^FotG-VR-v[0-9.]+-beta\\.apk$' },
    data: [], guidance: 'Install the Quest APK, then use its first-run One-Tap Installer on Wi-Fi to download the free Fate of the Galaxy data. Allow about 4.6 GB of headset space. You do not need a FreeSpace 2 copy.',
  },
  {
    id: 'wing-commander-saga-vr', title: 'Wing Commander Saga VR', gameName: 'Wing Commander Saga', series: 'SgtBilko76', category: 'PC', color: '#799bb5',
    description: 'Standalone Quest 3 beta of the free Wing Commander Saga space combat game.',
    projectUrl: 'https://github.com/SgtBilko76/WCSaga-VR', source: { repo: 'SgtBilko76/WCSaga-VR', assetPattern: '^WCSaga-VR-v[0-9.]+-beta\\.apk$' },
    data: [], guidance: 'Install the Quest APK, then use its first-run One-Tap Installer on Wi-Fi to download the free game data. Leave about 9 GB free. Flight performance is still experimental.',
  },
  {
    id: 'wipeout-pure-vr', title: 'Wipeout Pure VR', gameName: 'Wipeout Pure', series: 'SgtBilko76', category: 'PlayStation Portable', color: '#80a6c4',
    description: 'Wipeout Pure in stereoscopic standalone VR on Quest.',
    projectUrl: 'https://github.com/SgtBilko76/WipeoutPure-VR', source: { repo: 'SgtBilko76/WipeoutPure-VR', assetPattern: '^WipeoutPure-VR-v[0-9.]+-beta\\.apk$' },
    data: [{ id: 'iso', label: 'Owned Wipeout Pure US Greatest Hits ISO', kind: 'file', extensions: ['.iso'], destination: '/sdcard/Android/data/online.portroyale.wipeoutpurevr/files/import/', note: 'The creator supports only US Greatest Hits UCUS-98612 revision 2.00. Other Wipeout Pure revisions will be rejected. Launch the app once if the import directory is not yet available.' }],
    guidance: 'VR4ALL installs the creator’s APK and places your owned PSP ISO in its import folder. The app validates the disc; only the US Greatest Hits release is supported.',
  },
  {
    id: 'star-wars-arcade-vr', title: 'Star Wars Arcade VR', gameName: 'Star Wars (1983 arcade)', series: 'cyberheater', category: 'Arcade', color: '#8da8d6',
    description: 'The original Atari vector arcade game on standalone Quest.',
    projectUrl: 'https://github.com/cyberheater/Quest-SWVR', source: { repo: 'cyberheater/Quest-SWVR', assetPattern: '^StarWarsQuest\\.apk$' },
    data: [{ id: 'rom', label: 'Owned Atari Star Wars arcade ROM set', kind: 'file', extensions: ['.zip'], destination: '/sdcard/Android/data/com.cyberheater.starwars/files/starwars.zip', note: 'Provide your own MAME starwars.zip. Current releases load the ZIP directly; no conversion or extraction is needed.' }],
    guidance: 'VR4ALL installs the creator’s Quest APK and copies your original starwars.zip to the game’s expected path.',
  },
  {
    id: 'supertuxkart-vr', title: 'SuperTuxKart VR', gameName: 'SuperTuxKart', series: 'SgtBilko76', category: 'PC', color: '#8db886',
    description: 'Free kart racing game adapted for standalone Quest VR.',
    projectUrl: 'https://github.com/SgtBilko76/SuperTuxKart-VR', source: { repo: 'SgtBilko76/SuperTuxKart-VR', assetPattern: '^SuperTuxKart-VR-[0-9.]+\\.apk$' },
    data: [], guidance: 'The creator’s APK includes or prepares its free game content. No commercial game files are needed.',
  },
  {
    id: 'openmw-quest-vr', title: 'OpenMW VR Quest', gameName: 'The Elder Scrolls III: Morrowind', series: 'tomups', category: 'PC', color: '#ac9a79',
    description: 'A separate native OpenMW VR port for Quest.',
    projectUrl: 'https://github.com/tomups/openmw-vr-quest', source: { repo: 'tomups/openmw-vr-quest', assetPattern: '^com\\.openmw\\.vr-[0-9-]+-release\\.apk$' },
    data: [{ id: 'game', label: 'Owned Morrowind installation folder', kind: 'directory', destination: '/sdcard/Morrowind/', requiredDirectories: ['Data Files'], note: 'Choose the complete original Morrowind folder containing Data Files. VR4ALL copies its contents to /sdcard/Morrowind/; the APK contains no Morrowind assets.' }],
    guidance: 'This is an older, separate Quest build that is not actively maintained. Supply your own full Morrowind installation; this port is distinct from TES3MP VR already in the catalog.',
  },
  {
    id: 'ankh-vr', title: 'ANKH VR', gameName: 'Ultima IV: Quest of the Avatar', series: 'plaidpants', category: 'PC', color: '#ad9272',
    description: 'Experimental standalone Quest port of Ultima IV.',
    projectUrl: 'https://github.com/plaidpants/ANKH-VR', source: { repo: 'plaidpants/ANKH-VR', assetPattern: '^ANHK-VR\\.apk$' },
    data: [{ id: 'game', label: 'Owned Ultima IV game folder', kind: 'directory', destination: '/sdcard/Android/data/com.SwivelChairGames.ANKHVR/files/u4/', requiredEntries: ['AVATAR.EXE'], note: 'Choose the entire original Ultima IV folder containing AVATAR.EXE and its companion game files. Music files are optional.' }],
    guidance: 'VR4ALL installs the creator’s Quest alpha APK and copies your original Ultima IV data. The creator’s release asset is named ANHK-VR.apk.',
  },
  {
    id: 'vpinball-vr', catalogGroup: 'emulator', title: 'Visual Pinball VR', gameName: 'Visual Pinball', series: 'SgtBilko76', category: 'PC', color: '#ba8c9b',
    description: 'Quest pinball simulator for user-provided tables.',
    projectUrl: 'https://github.com/SgtBilko76/VPinball-VR', source: { repo: 'SgtBilko76/VPinball-VR', assetPattern: '^VPinball-VR-Beta-[0-9.]+\\.apk$' },
    data: [], guidance: 'VR4ALL installs the emulator APK. The creator offers an in-app table downloader; other tables and any required ROMs must be supplied separately. No tables are bundled here.',
  },
  {
    id: 'armsx2-3d', catalogGroup: 'emulator', title: 'ARMSX2 3D', gameName: 'PlayStation 2', series: 'SgtBilko76', category: 'PlayStation 2', color: '#8a9ec6',
    description: 'PlayStation 2 emulator with a stereoscopic 3D virtual screen on Quest.',
    projectUrl: 'https://github.com/SgtBilko76/ARMSX2-3D', source: { repo: 'SgtBilko76/ARMSX2-3D', assetPattern: '^ARMSX2-3D-[0-9.]+-beta\\.apk$' },
    data: [], guidance: 'VR4ALL installs the creator’s Quest APK. Add your own PlayStation 2 BIOS and game backups inside the emulator; neither is bundled.',
  },
];

const questportsExtraFacets = {
  'fate-of-the-galaxy-vr': ['PC', 'Space combat'], 'wing-commander-saga-vr': ['PC', 'Space combat'],
  'wipeout-pure-vr': ['PlayStation Portable', 'Racing'], 'star-wars-arcade-vr': ['Arcade', 'Space combat'],
  'supertuxkart-vr': ['PC', 'Racing'], 'openmw-quest-vr': ['PC', 'RPG'],
  'ankh-vr': ['PC', 'RPG'], 'vpinball-vr': ['PC', 'Pinball'], 'armsx2-3d': ['PlayStation 2', 'Emulator'],
};

module.exports = { questportsExtra, questportsExtraFacets };
