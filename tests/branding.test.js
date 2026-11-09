const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('the app and browser icon use the same headset artwork', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /<link rel="icon" href="\/brand-headset\.png" type="image\/png">/);
  assert.match(html, /<img src="\/brand-headset\.png" alt="" aria-hidden="true">/);

  const artwork = fs.readFileSync(path.join(root, 'public/brand-headset.png'));
  const desktop = fs.readFileSync(path.join(root, 'desktop/icon.png'));
  for (const png of [artwork, desktop]) {
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), 'icon must be square');
  }
  assert.equal(desktop.readUInt32BE(16), 512);
});

test('the Windows icon includes a full-size headset image', () => {
  const ico = fs.readFileSync(path.join(root, 'desktop/icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 5);
  const sizes = Array.from({ length: count }, (_, index) => ico[6 + 16 * index] || 256);
  assert.ok(sizes.includes(16));
  assert.ok(sizes.includes(256));
  for (let index = 0; index < count; index++) {
    const entry = 6 + 16 * index;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset + length <= ico.length, 'icon entry must fit in the file');
    assert.equal(ico.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
  }
});
