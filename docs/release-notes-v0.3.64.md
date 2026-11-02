# VR4ALL v0.3.64 beta

Jurassic Park Arcade Quest now has a **Build and install** card inside VR4ALL. Drop your owned Raw Thrills Linux PC v1.08 TeknoParrot game folder and the matching PhysX 2.8 i386 `ElfLdr2/libs` folder. If PhysX is nested inside the game folder, VR4ALL fills the second field automatically. The app validates the exact game binary and four PhysX libraries, downloads the creator's current source, runs the creator's dependency, preparation and Quest build scripts, then installs the personal APK and transfers game data to the selected Quest.

The build stays in the PC build folder selected in VR4ALL. Reusing that folder preserves its signing key and incremental output for later builds. This is a large first build: the creator documents about 15 GB free PC storage, 16 GB RAM, and roughly 15–60 minutes to compile. Git for Windows, Python 3.10+, Android SDK with NDK 27.1.12297006, build-tools 36.0.0, platform android-36, and JDK 17+ must already be installed. VR4ALL checks those prerequisites and reports what is missing; it does not yet install them for this port.

The headset scan now marks Jurassic Park Arcade ready only when its Quest package and transferred game and PhysX data are present. The creator documents Quest 3 support; Quest 3S has not been verified. The personal APK contains recompiled game code and must not be redistributed.

Validated with installer tests and a mocked author build sequence. A full source compilation and Quest play test require the user's owned arcade dump and were not performed for this beta.
