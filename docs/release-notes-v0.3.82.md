# VR4ALL v0.3.82 beta

- **Super Mario 64 MR installs inside VR4ALL.** Drop an unmodified USA ROM, select a Quest, and click Build and install. VR4ALL runs the creator's current builder, installs the official Quest APK, and transfers the generated game data. The first build needs about 4 GB of free space in the selected PC build folder.
- **Bully VR updates to the creator's public test.** The release matcher now selects `BullyVR-0.0.1-test.apk` instead of stopping at the older Recovery r20 APK. The latest APK uses the same Quest package ID as the earlier Recovery build.
- Corrected the **Star Wars Jedi Knight: Jedi Academy MR** and **Super Mario 64 MR** card titles. Mario MR now has artwork from its creator's gameplay clip.

Verification: 868 tests passed on Windows and 25 platform-dependent tests were skipped. Bully's latest release asset and APK package ID were checked against the creator's GitHub release. Mario MR's build and Quest transfer steps were tested with a simulated builder and ADB; a full build from an owned ROM and headset play have not yet been tested.
