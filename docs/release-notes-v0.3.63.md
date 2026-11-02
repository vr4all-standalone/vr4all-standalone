# VR4ALL v0.3.63 beta

Fixes GTA: San Andreas builds from phone export folders. VR4ALL now keeps build tools outside the selected game folder, detects older saved locations that overlap it, and suggests a safe folder beside the export. Choose **Download and set up tools** once at the suggested location, then **Build and install**. The old tools folder and original export are left untouched.

GTA exports are passed to the creator's builder through `base.apk` and its sibling split APKs, so an old tools folder inside the export is not scanned as game input. The same build location check protects Red Dead Redemption and Vice City folder builds.

No owned game files are redistributed. This release does not claim a full GTA build or headset play test with the reporter's files.
