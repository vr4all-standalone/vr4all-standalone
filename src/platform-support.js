// Install flows that shell out to Windows PowerShell kits or Windows-only executables.
// official-zip: PowerShell installer kit. road-rash / harry-potter: PowerShell installer.
// galaxyquest: Windows converter .exe. magic-carpet: mgc-import.exe.
const WINDOWS_PLAYER_INSTALLS = new Set(['official-zip', 'road-rash', 'harry-potter', 'galaxyquest', 'magic-carpet']);

// personalBuild covers the creator PowerShell kits (GTA SA, RDR, Vice City), the BioShock
// installer EXE, the Victory Heat PowerShell kit, the F-Zero X gdx-extract.exe tool and the
// Crazy Taxi xdelta3.exe patcher. manualBuild and releaseKind installer/patch mark the same ports.
function needsWindows(game) {
  return Boolean(game.personalBuild || game.manualBuild
    || game.releaseKind === 'installer' || game.releaseKind === 'patch'
    || WINDOWS_PLAYER_INSTALLS.has(game.playerInstall));
}

function platformSupport(game, platform = process.platform) {
  if (platform === 'win32' || !needsWindows(game)) return { supported: true };
  return { supported: false, reason: 'This port installs through a Windows-only tool. It is not available on Linux yet.' };
}

module.exports = { platformSupport };
