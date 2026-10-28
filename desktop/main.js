const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const { createApp } = require('../server');
const { GitHubReleases } = require('../src/releases');
const { profilePaths } = require('./profile-paths');
const { confirmExitWithInstalls } = require('./exit-guard');
const { AppUpdater, installApprovedUpdate, startReplacement } = require('./app-updater');

// Keep Windows PowerShell helpers independent of the shell that opened VR4ALL.
if (process.platform === 'win32') delete process.env.PSModulePath;

app.setName('VR4ALL');

let profiles;
try {
  profiles = profilePaths(app.getPath('appData'));
  fs.mkdirSync(profiles.electronDir, { recursive: true });
  app.setPath('userData', profiles.electronDir);
} catch (error) {
  if (process.env.VR4ALL_STARTUP_TRACE) fs.appendFileSync(process.env.VR4ALL_STARTUP_TRACE, `profile-error=${error.stack || error.message}\n`);
  throw error;
}

function traceStartup(message) {
  if (!process.env.VR4ALL_STARTUP_TRACE) return;
  try { fs.appendFileSync(process.env.VR4ALL_STARTUP_TRACE, `${new Date().toISOString()} ${message}\n`); } catch { /* Diagnostics must not stop the app. */ }
}

traceStartup(`userData=${app.getPath('userData')}`);
const ownsInstanceLock = app.requestSingleInstanceLock();
traceStartup(`instanceLock=${ownsInstanceLock}`);
if (!ownsInstanceLock) {
  app.quit();
} else {
  let window = null;
  let server = null;
  let getActiveInstallJobs = () => [];

  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      traceStartup('ready');
      const dataDir = profiles.dataDir;
      const releases = new GitHubReleases(path.join(dataDir, 'apks'));
      const instance = createApp({
        settingsPath: path.join(dataDir, 'settings.json'),
        releases,
        openFolder: async (folder) => {
          const error = await shell.openPath(folder);
          if (error) throw new Error(error);
        },
      });
      server = instance.server;
      getActiveInstallJobs = instance.getActiveInstallJobs;
      const appUpdater = new AppUpdater({
        releases,
        currentVersion: app.getVersion(),
        portablePath: app.isPackaged ? process.env.PORTABLE_EXECUTABLE_FILE : '',
      });
      ipcMain.handle('app-update-check', () => appUpdater.check());
      ipcMain.handle('app-update-install', () => installApprovedUpdate({
        updater: appUpdater,
        getActiveJobs: getActiveInstallJobs,
        confirm: async () => {
          const version = appUpdater.pending?.tag?.replace(/^v/i, '').replace(/-beta$/i, '') || 'new version';
          const { response } = await dialog.showMessageBox(window, {
            type: 'question', title: 'Update VR4ALL',
            message: `VR4ALL ${version} is available. Update and restart now?`,
            detail: 'VR4ALL will download the verified Windows EXE, close, replace the portable app you opened, and reopen it. Your game files and settings stay in place.',
            buttons: ['Update and restart', 'Later'], defaultId: 0, cancelId: 1, noLink: true,
          });
          return response === 0;
        },
        onProgress: (done, total) => {
          if (window && !window.isDestroyed()) window.webContents.send('app-update-progress', {
            done, total, version: appUpdater.pending?.tag?.replace(/^v/i, '').replace(/-beta$/i, ''),
          });
        },
        startReplacement: (input) => startReplacement({ ...input, dataDir }),
        quit: () => app.quit(),
      }));
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      traceStartup(`server=${server.address().port}`);
      const origin = `http://127.0.0.1:${server.address().port}`;
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window = new BrowserWindow({
        title: 'VR4ALL',
        width: 1440,
        height: 920,
        minWidth: 940,
        minHeight: 640,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#0b111c',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
      });
      traceStartup('window-created');
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) shell.openExternal(url);
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith(`${origin}/`)) return;
        event.preventDefault();
        if (url.startsWith('https://')) shell.openExternal(url);
      });
      window.once('ready-to-show', () => window?.show());
      window.on('close', (event) => {
        if (!confirmExitWithInstalls(getActiveInstallJobs(), (options) => dialog.showMessageBoxSync(window, options))) event.preventDefault();
      });
      window.on('closed', () => { window = null; app.quit(); });
      await window.loadURL(origin);
      traceStartup('window-loaded');
    } catch (error) {
      traceStartup(`error=${error.stack || error.message}`);
      dialog.showErrorBox('VR4ALL could not start', error.message);
      app.quit();
    }
  });

  app.on('will-quit', () => {
    if (server?.listening) server.close();
  });
}
