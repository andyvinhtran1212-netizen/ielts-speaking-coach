/**
 * frontend/tests/dashboard-tweaks.test.mjs
 *
 * Item 1 — Tổng người dùng + Mã đã kích hoạt are all-time (window-independent):
 *   labelled "toàn thời gian", NOT marked .db-card--windowed, and the controller
 *   reloads only the windowed tiles on a window switch.
 * Item 2 — "Token đã gọi" replaces the cost tile: windowed token total + a
 *   K/M/B formatter; the trends series + backend both speak tokens, not cost.
 * Item 3 — window switch / refresh re-fetch immediately with a loading state and
 *   a stale-request guard.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let html, tsx, css, model, svc;
before(async () => {
  // LEGACYJS-0075 W4a — the ops Dashboard lives in the Next Tổng quan owner;
  // the retired admin-dashboard.js controller is gone.
  html  = read('frontend/pages/admin/index.html'); // retired fixture (ADR-005)
  tsx   = read('frontend/app/(authed-admin-overview)/admin/admin-overview.tsx');
  css   = read('frontend/public/css/admin-overview.css');
  model = await import(path.join(REPO, 'frontend/lib/admin-overview-model.mjs'));
  svc   = read('backend/services/admin_dashboard.py');
});


describe('Item 1 — all-time metrics are window-independent', () => {
  test('users + codes labelled "toàn thời gian", NOT windowed tiles', () => {
    assert.match(html, /Tổng người dùng <span class="db-card__scope">toàn thời gian/);
    assert.match(html, /Mã đã kích hoạt <span class="db-card__scope">toàn thời gian/);
    assert.equal((html.match(/db-card--windowed/g) || []).length, 2);
    assert.match(tsx, /label="Tổng người dùng" scope="toàn thời gian"[^\n]*loading=\{loadingScope === 'all'\}/);
    assert.match(tsx, /label="Mã đã kích hoạt" scope="toàn thời gian"[^\n]*loading=\{loadingScope === 'all'\}/);
    // the two windowed tiles (visitors, tokens) shimmer on any load; all-time only on 'all'.
    assert.equal((tsx.match(/loading=\{loadingScope != null\}/g) || []).length, 2);
  });

  test('backend users/codes counts take no window argument', () => {
    assert.match(svc, /def _users\(\):\s*return _count\("users"\)/);
    // dashboard-counter-audit: codes counts activated access_codes (is_used),
    // still window-independent (no visitors_since in the body).
    assert.match(svc, /def _codes\(\)[\s\S]{0,1000}_count\("access_codes", lambda q: q\.eq\("is_used", True\)\)/);
  });

  test('window switch reloads only the windowed tiles (all-time tiles stay put)', () => {
    assert.match(tsx, /id="db-window"[\s\S]{0,120}onChange=\{\(event\) => setWindowDays\(/);
    assert.match(tsx, /void loadOps\(windowDays, 'windowed'\)/);
  });
});


describe('Item 2 — token tile replaces cost (windowed, K/M/B)', () => {
  test('token KPI tile present; cost tile gone', () => {
    assert.match(html, /Token đã gọi/);
    assert.match(html, /id="m-tokens"/);
    assert.ok(!/id="m-cost"/.test(html), 'old cost tile id must be gone');
    assert.ok(!/Chi phí/.test(html), 'no "Chi phí" copy left on the retired fixture');
    assert.match(tsx, /Token đã gọi/);
    assert.match(tsx, /value=\{formatTokens\(ops\?\.tokens\?\.count\)\}/);
    assert.ok(!/Chi phí/.test(tsx), 'no "Chi phí" copy left on the dashboard');
  });

  test('compact K/M/B token formatter', () => {
    assert.equal(model.formatTokens(999), '999');
    assert.equal(model.formatTokens(1500), '1.5K');
    assert.equal(model.formatTokens(2_000_000), '2M');
    assert.equal(model.formatTokens(3_400_000_000), '3.4B');
    assert.equal(model.formatTokens(null), '—');
  });

  test('backend tokens_called is windowed (visitors_since) from input+output tokens', () => {
    assert.match(svc, /def _tokens_called\(\)/);
    assert.match(svc, /\.select\("input_tokens, output_tokens"\)[\s\S]{0,120}\.gte\("created_at", visitors_since\)/);
    assert.match(svc, /"tokens_called":\s*\{[\s\S]{0,120}"window_days": visitors_window_days/);
    assert.ok(!/monthly_cost_usd/.test(svc), 'monthly_cost_usd metric removed');
  });

  test('trends series speaks tokens, not cost', () => {
    assert.match(html, /data-series="tokens"/);
    assert.match(svc, /"tokens":\s*_safe_series\("tokens"/);
    assert.ok(!/"cost_usd":\s*_safe_series/.test(svc));
    assert.match(tsx, /tokens: 'Token'/);
    assert.deepEqual(model.normalizeTrendsPayload({ series: { tokens: [{ value: 5 }, 'x'] } }).tokens, [5, 0]);
  });
});


describe('Item 3 — responsive filter/refresh', () => {
  test('loading state: shimmer class + refresh disabled during fetch', () => {
    assert.match(html, /\.db-card\.is-loading/);
    assert.match(html, /db-shimmer/);
    assert.match(html, /\.db-refresh:disabled/);
    assert.match(css, /\.db-card\.is-loading/);
    assert.match(css, /db-shimmer/);
    assert.match(css, /\.db-refresh:disabled/);
    assert.match(tsx, /className=\{`db-card\$\{loading \? ' is-loading' : ''\}/);
    assert.match(tsx, /className="db-refresh" type="button" disabled=\{anyLoading\}/);
  });

  test('refresh reloads everything; both re-fetch immediately', () => {
    assert.match(tsx, /onClick=\{\(\) => loadAll\('all'\)\}/);
    assert.match(tsx, /Promise\.all\(\[loadOps\(windowDays, scope\), loadContent\(\)\]\)/);
  });

  test('stale-request guard drops superseded responses (no race / freeze)', () => {
    assert.match(tsx, /const requestId = \+\+opsSequence\.current/);
    assert.match(tsx, /if \(requestId !== opsSequence\.current\) return/);
  });
});
