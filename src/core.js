const path = require('node:path');

function parseDevices(output) {
  return String(output).split(/\r?\n/).slice(1).map((line) => {
    const match = line.trim().match(/^(\S+)\s+(device|unauthorized|offline|recovery|sideload)(?:\s+(.*))?$/);
    if (!match) return null;
    const rawModel = match[3]?.match(/\bmodel:(\S+)/)?.[1];
    let model = rawModel ? rawModel.replaceAll('_', ' ') : 'Quest headset';
    if (/^Quest 3S?$/i.test(model)) model = model.replace(/^quest/i, 'Quest');
    return { serial: match[1], state: match[2], model };
  }).filter(Boolean);
}

function selectRelease(releases, source) {
  if (!Array.isArray(releases) || !source?.assetPattern) return null;
  const assetPattern = new RegExp(source.assetPattern, 'i');
  const releasePattern = source.releasePattern ? new RegExp(source.releasePattern, 'i') : null;
  const matches = [];
  let totalDownloads = 0;
  let hasDownloadCounts = true;
  for (const release of releases) {
    if (release.draft) continue;
    if (releasePattern && !releasePattern.test(`${release.name || ''} ${release.tag_name || ''}`)) continue;
    const assets = release.assets?.filter((item) => assetPattern.test(item.name || '') && /^https:\/\/github\.com\//i.test(item.browser_download_url || '')) || [];
    const asset = assets[0];
    if (!asset) continue;
    for (const item of assets) {
      if (!Number.isSafeInteger(item.download_count) || item.download_count < 0) hasDownloadCounts = false;
      else totalDownloads += item.download_count;
    }
    matches.push({
      tag: release.tag_name || release.name,
      title: release.name || release.tag_name,
      url: release.html_url,
      assetName: asset.name,
      downloadUrl: asset.browser_download_url,
      digest: /^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ? asset.digest.toLowerCase() : null,
      size: asset.size || null,
      downloadCount: Number.isSafeInteger(asset.download_count) ? asset.download_count : null,
      publishedAt: release.published_at || null,
      prerelease: Boolean(release.prerelease),
    });
  }
  const latest = matches.sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))[0];
  return latest ? { ...latest, totalDownloads: hasDownloadCounts ? totalDownloads : null } : null;
}

function safeDestination(destination) {
  if (typeof destination !== 'string' || !destination.startsWith('/sdcard/') || /[\x00-\x1f\\]/.test(destination)) {
    throw new Error('Invalid headset destination');
  }
  const segments = destination.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || !/^[A-Za-z0-9._ -]+$/.test(segment)) || destination.includes('//')) {
    throw new Error('Invalid headset destination');
  }
  return destination;
}

function remoteFileName(game, item, source) {
  const original = path.win32.basename(source);
  if (item.destination !== '/sdcard/Download/' || !item.renameOnHeadset && !/^(?:game|disc|rom|dump|image)(?:[ ._-]?\d+)?\.[^.]+$/i.test(original)) return original;
  if (!/^[a-z0-9-]+$/i.test(game.id || '') || !/^[a-z0-9-]+$/i.test(item.id || '')) throw new Error('Invalid game file name');
  return `VR4ALL-${game.id}-${item.id}${path.win32.extname(original).toLowerCase()}`;
}

function buildInstallPlan(game, input) {
  if (!game || !Array.isArray(game.data)) throw new Error('Invalid game profile');
  if (!/^[A-Za-z0-9._:-]+$/.test(input?.serial || '')) throw new Error('Invalid headset serial');
  if (!input?.apkPath || path.win32.extname(input.apkPath).toLowerCase() !== '.apk') throw new Error('Select an APK file');
  if (game.requireOneOf?.length && !input.reuseExistingData && !game.requireOneOf.some((id) => input.files?.[id])) throw new Error(`Select one of ${game.requireOneOf.map((id) => game.data.find((item) => item.id === id)?.label || id).join(' or ')}`);
  const prefix = ['-s', input.serial];
  const steps = [{ label: 'Install APK', args: [...prefix, 'install', '-r', input.apkPath] }];
  if (game.id === 'avp-vr' && input.files?.game) {
    steps.push({ label: 'Initialize AvP game folder', args: [...prefix, 'shell', 'monkey', '-p', 'com.bassquake.quest.avpvr', '1'] });
  }
  if (game.fileAccessPackage) {
    if (!/^[A-Za-z0-9_.]+$/.test(game.fileAccessPackage)) throw new Error('Invalid file access package');
    steps.push({ label: 'Enable game file access', args: [...prefix, 'shell', 'appops', 'set', game.fileAccessPackage, 'MANAGE_EXTERNAL_STORAGE', 'allow'] });
  }
  const made = new Set();
  for (const item of game.data) {
    const source = input.files?.[item.id];
    if (!source) {
      if (item.optional || input.reuseExistingData) continue;
      throw new Error(`Select ${item.label || item.id}`);
    }
    if (typeof source !== 'string') throw new Error(`Invalid path for ${item.label || item.id}`);
    const ext = path.win32.extname(source).toLowerCase();
    if (item.kind === 'file' && item.extensions?.length && !item.extensions.map((value) => value.toLowerCase()).includes(ext)) {
      throw new Error(`${item.label || item.id} must be ${item.extensions.join(', ')}`);
    }
    if (item.kind !== 'file' && item.kind !== 'directory') throw new Error('Invalid data input kind');
    let destination = safeDestination(item.destination);
    if (destination.endsWith('/') && item.kind === 'file') destination += remoteFileName(game, item, source);
    const remoteDir = item.kind === 'directory' ? destination.replace(/\/$/, '') : path.posix.dirname(destination);
    if (!made.has(remoteDir)) {
      steps.push({ label: `Create ${remoteDir}`, args: [...prefix, 'shell', 'mkdir', '-p', remoteDir.includes(' ') ? `'${remoteDir}'` : remoteDir] });
      made.add(remoteDir);
    }
    if (item.kind === 'directory') {
      const entries = input.directoryEntries?.[item.id];
      if (!Array.isArray(entries) || entries.length === 0) throw new Error(`${item.label || item.id} folder is empty`);
      const copiedEntries = entries.filter((entry) => (!item.copyEntries || item.copyEntries.includes(entry)) && (!item.copyExtensions || item.copyExtensions.includes(path.win32.extname(entry).toLowerCase())));
      if (!copiedEntries.length) throw new Error(`${item.label || item.id} folder has no supported game files`);
      for (const entry of copiedEntries) {
        if (!entry || entry === '.' || entry === '..' || /[\\/]/.test(entry)) throw new Error(`Invalid file in ${item.label || item.id}`);
        steps.push({ label: `Copy ${item.id}/${entry}`, args: [...prefix, 'push', path.win32.join(source, entry), destination] });
      }
    } else {
      steps.push({ label: `Copy ${item.id}`, args: [...prefix, 'push', source, destination] });
    }
  }
  return steps;
}

module.exports = { parseDevices, selectRelease, safeDestination, buildInstallPlan };
