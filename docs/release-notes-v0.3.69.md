# VR4ALL v0.3.69 beta

- Adds **Balatro in VR** from [BaLaurent's standalone Quest project](https://github.com/BaLaurent/BalatroVRMod-Standalone). Choose your own Steam `Balatro.exe` version **1.0.1o**. VR4ALL runs the creator's source build, checks both generated Quest APK package IDs, then installs the VR client and personal game host to the selected Quest 3 or 3S. The card uses the creator's artwork.
- The Balatro status checks for **both** Quest packages before showing Ready. Uninstalling from VR4ALL removes both apps.
- Balatro has **no prebuilt Quest APK release**. Its creator's build currently requires Linux, or WSL2 on Windows, with Godot 4.7.2, Android SDK/NDK, JDK 17 and the other listed tools configured. Windows PCs without WSL2 now receive a clear message before VR4ALL downloads the source. The generated host APK contains your game and must remain private.

VR4ALL now lists **131 game projects and 5 emulator tools**. Windows and Linux packages are separate downloads. The Linux AppImage requires a manual download for app updates; the Windows portable app can update itself in app.

The Balatro build route and device status passed automated tests. A full Balatro build and headset play check were **not** run for this release: no owned Balatro 1.0.1o input or configured Linux/WSL toolchain was available in the release environment. Commercial game files are not included.
