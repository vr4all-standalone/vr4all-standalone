const { execFile } = require('node:child_process');
const { findOnPath } = require('./find-tool');

function linuxPickerCommand(binary, kind, defaultPath) {
  const directory = kind === 'directory';
  if (binary.endsWith('kdialog')) {
    return [binary, [directory ? '--getexistingdirectory' : '--getopenfilename', defaultPath || '.']];
  }
  const args = ['--file-selection', ...(directory ? ['--directory'] : []), `--title=${directory ? 'Choose game data folder' : 'Choose game file'}`];
  if (defaultPath) args.push(`--filename=${defaultPath.replace(/\/?$/, '/')}`);
  return [binary, args];
}

function run(command, args) {
  return new Promise((resolve, reject) => execFile(command, args, { timeout: 120000, maxBuffer: 8192 }, (error, stdout, stderr) => {
    // zenity/kdialog exit 1 when the user cancels: that is "no choice", not a failure.
    if (error && error.code === 1 && !String(stderr).trim()) return resolve('');
    return error ? reject(new Error(stderr || error.message)) : resolve(stdout);
  }));
}

async function pickOnLinux(kind, defaultPath, options) {
  const zenity = await (options.find || findOnPath)(['zenity']);
  const binary = zenity || await (options.find || findOnPath)(['kdialog']);
  if (!binary) throw new Error('Install zenity or kdialog to use Browse, or type the path in the field');
  const [command, args] = linuxPickerCommand(binary, kind, defaultPath);
  return (await (options.run || run)(command, args)).trim() || null;
}

function pickPath(kind, defaultPath, options = {}) {
  if (!['file', 'directory'].includes(kind)) throw new Error('Invalid picker kind');
  const platform = options.platform || process.platform;
  if (platform === 'linux') return pickOnLinux(kind, defaultPath, options);
  if (platform !== 'win32') throw new Error('Use the path field on this platform');
  let script = kind === 'directory'
    ? 'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "Choose game data folder"; if ($dialog.ShowDialog() -eq "OK") { [Console]::Out.Write($dialog.SelectedPath) }'
    : 'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.OpenFileDialog; $dialog.Title = "Choose game file"; $dialog.Filter = "All files (*.*)|*.*"; if ($dialog.ShowDialog() -eq "OK") { [Console]::Out.Write($dialog.FileName) }';
  if (kind === 'directory' && defaultPath) {
    script = script.replace('$dialog.Description = "Choose game data folder";', '$dialog.Description = "Choose download folder"; $dialog.SelectedPath = $env:VR4ALL_PICKER_DEFAULT;');
  }
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, timeout: 120000, maxBuffer: 8192, env: { ...process.env, VR4ALL_PICKER_DEFAULT: defaultPath || '' } }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout.trim() || null)));
}

module.exports = { pickPath, linuxPickerCommand };
