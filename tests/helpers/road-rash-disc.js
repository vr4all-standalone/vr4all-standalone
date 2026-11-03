const crypto = require('node:crypto');

const fs = require('node:fs/promises');

const SECTOR = 2352;
const REMOTE = '/sdcard/Android/data/com.rrjb.vr/files/disc.bin';
const sha1 = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');

// Small stand-ins for the four hashed disc parts; the production table is never weakened.
const PARTS = [
  ['SLUS_010.53', Buffer.alloc(3000, 0x45)],
  ['RASHCDF.BIN', Buffer.alloc(2100, 0x46)],
  ['RASHCDG.BIN', Buffer.alloc(100, 0x47)],
  ['RASHCDI.BIN', Buffer.alloc(5000, 0x49)],
];
const fixtureIdentity = {
  title: 'Road Rash: Jailbreak (USA)', serial: 'SLUS-01053', volume: 'SLUS_01053',
  parts: PARTS.map(([name, bytes]) => ({ name, size: bytes.length, sha1: sha1(bytes) })),
};

function record(name, lba, size, flags = 0) {
  const nameBytes = Buffer.from(name, 'latin1');
  const length = 33 + nameBytes.length + (nameBytes.length % 2 === 0 ? 1 : 0);
  const out = Buffer.alloc(length);
  out[0] = length;
  out.writeUInt32LE(lba, 2);
  out.writeUInt32LE(size, 10);
  out[25] = flags;
  out[32] = nameBytes.length;
  nameBytes.copy(out, 33);
  return out;
}

// A raw MODE2/2352 image: PVD at LBA 16, one root directory sector at LBA 20, the parts from LBA 21.
function buildDisc({ volume = 'SLUS_01053', parts = PARTS, omit = [] } = {}) {
  const placed = [];
  let lba = 21;
  for (const [name, bytes] of parts) {
    if (omit.includes(name)) continue;
    placed.push({ name, bytes, lba });
    lba += Math.ceil(bytes.length / 2048);
  }
  const user = new Map();
  const pvd = Buffer.alloc(2048);
  pvd[0] = 1;
  pvd.write('CD001', 1, 'latin1');
  pvd.write(volume.padEnd(32, ' '), 40, 'latin1');
  record('\0', 20, 2048, 2).copy(pvd, 156);
  user.set(16, pvd);
  const root = Buffer.concat([record('\0', 20, 2048, 2), record('\x01', 20, 2048, 2),
    record('ZZDIR', 5000, 2048, 2), ...placed.map((part) => record(`${part.name};1`, part.lba, part.bytes.length))]);
  user.set(20, Buffer.concat([root, Buffer.alloc(2048 - root.length)]));
  for (const part of placed) {
    for (let index = 0; index * 2048 < part.bytes.length; index++) {
      const chunk = Buffer.alloc(2048);
      part.bytes.copy(chunk, 0, index * 2048, Math.min(part.bytes.length, (index + 1) * 2048));
      user.set(part.lba + index, chunk);
    }
  }
  const sectors = [];
  for (let index = 0; index < lba; index++) {
    const sector = Buffer.alloc(SECTOR);
    sector.fill(0xff, 1, 11);
    user.get(index)?.copy(sector, 24);
    sectors.push(sector);
  }
  return Buffer.concat(sectors);
}

// Scripted headset keeping the pushed disc in memory.
function fakeAdb({ devices = [{ serial: 'Q3', state: 'device' }], remote = null, installOutput = 'Performing Streamed Install\nSuccess', truncate = false, corrupt = false } = {}) {
  const calls = [];
  let disc = remote;
  const adb = {
    calls,
    listDevices: async () => { calls.push('devices'); return devices; },
    run: async (args) => {
      const [, , verb, ...rest] = args;
      const text = rest.join(' ');
      calls.push(verb === 'shell' ? text : `${verb} ${text}`.trim());
      if (verb === 'install') return installOutput;
      if (verb === 'push') { disc = await fs.readFile(rest[0]); if (truncate) disc = disc.subarray(1); if (corrupt) disc = Buffer.from(disc).fill(1); return '1 file pushed'; }
      if (text.startsWith('mkdir')) return '';
      if (text.startsWith('if [ -f')) return disc ? `${sha1(disc)}  ${REMOTE}` : 'missing';
      if (text.startsWith('stat')) return String(disc.length);
      if (text.startsWith('sha1sum')) return `${sha1(disc)}  ${REMOTE}`;
      if (text.startsWith('dumpsys')) return '    versionName=0.1.0';
      throw new Error('unexpected adb call: ' + args.join(' '));
    },
  };
  return adb;
}

module.exports = { buildDisc, fixtureIdentity, fakeAdb, PARTS, sha1 };
