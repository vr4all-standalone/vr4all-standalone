const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { GitHubReleases } = require('../src/releases');
const { getCatalog } = require('../src/catalog');
const { buildInstallPlan } = require('../src/core');

test('Honeydew resolves only the checksum-verified Quest APK from the creator site', async (t) => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.cache', 'honeydew-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const bytes = Buffer.from('test Quest APK');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const html = `<details class="release-checksum release-quest"><summary>Meta Quest 3 / 3S standalone</summary><p class="release-version">Version 0.3.1.</p><a href="/downloads/ProjectHoneydew-0.3.1-quest.apk">Download for Quest</a><code>${digest}</code></details>`;
  const requests = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    return String(url).endsWith('.apk') ? new Response(bytes) : new Response(html);
  };
  const source = { provider: 'project-honeydew' };
  const releases = new GitHubReleases(root);
  const release = await releases.latest(source);
  assert.equal(release.tag, '0.3.1');
  assert.equal(release.downloadUrl, 'https://projecthoneydew.com/downloads/ProjectHoneydew-0.3.1-quest.apk');
  assert.equal(release.digest, `sha256:${digest}`);
  assert.equal((await releases.latest(source)).tag, '0.3.1');
  assert.equal(requests.length, 1);
  assert.equal(await fs.readFile(await releases.download(release), 'utf8'), bytes.toString());
  assert.equal(requests.length, 2);
  assert.throws(() => releases.targetFor({ ...release, downloadUrl: 'https://other.example/downloads/ProjectHoneydew-0.3.1-quest.apk' }), /Untrusted/);
});

test('Deus Ex remains a development guide while Honeydew requires an owned disc', () => {
  const games = getCatalog();
  const deus = games.find((game) => game.id === 'deus-ex-quest-vr');
  const honeydew = games.find((game) => game.id === 'project-honeydew');
  assert.equal(deus.externalInstaller, true);
  assert.equal(deus.source, undefined);
  assert.match(deus.guidance, /smoke.test|in development/i);
  assert.equal(honeydew.source.provider, 'project-honeydew');
  assert.equal(honeydew.data.length, 1);
  const plan = buildInstallPlan(honeydew, { serial: 'Q3', apkPath: 'C:\\Mods\\Honeydew.apk', files: { disc: 'C:\\Games\\Pikmin.iso' } });
  assert.equal(plan.find((step) => step.args.includes('push')).args.at(-1), '/sdcard/Download/VR4ALL-project-honeydew-disc.iso');
});
