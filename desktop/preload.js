const { contextBridge, webUtils } = require('electron');

contextBridge.exposeInMainWorld('vr4allDesktop', {
  pathForFile: (file) => webUtils.getPathForFile(file),
});
