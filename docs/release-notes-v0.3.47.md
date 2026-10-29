# VR4ALL v0.3.47 beta

Adds the released Teraburst VR, Virtua Cop VR and Virtua Cop 2 VR ports to the catalog, with direct Quest APK downloads, the correct Android package identities and game-file destinations, original game artwork, and installed/update detection. The catalog now has 99 game cards and 105 port profiles.

Virtua Cop uses its own Download/vcop-vr folder, preserving the other developer's Cop VR files. VC1 and VC2 accept complete combined game/firmware ZIPs; separate firmware archives remain optional. Each game's setup validates the actual owned ROM payloads before starting. No game data or BIOS is bundled.

Update checks were tested across all eleven released VR4ALL lightgun ports: an older installed APK offers an update, matching installed bytes show Ready, and stale metadata does not claim an update. The installer also discovers each current public Quest release. A game already installed at the latest build does not need an update; installing through the overseer or another tool counts too.

Fixes Confidential Mission detection after installation outside VR4ALL. Its Android package identity was missing from the device scanner, so a fresh scan could omit it and its updates unless VR4ALL had saved an earlier install record.

Fixes missing update notices for rebuilt lightgun APKs that keep the same numeric version and use a different source revision suffix. All eleven managed public profiles now use the installed APK's SHA-256 against the release asset, so changed bytes are detected even when the version number is unchanged. VC1 also exposes its supported separate LCD-firmware archive, avoiding manual ZIP merging.

This release preserves the existing VR4ALL updater and other installation workflows. Automated checks and read-only connected-headset probes are separate from a full new-game install/play test through this version of VR4ALL.
