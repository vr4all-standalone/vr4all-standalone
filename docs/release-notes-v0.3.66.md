# VR4ALL v0.3.66 beta

Connected Quest ports now offer **Uninstall from headset** in their game details. VR4ALL shows the exact package and headset before you confirm. If two cards use the same Quest app, the confirmation names the other affected port. Uninstall is blocked while another operation runs on that headset.

After ADB confirms removal, VR4ALL checks that the package is absent, clears its saved install receipt, and updates the library immediately. A fresh headset scan also clears old receipts for apps removed in the headset, and the **Scan connected headset** activity now waits for the installed-app scan before reporting completion.

Android may remove that app's private data and saves during uninstall. VR4ALL leaves ROMs in shared Quest folders and all PC game files untouched, so another port's files are not deleted.

Validation: automated uninstall, shared-package, stale-receipt, and scan-timing tests pass. The full local suite reports 659 passed, 0 failed, and 2 skipped. The packaged app launched and loaded its window. No app was actually uninstalled from a connected Quest during this release check.
