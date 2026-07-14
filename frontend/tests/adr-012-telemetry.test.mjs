// ADR-012 observability contract — Pilot Entry enabling changes.
// Pin: telemetry carries implementation/release tags, api.js sends the
// correlation header, and the cutover dashboard surface exists.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...p) => readFileSync(path.join(FRONTEND, ...p), 'utf8');

const REPORTER = read('js', 'error-reporter.js');
const BEACON = read('js', 'analytics-beacon.js');
const API = read('js', 'api.js');
const ADMIN_JS = read('js', 'admin-error-logs.js');
const ADMIN_HTML = read('pages', 'admin', 'error-logs', 'index.html');

test('error-reporter: migration tags (implementation/release) ride in extra (ADR-012 §3)', () => {
  assert.match(REPORTER, /function migrationTags\(\)/);
  assert.match(REPORTER, /__next_f/, 'implementation detection = App Router flight sink presence');
  assert.match(REPORTER, /__AVER_RUNTIME_CONFIG__/, 'release/environment come from runtime config');
  assert.match(REPORTER, /Object\.assign\(\{\}, payload\.extra \|\| \{\}, migrationTags\(\)\)/,
    'tags must win a collision — infrastructure truth, not caller data');
});

test('analytics-beacon: page_view carries implementation + release (ADR-012 §1)', () => {
  assert.match(BEACON, /implementation: impl/);
  assert.match(BEACON, /release: release/);
  assert.match(BEACON, /__next_f/);
});

test('api.js: X-Request-ID per call — correlation browser → FastAPI (ADR-012 §2)', () => {
  assert.match(API, /headers\['X-Request-ID'\]/);
  // Caller-provided extraHeaders must still be able to override (merged later).
  const idx = API.indexOf("headers['X-Request-ID']");
  const mergeIdx = API.indexOf('if (extraHeaders)');
  assert.ok(idx !== -1 && mergeIdx !== -1 && idx < mergeIdx,
    'correlation id must be set BEFORE the extraHeaders merge');
});

test('correlation chain: failed api calls carry join keys into error reports (review #746)', () => {
  assert.match(API, /thrown\.request_id = requestId/,
    'HTTP errors must carry the per-call correlation id');
  assert.match(API, /fetchErr.*request_id = requestId|request_id = requestId;[\s\S]{0,80}throw fetchErr/,
    'network failures must carry the SENT correlation id too');
  assert.match(API, /thrown\.ref = \(isObj && detail\.ref\)/,
    '5xx sanitizer ref must survive onto the thrown error');
  assert.match(REPORTER, /api_request_id/,
    'reporter must ship the api call id (page REQUEST_ID alone cannot join to a server log line)');
  assert.match(REPORTER, /api_ref/,
    'reporter must ship the server sanitizer ref when present');
});

test('triage refresh: dismiss/undismiss also refresh the migration panel (review #746)', () => {
  const refreshes = ADMIN_JS.match(/loadLogs\(\), loadStats\(\), loadMigrationStats\(\)/g) || [];
  assert.ok(refreshes.length >= 2,
    'both dismiss and undismiss must refresh migration-stats (its undismissed column is canonical state)');
});

test('cutover dashboard: admin Báo lỗi renders migration-stats (ADR-012 điều kiện mở)', () => {
  assert.match(ADMIN_HTML, /id="migration-stats-panel"/);
  assert.match(ADMIN_HTML, /id="migration-stats-body"/);
  assert.match(ADMIN_JS, /function loadMigrationStats\(\)/);
  assert.match(ADMIN_JS, /'\/admin\/error-logs\/migration-stats'/);
  assert.match(ADMIN_JS, /truncated/, 'silent truncation is forbidden — must render the warning');
});

// ── AUDIT F2 (2026-07-14): field Web Vitals collector ──────────────────
const RUM = read('js', 'rum-vitals.js');

