# VR4All catalog install and update audit

Checked: 2026-10-23T06:43:41.077Z · Catalog: 92 port profiles

## What was verified

- The current official GitHub release lookup found matching assets for all 84 profiles with configured sources. This includes patch and installer ZIP assets; it does not mean each asset is a directly installable APK.
- Five additional launcher, companion, importer, and converter assets also matched current releases.
- All 75 generic profiles produced a selected-headset ADB install and file-transfer plan with synthetic paths. The 17 specialized workflows are exercised by the automated runner/API tests where their owned inputs can be mocked.
- The connected Quest 3 scan found 32 installed profiles with their expected data markers, including The Simpsons: Hit & Run after correcting its false-negative probe.
- The app's update endpoint returned a current release for all 30 GitHub-linked profiles installed on that Quest. Twenty-five installed APK hashes matched the selected release exactly. Five differed: WiiCompiled, NFS Underground, and Simpsons have a different installed APK; Road Rash and Crazy Taxi publish an installer ZIP and patch respectively, so their source-asset hash is not an APK comparison.
- The Simpsons: Hit & Run has its Quest APK (version 0.93) and roughly 1.8 GB of PC assets in `/sdcard/SimpsonsHitRun/`. Its current GitHub release is 1.2, so it needs an APK update, not another game-file transfer.
- A separate successful Simpsons 1.2 install job targeted the Quest 3S (`340YC10GB00YWB`), not the connected Quest 3 (`2G0YC1ZF840H2Y`). The Quest 3S was unavailable for a post-install hash check in this pass.
- The complete automated suite passed: 204 passed, 0 failed, 2 skipped (206 total).

## Limits

This is a source, plan, test, and read-only headset audit. It does **not** establish that all 92 games launch and play. Most profiles are absent from the connected Quest, and the required owned ROMs/game installs, developer tools, signing keys, and headset interaction are not all available. A GitHub asset match also does not prove APK integrity or signing compatibility. In-headset import steps and complete personal builds need game-specific live trials.

## Profile-by-profile evidence

