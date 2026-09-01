import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatReadingCount, normalizeReadingAttemptsPayload } from '../lib/admin-reading-attempts-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-reading-attempts)', 'admin', 'dashboard', 'reading-attempts', 'admin-reading-attempts.tsx');
const PAGE = read('app', '(authed-admin-reading-attempts)', 'admin', 'dashboard', 'reading-attempts', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-reading-attempts)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-reading-attempts-next.css');
const ROLLBACK = read('public', 'js', 'admin-reading-attempts.js');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

function fixture(overrides = {}) {
  return {
    ok: true, data_status: 'complete', window_days: 30,
    window_start: '2026-07-13T08:00:00Z', snapshot_to: '2026-08-12T08:00:00Z', computed_at: '2026-08-12T08:00:05Z',
    totals: { submitted_all_time: 90, submitted_window: 12, auth_attempts: 8, anon_attempts: 4, auth_distinct_users: 6, anon_distinct_sources: 3, truncated: false },
    band_distribution: [{ band: 6.5, count: 4 }],
    skill_performance: [{ skill_tag: 'inference', correct: 3, total: 8, accuracy: 0.375 }],
    time_stats: { avg_minutes: 48.2, median_minutes: 49, count: 10 },
    per_test: [{ test_id: 'T1', title: 'Reading <script>', attempts: 12, auth: 8, anon: 4, avg_band: 6.5 }],
    recent: [{ submitted_at: '2026-08-12T07:00:00Z', test_title: 'Reading <script>', who: 'learner@example.com', is_anonymous: false, band: 6.5, time_minutes: 48 }],
    malformed_count: 0, lookup_failures: [], ...overrides,
  };
}

describe('/admin/dashboard/reading-attempts native contract', () => {
  test('owns the canonical route with admin gate and read-only API', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<Suspense fallback=/);
    assert.match(PAGE, /subsection="reading-attempts"/);
    assert.match(CLIENT, /\/admin\/dashboard\/reading-attempts\?days=\$\{nextDays\}/);
    assert.doesNotMatch(CLIENT, /window\.api\.(post|put|patch|delete)/);
    assert.match(CLIENT, /snapshot\?\.key === currentKey/);
    assert.match(CLIENT, /router\.replace\(target, \{ scroll: false \}\)/);
    assert.doesNotMatch(CLIENT, /history\.replaceState/);
    assert.match(LAYOUT, /admin-reading-attempts-next\.css/);
    assert.match(CHROME, /href:\s*'\/admin\/dashboard\/reading-attempts'/);
    assert.match(OVERVIEW, /href="\/admin\/dashboard\/reading-attempts"/);
  });

  test('has responsive/accessibility evidence and CI browser ownership', () => {
    assert.match(CLIENT, /aria-label=\{`Phân bố band/);
    assert.match(CLIENT, /className="ara-sr-table"/);
    assert.match(CLIENT, /role="region" aria-label="Bảng lượt làm theo đề" tabIndex=\{0\}/);
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /\.ara-table td::before\{content:attr\(data-label\)/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-reading-attempts\)\/\*\*/);
    assert.match(WORKFLOW, /verify-admin-reading-attempts-flow\.mjs/);
  });

  test('rollback surface preserves unavailable and partial truth', () => {
    assert.match(ROLLBACK, /d\.data_status === 'unavailable'/);
    assert.match(ROLLBACK, /fmtCount\(p\.attempts, partial\)/);
    assert.match(ROLLBACK, /Không kết luận từ dữ liệu thiếu/);
    assert.match(ROLLBACK, /dấu — không có nghĩa là 0/);
    assert.match(ROLLBACK, /LOOKUP_FAILURE_LABEL/);
    assert.match(ROLLBACK, /fmtApproxCount\(t\.anon_distinct_sources, partial\)/);
  });
});

describe('Reading attempt payload truth', () => {
  test('normalizes complete data and keeps content as text', () => {
    const payload = normalizeReadingAttemptsPayload(fixture());
    assert.ok(payload);
    assert.equal(payload.perTest[0].title, 'Reading <script>');
    assert.equal(payload.skills[0].accuracy, 0.375);
    assert.equal(formatReadingCount(2350), '2.350');
  });

  test('partial counts are lower bounds and averages remain available only for UI suppression', () => {
    const payload = normalizeReadingAttemptsPayload(fixture({ data_status: 'partial', lookup_failures: ['test_titles'] }));
    assert.ok(payload);
    assert.equal(formatReadingCount(payload.totals.submittedWindow, true), '≥ 12');
    assert.equal(formatReadingCount(payload.totals.anonDistinctSources, true, true), '≈ ≥ 3');
    assert.deepEqual(payload.lookupFailures, ['test_titles']);
  });

  test('rejects false-zero unavailable payloads and excludes malformed children', () => {
    assert.equal(normalizeReadingAttemptsPayload(fixture({ data_status: 'unavailable' })), null);
    const unavailable = normalizeReadingAttemptsPayload(fixture({
      ok: false, data_status: 'unavailable',
      totals: { submitted_all_time: 90, submitted_window: null, auth_attempts: null, anon_attempts: null, auth_distinct_users: null, anon_distinct_sources: null, truncated: false },
      band_distribution: [], skill_performance: [], per_test: [], recent: [],
      time_stats: { avg_minutes: null, median_minutes: null, count: 0 },
    }));
    assert.ok(unavailable);
    assert.equal(formatReadingCount(unavailable.totals.submittedWindow), '—');
    const malformed = normalizeReadingAttemptsPayload(fixture({ per_test: [{ test_id: 'T1', title: 'Bad', attempts: 2, auth: 2, anon: 2, avg_band: 6 }] }));
    assert.ok(malformed);
    assert.equal(malformed.perTest.length, 0);
    assert.equal(malformed.malformedCount, 1);
    assert.equal(malformed.status, 'partial');
  });

  test('fails closed on missing collections, contradictory status and impossible totals', () => {
    const missingRecent = fixture();
    delete missingRecent.recent;
    assert.equal(normalizeReadingAttemptsPayload(missingRecent), null);
    assert.equal(normalizeReadingAttemptsPayload(fixture({ ok: false })), null);
    assert.equal(normalizeReadingAttemptsPayload(fixture({ lookup_failures: ['unknown_source'] })), null);
    assert.equal(normalizeReadingAttemptsPayload(fixture({
      totals: { submitted_all_time: 90, submitted_window: 3, auth_attempts: 8, anon_attempts: 4, auth_distinct_users: 6, anon_distinct_sources: 3, truncated: false },
    })), null);
    assert.equal(normalizeReadingAttemptsPayload(fixture({ data_status: 'complete', malformed_count: 1 })), null);
  });
});
