# Game Or Die standalone Quest additions — 2026-11-01

The three missing GameOrDie007 standalone Quest ports are added as alternate developer choices. Descent 1 & 2 was already integrated. Catalog totals remain 128 game cards and 5 emulator/runtime cards, now with 145 port choices. Other developers' ports remain available.

Canonical installer checkout: `vr4all-public`, branch `codex/gameordie-standalone-ports`, starting revision `4def5fe`. Candidate version: **0.3.65**. The user approved publication on 2026-11-01. This preparation report precedes publication as `v0.3.65-beta`; final public-download and updater receipts are recorded in the overseer's publication report. No headset installation or gameplay was performed.

| New choice | Creator release | Android package | Data preparation |
| --- | --- | --- | --- |
| [Forsaken VR](https://github.com/GameOrDie007/Forsaken-VR/releases/tag/v1.2) | `Forsaken-VR-1.2-Quest.zip` | `net.gameordie.forsakenvr` | Creator downloads ForsakenX data; optional Remastered folder supplies soundtrack/intro |
| [Unreal Gold VR](https://github.com/GameOrDie007/Unreal-Gold-VR/releases/tag/v1.0.3) | `Unreal-Gold-VR-1.0.3-Quest.zip` | `net.gameordie.unrealgoldvr` | Optional owned PC folder; creator can download original CD and compatible 226 System files |
| [Unreal Tournament 99 VR](https://github.com/GameOrDie007/Unreal-Tournament-99-VR/releases/tag/v1.0.1) | `Unreal-Tournament-99-VR-1.0.1-Quest.zip` | `net.gameordie.ut99vr` | Creator downloads original CD and OldUnreal 469e patch |

These profiles select only the Quest ZIP, never the PCVR ZIP or Windows installer EXE. First install requires no local files. VR4ALL runs each unmodified creator script with `-Quiet -NoSearch -Serial <selected> -Adb <bundled adb> -Json`; Unreal recipes also select `-Game UG` or `-Game UT`. Updates rerun the creator setup to prepare companion files and delegate save/settings preservation to that setup. Existing Descent and other ZIP recipes retain their APK-only update path.

Actual ZIPs were downloaded, hashed against GitHub's SHA256 digests, extracted and inspected without executing their installers on a headset. APK package identities match the table. Quest 3 playtesting is the creator's claim; Quest 3S remains untested here. Internet access is required for automatic first-time data downloads. The automatic game-data downloads themselves were not repeated in this audit.

| Archive | Verified SHA256 |
| --- | --- |
| Forsaken 1.2 Quest | `c5d313e1a6691c0e4b407149f22144c020c4b03ba167ad33a9be970b3ea643fe` |
| Unreal Gold 1.0.3 Quest | `283f27ce9f554bedfe3fb87930956f69206bdc2508811fb28589d750c8028a83` |
| UT99 1.0.1 Quest | `1f73deaa88408f86db97a3e7ac241f0d70b69ca21c1615116e96a63fb8c624bc` |

Verification:

- Focused baseline: 44 passed. Initial new tests failed because the profiles/recipes were absent. Final focused adapter, API, frontend and catalog run: 145 passed.
- Full production test command: `node --test` (the command behind `npm test`), **653 passed, 0 failed, 2 skipped**, exit 0. Log: `D:/VR4ALL-GameOrDie-0.3.65-20261101/audit/full-suite-final.log`.
- Earlier sandbox run: 600 passed, 51 failed, 2 skipped, from Windows filesystem restrictions, old catalog-count assertions and insufficient free C: space. First unrestricted run: 628 passed, 25 failed, 2 skipped; one message-contract regression and 24 storage-guard failures. The message was corrected, task downloads moved to D:, and the final full run passed. No storage guards or tests were bypassed.
- Independent read-only review found four integration gaps. Corrected Gold map readiness to `UT99/Unreal/Maps`; added automatic installs to bulk discovery and Ready to install; treated Gold/UT99 APK `0.1.0` versions as unrelated to GitHub tags and used completed installer receipts for updates; corrected first-install/update guidance. Regression tests cover these paths.
- Data probes require actual files in each distinct package's storage, including Forsaken's level lists and `ship.mxv`, and Unreal System packages and startup maps. An APK alone, empty folders, or another developer's package cannot count as successful automatic setup.
- Actual release selectors, expected script/APK suffixes and portable APK package inspection passed for all three downloaded archives. Metadata and extracted packages are retained in the candidate's `audit` directory.
- Existing game artwork is reused for identification; it is not represented as a capture of the new port.

Build command: `node node_modules/electron-builder/cli.js --win portable --x64 --publish never --config.directories.output=D:/VR4ALL-GameOrDie-0.3.65-20261101/dist`. TEMP/TMP use that candidate directory. A task-local `npm.cmd` wrapper calls the existing cached npm 12.2.1 CLI because the shell has no npm command and its cached stock wrapper has a broken path. No installed tooling was modified. Publication is disabled.

Build succeeded, exit 0; log: `D:/VR4ALL-GameOrDie-0.3.65-20261101/audit/build-success.log`. The earlier two attempts failed only on absent/broken npm command resolution. The final EXE is unsigned, as no signing certificate was configured.

- Candidate: `D:/VR4ALL-GameOrDie-0.3.65-20261101/dist/VR4ALL-win-x64.exe` — 190,674,176 bytes.
- SHA256: `71f71703b6c2d5589874861bf7e895ed014e36e4668a4b6845989a026ad57411`.
- Packaged `app.asar` SHA256: `3178c0e0d72f67a5da1c14584533c394e3159bafdd8e9d76d68fac7f212b7170`.
- Extracted packaged application verification passed: six changed production JS files exactly match the checked source; packaged version is 0.3.65; all three variants and their artwork exist; the packaged catalog loads with 145 profiles, 128 game cards and 5 emulator/runtime cards. Detailed receipt: `audit/package-verification.json` in the candidate directory.

Prepared release notes: "Adds Game Or Die's Forsaken, Unreal Gold and Unreal Tournament 99 standalone Quest ports as alternate developer choices. Their official setup can prepare game data automatically, and optional local folders remain supported for Forsaken and Unreal Gold. Improves readiness and update tracking for these installer-based ports."

Remaining limits: no physical installation/play, no live save migration check, and no Quest 3S acceptance. Public-download and updater verification follow publication under the user's approval.
