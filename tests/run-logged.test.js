const test = require('node:test');
const assert = require('node:assert/strict');
const { runLogged } = require('../src/run-logged');

const node = (script, options = {}) => runLogged(process.execPath, ['-e', script], options);

test('runLogged splits CRLF lines, keeps the last progress rewrite and merges stderr', async () => {
  const lines = [];
  const result = await node(
    "process.stdout.write('first\\r\\nsecond\\n10%\\r50%\\r100%\\n\\n   \\nlast');process.stderr.write('oops\\n')",
    { onLine: (line) => lines.push(line) },
  );
  assert.equal(result.code, 0);
  assert.deepEqual(lines.slice().sort(), ['100%', 'first', 'last', 'oops', 'second']);
  assert.deepEqual(result.tail.slice().sort(), lines.slice().sort());
  assert.equal(result.stdout, '');
});

test('runLogged joins a CRLF that straddles two chunks', async () => {
  const lines = [];
  await node("process.stdout.write('ab\\r');setTimeout(()=>process.stdout.write('\\ncd\\n'),50)", { onLine: (line) => lines.push(line) });
  assert.deepEqual(lines, ['ab', 'cd']);
});

test('runLogged captures stdout when asked and reports the exit code', async () => {
  const result = await node("console.log('cooked 1 disc files in 0.1s');process.exit(3)", { captureStdout: true });
  assert.equal(result.code, 3);
  assert.match(result.stdout, /^cooked 1 disc files in 0\.1s$/m);
});

test('runLogged keeps only the last 200 tail lines and truncates logged lines to 500 characters', async () => {
  const logged = [];
  const result = await node("for(let i=0;i<250;i++)console.log('line'+i);console.log('x'.repeat(700))", { onLine: (line) => logged.push(line) });
  assert.equal(result.tail.length, 200);
  assert.equal(result.tail.at(-1).length, 700);
  assert.equal(logged.at(-1).length, 500);
});

test('runLogged passes cwd and env to the child', async () => {
  const result = await node('console.log(process.cwd()+"|"+process.env.RUN_LOGGED_PROBE)', {
    cwd: require('node:os').tmpdir(), env: { ...process.env, RUN_LOGGED_PROBE: 'yes' }, captureStdout: true,
  });
  assert.match(result.stdout.trim(), /\|yes$/);
});

test('runLogged kills a process that outlives its timeout', async () => {
  await assert.rejects(node('setInterval(()=>{},1000)', { timeoutMs: 100 }), /node(\.exe)? did not finish within \d+ minutes/);
});

test('runLogged rejects output beyond 8 MiB when capturing', async () => {
  await assert.rejects(
    node("const b=Buffer.alloc(1024*1024,97);let n=0;(function w(){while(n++<12){if(!process.stdout.write(b))return process.stdout.once('drain',w)}})()", { captureStdout: true }),
    /node(\.exe)? printed more than 8 MiB of output/,
  );
});

test('runLogged rejects when the command does not exist', async () => {
  await assert.rejects(runLogged('/nonexistent/vr4all-tool', []), { code: 'ENOENT' });
});
