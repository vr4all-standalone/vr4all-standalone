# Audit of the 143 suggested Quest titles

For the 30 titles selected for the next VR4All batch, see the [22 October approval audit](quest-additions-audit-2026-10-22.md). It supersedes the brief findings below for those numbered entries.

Checked 22 October 2026 against the 68 current VR4All profiles and author-controlled release pages. Numbers match the supplied list. **Catalogued** means a card already exists; it does not assert a successful install on every headset. **Add** means a native Quest release is evidenced and merits a new profile after its APK, package ID, file rules, and artwork are checked. **Guide** means a real Quest project needs more than a generic APK plus ROM transfer. **Alternate** means another Quest implementation exists for an original game VR4All already covers; keep it as research, without a second catalog card or download. **Hold** means the release or native VR claim is insufficient. **Separate** means an emulator, compatibility runtime, or commercial store title rather than a game port.

## Catalog rule

For new additions, use the existing entry when the original game is already covered. Choose one supported Quest port for that entry. Alternate implementations may replace the selected port after install and update behavior is verified, but should not create duplicate game downloads. When one engine APK supports several distinct games, download it once and reuse the saved copy. Sequels and other distinct original games still get their own entries.

## Entries 1–48

| # | Verdict | Finding |
| --- | --- | --- |
| 1 QuestZDoom | Guide | [Team Beef engine and launcher](https://github.com/Team-Beef-Studios/QuestZDoom/releases); support both APKs and WAD import. |
| 2–8 Doom3Quest, Lambda1VR, RTCWQuest, JKXR, QuakeQuest, Quake2Quest, Quake3Quest | Catalogued | JKXR is guided because its [release](https://github.com/Team-Beef-Studios/JKXR/releases) has a companion APK. |
| 9 CSVR; 10 PreyVR; 11 RazeXR | Guide | The [CSVR author site](https://www.csvr.online/) now links a direct APK; [PreyVR](https://github.com/Team-Beef-Studios/PreyVR/releases) and [RazeXR](https://github.com/Team-Beef-Studios/RazeXR/releases) need game-data workflows. |
| 12 Beef Raider XR | Catalogued | Guided original Tomb Raider extraction. |
| 13 Hexen II VR; 14 QuestSam | Guide | Establish release asset and data import. QuestSam's [releases](https://github.com/maranone/QuestSam/releases) now include b004; older research called it unreleased. |
| 15–17 AvP VR, No One Lives ForeVR, Descent 3 VR | Catalogued | Descent 3 remains guided. |
| 18 DescentVR | Guide | The newer [Descent 1 & 2 Quest v1.2 release](https://github.com/GameOrDie007/Descent-1-and-2-VR/releases/tag/v1.2) includes a standalone installer; evaluate it as one combined profile. |
| 19–21 Forsaken, UT99, Unreal Gold | Catalogued | UT99 and Unreal Gold each have distinct implementations to label clearly. |
| 22 WolfSharp; 23 QuestCarNage | Guide | [WolfSharp creator page](https://benmclean.itch.io/wolfsharp) distributes a Quest APK outside GitHub. QuestCarNage needs release and content workflow verification. |
| 24–30 OpenCMR2, Re-Volt, OpenXWA, OpenTIE, OpenXW, OpenXvT, X-Wing Revival | Catalogued | Existing direct or guided profiles. |
| 31 Wing Commander I; 32 Wing Commander II | Guide | [Wing Commander I](https://portroyale.online/wingcommander.html) and [II](https://portroyale.online/wingcommander2.html) have separate Quest APKs and documented owned-file destinations. |
| 33 Wing Commander Saga | Add | [Quest APK v0.1.5-beta](https://github.com/SgtBilko76/WCSaga-VR/releases/tag/v0.1.5-beta); app obtains freely available game data, requiring substantial space. |
| 34 FreeSpace 2 | Add | [Quest APK v0.1.1-beta](https://github.com/SgtBilko76/FreeSpace2-VR/releases/tag/v0.1.1-beta), with nine files from an owned FreeSpace 2 installation under `/sdcard/FS2/`. The list's “may not be released yet” is outdated. |
| 35 Homeworld; 36 Generals Zero Hour XR | Catalogued | Generals is a guided original-data setup. |
| 37 Tiberian Dawn MR | Guide | [Quest 3 preview APK](https://github.com/Cesarus85/Tiberian-Dawn-for-Android-and-Meta-Quest/releases/tag/v0.2.3-preview.20); requires C&C disc data and hardware validation. |
| 38 Magic Carpet; 39 OpenMW; 40 TES3MP; 41 Gothic II | Guide | [Magic Carpet](https://github.com/NathanaelA/mgcarpet-vr/releases) needs asset baking; [OpenMW](https://github.com/mmry2940/openmw-vr-quest/releases) has a Quest APK, but its fork and install flow need verification; [TES3MP](https://github.com/Nikman17/tes3mp-vr-quest/releases) is another Morrowind implementation, so choose one for a future Morrowind card; [Gothic II](https://github.com/dubrovskiy-yevhen-stakelogic/gothic2-vr/releases) uses an installer ZIP. |
| 42 Harry Potter | Catalogued | Guided profile. |
| 43 shock2quest | Hold | Pre-alpha proof exists but a usable standalone player release was not established. |
| 44 Sclerosis | Guide | [Creator distribution](https://createam.itch.io/sclerosis-an-amnesia-vr-remake) is outside GitHub; verify install and owned-data steps. |
| 45 0 A.D. | Add | [Quest APK plus data ZIP](https://github.com/SgtBilko76/0AD-VR/releases/tag/v0.1.0-beta); must install/extract both. |
| 46 Warzone 2100 | Add | [Self-contained Quest APK](https://github.com/SgtBilko76/Warzone2100-VR/releases/tag/v0.1.1-beta). |
| 47 SourceVR | Catalogued | Existing multi-game Source engine profile. |
| 48 alferiko/Zer0K Half-Life 2 | Alternate | [Separate release](https://github.com/alferiko/half-life-2-stanalone-quest-releases/releases/tag/0.989) from SourceVR; Half-Life 2 is already covered by the existing SourceVR card. |

## Entries 49–96

| # | Verdict | Finding |
| --- | --- | --- |
| 49 Qualyx | Hold | Opaque Alyx claim; no verifiable source or author Quest release. |
| 50–55 Vice City, San Andreas, Red Dead Redemption, GoldenEye, Perfect Dark, SM64 Co-Op DX | Catalogued | GTA SA and RDR are guided build profiles, not one-click APKs. |
| 56 SM64 Quest by heurazy | Alternate | [Distinct Quest release](https://github.com/heurazy/mario64VRStandalone/releases/tag/v1.0.1); Super Mario 64 already has a card. |
| 57 Ship of Harkinian VR | Hold | This specific upstream project is PCVR; do not confuse it with the two Quest OoT projects. |
| 58 Quest 3 OoT by ChocoTorp | Alternate | [Quest release](https://github.com/ChocoTorp/Shipwright-VR/releases/tag/v1.2.1); Ocarina of Time already has a card. |
| 59–60 Majora's Mask, XRKart 64 | Catalogued | Existing Quest profiles. |
| 61 SpaghettiKart-VR | Alternate | A [standalone Quest release](https://portroyale.online/spaghettikart.html) now exists, but Mario Kart 64 is already covered by XRKart. |
| 62 Starship-VR; 63 F-Zero X; 64 Wave Race; 65 Smash Remix | Catalogued | A second F-Zero build remains unverified; do not duplicate the card yet. |
| 66 Mystical Ninja; 67 Bomberman Hero; 68 WWF No Mercy | Hold | No author-controlled released Quest APK verified. |
| 69 MegaMan64; 70 TPVR | Catalogued | Existing Quest profiles. |
| 71 GalaxyQuest | Guide | [Quest APK and converter](https://github.com/bigmak94/GalaxyQuest/releases/tag/v0.1.9); owned Wii disc needs conversion and multi-gigabyte transfer. |
| 72 PrimedGun | Catalogued | Existing iChris port. Other implementations need separate verification before duplicate cards. |
| 73 WiiCompiled VR PLUS | Alternate | [PLUS release](https://github.com/heurazy/Wiicompiled_VR-PLUS/releases) is distinct, but Mario Kart Wii is already covered by WiiCompiled. |
| 74 Animal Crossing VR | Add | [LiquidAzir Quest release](https://github.com/LiquidAzir/animal-crossing-vr/releases/tag/v0.9.3-vr20) is a native owned-disc port. Heurazy's DolphinXR variant is a different workflow. |
| 75 Quest 3 Strikers | Catalogued | Existing GameCube title. |
| 76 Strikers CHARGED | Add | [Author Quest releases](https://github.com/LanceSweatpants/Quest-3-Strikers-CHARGED/releases), owned Wii R4QE01 Rev 1 required. |
| 77 Star Fox Enhanced | Hold | Quest install/play evidence remains incomplete. |
| 78 1GenPokemonVR | Catalogued | Existing Red/Blue port. |
| 79 Gen1Recomp VR Unplugged | Alternate | [Separate native Quest fork](https://github.com/HimioneGranger/Gen1recomp-Quest-Standalone/releases/tag/v0.1.81-quest), but Pokémon Red/Blue already has a card. Its Yellow support may warrant a separate game rule later. |
| 80–89 Time Crisis, Time Crisis II, Crisis Zone, HOTD, HOTD2/MOK, Virtua Cop, Sega Rally, Dirt Dash, Rave Racer, Crazy Taxi | Catalogued | The author/variant matters; some profiles are manual because a distributable clean APK is not established. |
| 90 Gran Turismo 2 VR | Guide | [Release ZIP](https://github.com/dubrovskiy-yevhen-stakelogic/gt-2-pc/releases/tag/v0.8.1) contains a converter and APK; owned disc preparation is required. |
| 91–95 Wipeout, Road Rash Jailbreak, NFS Underground 1/2, Halo CE Quest | Catalogued | Road Rash release ships an installer ZIP, so remains guided. |
| 96 Mjolnir VR | Alternate | [Distinct Halo CE Quest build](https://github.com/Cesarus85/mjolnir-vr/releases/tag/build-314); Halo CE already has a card. |

## Entries 97–143

| # | Verdict | Finding |
| --- | --- | --- |
| 97 AstroQuest | Guide | [Quest 3 APK](https://github.com/bigmak94/AstroQuest/releases/tag/v0.23), but needs an owned unpacked PS4 game, roughly 13 GB, in `/data/local/tmp/astro/games/`. |
| 98 Crash Bandicoot; 99 Metal Gear Solid | Catalogued | Existing Quest profiles. |
| 100 Quest 3 Streets | Hold | [Current project](https://github.com/LanceSweatpants/Quest-3-Streets) displays NBA Street on a floating flat screen; full 3D VR modes are planned. |
| 101 LSD Dream Emulator | Hold | No author-controlled APK and data rules verified. |
| 102 Project06-VR | Hold | [Quest alpha](https://github.com/moistman42069/Project06-VR/releases/tag/v0.1.15) is real, but bundles a third-party fan-port payload; review distribution rights before a direct installer. |
| 103 QuestCraft | Guide | [Standalone launcher](https://github.com/QuestCraftPlusPlus/QuestCraft/releases/tag/6.0.0) requires a Microsoft account owning Minecraft Java. Better suited to a distinct launcher category. |
| 104 QuestBridge | Hold | [Flat-panel Fabric/Amethyst mod](https://github.com/Junior37534/QuestBridge), not stereo Quest VR. |
| 105 Iron Lung; 106 Victory Heat Rally; 107 GoatVR | Hold | Iron Lung is a fan recreation, Victory Heat Rally is [PCVR](https://github.com/segadreamcat/VictoryHeatRallyVR), and GoatVR is a joke mode rather than a Quest port. |
| 108 R.E.P.O. Quest | Guide | [Owned-game Unity builder](https://github.com/Dobutsu/repo-quest-vr) produces an APK; no redistributable Quest game APK. High time and disk cost. |
| 109 Granny / Infernal Neighbor | Hold | Fan recreations rather than owned-file ports. |
| 110 Bugdom 1 and 2 | Add | [Two separate self-contained APKs](https://portroyale.online/bugdom.html), so two profiles. |
| 111 SauerQuest; 112 Xonotic; 113 SuperTuxKart; 114 SuperTux 3D; 115 Extreme Tux Racer; 116 Hurrican | Add | [Port Royale creator index](https://portroyale.online/) links native self-contained Quest APKs for each. |
| 117 Neverball / Neverputt | Add | [Two separate Quest apps](https://portroyale.online/neverball.html), so two profiles. |
| 118 VDrift; 119 Speed Dreams; 120 Luanti | Add | [Port Royale creator index](https://portroyale.online/) links native Quest APKs. VDrift changes signing key across older builds; Luanti downloads a game in-app and conflicts with regular Android Luanti. |
| 121–130 DolphinXR, PPSSPP VR, CitraVR, VBoy Color, VirtualBoyGo, AGE of Joy, Snes9x 3D, ARMSX1/2, VPinball | Separate | Emulators and arcade/launcher environments; useful future category, but they are not individual owned-game ports. |
| 131 WinlatorXR | Separate | Windows compatibility runtime, not a native game port. |
| 132 official HL2 VR mod | Separate | PCVR mod; SourceVR is the Quest profile. |
| 133–139 HWXR Halo, CoD4, Crysis, Far Cry, Red Faction, Battlefield 1942, TrackMania | Separate | Run through [WinlatorXR](https://portroyale.online/) on the headset; no native Android port APK per game. |
| 140–143 WRATH, Roboquest, Trombone Champ, Out of Sight | Separate | Official Quest store products; Out of Sight was listed as a preorder at the time of checking. |

## Beyond the numbered list

The “coming soon” section is not evidence of a public release. No current author Quest release was found for Team Beef Quake 4/Morrowind, Jedi Knight: Dark Forces II, the Elite Force fork, Port0r's Daytona/Virtua Racing/Sega Super GT/Top Skater, or Quest Banjo-Kazooie. Postal 2 and System Shock were listed as in development. The old Pokémon Snap author release could not be verified. Do not substitute third-party mirrors for missing original downloads. RaYRoD's old direct SM64 build was removed; his [current hub](https://github.com/RaYRoD-TV/sm64coopdx-vr) claims a Quest build but its delivery needs separate validation.

## Practical priority

1. Add the self-contained, author-hosted Quest APKs first: Warzone 2100 and the released Port Royale games in entries 110–120. Capture package IDs and signing/version behavior before enabling updates.
2. Add new original games with owned-file rules once ROM revision, destination, and APK package are checked: Animal Crossing and Strikers CHARGED. For Morrowind, choose one Quest implementation before adding a card.
3. Add guided cards for the real converter or multi-APK projects that introduce new games, particularly GalaxyQuest, AstroQuest, and QuestZDoom. Only call an install “one click” after the complete workflow can be automated and tested.

This is a release/source audit, not a successful install or play test of all projects. Quest 3S and Quest Pro support must be attributed per author instead of inferred from Quest 3 support.
