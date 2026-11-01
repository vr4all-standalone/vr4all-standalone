# Creator game-file requirement audit — 2026-11-01

Scope: all 142 current catalog profiles. Fifteen profiles have no player-supplied game-file field. The remaining 127 profiles contain 173 input fields. The baseline catalog and per-field creator-source links, evidence, and verdicts are in `catalog-baseline.json` and the three `requirements-*.json` files beside this report. Those files record the *pre-fix* catalog; they are an audit trail, not the current UI text.

At the time of review, 112 fields matched the accessible creator instructions; 31 had a wording, version, format, or companion-file discrepancy; 27 lacked enough original-source detail to verify the catalog's exact claim; and three original pages could not be fetched. The audit compares the creator's documented input to VR4ALL's actual import path. A creator-supported format is not automatically a VR4ALL-supported format.

## Corrections made

- Crazy Taxi's copy text uses the creator-documented original Android APKM filename rather than a generic title.
- Gran Turismo 2 now requests a complete raw 2352-byte-sector BIN/CUE image. A plain 2048-byte ISO is no longer offered by the picker; the creator says it omits XA audio and video data. [Creator install guide](https://github.com/dubrovskiy-yevhen-stakelogic/gt-2-pc/blob/main/docs/PLAYER-INSTALL.md).
- GalaxyQuest now offers the creator-documented ISO, RVZ, and WBFS image formats; its converter no longer advertises GCZ, WIA, or CISO. [Creator repository](https://github.com/bigmak94/GalaxyQuest).
- AstroQuest now accepts both documented extracted-game IDs, European CUSA12392 and American CUSA12431, verifies `sce_sys/param.sfo`, transfers to the matching headset directory, and detects either one when scanning. [Creator repository](https://github.com/bigmak94/AstroQuest).
- Gunblade NY specifies Revision A of its Model 2B set. Rally VR explains when `segabill.zip` is required. Rave Racer preserves either creator-accepted `raverace.zip` or `raveracw.zip` instead of renaming the latter.
- Ocarina of Time, Majora's Mask, NFS Underground 2, Road Rash, Aliens Versus Predator, SourceVR, QuestSam, and FreeSpace 2 now identify the creator's region, revision, required companion files, or full-game data more precisely.
- Super Mario Strikers now distinguishes the creator-tested US image from untested PAL/Japan images. Smash Remix explains the personally patched 2.0.1 option. The Quake III, Prey, and Unreal Tournament fields distinguish VR4ALL's full-game transfer path from demo or in-headset download paths documented by their creators.
- Red Dead Redemption now asks for one complete 1.58.63226194 ARM64 export, including all splits and asset packs, and identifies the current engine-variant limit. It no longer suggests that a particular `split_game0`–`split_game3` set is a universal replacement for a complete export. [Creator instructions](https://github.com/dubrovskiy-yevhen-stakelogic/rdr1-quest).

## Supported by the creator, not yet by VR4ALL's field

These are explicitly described on the cards as creator alternatives or kept out of the picker until the transfer path can handle them:

- Complete multi-track GDI/CUE sets for Dreamcast House of the Dead 2, Maze of the Kings, and Confidential Mission. VR4ALL currently transfers their self-contained CHD or CDI route.
- Mega Man 64 `.n64`/`.v64` and other PrimedGun disc formats. VR4ALL currently stages Mega Man's `.z64` and PrimedGun's uncompressed ISO.
- Majora's Mask `mm.o2r` and a separately patched Smash Remix ROM are creator options. The current VR4ALL field prepares the original ROM; Smash Remix's in-headset picker can select a patched ROM after transfer.
- Extracted GTA San Andreas audio directory. The current VR4ALL builder field accepts the creator's `.7z` audio pack.
- Qualyx's optional in-headset Steam download and the demo/in-headset routes for Quake III, Prey, and Unreal Tournament. VR4ALL currently prepares those profiles using owned PC files supplied to its fields.

## Claims that remain unverified

The 27 `UNCLEAR` fields in the per-field reports have insufficient accessible creator documentation to assert an exact revision, hash, or filename beyond what is already shown. The Max Payne Nightmare Drive distribution has no accessible original install text for its mobile APK and OBB requirements. The NFL Blitz 2000 creator page could not be fetched during this audit. These cards should not gain stronger version claims until the creator's own instructions or package checks substantiate them. No headset install was performed for this audit.

The per-field verdicts and primary-source links are in:

- `requirements-001-042.json`
- `requirements-043-084.json`
- `requirements-085-127.json`
