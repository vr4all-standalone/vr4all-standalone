const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const packages = Object.freeze({ 'com.netflix.NGP.Kamo': 'Netflix RDR', 'com.rockstargames.rdr': 'Google Play RDR' });

async function exportRdrPrivatePacks({ adb, serial, packageId, directory, missing, present, installedSplits, statfs = fs.statfs, onLog = () => {} }) {
  if (!Object.hasOwn(packages, packageId)) throw new Error('Unsupported RDR package for private pack export');
  const label = packages[packageId];
  const rootMessage = `${label} export is incomplete: required game packs are missing from its APKs. These packs may be in private Android storage, which this phone cannot export without existing root access. Select matching files in Additional RDR game data, then export again, or use a complete export from a device that can read all packs. Changing editions does not guarantee a complete export. VR4ALL does not root your phone.`;
  const run = (...args) => adb.run(['-s', serial, ...args], undefined, { timeoutMs: 120000 });
  const alreadyRoot = String(await run('shell', 'id', '-u')).trim() === '0';
  if (!alreadyRoot && !await run('shell', 'which', 'su').then((value) => String(value).trim(), () => '')) throw new Error(rootMessage);
  onLog(`${label} data packs need existing root access. If the phone asks, approve superuser access for Shell to read this game.`);
  const command = (script) => {
    if (/[\r\n']/.test(script)) throw new Error('Unsupported private game-pack command');
    return alreadyRoot ? script : `su -c '${script}'`;
  };
  const read = (script) => run('shell', command(script));
  let uid;
  try { uid = String(await read('id -u')).trim(); } catch { throw new Error(rootMessage); }
  if (uid !== '0') throw new Error(rootMessage);
  if (typeof adb.runToFile !== 'function') throw new Error('This ADB connection cannot stream private game files. Reopen the updated VR4ALL app.');
  const lines = (text) => String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const remoteRoot = `/data/user/0/${packageId}/files/assetpacks`;
  const packs = lines(await read(`ls -1 ${remoteRoot}`).catch(() => ''));
  if (packs.length > 128) throw new Error('Too many downloaded game packs');
  const plan = [], planned = new Set();
  for (const pack of packs) {
    // Play Asset Delivery keeps temporary/metadata directories alongside packs.
    if (/^_[A-Za-z0-9_.-]+$/.test(pack)) continue;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(pack)) throw new Error('The phone returned an unsafe or unsupported pack name');
    if (installedSplits.has(pack)) continue;
    const versions = lines(await read(`ls -1 ${remoteRoot}/${pack}`));
    if (!versions.includes('63226194')) continue;
    const revisions = lines(await read(`ls -1 ${remoteRoot}/${pack}/63226194`)).filter((revision) => /^\d{1,19}$/.test(revision));
    revisions.sort((a, b) => BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0);
    if (!revisions.length) continue;
    const assets = `${remoteRoot}/${pack}/63226194/${revisions[0]}/assets`;
    const listing = lines(await read(`cd ${assets} && find . -type f -exec stat -c %s:%n {} +`).catch(() => ''));
    if (listing.length > 20000 || plan.length + listing.length > 20000) throw new Error('Too many files in the downloaded game packs');
    for (const line of listing) {
      const match = line.match(/^(\d+):\.\/(.+)$/);
      if (!match || !/^[A-Za-z0-9_+-][A-Za-z0-9_.+-]*(\/[A-Za-z0-9_+-][A-Za-z0-9_.+-]*)*$/.test(match[2]) || match[2].endsWith('.partial')) throw new Error('The phone returned an unsafe or unsupported game-pack file path');
      const relative = match[2], bytes = Number(match[1]), member = `assets/${relative}`;
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 64 * 1024 ** 3) throw new Error('Invalid downloaded game-pack file size');
      if (present.has(member)) continue;
      if (planned.has(member)) throw new Error('Downloaded game packs contain duplicate file paths');
      if (bytes > 0) planned.add(member);
      plan.push({ pack, relative, member, bytes, remote: `${assets}/${relative}` });
    }
  }
  const absent = missing.filter((member) => !planned.has(member));
  if (absent.length) throw new Error(`${label} game data is still incomplete (${absent.length} required files missing). Open RDR on the phone, finish its downloads and enter the game world, then export again.`);
  const total = plan.reduce((sum, file) => sum + file.bytes, 0);
  if (!Number.isSafeInteger(total) || total > 256 * 1024 ** 3) throw new Error('Downloaded game packs are unexpectedly large');
  const disk = await statfs(directory);
  if (Number(disk.bavail) * Number(disk.bsize) < total + 256 * 1024 ** 2) throw new Error(`Not enough free space for ${label} data packs. Allow ${(total / 1024 ** 3 + 0.25).toFixed(1)} GB more on the export drive.`);
  const report = [];
  for (const [index, file] of plan.entries()) {
    onLog(`Copying ${label} pack file ${index + 1}/${plan.length}: ${file.pack}/${file.relative}`);
    const target = path.join(directory, 'asset-packs', file.pack, 'assets', ...file.relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const expected = String(await read(`sha256sum ${file.remote}`)).match(/^([a-f0-9]{64})\s/i)?.[1]?.toLowerCase();
    if (!expected) throw new Error('Could not read the game-pack checksum on the phone');
    let lastProgress = Date.now();
    await adb.runToFile(['-s', serial, 'exec-out', command(`cat ${file.remote}`)], `${target}.partial`, {
      maxBytes: file.bytes, onProgress(bytes) {
        if (Date.now() - lastProgress < 5000) return;
        lastProgress = Date.now();
        onLog(`${file.pack}/${file.relative}: ${Math.floor(bytes / 1024 ** 2)} / ${Math.ceil(file.bytes / 1024 ** 2)} MB`);
      },
    });
    const copied = await fs.lstat(`${target}.partial`);
    const hash = crypto.createHash('sha256');
    if (!copied.isFile() || copied.isSymbolicLink() || copied.size !== file.bytes) throw new Error(`${label} game-pack transfer size does not match the phone`);
    for await (const chunk of createReadStream(`${target}.partial`)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    if (sha256 !== expected) throw new Error(`${label} game-pack checksum does not match the phone. Reconnect and retry.`);
    await fs.rename(`${target}.partial`, target);
    report.push({ pack: file.pack, path: file.member, bytes: file.bytes, sha256 });
  }
  return report;
}

module.exports = { exportRdrPrivatePacks };
