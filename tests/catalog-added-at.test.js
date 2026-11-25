const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog } = require('../src/catalog');

test('every catalog port has a recorded VR4ALL addition time', () => {
  const catalog = getCatalog();
  const missing = catalog.filter((game) => !Number.isFinite(Date.parse(game.addedAt || ''))).map((game) => game.id);
  assert.deepEqual(missing, [], 'add each new port to the catalog addition metadata');
});

test('recorded addition times follow the original VR4ALL catalog commits', () => {
  const catalog = new Map(getCatalog().map((game) => [game.id, Date.parse(game.addedAt)]));
  for (const [newer, older] of [
    ['vib-ribbon-vr', 'rage-racer-vr'],
    ['rage-racer-vr', 'wario-land-4-vr'],
    ['wario-land-4-vr', 'birdman64-vr'],
    ['birdman64-vr', 'bugdom2-vr'],
  ]) assert.ok(catalog.get(newer) > catalog.get(older), `${newer} should appear after ${older}`);
});