| Profile | Install route | Current source match | Quest 3 scan | Audit status |
| --- | --- | --- | --- | --- |
| Cop VR (cop-vr) | Quest APK + game data | vcop-v0.2.2 · Port0r-CopVR-v0.2.2-quest3.apk | 0.2.2 · data markers found | ADB plan generated; live install untested |
| Time Crisis VR (time-crisis-vr) | Quest APK + game data | timecris-v0.2.2 · Port0r-TimeCrisisVR-v0.2.2-quest3.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Time Crisis II VR (time-crisis-2-vr) | Quest APK + game data | timecrs2-v0.1.0 · Port0r-TimeCrisisIIVR-v0.1.0-quest3.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| House of the Dead VR (hotd-vr) | Quest APK + game data | hotd-v0.1.1 · Port0r-HouseOfTheDeadVR-v0.1.1-quest3.apk | 0.1.1 · data markers found | ADB plan generated; live install untested |
| Rally VR (rally-vr) | Quest APK + game data | v0.2.6 · Port0r-RallyVR-v0.2.6-quest3.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Dirt Dash VR (dirt-dash-vr) | Quest APK + game data | dirtdash-v0.1.3 · Port0r-DirtDashVR-v0.1.3-quest3.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Time Crisis VR (Experimental) (dr89-time-crisis) | Quest APK + game data | v0.9.4 · TimeCrisisVR-v0.9.4-quest3.apk | 0.9.4 · data markers found | ADB plan generated; live install untested |
| Time Crisis II VR (Test) (dr89-time-crisis-2) | Quest APK + game data | v0.3.3 · TimeCrisis2VR-v0.3.3-quest3.apk | 0.3.3 · data markers found | ADB plan generated; live install untested |
| SM64 Co-Op DX VR (sm64-vr) | Quest APK + game data | v0.9.22 · SM64-Co-Op-DX-VR-Quest-v0.9.22.apk | 0.9.22 · data markers found | ADB plan generated; live install untested |
| Ocarina of Time VR (oot-vr) | Quest APK + game data | v0.9.0-beta · oot-vr-v0.9.0-beta.apk | v0.9.0-beta · data markers found | ADB plan generated; live install untested |
| Majora’s Mask VR (mm-vr) | Quest APK + game data | v0.36 · MMVR-Quest-0.36.apk | 0.36 · data markers found | ADB plan generated; live install untested |
| Xelee (xelee) | Quest APK + game data | v0.1.0-beta · Xelee-Quest-arm64.apk | 0.1.0-beta · data markers found | ADB plan generated; live install untested |
| Twilight Princess VR (twilight-vr) | Quest APK + game data | 2.4.0 · tpvr-quest-arm64.apk | 2.2.0-43-dirty · data markers found | ADB plan generated; live install untested |
| QuestStrikers (quest-strikers) | Quest APK + game data | v0.1.13-alpha1 · QuestStrikers-alpha1.13.apk | 0.1.13-alpha1 · data markers found | ADB plan generated; live install untested |
| WiiCompiled VR (wii-compiled) | Quest APK + game data | 0.2.46 · WiiCompiledVR-Quest-0.7.0.apk | 1.3.1-quest3-preview · data markers found | ADB plan generated; live install untested |
| House of the Dead 2 VR (hotd2-vr) | Quest APK + game data | v0.4-test1 · hotd2-vr-quest.apk | v0.3-test1-16-geeb629d-vr · data markers found | ADB plan generated; live install untested |
| Crisis Zone VR (crisis-zone-vr) | Quest APK + game data | v0.1.7 · CrisisZoneVR-v0.1.7-quest3.apk | 0.1.7 · data markers found | ADB plan generated; live install untested |
| Halo CE Quest (halo-ce) | Quest APK + game data | v1.0.37 · HaloCE-Quest-1.0.37.apk | 1.0.37-test70 · data markers found | ADB plan generated; live install untested |
| NFS Underground VR (nfsu-vr) | Quest APK + game data | v0.3.0-preview.1 · NFSU-VR-Quest3-v0.3.0-preview.1.apk | 0.3.0-preview.1 · data markers found | ADB plan generated; live install untested |
| NFS Underground 2 VR (nfsu2-vr) | Quest APK + game data | dev-2026-10-17 · NFSU2VR-Quest3-dev-2026-10-17.apk | 0.3.2-dev · data markers found | ADB plan generated; live install untested |
| Re-Volt VR (revolt-vr) | Quest APK + game data | v0.1-beta · ReVolt-QuestVR-0.18-Sin-Juego-ARM64.apk | 0.18-font-controls-focus · data markers found | ADB plan generated; live install untested |
| Metal Gear Solid VR (mgs-vr) | Quest APK + game data | V0.1-beta · MGSVR-Quest.apk | 1.0.63-codec-text · data markers found | ADB plan generated; live install untested |
| Wipeout Rewrite (wipeout-vr) | Quest APK + game data | v0.1.0-beta1 · WipeoutRewriteVR-0.1.0-beta1-quest.apk | 0.1.0-beta1 · data markers found | ADB plan generated; live install untested |
| Road Rash Jailbreak VR (road-rash-vr) | Integrated road-rash | v0.1.0 · RoadRashJailbreak-0.1.0.zip | 0.1.0 · data markers found | Specialized route; mocked tests only |
| Half-Life VR (lambda1vr) | Quest APK + game data | v1.7.4 · lambda1vr-v1.7.4.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Quake VR (quakequest) | Quest APK + game data | v1.6.0 · quakequest-v1.6.0.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Quake II VR (quake2quest) | Quest APK + game data | v1.1.1 · quake2quest-v1.1.1.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Return to Castle Wolfenstein VR (rtcwquest) | Quest APK + game data | v1.4.1 · rtcwquest-1.4.1.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| GoldenEye VR (goldeneye-vr) | Quest APK + game data | v0.5.13 · GoldenEye-VR-v0.5.13.apk | 0.5.13 · data markers found | ADB plan generated; live install untested |
| Aliens Versus Predator VR (avp-vr) | Quest APK + game data | 1.2 · avpvr-1.2-quest-arm64-v8a-release.apk | 1.2 · data markers found | ADB plan generated; live install untested |
| SourceVR (sourcevr) | Quest APK + game data | 0.1.28 · SourceVR-0.1.28.apk | 0.5.5+d6c0a068 · data markers found | ADB plan generated; live install untested |
| XrKart 64 (xrkart-64) | Quest APK + game data | v0.2.0 · XRKart-64-v0.2.0-Quest.apk | 0.2.0-on-device-extraction · data markers found | ADB plan generated; live install untested |
| Unreal Gold VR (unreal-gold-vr) | Quest APK + game data | v1.0.0-beta12 · UnrealGoldVR-1.0.0-beta12.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| UT99 Quest (ut99-quest) | Manual creator APK | No automatic GitHub release | 1.1.1 · data markers found | ADB plan generated; live install untested |
| PrimedGun 2.0 (primedgun-2) | Quest APK + game data | v2.0.0-beta.3 · PrimedGun-v2.0.0-beta.3-Quest.apk | 2.0.0-beta.3 · data markers found | ADB plan generated; live install untested |
| Perfect Dark VR (perfect-dark-vr) | Quest APK + game data | v2.1 · Perfect_Dark_VR_Standalone_NTSC_v2.1.apk | 1.0 · data markers found | ADB plan generated; live install untested |
| The Simpsons: Hit & Run VR (simpsons-hit-run-vr) | Quest APK + game data | 1.2 · SimpsonsHitRun_1.2.apk | 0.93 · data markers found | ADB plan generated; live install untested |
| Vice City VR (vice-city-vr) | Personal APK build | No automatic GitHub release | 0.5.6 · data markers found | Specialized route; mocked tests only |
| Crazy Taxi VR (crazy-taxi-vr) | Patch owned Android package | v0.1-beta · crazywilly.xdelta | CrazyTaxiVR-42 · data markers found | Specialized route; mocked tests only |
| OpenCMR2 VR (opencmr2-vr) | Quest APK + game data | v0.1.0 · OpenCMR2-VR-Quest-arm64-v0.1.0.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| GTA: San Andreas VR (gta-sa-vr) | Personal APK build | No automatic GitHub release | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| Red Dead Redemption VR (rdr1-vr) | Personal APK build | No automatic GitHub release | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| F-Zero X VR (fzero-x-vr) | Quest APK + game data | v1.0.1 · FzeroVR-Standalone-v1.0.1-Quest3.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| The Maze of the Kings VR (mok-vr) | Quest APK + game data | v0.4-test1 · hotd2-vr-quest.apk | v0.3-test1-16-geeb629d-vr · data markers found | ADB plan generated; live install untested |
| Pokémon Gen 1 VR (pokemon-gen1-vr) | Quest APK + game data | v0.2.46 · 1GenPokemonVR-Quest3-v0.2.46.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Rave Racer VR (rave-racer-vr) | Manual creator APK | No automatic GitHub release | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Generals Zero Hour XR (cnc-generals-xr) | Quest APK + game data | v1.2.36-xr-preview · Generals-Zero-Hour-XR.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Harry Potter VR (harry-potter-vr) | Integrated harry-potter | v0.1.4.1 · HPVR-Quest-0.1.4.1.zip | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| Beef Raider XR (beef-raider-xr) | Integrated beef-raider | 1.0.0 · beefraiderxr-1.0.0.apk | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| JKXR (jkxr) | Integrated jkxr | v1.2.0 · jkxr-1.2.0.apk | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| The Force Engine VR (dark-forces-vr) | Quest APK + game data | v0.9.57-quest · the-force-engine-quest.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| X-Wing Revival VR (xwing-revival-vr) | Quest APK + game data | v1.0.3 · X-Wing-Revival-VR-v1.0.3-full.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| OpenXWA VR (openxwa-vr) | Quest APK + game data | v0.1.7-beta · OpenXWA-VR-v0.1.7-beta.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| OpenTIE VR (opentie-vr) | Quest APK + game data | v0.1.6-beta · OpenTIE-VR-v0.1.6-beta.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| OpenXW VR (openxw-vr) | Quest APK + game data | v0.1.2-beta · OpenXW-VR-v0.1.2-beta.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| OpenXvT VR (openxvt-vr) | Quest APK + game data | v0.1.0-beta · OpenXvT-VR-v0.1.0-beta.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Smash Remix VR (smash-remix-vr) | Quest APK + game data | v0.8.5 · SmashRemixVR-Quest-0.8.5.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Wave Race 64 VR (wave-race-vr) | Quest APK + game data | v0.1.5 · WaveRace64VR-Quest-0.1.8.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Mega Man 64 VR (mega-man-64-vr) | Quest APK + game data | v0.9.1-vr1 · MegaMan64RecompiledVR-Quest.apk | 0.9.1-vr · data markers found | ADB plan generated; live install untested |
| Doom3Quest (doom3quest) | Quest APK + game data | v1.4.8 · doom3quest148.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Quake3Quest (quake3quest) | Quest APK + game data | 1.2.0 · ioq3quest-release-1.2.0.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Descent 3 VR (descent3-vr) | Integrated descent3 | quest-v0.3-beta · Descent3-VR-0.3-beta.apk | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| Unreal Tournament VR (ut99-portroyale) | Quest APK + game data | v1.0.0-beta12-ut99 · UnrealTournamentVR-1.0.0-beta12.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Homeworld: Unbound (homeworld-unbound) | Quest APK + game data | unbound-0.14 · homeworld-unbound-vr.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| No One Lives ForeVR (no-one-lives-forevr) | Quest APK + game data | v0.4.0 · relith-nolf-quest-0.4.0.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Starship-VR (starship-vr) | Quest APK + game data | v1.0-beta1 · Starship-VR-1.0-beta1.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Crash Bandicoot Launcher (crash-bandicoot-vr) | Quest APK + game data | v2.0.0-beta.1 · CrashBandicoot-2.0.0-beta.1.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Forsaken VR (forsaken-vr) | Quest APK + game data | v0.1.1-beta · Forsaken-VR-v0.1.1-beta-full.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| QuestZDoom (questzdoom) | Quest APK + game data | 1.6.2 · questzdoom-1.6.2.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| CSVR (csvr) | Quest APK + game data | beta-0.6 · CSVR-Beta0.6.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| PreyVR (preyvr) | Quest APK + game data | v1.2.4 · preyvr-v124.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| RazeXR (razexr) | Quest APK + game data | v1.0.0 · razexr-1.0.0.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Hexen II VR (hexen2-vr) | Manual creator APK | No automatic GitHub release | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| QuestSam (questsam) | Quest APK + game data | b004 · questsam.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Descent 1 & 2 VR (descent12-vr) | Official installer ZIP | v1.2 · Descent-1-and-2-VR-1.2-Quest.zip | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| WolfSharp (wolfsharp) | Manual creator APK | No automatic GitHub release | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Sclerosis (sclerosis-vr) | Creator APK + sclerosis | No automatic GitHub release | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| Wing Commander VR (wing-commander-1-vr) | Quest APK + game data | quest-vr-1.0.0 · WingCommanderVR-1.0.0.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Wing Commander II VR (wing-commander-2-vr) | Quest APK + game data | quest-vr-1.0.0 · WingCommanderIIVR-1.0.0.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| FreeSpace 2 VR (freespace2-vr) | Quest APK + game data | v0.1.1-beta · FreeSpace2-VR-v0.1.1-beta.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Tiberian Dawn MR (tiberian-dawn-mr) | Quest APK + game data | v0.2.3-preview.20 · Tiberian-Dawn-Meta-Quest-3-3S-Spatial-preview.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Magic Carpet VR (magic-carpet-vr) | Integrated magic-carpet | 0.1.0 · mgcarpet-vr.apk | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| TES3MP VR (tes3mp-vr) | Quest APK + game data | v0.9.0 · TES3MP-VR-Quest2.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Gothic II VR (gothic2-vr) | Official installer ZIP | v0.2.0 · Gothic-II-VR-0.2.0-PCVR-and-Quest.zip | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| QuestCarNage (questcarnage) | Quest APK + game data | b003 · QuestCarnage-Meta-Quest-release.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| GalaxyQuest (galaxyquest) | Integrated galaxyquest | v0.1.9 · GalaxyQuest.apk | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| Animal Crossing VR (animal-crossing-vr) | Official installer ZIP | v0.9.3-vr20 · AnimalCrossing-Quest-v0.9.3-vr20.zip | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| Strikers CHARGED VR (strikers-charged-vr) | Quest APK + game data | v0.1.1-alpha1.1 · QuestStrikersCharged-alpha1.1.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| GT2 VR (gt2-vr) | Official installer ZIP | v0.8.1 · GT2-0.8.1.zip | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| AstroQuest (astroquest) | Integrated astroquest | v0.23 · AstroQuest-0.23-Quest3.apk | Not installed on connected Quest 3 | Specialized route; mocked tests only |
| Gen1Recomp VR Unplugged (pokemon-gen1-recomp) | Quest APK + game data | v0.1.81-quest · Gen1Recomp-VR-Unplugged-v0.1.81-Quest.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |
| Mjolnir VR (mjolnir-vr) | Quest APK + game data | build-315 · MjolnirVR.apk | Not installed on connected Quest 3 | ADB plan generated; live install untested |

## Follow-up priorities

1. Live test one first install and one update per workflow type using legally owned game files, then verify launch and imported data inside the Quest.
2. Test signing-key and APK version changes on an already installed copy before bulk updating.
3. For creator-hosted APKs, manually obtain the author file once and verify its package identity before an install.
4. Check any headset status that disagrees with what launches in the headset against the actual app-specific data path.
