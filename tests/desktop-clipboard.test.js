const test = require('node:test');
const assert = require('node:assert/strict');
const { createClipboardHandler } = require('../desktop/clipboard');

test('desktop clipboard accepts requirement text only from its own app page', async () => {
  const writes = [];
  const handler = createClipboardHandler({ origin: 'http://127.0.0.1:4173', clipboard: { writeText: (value) => writes.push(value) } });
  const ownPage = { senderFrame: { url: 'http://127.0.0.1:4173/' } };
  await handler(ownPage, 'timecris.zip MAME 0.289');
  assert.deepEqual(writes, ['timecris.zip MAME 0.289']);
  assert.throws(() => handler({ senderFrame: { url: 'https://example.com/' } }, 'bad'), /page/i);
  assert.throws(() => handler(ownPage, 'x'.repeat(8193)), /text/i);
  assert.equal(writes.length, 1);
});
