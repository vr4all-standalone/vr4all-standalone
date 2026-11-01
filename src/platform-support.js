// Install flows that shell out to Windows PowerShell kits or Windows-only executables.
// official-zip: PowerShell installer kit. road-rash / harry-potter: PowerShell installer.
// galaxyquest: Windows converter .exe. magic-carpet: mgc-import.exe.
const WINDOWS_PLAYER_INSTALLS = new Set(['official-zip', 'road-rash', 'harry-potter', 'galaxyquest', 'magic-carpet']);

const WINDOWS_ONLY_REASON = 'This port installs through a Windows-only tool. It is not available on Linux yet.';
const EXPERIMENTAL_NOTE = 'Linux support for this port is experimental: VR4ALL has not yet completed this install end to end from Linux. If it fails, report the activity log.';
const ARCH_REASON = 'On Linux this port needs a 64-bit x86 (x64) PC.';
const NOT_ON_LINUX = Object.freeze({
  'bioshock-vr': 'BioShock VR installs through the creator’s 1 GB Windows installer, which carries Windows-only tools. It is not available on Linux.',
});
// Ports whose Linux install path exists. x64: the Linux artifacts are x86-64 only.
const LINUX_PORTS = Object.freeze({
  'crazy-taxi-vr': { x64: true },
  'magic-carpet-vr': { x64: true },
});

// personalBuild covers the creator PowerShell kits (GTA SA, RDR, Vice City), the BioShock
// installer EXE, the Victory Heat PowerShell kit, the F-Zero X gdx-extract.exe tool and the
// Crazy Taxi xdelta3.exe patcher.
function needsWindows(game) {
  return Boolean(game.personalBuild || WINDOWS_PLAYER_INSTALLS.has(game.playerInstall));
}

function platformSupport(game, platform = process.platform, host = {}) {
  if (platform === 'win32' || !needsWindows(game)) return { supported: true };
  if (platform !== 'linux') return { supported: false, reason: WINDOWS_ONLY_REASON };
  if (NOT_ON_LINUX[game.id]) return { supported: false, reason: NOT_ON_LINUX[game.id] };
  const entry = LINUX_PORTS[game.id];
  if (!entry) return { supported: false, reason: WINDOWS_ONLY_REASON };
  if (entry.x64 && (host.arch || process.arch) !== 'x64') return { supported: false, reason: ARCH_REASON };
  return { supported: true, experimental: true, note: EXPERIMENTAL_NOTE };
}

module.exports = { platformSupport, LINUX_PORTS, EXPERIMENTAL_NOTE };
