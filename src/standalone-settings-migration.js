const path = require('node:path');

const upstreamRepo = 'mikermak/hotd2-vr';
const upstreamPattern = '^hotd2-vr-quest\\.apk$';
const upstreamApk = 'hotd2-vr-quest.apk';
const upstreamPackage = 'com.flycast.emulator.vr';
const ports = [
  { id: 'hotd2-vr', variant: 'hotd2-dreamcast-vr', apk: 'hotd2-arcade-vr-quest.apk', packageId: 'com.vrlightgunhub.hotd2arcade', media: ['disc'] },
  { id: 'mok-vr', variant: 'mok-upstream-vr', apk: 'mok-vr-quest.apk', packageId: 'com.vrlightgunhub.mok', media: ['mok', 'chd', 'naomi'] },
];
const record = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const apkName = (value) => typeof value === 'string' ? path.win32.basename(value).toLowerCase() : '';

// Earlier settings saves included catalog defaults as overrides. Keep custom
// sources intact, and retain links to the old app under its selectable variant.
function migrateStandaloneSettings(settings) {
  if (settings.standalonePortsMigrationVersion >= 1) return false;
  for (const port of ports) {
    const source = settings.sources?.[port.id];
    const legacySource = record(source) && source.repo === upstreamRepo && source.assetPattern === upstreamPattern
      && Object.keys(source).every((key) => key === 'repo' || key === 'assetPattern');
    if (legacySource) {
      if (!Object.hasOwn(settings.sources, port.variant)) settings.sources[port.variant] = { ...source };
      delete settings.sources[port.id];
    }
    for (const installed of Object.values(settings.installed || {})) {
      const previous = installed?.[port.id];
      if (!record(installed) || !record(previous) || previous.packageId === port.packageId) continue;
      if (previous.packageId !== upstreamPackage && apkName(previous.apk) !== upstreamApk) continue;
      if (!Object.hasOwn(installed, port.variant)) installed[port.variant] = { ...previous };
      delete installed[port.id];
    }
    const values = settings.localPaths?.[port.id];
    if (!record(values)) continue;
    const name = apkName(values.apkPath);
    const legacyApk = name === upstreamApk || legacySource && name.endsWith('.apk') && name !== port.apk;
    const copyLink = (key) => {
      if (!Object.hasOwn(values, key)) return;
      if (!Object.hasOwn(settings.localPaths, port.variant)) settings.localPaths[port.variant] = {};
      const target = settings.localPaths[port.variant];
      if (record(target) && !Object.hasOwn(target, key)) {
        target[key] = values[key];
      }
    };
    for (const key of port.media) copyLink(key);
    if (port.id === 'hotd2-vr' && Object.hasOwn(values, 'disc') && record(settings.localPaths[port.variant]) && Object.hasOwn(settings.localPaths[port.variant], 'disc')) {
      delete values.disc;
    }
    if (legacyApk) {
      copyLink('apkPath');
      delete values.apkPath;
    }
  }
  settings.standalonePortsMigrationVersion = 1;
  return true;
}

module.exports = { migrateStandaloneSettings };
