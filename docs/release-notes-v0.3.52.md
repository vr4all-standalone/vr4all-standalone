# VR4ALL v0.3.52 beta

This release repairs Windows self-update. VR4ALL now checks for its own new release when it opens, without waiting for **Check updates**. After you approve an update, it confirms Windows has started an independent replacement helper before closing. The helper verifies the downloaded EXE, replaces the portable app, and reopens it. A failed handoff keeps the running app open; a failed replacement restores the previous EXE and records the error.

The portable download is now named **`VR4ALL-win-x64.exe`** across releases. The version remains visible on this release page. A versioned duplicate asset is included so older updater versions can find the release.

**If you have v0.3.51 or older, download `VR4ALL-win-x64.exe` manually once.** Those versions have the broken handoff and may close without installing the update. Keep this stable-name EXE wherever you want VR4ALL to live; later releases can replace it in place. Your saved game paths and settings remain in Windows application data.

The game catalog is unchanged at 116 cards and 123 port profiles.
