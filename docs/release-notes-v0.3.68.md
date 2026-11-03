# VR4ALL v0.3.68 beta

VR4ALL now has separate Windows x64 and Linux x64 downloads. This release incorporates the community Linux contribution in [PR #2](https://github.com/vr4all-standalone/vr4all-standalone/pull/2).

- **Windows:** Download `VR4ALL-win-x64.exe`. The portable Windows app and its in-app self-updater remain available.
- **Linux:** Download `VR4ALL-linux-x64.AppImage`, make it executable, and install the Linux tools listed in the [user guide](https://github.com/vr4all-standalone/vr4all-standalone/blob/main/docs/user-guide.md#run-on-linux). Linux builds need `adb`, `7z`, `chdman`, and `zenity` or `kdialog`. The Linux AppImage does not self-update; download a newer AppImage from Releases when one is published.

The contributor installed Animal Crossing, GTA: San Andreas, and Counter-Strike 1.6 from Linux to a Quest 3. Other newly enabled Linux install routes remain experimental. VR4ALL's cross-platform automated tests run on Windows and Linux; this release's packages were built separately on those operating systems. No headset install was run as part of this packaging check.

Commercial game files and ROMs are not included. Some ports still require their creator's separate APK download.