test('rum-vitals: measures LCP/CLS/INP via PerformanceObserver and ships tagged web_vitals events (AUDIT F2)', () => {
  assert.match(RUM, /largest-contentful-paint/);
  assert.match(RUM, /layout-shift/);
  assert.match(RUM, /hadRecentInput/, 'CLS must exclude shifts caused by recent input');
  assert.match(RUM, /interactionId/, 'INP approximation reads interaction entries only');
  assert.match(RUM, /event_name: 'web_vitals'/);
  assert.match(RUM, /__next_f/, 'implementation tag = same derivation as error-reporter/beacon');
});

test('rum-vitals: sends via fetch keepalive, NOT sendBeacon (cross-origin JSON needs headers)', () => {
  assert.match(RUM, /keepalive: true/);
  assert.ok(!/navigator\.sendBeacon/.test(RUM),
    'sendBeacon cannot carry Content-Type: application/json on the cross-origin Railway API');
});

test('rum-vitals: sends once, on first pagehide/hidden — not per interaction', () => {
  assert.match(RUM, /var sent = false/);
  assert.match(RUM, /if \(sent\) return/);
  assert.match(RUM, /pagehide/, 'pagehide covers navigation');
  assert.match(RUM, /visibilitychange/, 'hidden covers tab/app switch where pagehide may never fire');
});

test('rum-vitals: apiBase prefers runtime-config before the production fallback (same contract as reporter, review #755)', () => {
  assert.match(RUM, /rc\.apiBase/);
  const rcIdx = RUM.indexOf('rc.apiBase');
  const prodIdx = RUM.indexOf('ielts-speaking-coach-production');
  assert.ok(rcIdx !== -1 && prodIdx !== -1 && rcIdx < prodIdx,
    'runtime-config must be consulted BEFORE the production Railway fallback');
});

test('rum-vitals: loaded by all three Next route-group layouts (AUDIT F2)', () => {
  for (const group of ['(marketing)', '(public-content)', '(authed)']) {
    const layout = read('app', group, 'layout.tsx');
    assert.match(layout, /\/js\/rum-vitals\.js/, `${group} layout must load the collector`);
  }
});

// ── AUDIT F1 (2026-07-14): rollback-trigger metrics panel ──────────────
test('rollback-metrics: admin panel computes the FROZEN triggers with a real denominator (AUDIT F1)', () => {
  assert.match(ADMIN_HTML, /id="rollback-metrics-panel"/);
  assert.match(ADMIN_HTML, /id="rbm-route"/);
  assert.match(ADMIN_HTML, /id="rbm-window"/);
  assert.match(ADMIN_JS, /function loadRollbackMetrics\(\)/);
  assert.match(ADMIN_JS, /\/admin\/error-logs\/rollback-metrics\?route=/);
  assert.match(ADMIN_JS, /encodeURIComponent\(route\)/, 'route param must be URL-encoded');
  assert.match(ADMIN_JS, /error_verdict/, 'the verdict (not just raw counts) must render');
  assert.match(ADMIN_JS, /vitals_verdict/, 'the LCP verdict must render');
  assert.match(ADMIN_JS, /insufficient-sample/,
    'sample insufficiency must be surfaced — a rate over 3 views is not a verdict');
});

test('error-reporter: _apiBase prefers runtime-config before the production fallback (review #755, ADR-006)', () => {
  // A page that loads error-reporter WITHOUT api.js (the lean Next marketing
  // landing) must still post to the ENVIRONMENT origin, not hardcoded prod —
  // else staging landing errors pollute production error_logs.
  assert.match(REPORTER, /rc\.apiBase/, 'must read runtime-config apiBase');
  const rcIdx = REPORTER.indexOf('rc.apiBase');
  const prodIdx = REPORTER.indexOf("ielts-speaking-coach-production", REPORTER.indexOf('function _apiBase'));
  assert.ok(rcIdx !== -1 && prodIdx !== -1 && rcIdx < prodIdx,
    'runtime-config must be consulted BEFORE the production Railway fallback');
});
