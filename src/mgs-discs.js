const fs = require('node:fs/promises');
const path = require('node:path');

async function validateMgsDiscPairs(files) {
  const ids = ['disc1Bin', 'disc1Cue', 'disc2Bin', 'disc2Cue'];
  if (ids.some((id) => !files?.[id])) return;
  const names = ids.map((id) => path.basename(files[id]).toLowerCase());
  if (new Set(names).size !== names.length) {
    throw new Error('MGS Disc 1 and Disc 2 files have duplicate names. Rename each BIN/CUE pair distinctly before installing so one disc cannot replace the other.');
  }
  for (const disc of [1, 2]) {
    const cue = await fs.readFile(files[`disc${disc}Cue`], 'latin1');
    const references = [...cue.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+BINARY\b/gim)]
      .map((match) => (match[1] || match[2]).replace(/\\/g, '/'));
    const expected = path.basename(files[`disc${disc}Bin`]).toLowerCase();
    if (references.length !== 1 || references[0].includes('/') || references[0].toLowerCase() !== expected) {
      throw new Error(`MGS Disc ${disc} CUE must reference its selected BIN by filename (${path.basename(files[`disc${disc}Bin`])}).`);
    }
  }
}

module.exports = { validateMgsDiscPairs };
