# VR4ALL v0.3.87 beta

- **WolfSharp** now uses [Ben McLean's official GitHub Quest APK releases](https://github.com/BenMcLean/WolfSharp/releases) for in-app downloads and update checks. The release picker selects the Meta Quest APK rather than a PC build.
- **Virtua Tennis 3 VR** now runs the creator's Windows game check and personal Quest build inside VR4ALL. Choose the `disk0` folder from your own compatible game copy; VR4ALL checks the exact game revision, builds the APK, and installs it with the game data on the selected headset.

The Virtua Tennis 3 creator does not distribute a Quest APK. Its first Windows build requires Git Bash, CMake, Ninja, Python 3.10+, JDK 17+, and Android SDK with NDK 27 or 28 installed on the PC. VR4ALL reports missing tools through the build activity. The integration has automated builder and simulated ADB tests; an end-to-end build with owned game data and headset gameplay has not yet been verified.
