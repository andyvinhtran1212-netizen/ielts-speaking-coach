/**
 * frontend/tests/reading-attempts-dashboard.test.mjs
 *
 * reading-access-tracking Part C — admin "Reading — Lượt làm bài" dashboard.
 * Static-analysis sentinels pinning the wiring + the honest/privacy contracts:
 *   • reuses the ops-dashboard chrome + .db-* vocabulary; mounts as a Dashboard
 *     subsection,
 *   • fetches the Part-C endpoint with the window param,
 *   • auth-vs-anonymous split with the anonymous count labelled APPROXIMATE,
 *   • PRIVACY: the view never references anon_src / a raw IP,
 *   • XSS-safe (escapeHtml on interpolated values), token-clean, admin-gated.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const html = read('frontend/pages/admin/dashboard/reading-attempts.html');
const js = read('frontend/js/admin-reading-attempts.js');
const chromeJs = read('frontend/js/components/aver-admin-chrome.js');
const adminRouter = read('backend/routers/admin.py');
const svc = read('backend/services/admin_reading_dashboard.py');


describe('C — dashboard page (reading-attempts.html)', () => {
  test('mounts under the Dashboard chrome as the reading-attempts subsection', () => {
    // dashboard-consolidation — the ops Dashboard merged into Tổng quan, so
    // this drill-down now mounts under the 'overview' chrome section.
    assert.match(html, /<aver-admin-chrome active="overview" subsection="reading-attempts">/);
  });
  test('reuses the design-system stylesheets (tokens/components/admin)', () => {
    assert.match(html, /aver-design\/tokens\.css/);
    assert.match(html, /aver-design\/components\.css/);
    assert.match(html, /aver-design\/admin-components\.css/);
  });
  test('ships KPI tiles: all-time, windowed, auth distinct, anon sources, time', () => {
    for (const id of ['rd-total-alltime', 'rd-total-window', 'rd-auth-users',
                      'rd-anon-sources', 'rd-time-avg']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
  });
  test('ships skill + band blocks and per-test + recent tables', () => {
    for (const id of ['rd-skills', 'rd-bands', 'rd-pertest', 'rd-recent',
                      'rd-window', 'rd-refresh']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
  });
  test('anonymous sources tile is labelled APPROXIMATE (xấp xỉ), not exact', () => {
    assert.match(html, /Nguồn ẩn danh[\s\S]{0,80}xấp xỉ/);
  });
  test('loads the page controller + the shared chart helper', () => {
    assert.match(html, /src="\/js\/admin-reading-attempts\.js"/);
    assert.match(html, /src="\/js\/charts\/sparkline\.js"/);
  });
  test('inline CSS is token-clean (no hardcoded hex colours)', () => {
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(style), 'page CSS must use --av-* tokens, not hex');
  });
});


describe('C — page controller (admin-reading-attempts.js)', () => {
  test('fetches the Part-C endpoint with the window param', () => {
    assert.match(js, /\/admin\/dashboard\/reading-attempts\?days='\s*\+\s*encodeURIComponent\(win\)/);
  });
  test('renders the auth-vs-anonymous split honestly', () => {
    assert.match(js, /đăng nhập[\s\S]{0,40}ẩn danh/);
    assert.match(js, /auth_distinct_users/);
    assert.match(js, /anon_distinct_sources/);
  });
  test('weakest skills are flagged (is-weak) — the actionable cue', () => {
    assert.match(js, /is-weak/);
    assert.match(js, /weakKeys/);
  });
  test('PRIVACY: the view never consumes anon_src or a raw IP as data', () => {
    // No property access on a (non-existent) anon_src field — the backend never
    // sends it. An explanatory comment mentioning the word is fine.
    assert.doesNotMatch(js, /\.anon_src\b/);
    assert.doesNotMatch(js, /\[['"]anon_src['"]\]/);
    assert.match(js, /Ẩn danh/);   // anonymous rows render as a label, not an identifier
  });
  test('XSS-safe: escapeHtml exists and wraps interpolated values', () => {
    assert.match(js, /function escapeHtml/);
    assert.match(js, /escapeHtml\(p\.title\)/);
    assert.match(js, /escapeHtml\(r\.test_title\)/);
    assert.match(js, /escapeHtml\(r\.who\)/);
  });
  test('monotonic race-guard drops stale responses on rapid window switches', () => {
    assert.match(js, /_reqId/);
    assert.match(js, /myId\s*!==\s*_reqId/);
  });
});


describe('C — navigation registration', () => {
  test('Dashboard nav item carries the reading-attempts subsection', () => {
    // dashboard-consolidation — reading-attempts subsection moved under 'overview'.
    assert.match(chromeJs, /section:\s*['"]overview['"][\s\S]{0,400}slug:\s*['"]reading-attempts['"]/);
    assert.match(chromeJs, /reading-attempts\.html/);
  });
});


describe('C — backend cross-ref', () => {
  test('admin endpoint + service + admin gate exist', () => {
    assert.match(adminRouter, /@router\.get\("\/dashboard\/reading-attempts"\)/);
    assert.match(adminRouter, /await require_admin\(authorization\)/);
    assert.match(adminRouter, /compute_reading_attempts_dashboard\(days=days\)/);
  });
  test('service documents anon counts as APPROXIMATE and never returns the hash', () => {
    assert.match(svc, /APPROXIMATE/);
    assert.match(svc, /NEVER (?:returned|surfaced)/i);
    // anon_src is read for counting (.get("anon_src")) but the response dict
    // has no anon_src KEY (which would appear as `"anon_src":`).
    assert.ok(!/"anon_src"\s*:/.test(svc), 'response must not carry an anon_src field');
  });
});
