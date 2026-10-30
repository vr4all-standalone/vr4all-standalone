const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { selectRelease } = require('./core');

function validateSource(source) {
  if (source?.provider === 'project-honeydew') return source;
  if (!source || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repo || '')) throw new Error('Enter a GitHub owner/repository');
  if (!source.assetPattern || source.assetPattern.length > 180) throw new Error('Enter an APK asset pattern');
  try { new RegExp(source.assetPattern, 'i'); if (source.releasePattern) new RegExp(source.releasePattern, 'i'); }
  catch { throw new Error('Invalid release pattern'); }
  return source;
}

function honeydewRelease(html) {
  const section = html.match(/<details\b[^>]*class="[^"]*\brelease-quest\b[^"]*"[^>]*>[\s\S]*?<\/details>/i)?.[0];
  const asset = section?.match(/<a\b[^>]*href="(\/downloads\/ProjectHoneydew-(\d+\.\d+\.\d+)-quest\.apk)"[^>]*>[\s\S]*?<\/a>\s*<code>([a-f0-9]{64})<\/code>/i);
  if (!asset || !new RegExp(`\\bVersion\\s+${asset[2].replaceAll('.', '\\.')}\\b`, 'i').test(section)) throw new Error('Honeydew site has no verified Quest APK');
  return {
    tag: asset[2], title: `Project Honeydew ${asset[2]}`, url: 'https://projecthoneydew.com/#download',
    assetName: path.posix.basename(asset[1]), downloadUrl: `https://projecthoneydew.com${asset[1]}`,
    digest: `sha256:${asset[3].toLowerCase()}`, size: null, downloadCount: null, totalDownloads: null,
    publishedAt: null, prerelease: false,
  };
}

function htmlText(value) {
  return String(value || '').replace(/&(?:amp|quot|#39|lt|gt);/g, (entity) => ({
    '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>',
  })[entity]);
}

function publicReleaseEntries(html, repo) {
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagLink = new RegExp(`href="/${escaped}/releases/tag/([^"]+)"[^>]*>([^<]+)</a>`);
  const entries = [];
  for (const section of html.matchAll(/<section\b[^>]*\bid="release-[^"]+"[\s\S]*?<\/section>/g)) {
    const match = section[0].match(tagLink);
    if (!match) continue;
    let tag;
    try { tag = decodeURIComponent(htmlText(match[1])); } catch { continue; }
    if (!tag || tag.includes('/') || tag.includes('\\')) continue;
    entries.push({
      tag_name: tag,
      name: htmlText(match[2]).trim(),
      html_url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
      published_at: section[0].match(/<relative-time\b[^>]*\bdatetime="([^"]+)"/)?.[1] || null,
      prerelease: /\bPre-release\b/i.test(section[0]),
    });
  }
  return entries;
}

function publicReleaseAssets(html, repo, tag) {
  const assets = [];
  for (const row of html.matchAll(/<li\b[^>]*\bclass="[^"]*\bBox-row\b[^"]*"[^>]*>[\s\S]*?<\/li>/g)) {
    const href = row[0].match(/<a\b[^>]*\bhref="([^"]*\/releases\/download\/[^\"]+)"/)?.[1];
    if (!href) continue;
    let url;
    try { url = new URL(htmlText(href), 'https://github.com'); } catch { continue; }
    const prefix = `/${repo}/releases/download/${encodeURIComponent(tag)}/`;
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(prefix)) continue;
    let name;
    try { name = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { continue; }
    if (!name || name.includes('/') || name.includes('\\')) continue;
    assets.push({
      name,
      browser_download_url: url.href,
      digest: row[0].match(/sha256:[a-f0-9]{64}/i)?.[0]?.toLowerCase() || null,
    });
  }
  return assets;
}

