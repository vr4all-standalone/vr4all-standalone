const fs = require('node:fs');
const crypto = require('node:crypto');

async function installedApkSha256(adb, serial, packageId) {
  const packagePaths = await adb.run(['-s', serial, 'shell', 'pm', 'path', packageId]);
  const remotePath = packagePaths.split(/\r?\n/).map((line) => line.trim().match(/^package:(\/data\/app\/\S+\/base\.apk)$/)?.[1]).find(Boolean);
  if (!remotePath) return null;
  const remoteOutput = await adb.run(['-s', serial, 'shell', 'sha256sum', remotePath]);
  return remoteOutput.match(/^([a-f0-9]{64})\s/i)?.[1]?.toLowerCase() || null;
}

async function matchesInstalledDigest(adb, serial, packageId, digest) {
  if (!/^sha256:[a-f0-9]{64}$/i.test(digest || '')) return null;
  const remoteHash = await installedApkSha256(adb, serial, packageId);
  return remoteHash ? remoteHash === digest.slice(7).toLowerCase() : null;
}

async function matchesInstalledApk(adb, serial, packageId, localApk) {
  const remoteHash = await installedApkSha256(adb, serial, packageId);
  if (!remoteHash) return null;
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(localApk)) digest.update(chunk);
  return digest.digest('hex') === remoteHash;
}

module.exports = { matchesInstalledApk, matchesInstalledDigest };
