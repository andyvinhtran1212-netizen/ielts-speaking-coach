/**
 * frontend/tests/viewers-anonymous.test.mjs
 *
 * "Người xem" includes anonymous: total = authenticated distinct users +
 * anonymous page-view hits (anonymous can't be deduped — the beacon sends no
 * session_id, so it's hits not distinct viewers). The tile shows the total with
 * an inline auth-vs-anonymous split, honestly labelled by unit.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let html, js, svc;
before(() => {
  html = read('frontend/pages/admin/dashboard/index.html');
  js   = read('frontend/js/admin-dashboard.js');
  svc  = read('backend/services/admin_dashboard.py');
});


describe('backend — viewers total = auth distinct + anon hits', () => {
  test('_visitors returns the auth/anon breakdown (anon = hits, no dedup id)', () => {
    assert.match(svc, /auth = len\(\{r\["user_id"\] for r in rows if r\.get\("user_id"\)\}\)/);
    assert.match(svc, /anon = sum\(1 for r in rows if not r\.get\("user_id"\)\)/);
    assert.match(svc, /return \{"authenticated": auth, "anonymous": anon\}/);
  });

  test('distinct_visitors exposes count(total) + authenticated + anonymous', () => {
    assert.match(svc, /"count":\s*_vis_total/);
    assert.match(svc, /"authenticated":\s*_vis_auth/);
    assert.match(svc, /"anonymous":\s*_vis_anon/);
    assert.match(svc, /_vis_total = _vis\["authenticated"\] \+ _vis\["anonymous"\]/);
  });

  test('daily visitors trend is the total (auth distinct + anon hits)', () => {
    // mig 139 — _visitors_series() now tries the daily-bucket RPC first and
    // falls back to this in-app aggregation, so the auth+anon logic sits
    // further from the def line; widen the scan window to reach the fallback.
    assert.match(svc, /def _visitors_series\(\)[\s\S]{0,1500}len\(auth\[d\]\) \+ anon\[d\]/);
  });
});


describe('frontend — tile total + inline auth/anon split', () => {
  test('tile value is the total; split subline element present', () => {
    assert.match(html, /id="m-visitors"/);
    assert.match(html, /id="m-visitors-split"/);
    assert.match(html, /\.db-card__split/);   // styled
  });

  test('controller renders total + an honestly-unit-labelled split', () => {
    assert.match(js, /m-visitors'\)\.textContent = fmtInt\(dv\.count\)/);
    assert.match(js, /m-visitors-split/);
    assert.match(js, /đăng nhập · /);
    assert.match(js, /lượt ẩn danh/);   // "lượt" = hits, not distinct viewers
    assert.match(js, /dv\.authenticated/);
    assert.match(js, /dv\.anonymous/);
  });
});
