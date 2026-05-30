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

let html, js, svc;
before(() => {
  html = read('frontend/pages/admin/dashboard/index.html');
  js   = read('frontend/js/admin-dashboard.js');
  svc  = read('backend/services/admin_dashboard.py');
});


describe('Item 1 — all-time metrics are window-independent', () => {
  test('users + codes labelled "toàn thời gian", NOT windowed tiles', () => {
    assert.match(html, /Tổng người dùng <span class="db-card__scope">toàn thời gian/);
    assert.match(html, /Mã đã kích hoạt <span class="db-card__scope">toàn thời gian/);
    // the two windowed tiles (visitors, tokens) carry the modifier; all-time don't.
    assert.equal((html.match(/db-card--windowed/g) || []).length, 2);
  });

  test('backend users/codes counts take no window argument', () => {
    assert.match(svc, /def _users\(\):\s*return _count\("users"\)/);
    assert.match(svc, /def _codes\(\):\s*return _count\("user_code_assignments"/);
  });

  test('window switch reloads only the windowed tiles (all-time tiles stay put)', () => {
    assert.match(js, /db-window'\)\.addEventListener\('change',\s*\(\)\s*=>\s*load\('windowed'\)\)/);
    // setLoading('windowed') targets .db-card--windowed, not every tile.
    assert.match(js, /scope === 'all' \? '\.db-card' : '\.db-card--windowed'/);
  });
});


describe('Item 2 — token tile replaces cost (windowed, K/M/B)', () => {
  test('token KPI tile present; cost tile gone', () => {
    assert.match(html, /Token đã gọi/);
    assert.match(html, /id="m-tokens"/);
    assert.ok(!/id="m-cost"/.test(html), 'old cost tile id must be gone');
    assert.ok(!/Chi phí/.test(html), 'no "Chi phí" copy left on the dashboard');
  });

  test('compact K/M/B token formatter', () => {
    assert.match(js, /function fmtTokens/);
    assert.match(js, /'B'/);
    assert.match(js, /'M'/);
    assert.match(js, /'K'/);
    assert.match(js, /m-tokens'\)\.textContent = fmtTokens/);
  });

  test('backend tokens_called is windowed (visitors_since) from input+output tokens', () => {
    assert.match(svc, /def _tokens_called\(\)/);
    assert.match(svc, /\.select\("input_tokens, output_tokens"\)[\s\S]{0,120}\.gte\("created_at", visitors_since\)/);
    assert.match(svc, /"tokens_called":\s*\{[\s\S]{0,120}"window_days": visitors_window_days/);
    assert.ok(!/monthly_cost_usd/.test(svc), 'monthly_cost_usd metric removed');
  });

  test('trends series speaks tokens, not cost', () => {
    assert.match(svc, /"tokens":\s*_safe_series\("tokens"/);
    assert.ok(!/"cost_usd":\s*_safe_series/.test(svc));
    assert.match(html, /data-series="tokens"/);
    assert.match(js, /series\.tokens/);
  });
});


describe('Item 3 — responsive filter/refresh', () => {
  test('loading state: shimmer class + refresh disabled during fetch', () => {
    assert.match(html, /\.db-card\.is-loading/);
    assert.match(html, /db-shimmer/);
    assert.match(html, /\.db-refresh:disabled/);
    assert.match(js, /function setLoading/);
    assert.match(js, /btn\.disabled = on/);
  });

  test('refresh reloads everything; both re-fetch immediately', () => {
    assert.match(js, /db-refresh'\)\.addEventListener\('click',\s*\(\)\s*=>\s*load\('all'\)\)/);
  });

  test('stale-request guard drops superseded responses (no race / freeze)', () => {
    assert.match(js, /_reqId/);
    assert.match(js, /const myId = \+\+_reqId/);
    assert.match(js, /if \(myId !== _reqId\) return/);
  });
});
