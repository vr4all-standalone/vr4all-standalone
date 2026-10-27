const path = require('node:path');

function buildEnvironment(workDir) {
  const env = {
    ...process.env,
    TEMP: path.join(workDir, '.tmp'),
    TMP: path.join(workDir, '.tmp'),
    GRADLE_USER_HOME: path.join(workDir, '.gradle'),
    ANDROID_USER_HOME: path.join(workDir, '.android-user'),
  };
  // A launcher running PowerShell 7 can pass incompatible modules to Windows
  // PowerShell 5.1. Let the child reconstruct its own standard module paths.
  if (process.platform === 'win32') for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  return env;
}

module.exports = { buildEnvironment };
