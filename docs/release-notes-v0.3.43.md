# VR4ALL v0.3.43 — first public beta

VR4ALL is a portable Windows app for discovering and installing standalone Meta Quest game ports. The library currently contains **94 game cards and 98 port choices**.

## Highlights

- Browse standalone ports by console or genre, search the catalog, and open each creator's project.
- Install creator APKs with your own game files. For supported build and patch workflows, VR4ALL prepares the Quest app inside the installer.
- Detect connected Quest 2, Quest 3, Quest 3S, and Quest Pro headsets. Each port's actual headset support depends on its creator.
- Save file locations for later installs, bulk install games whose inputs are ready, and check installed mods for new creator releases.
- Review updates and approve a bulk update; VR4ALL installs eligible updates sequentially.
- Morrowind now accepts an installed game folder containing `Morrowind.ini` and the `Data Files` directory, and transfers those two required items to the Quest.

## Get started

1. Download `VR4ALL-0.3.43-win-x64.exe` below and run it on Windows x64. No separate Node.js installation is needed.
2. Enable Developer Mode on your Quest, connect it by USB, and approve USB debugging inside the headset.
3. Open a game card, provide the original game files or creator APK requested there, and click **Install**.
4. Launch the port from your Quest's app library. Use **Check updates** after reconnecting the headset to review newer builds.

The portable EXE includes ADB and 7-Zip. It does **not** include commercial games, ROMs, or paid game data. Some creators distribute APKs outside GitHub; those cards ask you to download the APK from the creator and select it locally. Those ports cannot receive automatic GitHub release checks until a verified direct APK source is available.

## Beta notes

- The app is unsigned, so Windows may show a publisher warning.
- Game and headset compatibility varies by port. A completed file transfer confirms that files reached the Quest; launch the game to confirm it plays correctly.
- Update checks detect newer supported creator releases. VR4ALL asks before installing them; it does not silently install updates when you connect a headset.
- Some author build workflows need additional downloads, available disk space, or a Google SDK license decision. VR4ALL shows those steps in the app.

Please report a failed install with the game name, Quest model, VR4ALL version, and a **redacted** log. Do not upload ROMs, game files, headset serial numbers, credentials, or full local paths.
