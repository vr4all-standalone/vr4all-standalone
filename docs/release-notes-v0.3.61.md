# VR4ALL v0.3.61 beta

Game-file requirements have been checked against creator install pages for all 127 catalog profiles that ask for player files. The Copy buttons now give clearer regions, revisions, archive names and companion-file requirements where the creator documents them.

- Gran Turismo 2 asks for a complete raw 2352-byte-sector BIN/CUE disc. Plain ISO is no longer offered because it omits required disc data.
- GalaxyQuest offers the creator-documented ISO, RVZ and WBFS inputs.
- AstroQuest accepts both European CUSA12392 and American CUSA12431 extracted game folders and scans either one on the headset.
- Rave Racer preserves the creator-accepted `raverace.zip` or `raveracw.zip` filename.
- Gunblade NY, Rally VR, Ocarina of Time, NFS Underground 2, Road Rash, QuestSam, FreeSpace 2 and other cards describe their verified game-file requirements more precisely.
- Cards now identify creator-supported alternatives that VR4ALL's own picker cannot yet transfer, instead of implying those inputs work in the app.

The [creator requirement audit](audits/2026-11-01-creator-requirements.md) records the source for every checked field and identifies requirements that the creator has not documented clearly enough to verify. This release was tested in software; it does not claim a physical install of every port.
