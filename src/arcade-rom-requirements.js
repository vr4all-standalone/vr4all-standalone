// Chip identities come from the corresponding port's own game-file validator.
// CRCs describe uncompressed ROM payloads. The archive verifier also tests ZIP
// decompression before reporting a match.
const model2 = require('./arcade-rom-manifests.json');
const hotd2Crcs = ['b23d1a0c','88fb0562','5f4dd576','3e62fca4','6f73a852','c7950445','5a812247','17e9414a','5d2d8134','eacaf26d','1e3686be','5ada00a2','9eff6247','8a80b16a','7ae20daf','fbb8641b','3881ec23','66bff6e4','8cd2f654','6cf6e705','495e6265'];
const hotd2Names = ['epr-21585.ic22', ...Array.from({ length: 20 }, (_, index) => `mpr-${21386 + index}.ic${index < 11 ? index + 1 : `${index + 1}s`}`)];
const deathCrcs = ['b60e113e','1f2b090e','dc8557eb','94494cbb','69ba6a41','49882766','cdc82805','1a268360','cf8674b8','7ae6716e','c91efb67'];
const ninjaCrcs = ['a5bdf581','1f81f46b','24974c3d','5af34ea0','504a89b3','d5c2799a','cf5df4d3','5daa6ed4','d866cfa8','1c959b74','8abed815','f14d2073'];
const survivorCrcs = ['756e0de6','8073dec7','43cd16a4','f6aebed8','b5e1b582','345fd824','465ecff1','76c92354','d45a46ee','8c38d1f7','f49153c4','0e2bdd9a','055718ad','d06c9bd7','db3c396b'];

