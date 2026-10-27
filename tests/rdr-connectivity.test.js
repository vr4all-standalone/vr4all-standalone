const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuestInternet, checkRdrInternet } = require('../src/rdr-connectivity');

test('RDR connectivity checks the current default network rather than a validated historical network', () => {
  assert.equal(parseQuestInternet('Active default network: none\nHistorical NetworkAgentInfo: VALIDATED').status, 'offline');
  const dump = `Active default network: 101
Current Networks:
  NetworkAgentInfo{network{100} nc{[ Transports: WIFI Capabilities: INTERNET&VALIDATED ]}}
  NetworkAgentInfo{network{101} nc{[ Transports: WIFI Capabilities: INTERNET&TRUSTED ]}}
Network Requests:
  old network 101: VALIDATED`;
  assert.equal(parseQuestInternet(dump).status, 'offline');
  assert.equal(parseQuestInternet(dump.replace('INTERNET&TRUSTED', 'INTERNET&VALIDATED&TRUSTED')).status, 'online');
  assert.equal(parseQuestInternet('unexpected newer diagnostic output').status, 'unknown');
});

test('offline selected Quest stops RDR before a lengthy build with an actionable DRM message', async () => {
  const adb = { run: async (args, _log, options) => {
    assert.deepEqual(args, ['-s', 'Q3-SELECTED', 'shell', 'dumpsys', 'connectivity']);
    assert.ok(options.timeoutMs <= 10000);
    return 'Active default network: none';
  } };
  await assert.rejects(checkRdrInternet(adb, 'Q3-SELECTED'), /Quest.*internet|Wi-Fi/i);
});

test('unreadable connectivity is reported honestly and does not prevent a supported build', async () => {
  const log = [];
  const result = await checkRdrInternet({ run: async () => { throw new Error('diagnostic unavailable'); } }, 'Q3', (line) => log.push(line));
  assert.equal(result.status, 'unknown');
  assert.match(log.join(' '), /could not verify|cannot verify/i);
  assert.match(log.join(' '), /Wi-Fi|internet/);
});
