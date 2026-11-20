// LEGACYJS-0075 T001: the layer-2 capture preload must never turn a lost write
// into "no request". Runs the preload in child processes; no browser needed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const frontend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = './tooling/capture-public-js.mjs';

function run(captureOut, body) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  if (captureOut === undefined) delete env.CAPTURE_OUT; else env.CAPTURE_OUT = captureOut;
  return spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e', body], { cwd: frontend, env, encoding: 'utf8' });
}

const record = (urls, tail = '') =>
  `const m = await import('${preload}'); for (const u of ${JSON.stringify(urls)}) m.recordUrl(u); ${tail}`;

test('records only /js/ URLs and ignores non-URL requests', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'capture-js-'));
  const out = path.join(dir, 'req.txt');
  try {
    const r = run(out, record(['http://h/js/api.js', 'http://h/css/a.css', 'data:text/plain,x', 'http://h/js/components/c.js?v=1']));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFileSync(out, 'utf8').trim().split('\n'), ['http://h/js/api.js', 'http://h/js/components/c.js?v=1']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fails before the flow starts when CAPTURE_OUT is missing or not writable', () => {
  const missing = run(undefined, 'process.exit(0)');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /set CAPTURE_OUT/);

  const dir = mkdtempSync(path.join(tmpdir(), 'capture-js-'));
  try {
    const unwritable = run(dir, 'process.exit(0)'); // a directory cannot be appended to
    assert.notEqual(unwritable.status, 0);
    assert.match(unwritable.stderr, /cannot write CAPTURE_OUT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a write that fails mid-run makes the run exit non-zero even if the flow passed', { skip: !existsSync('/dev/full') && 'needs /dev/full' }, () => {
  // /dev/full accepts the empty start-up probe and fails every real write (ENOSPC).
  const r = run('/dev/full', record(['http://h/js/api.js', 'http://h/js/b.js'], 'console.log("captureFailed", m.captureFailed()); process.exit(0);'));
  assert.equal(r.status, 70, r.stderr);
  assert.match(r.stdout, /captureFailed true/);
  assert.match(r.stderr, /write to \/dev\/full failed/);
  assert.match(r.stderr, /2 write\(s\) to \/dev\/full failed; this capture is incomplete/);
});
