# VR4ALL v0.3.81 beta

- Fixed VR4ALL's Jurassic Park Arcade Windows build launcher disabling Git Bash path conversion for native Python, clang and Android build tools.
- Corrected JAVA_HOME handling for Android APK signing, including JDK installation paths containing spaces.
- Kept the author's separate ADB path handling, selected-headset targeting, persistent build folder and signing key behavior.

Includes the Bugdom VR and Bugdom 2 VR additions from v0.3.80. This corrects the launcher-side path issue without requiring the C:\\c junction workaround. Game files are never bundled with VR4ALL.

Verification covers real Windows tool calls and the author's install/data-transfer scripts with an ADB test executable. A complete Jurassic Park game build and headset play have not been verified here. The author's existing compiler flag quoting can still limit full builds with spaces in the source or SDK path; use paths without spaces for those folders.
