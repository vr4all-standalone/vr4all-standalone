const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { GitHubReleases } = require('../src/releases');

async function cacheDir() {
  const root = path.join(__dirname, '..', '.cache');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'releases-test-'));
}

test('APK cache separates repositories even when release filenames and sizes match', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  global.fetch = async (url) => new Response(url.includes('/alpha/') ? 'AAAA' : 'BBBB');
  try {
    const releases = new GitHubReleases(dir);
    const first = await releases.download({ tag: 'v1', assetName: 'Quest.apk', size: 4, downloadUrl: 'https://github.com/owner/alpha/releases/download/v1/Quest.apk' });
    const second = await releases.download({ tag: 'v1', assetName: 'Quest.apk', size: 4, downloadUrl: 'https://github.com/owner/beta/releases/download/v1/Quest.apk' });
    assert.notEqual(first, second);
    assert.equal(await fs.readFile(first, 'utf8'), 'AAAA');
    assert.equal(await fs.readFile(second, 'utf8'), 'BBBB');
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('parallel requests for one APK share the same download', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  let fetches = 0;
  global.fetch = async () => { fetches++; return new Response('APK!'); };
  try {
    const releases = new GitHubReleases(dir);
    const release = { tag: 'v1', assetName: 'Quest.apk', size: 4, downloadUrl: 'https://github.com/owner/alpha/releases/download/v1/Quest.apk' };
    const [first, second] = await Promise.all([releases.download(release), releases.download(release)]);
    assert.equal(first, second);
    assert.equal(fetches, 1);
    assert.equal(await fs.readFile(first, 'utf8'), 'APK!');
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('cachedFile returns only the exact cached release asset with its expected size', async () => {
  const dir = await cacheDir();
  const releases = new GitHubReleases(dir);
  const release = { assetName: 'Quest.apk', size: 4, downloadUrl: 'https://github.com/owner/port/releases/download/v1/Quest.apk' };
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('APKa');
  try {
    assert.equal(await releases.cachedFile(release), null);
    const target = await releases.download(release, () => {});
    assert.equal(await releases.cachedFile(release), target);
    await fs.writeFile(target, 'broken');
    assert.equal(await releases.cachedFile(release), null);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('forced release check bypasses the 15 minute cache', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  let fetches = 0;
  global.fetch = async () => {
    fetches++;
    return new Response(JSON.stringify([{ tag_name: `v${fetches}`, published_at: '2026-10-21T00:00:00Z', assets: [{ name: 'Quest.apk', browser_download_url: `https://github.com/owner/port/releases/download/v${fetches}/Quest.apk` }] }]), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const releases = new GitHubReleases(dir);
    const source = { repo: 'owner/port', assetPattern: '^Quest\\.apk$' };
    assert.equal((await releases.latest(source)).tag, 'v1');
    assert.equal((await releases.latest(source)).tag, 'v1');
    assert.equal((await releases.latest(source, { force: true })).tag, 'v2');
    assert.equal(fetches, 2);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('cached latest release exposes download counts without a network request', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  let fetches = 0;
  global.fetch = async () => { fetches++; throw new Error('network should not be used'); };
  try {
    const source = { repo: 'owner/port', assetPattern: '^Quest\\.apk$' };
    const crypto = require('node:crypto');
    const index = path.join(dir, 'release-index', `${crypto.createHash('sha256').update(source.repo).digest('hex').slice(0, 20)}.json`);
    await fs.mkdir(path.dirname(index), { recursive: true });
    await fs.writeFile(index, JSON.stringify({ at: Date.now(), releases: [{ tag_name: 'v1', assets: [{ name: 'Quest.apk', download_count: 42, browser_download_url: 'https://github.com/owner/port/releases/download/v1/Quest.apk' }] }] }));
    const found = await new GitHubReleases(dir).cachedLatest(source);
    assert.equal(found.totalDownloads, 42);
    assert.equal(fetches, 0);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('an empty cached release response is retried instead of hiding published APKs', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  const source = { repo: 'owner/port', assetPattern: '^Quest\\.apk$' };
  const crypto = require('node:crypto');
  const index = path.join(dir, 'release-index', `${crypto.createHash('sha256').update(source.repo).digest('hex').slice(0, 20)}.json`);
  await fs.mkdir(path.dirname(index), { recursive: true });
  await fs.writeFile(index, JSON.stringify({ at: Date.now(), releases: [] }));
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return new Response(JSON.stringify([{ tag_name: 'v2', assets: [{ name: 'Quest.apk', browser_download_url: 'https://github.com/owner/port/releases/download/v2/Quest.apk' }] }]));
  };
  try {
    assert.equal((await new GitHubReleases(dir).latest(source)).tag, 'v2');
    assert.equal(calls, 1);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('Beef Raider source matches its named 1.0.0 release', () => {
  const { getCatalog } = require('../src/catalog');
  const { selectRelease } = require('../src/core');
  const source = getCatalog().find((game) => game.id === 'beef-raider-xr').source;
  const release = selectRelease([{ name: 'v1.0.0 Initial Public Release', tag_name: '1.0.0', assets: [{ name: 'beefraiderxr-1.0.0.apk', browser_download_url: 'https://github.com/Team-Beef-Studios/BeefRaiderXR/releases/download/1.0.0/beefraiderxr-1.0.0.apk' }] }], source);
  assert.equal(release?.assetName, 'beefraiderxr-1.0.0.apk');
});

test('release metadata survives a restart and reports a stale fallback if GitHub is rate limited', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  let fetches = 0;
  const source = { repo: 'owner/port', assetPattern: '^Quest\\.apk$' };
  global.fetch = async () => {
    fetches++;
    if (fetches > 1) return new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    return new Response(JSON.stringify([{ tag_name: 'v1', published_at: '2026-10-21T00:00:00Z', assets: [{ name: 'Quest.apk', browser_download_url: 'https://github.com/owner/port/releases/download/v1/Quest.apk' }] }]));
  };
  try {
    assert.equal((await new GitHubReleases(dir).latest(source)).tag, 'v1');
    assert.equal((await new GitHubReleases(dir).latest(source)).tag, 'v1');
    assert.equal(fetches, 1);
    const stale = await new GitHubReleases(dir).latest(source, { force: true });
    assert.equal(stale.tag, 'v1');
    assert.equal(stale.stale, true);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('a rate limited API still finds the latest matching APK and digest on public release pages', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  const fetched = [];
  const source = { repo: 'owner/ports', assetPattern: '^GameB-.*\\.apk$' };
  global.fetch = async (url) => {
    fetched.push(String(url));
    if (String(url).startsWith('https://api.github.com/')) return new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    if (String(url).endsWith('/releases')) return new Response(`
      <section id="release-b2"><a href="/owner/ports/releases/tag/b2">Game B 2</a><relative-time datetime="2026-10-22T10:00:00Z"></relative-time></section>
      <section id="release-a1"><a href="/owner/ports/releases/tag/a1">Game A 1</a><relative-time datetime="2026-10-21T10:00:00Z"></relative-time></section>`);
    if (String(url).endsWith('/expanded_assets/b2')) return new Response(`<li class="Box-row"><a href="/owner/ports/releases/download/b2/GameB-v2.apk">GameB-v2.apk</a><span>sha256:${'a'.repeat(64)}</span><span>42 MB</span></li>`);
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const release = await new GitHubReleases(dir).latest(source);
    assert.equal(release.tag, 'b2');
    assert.equal(release.assetName, 'GameB-v2.apk');
    assert.equal(release.digest, `sha256:${'a'.repeat(64)}`);
    assert.equal(release.stale, false);
    assert.equal(fetched.filter((url) => url.endsWith('/expanded_assets/b2')).length, 1);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('public release fallback retries a shortened GitHub HTML response and reuses the result', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  let listings = 0;
  global.fetch = async (url) => {
    const address = String(url);
    if (address.startsWith('https://api.github.com/')) return new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    if (address.endsWith('/releases') || address.includes('/releases?expanded=true')) {
      listings++;
      return new Response(listings === 1 ? '<html><body>Loading releases</body></html>' : '<section id="release-v2"><a href="/owner/ports/releases/tag/v2">v2</a></section>');
    }
    if (address.endsWith('/expanded_assets/v2')) return new Response('<li class="Box-row"><a href="/owner/ports/releases/download/v2/Quest-v2.apk">Quest-v2.apk</a></li>');
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const releases = new GitHubReleases(dir);
    const source = { repo: 'owner/ports', assetPattern: '^Quest-.*\\.apk$' };
    assert.equal((await releases.latest(source)).tag, 'v2');
    assert.equal((await releases.latest(source)).tag, 'v2');
    assert.equal(listings, 2);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('public fallback follows a renamed GitHub repository to its current release assets', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).startsWith('https://api.github.com/')) return new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    if (String(url).endsWith('/old/releases')) return {
      ok: true, url: 'https://github.com/owner/new/releases',
      text: async () => '<section id="release-v2"><a href="/owner/new/releases/tag/v2">New v2</a></section>',
    };
    if (String(url).endsWith('/new/releases/expanded_assets/v2')) return new Response('<li class="Box-row"><a href="/owner/new/releases/download/v2/Quest-v2.apk">Quest-v2.apk</a></li>');
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const release = await new GitHubReleases(dir).latest({ repo: 'owner/old', assetPattern: '^Quest-.*\\.apk$' });
    assert.equal(release.assetName, 'Quest-v2.apk');
    assert.match(release.downloadUrl, /\/owner\/new\/releases\/download\//);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('a public API rate limit is not retried for every catalog repository', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  let apiCalls = 0;
  global.fetch = async (url) => {
    const address = String(url);
    if (address.startsWith('https://api.github.com/')) { apiCalls++; return new Response('', { status: 429 }); }
    const repo = address.includes('/owner/first/') ? 'first' : 'second';
    if (address.endsWith('/releases')) return new Response(`<section id="release-v1"><a href="/owner/${repo}/releases/tag/v1">v1</a></section>`);
    if (address.endsWith('/expanded_assets/v1')) return new Response(`<li class="Box-row"><a href="/owner/${repo}/releases/download/v1/Quest.apk">Quest.apk</a></li>`);
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const releases = new GitHubReleases(dir);
    for (const repo of ['owner/first', 'owner/second']) {
      assert.equal((await releases.latest({ repo, assetPattern: '^Quest\\.apk$' })).tag, 'v1');
    }
    assert.equal(apiCalls, 1);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('cached APKs with the wrong GitHub digest are replaced before install', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  const good = Buffer.from('RIGHT');
  const digest = `sha256:${require('node:crypto').createHash('sha256').update(good).digest('hex')}`;
  const release = { assetName: 'Quest.apk', downloadUrl: 'https://github.com/owner/port/releases/download/v1/Quest.apk', digest };
  let downloads = 0;
  global.fetch = async () => { downloads++; return new Response(good); };
  try {
    const releases = new GitHubReleases(dir);
    const target = releases.targetFor(release);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'WRONG');
    assert.equal(await releases.cachedFile(release), null);
    assert.equal(await releases.download(release), target);
    assert.equal(await fs.readFile(target, 'utf8'), 'RIGHT');
    assert.equal(downloads, 1);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('an APK download with a wrong GitHub digest is rejected', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('WRONG');
  try {
    const releases = new GitHubReleases(dir);
    const release = { assetName: 'Quest.apk', downloadUrl: 'https://github.com/owner/port/releases/download/v1/Quest.apk', digest: `sha256:${'a'.repeat(64)}` };
    await assert.rejects(() => releases.download(release), /digest|SHA-256/i);
    assert.equal(await releases.cachedFile(release), null);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});

test('a forced public check refreshes assets after a repository rename', async () => {
  const dir = await cacheDir();
  const originalFetch = global.fetch;
  let assetChecks = 0;
  global.fetch = async (url) => {
    if (String(url).startsWith('https://api.github.com/')) return new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    if (String(url).endsWith('/old/releases')) return {
      ok: true, url: 'https://github.com/owner/new/releases',
      text: async () => '<section id="release-v1"><a href="/owner/new/releases/tag/v1">v1</a></section>',
    };
    if (String(url).endsWith('/new/releases/expanded_assets/v1')) {
      assetChecks++;
      return new Response(`<li class="Box-row"><a href="/owner/new/releases/download/v1/Quest.apk">Quest.apk</a><span>sha256:${String(assetChecks).repeat(64)}</span></li>`);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const releases = new GitHubReleases(dir);
    const source = { repo: 'owner/old', assetPattern: '^Quest\\.apk$' };
    assert.equal((await releases.latest(source)).digest, `sha256:${'1'.repeat(64)}`);
    assert.equal((await releases.latest(source, { force: true })).digest, `sha256:${'2'.repeat(64)}`);
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }); }
});
