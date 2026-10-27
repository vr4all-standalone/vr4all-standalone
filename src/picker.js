const { execFile } = require('node:child_process');

function pickPath(kind, defaultPath) {
  if (!['file', 'directory'].includes(kind)) throw new Error('Invalid picker kind');
  if (process.platform !== 'win32') throw new Error('Use the path field on this platform');
  let script = kind === 'directory'
    ? 'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "Choose game data folder"; if ($dialog.ShowDialog() -eq "OK") { [Console]::Out.Write($dialog.SelectedPath) }'
    : 'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.OpenFileDialog; $dialog.Title = "Choose game file"; $dialog.Filter = "All files (*.*)|*.*"; if ($dialog.ShowDialog() -eq "OK") { [Console]::Out.Write($dialog.FileName) }';
  if (kind === 'directory' && defaultPath) {
    script = script.replace('$dialog.Description = "Choose game data folder";', '$dialog.Description = "Choose download folder"; $dialog.SelectedPath = $env:VR4ALL_PICKER_DEFAULT;');
  }
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, timeout: 120000, maxBuffer: 8192, env: { ...process.env, VR4ALL_PICKER_DEFAULT: defaultPath || '' } }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout.trim() || null)));
}

module.exports = { pickPath };