async function matchesDigest(file, digest) {
  if (!/^sha256:[a-f0-9]{64}$/i.test(digest || '')) return true;
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}` === digest.toLowerCase();
}

class GitHubReleases {
  constructor(cacheDir = path.join(__dirname, '..', '.cache', 'apks')) {
    this.cacheDir = cacheDir;
    this.releaseCache = new Map();
    this.downloads = new Map();
    this.publicPages = new Map();
    this.publicAssets = new Map();
    this.publicResolved = new Map();
    this.apiLimitedUntil = 0;
    this.siteResolved = new Map();
  }

  async cachedLatest(source) {
    validateSource(source);
    if (source.provider === 'project-honeydew') return this.siteResolved.get(source.provider)?.release || null;
    const repo = source.repo;
    let cached = this.releaseCache.get(repo);
    if (!cached) {
      const indexPath = path.join(this.cacheDir, 'release-index', `${crypto.createHash('sha256').update(repo.toLowerCase()).digest('hex').slice(0, 20)}.json`);
      try {
        const saved = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
        if (Number.isFinite(saved.at) && Array.isArray(saved.releases)) cached = saved;
      } catch { /* No cached GitHub metadata yet. */ }
    }
    if (!cached?.releases?.length) return null;
    const release = selectRelease(cached.releases, source);
    return release ? { ...release, checkedAt: new Date(cached.at).toISOString() } : null;
  }

  async publicText(url, cache) {
    const found = cache.get(url);
    if (found && Date.now() - found.at < 15 * 60 * 1000) return found.promise;
    const promise = (async () => {
      const response = await fetch(url, { headers: { 'User-Agent': 'vr4all/0.2' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`GitHub public release page failed (${response.status})`);
      const content = await response.text();
      if (content.length > 5 * 1024 * 1024) throw new Error('GitHub release page is unexpectedly large');
      return { content, finalUrl: response.url || url };
    })();
    cache.set(url, { at: Date.now(), promise });
    try { return await promise; }
    catch (error) { cache.delete(url); throw error; }
  }

  async publicLatest(source, { force = false } = {}) {
    const { repo } = source;
    let currentRepo = repo;
    const clearedRepos = new Set();
    const clearPublicRepo = (name) => {
      if (!force || clearedRepos.has(name)) return;
      clearedRepos.add(name);
      for (const key of this.publicPages.keys()) if (key.startsWith(`https://github.com/${name}/`)) this.publicPages.delete(key);
      for (const key of this.publicAssets.keys()) if (key.startsWith(`https://github.com/${name}/`)) this.publicAssets.delete(key);
    };
    clearPublicRepo(repo);
    const releasePattern = source.releasePattern ? new RegExp(source.releasePattern, 'i') : null;
    const assetPattern = new RegExp(source.assetPattern, 'i');
    for (let page = 1; page <= 10; page++) {
      const pageUrl = `https://github.com/${currentRepo}/releases${page === 1 ? '' : `?page=${page}`}`;
      const parsePage = (result) => {
        const finalPage = new URL(result.finalUrl);
        const repoMatch = finalPage.pathname.match(/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/releases\/?$/);
        if (finalPage.origin !== 'https://github.com' || !repoMatch) throw new Error('GitHub redirected to an unexpected release page');
        currentRepo = repoMatch[1];
        clearPublicRepo(currentRepo);
        return publicReleaseEntries(result.content, currentRepo);
      };
      let pageResult = await this.publicText(pageUrl, this.publicPages);
      let entries = parsePage(pageResult);
      if (!entries.length) {
        // GitHub sometimes returns a short, valid HTTP 200 page without release sections.
        this.publicPages.delete(pageUrl);
        const alternate = `https://github.com/${currentRepo}/releases?expanded=true${page === 1 ? '' : `&page=${page}`}`;
        pageResult = await this.publicText(alternate, this.publicPages);
        entries = parsePage(pageResult);
        if (!entries.length) {
          this.publicPages.delete(alternate);
          pageResult = await this.publicText(pageUrl, this.publicPages);
          entries = parsePage(pageResult);
        }
      }
      const html = pageResult.content;
      if (!entries.length) throw new Error('GitHub release page format could not be read');
      for (const entry of entries) {
        if (releasePattern && !releasePattern.test(`${entry.name} ${entry.tag_name}`)) continue;
        const assetsUrl = `https://github.com/${currentRepo}/releases/expanded_assets/${encodeURIComponent(entry.tag_name)}`;
        let assetsResult = await this.publicText(assetsUrl, this.publicAssets);
        let assets = publicReleaseAssets(assetsResult.content, currentRepo, entry.tag_name);
        if (!assets.length) {
          this.publicAssets.delete(assetsUrl);
          assetsResult = await this.publicText(assetsUrl, this.publicAssets);
          assets = publicReleaseAssets(assetsResult.content, currentRepo, entry.tag_name);
        }
        const asset = assets.find((item) => assetPattern.test(item.name));
        if (asset) return selectRelease([{ ...entry, assets }], source);
      }
      if (!new RegExp(`href="/${currentRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/releases\\?page=${page + 1}"`).test(html)) break;
    }
    return null;
  }

  async latest(source, { force = false } = {}) {
    validateSource(source);
    if (source.provider === 'project-honeydew') {
      const cached = this.siteResolved.get(source.provider);
      if (!force && cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.release;
      const response = await fetch('https://projecthoneydew.com/', { headers: { 'User-Agent': 'vr4all/0.2' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Honeydew release check failed (${response.status})`);
      const html = await response.text();
      if (html.length > 2 * 1024 * 1024) throw new Error('Honeydew release page is unexpectedly large');
      const release = { ...honeydewRelease(html), checkedAt: new Date().toISOString(), stale: false };
      this.siteResolved.set(source.provider, { at: Date.now(), release });
      return release;
    }
    const repo = source.repo;
    const sourceKey = `${repo}\u0000${source.assetPattern}\u0000${source.releasePattern || ''}`;
    const resolved = this.publicResolved.get(sourceKey);
    if (!force && resolved && Date.now() - resolved.at < 15 * 60 * 1000) return resolved.release;
    let cached = this.releaseCache.get(repo);
    const indexPath = path.join(this.cacheDir, 'release-index', `${crypto.createHash('sha256').update(repo.toLowerCase()).digest('hex').slice(0, 20)}.json`);
    if (!cached) {
      try {
        const saved = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
        if (Number.isFinite(saved.at) && Array.isArray(saved.releases)) cached = saved;
      } catch { /* A missing or damaged cache is treated as empty. */ }
      if (cached) this.releaseCache.set(repo, cached);
    }
    // An empty response is not evidence that a project has no releases. GitHub
    // can transiently return an empty API page for repositories with assets.
    if (cached && cached.releases.length === 0) {
      cached = null;
      this.releaseCache.delete(repo);
    }
    let stale = false;
    if (force || !cached || Date.now() - cached.at > 15 * 60 * 1000) {
      try {
        if (Date.now() < this.apiLimitedUntil) throw new Error('GitHub API rate limit reached');
        const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vr4all/0.2' },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
            const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
            this.apiLimitedUntil = Number.isFinite(reset) && reset > Date.now() ? reset : Date.now() + 15 * 60 * 1000;
          }
          const error = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
            ? 'GitHub API rate limit reached. Try again later or choose a local APK.'
            : `GitHub release check failed (${response.status})`;
          throw new Error(error);
        } else {
          const entries = await response.json();
          if (!Array.isArray(entries)) throw new Error('GitHub returned invalid release metadata');
          if (entries.length === 0) throw new Error('GitHub API returned an empty release list');
          cached = { at: Date.now(), releases: entries };
          this.releaseCache.set(repo, cached);
          await fsp.mkdir(path.dirname(indexPath), { recursive: true }).then(() => fsp.writeFile(indexPath, JSON.stringify(cached))).catch(() => {});
        }
      } catch (error) {
        try {
          const publicRelease = await this.publicLatest(source, { force });
          if (publicRelease) {
            const release = { ...publicRelease, checkedAt: new Date().toISOString(), stale: false };
            this.publicResolved.set(sourceKey, { at: Date.now(), release });
            return release;
          }
          return null;
        } catch (publicError) {
          if (!cached) throw new Error(`${error.message}; ${publicError.message}`);
          stale = true;
        }
      }
    }
    const release = selectRelease(cached.releases, source);
    return release ? { ...release, checkedAt: new Date(cached.at).toISOString(), stale } : null;
  }

  async download(release, onProgress = () => {}) {
    const target = this.targetFor(release);
    if (this.downloads.has(target)) return this.downloads.get(target);
    const task = this.downloadTo(release, target, onProgress, false);
    this.downloads.set(target, task);
    try { return await task; }
    finally { this.downloads.delete(target); }
  }

  async downloadPackage(release, onProgress = () => {}) {
    const target = this.targetFor(release, true);
    if (this.downloads.has(target)) return this.downloads.get(target);
    const task = this.downloadTo(release, target, onProgress, true);
    this.downloads.set(target, task);
    try { return await task; }
    finally { this.downloads.delete(target); }
  }

  async downloadTool(release, onProgress = () => {}) {
    const target = this.targetFor(release, false, true);
    if (this.downloads.has(target)) return this.downloads.get(target);
    const task = this.downloadTo(release, target, onProgress, false, true);
    this.downloads.set(target, task);
    try { return await task; }
    finally { this.downloads.delete(target); }
  }

  targetFor(release, allowZip = false, allowExe = false) {
    const websiteApk = /^https:\/\/projecthoneydew\.com\/downloads\/ProjectHoneydew-\d+\.\d+\.\d+-quest\.apk$/i.test(release?.downloadUrl || '');
    if (!/^https:\/\/github\.com\//i.test(release?.downloadUrl || '') && !websiteApk) throw new Error('Untrusted release URL');
    if (websiteApk && !/^sha256:[a-f0-9]{64}$/i.test(release.digest || '')) throw new Error('Honeydew APK needs the creator SHA-256');
    const filename = path.basename(release.assetName || '');
    if (!/^[A-Za-z0-9_.() -]+\.(?:apk|zip|exe)$/i.test(filename)
      || !/\.apk$/i.test(filename) && !(allowZip && /\.zip$/i.test(filename)) && !(allowExe && /\.exe$/i.test(filename))) throw new Error('Invalid release asset name');
    const identity = crypto.createHash('sha256').update(release.downloadUrl).digest('hex').slice(0, 16);
    return path.join(this.cacheDir, `${identity}-${filename}`);
  }

  async cachedFile(release, allowZip = false, allowExe = false) {
    const target = this.targetFor(release, allowZip, allowExe);
    const stat = await fsp.stat(target).catch(() => null);
    return stat?.isFile() && stat.size > 0 && (!release.size || stat.size === release.size)
      && await matchesDigest(target, release.digest) ? target : null;
  }

  async downloadTo(release, target, onProgress, allowZip = false, allowExe = false) {
    await fsp.mkdir(this.cacheDir, { recursive: true });
    if (await this.cachedFile(release, allowZip, allowExe)) return target;
    const response = await fetch(release.downloadUrl, { headers: { 'User-Agent': 'vr4all/0.2' }, signal: AbortSignal.timeout((allowExe ? 45 : 10) * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`GitHub asset download failed (${response.status})`);
    const expected = Number(response.headers.get('content-length') || release.size || 0);
    if (expected > 2 * 1024 ** 3) throw new Error('GitHub asset is unexpectedly large');
    const part = `${target}.part`;
    let bytes = 0;
    const hash = crypto.createHash('sha256');
    const progress = new (require('node:stream').Transform)({
      transform(chunk, _encoding, done) { bytes += chunk.length; hash.update(chunk); onProgress(bytes, expected); done(null, chunk); },
    });
    try {
      await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(part));
      if (release.size && bytes !== release.size) throw new Error('Downloaded asset size does not match GitHub');
      if (/^sha256:[a-f0-9]{64}$/i.test(release.digest || '') && `sha256:${hash.digest('hex')}` !== release.digest.toLowerCase()) {
        throw new Error('Downloaded asset SHA-256 digest does not match GitHub');
      }
      await fsp.rm(target, { force: true });
      await fsp.rename(part, target);
      return target;
    } catch (error) {
      await fsp.rm(part, { force: true }).catch(() => {});
      throw error;
    }
  }
}

module.exports = { GitHubReleases, validateSource };
