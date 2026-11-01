const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('vr4allDesktop', {
  pathForFile: (file) => webUtils.getPathForFile(file),
  copyText: (value) => ipcRenderer.invoke('clipboard-write-text', value),
  checkAppUpdate: () => ipcRenderer.invoke('app-update-check'),
  installAppUpdate: () => ipcRenderer.invoke('app-update-install'),
  onAppUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('app-update-progress', listener);
    return () => ipcRenderer.removeListener('app-update-progress', listener);
  },
});
