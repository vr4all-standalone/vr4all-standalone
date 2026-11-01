const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');

test('arcade ROM requirements attach to the right fields with complete chip lists', () => {
  const games = new Map(getCatalog().map((game) => [game.id, game]));
  const expected = {
    'hotd2-vr': ['hotd2', 21],
    'death-crimson-ox-vr': ['game', 11],
    'ninja-assault-vr': ['game', 12],
    'survivor2-code-veronica-vr': ['game', 15],
    'carnevil-vr': ['game', 3],
    'mok-vr': ['mok', 1],
    'confidential-mission-vr': ['game', 1],
    'lupin-the-third-vr': ['game', 1],
    'vcop-vr': ['game', 26],
    'vcop2-vr': ['game', 30],
    'gunblade-ny-vr': ['game', 17],
    'hotd-model2-vr': ['game', 29],
    'behind-enemy-lines-vr': ['game', 31],
    'rail-chase-2-vr': ['game', 22],
    'teraburst-vr': ['game', 11],
  };
  for (const [gameId, [itemId, count]] of Object.entries(expected)) {
    const item = games.get(gameId)?.data.find((entry) => entry.id === itemId);
    assert.equal(item?.romRequirement?.chips.length, count, `${gameId} chip list`);
    assert.ok(item.romRequirement.chips.every((chip) => /^[0-9a-f]{8}$/.test(chip.crc) && chip.size > 0));
  }
  assert.equal(games.get('time-crisis-vr').data[0].romRequirement.revision, 'MAME 0.289 set');
  assert.equal(games.get('time-crisis-vr').data[0].romRequirement.chips, undefined);
  for (const [gameId, discId] of [['mok-vr', 'chd'], ['lupin-the-third-vr', 'chd'], ['carnevil-vr', 'disk']]) {
    assert.match(games.get(gameId).data.find((item) => item.id === discId).romRequirement.discSha1, /^[0-9a-f]{40}$/);
  }
});
