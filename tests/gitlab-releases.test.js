const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { GitHubReleases, validateSource } = require('../src/releases');

const source = { provider: 'gitlab', repo: 'gandork/mpvr', assetPattern: '^mpvr-[0-9.]+\\.apk$' };
const directAsset = 'https://gitlab.com/gandork/mpvr/-/releases/v0.2.3/downloads/mpvr-0.2.3.apk';
const digest = crypto.createHash('sha256').update('APK!').digest('hex');
const metadata = {
  name: 'mpvr 0.2.3', tag_name: 'v0.2.3', released_at: '2026-10-12T19:43:03Z',
  description: `SHA-256: \`mpvr-0.2.3.apk\` ${digest}`,
  assets: { links: [
    { name: 'mpvr-0.2.3-apk.zip', direct_asset_url: 'https://gitlab.com/gandork/mpvr/-/releases/v0.2.3/downloads/mpvr-0.2.3-apk.zip' },
    { name: 'mpvr-0.2.3.apk', direct_asset_url: directAsset },
  ] },
};

test('GitLab source reads only the matching direct Quest APK, digest and cached release', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-gitlab-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    assert.equal(url, 'https://gitlab.com/api/v4/projects/gandork%2Fmpvr/releases/permalink/latest');
    return new Response(JSON.stringify(metadata), { status: 200 });
  };
  const releases = new GitHubReleases(dir);
  const found = await releases.latest(source);
  assert.equal(found.tag, 'v0.2.3');
  assert.equal(found.assetName, 'mpvr-0.2.3.apk');
  assert.equal(found.downloadUrl, directAsset);
  assert.equal(found.digest, `sha256:${digest}`);
  assert.equal(releases.targetFor(found).endsWith('mpvr-0.2.3.apk'), true);
  assert.equal((await new GitHubReleases(dir).cachedLatest(source)).tag, 'v0.2.3');
  assert.equal(calls, 1);
});

test('GitLab release rejects an asset redirected to another project or domain', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-gitlab-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async () => new Response(JSON.stringify({ ...metadata, assets: { links: [
    { name: 'mpvr-0.2.3.apk', direct_asset_url: 'https://other.example/mpvr-0.2.3.apk' },
  ] } }));
  assert.equal(await new GitHubReleases(dir).latest(source), null);
  assert.throws(() => new GitHubReleases(dir).targetFor({ assetName: 'mpvr-0.2.3.apk', downloadUrl: 'https://other.example/mpvr-0.2.3.apk' }), /Untrusted/);
  assert.equal(validateSource(source), source);
});

test('GitLab APK download verifies the creator hash before caching', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-gitlab-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const releases = new GitHubReleases(dir);
  const release = { assetName: 'mpvr-0.2.3.apk', downloadUrl: directAsset, digest: `sha256:${digest}` };
  global.fetch = async () => new Response('WRONG');
  await assert.rejects(() => releases.download(release), /SHA-256 digest/);
  assert.equal(await releases.cachedFile(release), null);
  global.fetch = async () => new Response('APK!');
  const file = await releases.download(release);
  assert.equal(await fs.readFile(file, 'utf8'), 'APK!');
});
