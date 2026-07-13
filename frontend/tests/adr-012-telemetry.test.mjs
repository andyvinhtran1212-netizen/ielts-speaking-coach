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
