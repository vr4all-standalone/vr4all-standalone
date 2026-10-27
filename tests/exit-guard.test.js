const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmExitWithInstalls } = require('../desktop/exit-guard');

test('closing with no active installs needs no confirmation', () => {
  let prompts = 0;
  assert.equal(confirmExitWithInstalls([], () => { prompts++; return 0; }), true);
  assert.equal(prompts, 0);
});

test('closing during an install or with queued installs defaults to keeping VR4ALL open', () => {
  const jobs = [{ status: 'running', title: 'Quake' }, { status: 'queued', title: 'Doom' }];
  let prompt;
  assert.equal(confirmExitWithInstalls(jobs, (options) => { prompt = options; return 0; }), false);
  assert.deepEqual(prompt.buttons, ['Keep VR4ALL open', 'Quit anyway']);
  assert.equal(prompt.defaultId, 0);
  assert.equal(prompt.cancelId, 0);
  assert.match(prompt.detail, /interrupt.*install/i);
  assert.equal(confirmExitWithInstalls(jobs, () => 1), true);
});
