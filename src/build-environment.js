const path = require('node:path');

function buildEnvironment(workDir, options = {}) {
  const platform = options.platform || process.platform;
  const env = {
    ...process.env,
    TEMP: path.join(workDir, '.tmp'),
    TMP: path.join(workDir, '.tmp'),
    GRADLE_USER_HOME: path.join(workDir, '.gradle'),
  };
  if (platform === 'win32') {
    env.ANDROID_USER_HOME = path.join(workDir, '.android-user');
    // A launcher running PowerShell 7 can pass incompatible modules to Windows
    // PowerShell 5.1. Let the child reconstruct its own standard module paths.
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
    return env;
  }
  // ANDROID_USER_HOME stays untouched: it decides where adb looks for the key the
  // Quest already trusts and where Gradle keeps its debug keystore.
  env.TMPDIR = path.join(workDir, '.tmp');
  // An AppImage's bundled libraries must not leak into system curl, python3 or git.
  if (process.env.APPIMAGE) { delete env.LD_LIBRARY_PATH; delete env.LD_PRELOAD; }
  return env;
}

module.exports = { buildEnvironment };
