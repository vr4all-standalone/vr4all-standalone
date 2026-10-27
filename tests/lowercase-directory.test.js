const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { stageLowercaseDirectory } = require('../src/lowercase-directory');
const { removeConversionDirectory } = require('../src/archive-conversion');

test('AvP staging lowercases nested assets without changing the owned PC files', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'vr4all-avp-source-'));
  let staged;
  try {
    await fs.mkdir(path.join(source, 'AVP_RIFS', 'Marine'), { recursive: true });
    await fs.writeFile(path.join(source, 'AVP_RIFS', 'Marine', 'DATA.RIF'), 'owned fixture');
    await fs.writeFile(path.join(source, 'LANGUAGE.TXT'), 'gold');
    staged = await stageLowercaseDirectory(source);
    assert.equal(await fs.readFile(path.join(staged.path, 'avp_rifs', 'marine', 'data.rif'), 'utf8'), 'owned fixture');
    assert.equal(await fs.readFile(path.join(staged.path, 'language.txt'), 'utf8'), 'gold');
    assert.equal(await fs.readFile(path.join(source, 'LANGUAGE.TXT'), 'utf8'), 'gold');
  } finally {
    if (staged) await removeConversionDirectory(staged.directory);
    await fs.rm(source, { recursive: true, force: true });
  }
});