const requirements = {
  // Port0r documents MAME 0.289 for these Quest releases, but does not publish
  // a per-chip manifest here. Show the required version without claiming a
  // filename or ZIP header proves compatibility.
  'cop-vr': { vcop: { set: 'vcop.zip', revision: 'MAME 0.289 set' }, io: { set: 'model1io2.zip', revision: 'MAME 0.289 set' } },
  'time-crisis-vr': { timecris: { set: 'timecris.zip', revision: 'MAME 0.289 set' }, namcoc71: { set: 'namcoc71.zip', revision: 'MAME 0.289 set' } },
  'time-crisis-2-vr': { timecrs2: { set: 'timecrs2.zip', revision: 'MAME 0.289 set' } },
  'hotd-vr': { hotd: { set: 'hotd.zip', revision: 'MAME 0.289 set' } },
  'rally-vr': { srallyc: { set: 'srallyc.zip', revision: 'MAME 0.289 set' }, segabill: { set: 'segabill.zip', revision: 'MAME 0.289 set' } },
  'dirt-dash-vr': { dirtdash: { set: 'dirtdash.zip', revision: 'MAME 0.289 set' }, namcoc71: { set: 'namcoc71.zip', revision: 'MAME 0.289 set' } },
  'scud-race-vr': { game: { set: 'scud.zip', revision: 'MAME 0.289 set' } },
  'daytona-usa-vr': { game: { set: 'daytona.zip', revision: 'MAME 0.289 set' }, io: { set: 'model1io.zip', revision: 'MAME 0.289 set' } },
  'hotd2-vr': { hotd2: { set: 'hotd2.zip', revision: 'USA arcade cartridge', chips: hotd2Crcs.map((crc, index) => ({ name: hotd2Names[index], size: index ? 8 * 1024 * 1024 : 2 * 1024 * 1024, crc })) } },
  'death-crimson-ox-vr': { game: { set: 'deathcoxj.zip', revision: 'Japan Rev A', chips: deathCrcs.map((crc, index) => ({ name: index ? `mpr-${23513 + index}.ic${index}` : 'epr-23524a.ic22', size: index ? 8 * 1024 * 1024 : 4 * 1024 * 1024, crc })) } },
  'ninja-assault-vr': { game: { set: 'ninjaslt.zip', revision: 'World NJA2 Ver.A', chips: ninjaCrcs.map((crc, index) => ({ size: index < 3 ? 8 * 1024 * 1024 : 16 * 1024 * 1024, crc })) } },
  'survivor2-code-veronica-vr': { game: { set: 'gunsur2.zip', revision: 'World BHF2 Ver.E', chips: survivorCrcs.map((crc, index) => ({ size: index ? 16 * 1024 * 1024 : 8 * 1024 * 1024, crc })) } },
  'carnevil-vr': { game: { set: 'carnevil.zip', revision: 'v1.0.3', chips: [
    { name: 'carnevil1_9.u32', size: 524288, crc: '82c07f2e' },
    { name: 'sound102.u95', size: 32768, crc: 'bec7d3ae' },
    { name: '486_carnevil.u96', size: 8192, crc: '40eea9d4' },
  ] }, disk: { set: 'carnevil CHD', revision: 'v1.0.3', discSha1: '5cffb0de63ad36eb01c5951bab04d3f8a9e23e16', discRawSha1: 'ba32b7ef9721d730ce58bd753d47fb947b6ae9b6', checkRawSha1: true, logicalBytes: 4310046720 } },
  'mok-vr': { mok: { set: 'mok.zip', revision: 'original GDS-0022 set', partial: true, chips: [{ name: '317-0333-com.pic', size: 16384, crc: '15fb7792' }] }, chd: { set: 'gds-0022.chd', revision: 'original GDS-0022 disc', discSha1: 'ddd6bf6a93f44f04199b278149ded19b26cdcab4', discRawSha1: 'ba9d27a248d86218898d9bb5f1fe22fdefb8c03f' } },
  'mok-upstream-vr': { mok: { set: 'mok.zip', revision: 'original GDS-0022 set', partial: true, chips: [{ name: '317-0333-com.pic', size: 16384, crc: '15fb7792' }] }, chd: { set: 'gds-0022.chd', revision: 'original GDS-0022 disc', discSha1: 'ddd6bf6a93f44f04199b278149ded19b26cdcab4', discRawSha1: 'ba9d27a248d86218898d9bb5f1fe22fdefb8c03f' } },
  'confidential-mission-vr': { game: { set: 'confmiss.zip', revision: 'original GDS-0001 set', partial: true, chips: [{ name: '317-0298-com.pic', size: 16384, crc: '15971bf6' }] } },
  'lupin-the-third-vr': { game: { set: 'lupinshoo.zip', revision: 'original GDS-0018 set (not Rev A)', partial: true, chips: [{ name: '317-0325-jpn.pic', size: 16384, crc: 'f71cb2fc' }] }, chd: { set: 'gds-0018.chd', revision: 'original GDS-0018 disc (not Rev A)', discSha1: '3b7d5dd917b9a2cc9b7b51aad22f8e75383c3301', discRawSha1: 'ded9d1aa791e64b0db962a5ea762f4ff28b2e76a' } },
  'vcop-vr': { game: { set: 'vcop.zip', revision: 'Revision B', partial: true, chips: model2['vcop-vr'] } },
  'vcop2-vr': { game: { set: 'vcop2.zip', revision: 'original Model 2A set', partial: true, chips: model2['vcop2-vr'] } },
  'gunblade-ny-vr': { game: { set: 'gunblade.zip', revision: 'original Model 2B set', partial: true, chips: model2['gunblade-ny-vr'] } },
  'hotd-model2-vr': { game: { set: 'hotdo.zip', revision: 'original Model 2C set', chips: model2['hotd-model2-vr'] } },
  'behind-enemy-lines-vr': { game: { set: 'bel.zip', revision: 'original Model 2C set', chips: model2['behind-enemy-lines-vr'] } },
  'rail-chase-2-vr': { game: { set: 'rchase2.zip', revision: 'Revision A', partial: true, chips: model2['rail-chase-2-vr'] } },
  'teraburst-vr': { game: { set: 'terabrst.zip', revision: 'US UEL, 17 July 1998', chips: model2['teraburst-vr'] } },
};

module.exports = { requirements };
