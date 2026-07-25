/**
 * mock-review-blankable-bands.test.mjs — the review console must let the
 * examiner leave a band blank when the raw score HAS no band (Listening 0/40,
 * any Phase-1 General Training Reading), and must still refuse a forgotten one.
 *
 * Codex P1 on PR #779: the backend allowance was unreachable — doSave() demanded
 * every required band client-side, so the POST never fired and the sitting stayed
 * unsaveable. Verifying the server rule against production data proved nothing
 * about whether the admin could ever trigger it.
 *
 * doSave/collectBands are lifted out of the IIFE and RUN here — a source match
 * would not have caught the gate that made the whole feature dead.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(__dirname, '..', 'public', 'js', 'admin-mock-reviews.js'), 'utf8');

function grab(re, what) {
  const m = JS.match(re);
  assert.ok(m, `${what} not found — sentinel is stale`);
  return m[0];
}

async function doSave({ bands, blankable, required }) {
  const body = [
    grab(/  function blankableSkills\(\) \{[\s\S]*?\n  \}/, 'blankableSkills()'),
    grab(/  function collectBands\(v\) \{[\s\S]*?\n  \}/, 'collectBands()'),
    grab(/  async function doSave\(id, v\) \{[\s\S]*?\n  \}/, 'doSave()'),
    'return doSave("rv-1", v);',
  ].join('\n');

  const v = { querySelector: (sel) => ({ value: bands[sel.match(/data-band="(\w+)"/)[1]] ?? '' }) };
  let toasted = null, posted = null;
  const fn = new Function('v', 'current', 'reqSkills', 'toast', 'el',
                          'collectRetestFlags', 'loadRoster', 'openDetail', 'window', body);
  await fn(
    v, { blankable_skills: blankable }, () => required, (m) => { toasted = m; },
    () => ({ value: '' }), () => ({}), async () => {}, async () => {},
    { api: { post: async (p, b) => { posted = { p, b }; } } },
  );
  return { sent: posted && posted.b.final_bands, blocked: posted === null, toasted };
}

const REQUIRED = ['listening', 'reading', 'writing'];

describe('review console — a band with no published score may be left blank', () => {
  test('a blankable skill saves, and is OMITTED rather than sent as null', async () => {
    const r = await doSave({ bands: { reading: '6.5', writing: '6.0' },
                             blankable: ['listening'], required: REQUIRED });
    assert.equal(r.blocked, false, 'the save must reach the server');
    assert.deepEqual(r.sent, { reading: 6.5, writing: 6 });
    assert.ok(!('listening' in r.sent), 'a blank must be omitted, not sent as NaN/null');
  });
  test('a forgotten Writing band is still refused', async () => {
    const r = await doSave({ bands: { listening: '7.0', reading: '6.5' },
                             blankable: ['listening'], required: REQUIRED });
    assert.equal(r.blocked, true);
    assert.match(r.toasted, /writing/);
  });
  test('a blank Listening that DOES convert is still refused', async () => {
    // 30/40 has a band — leaving it empty is forgetfulness, not a missing row.
    const r = await doSave({ bands: { reading: '6.5', writing: '6.0' },
                             blankable: [], required: REQUIRED });
    assert.equal(r.blocked, true);
    assert.match(r.toasted, /listening/);
  });
  test('a complete set saves unchanged', async () => {
    const r = await doSave({ bands: { listening: '7.0', reading: '6.5', writing: '6.0' },
                             blankable: [], required: REQUIRED });
    assert.deepEqual(r.sent, { listening: 7, reading: 6.5, writing: 6 });
  });
  test('the console reads blankable_skills from the review payload', () => {
    assert.match(JS, /current && current\.blankable_skills/);
  });
  test('the input says WHY it may be left empty', () => {
    // Without a reason the blank reads as an oversight — and the examiner invents
    // a band to fill it, which is the whole failure being fixed.
    assert.match(JS, /blankableSkills\(\)\.indexOf\(s\) !== -1/);
    assert.match(JS, /không có band trong bảng IELTS/);
  });
});
