import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  formatListeningAttemptDuration, listeningAttemptsHref,
  listeningAttemptsRollbackHref, normalizeListeningAttemptDetail,
  normalizeListeningAttemptFilters, normalizeListeningAttemptList,
} from '../lib/admin-listening-attempts-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'attempts', 'page.tsx');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'attempts', 'admin-listening-attempts.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = readFileSync(join(here, '..', '..', 'backend', 'routers', 'admin_overview.py'), 'utf8');

const baseRow = (patch = {}) => ({
  id: 'attempt-1', status: 'submitted', score: 8, total_questions: 10, accuracy: 0.8,
  duration_seconds: 750, started_at: '2026-08-14T00:00:00Z', submitted_at: '2026-08-14T00:12:30Z',
  created_at: '2026-08-14T00:00:00Z',
  user: { id: 'user-1', email: 'learner@example.com', display_name: 'Học viên A' },
  test: { id: 'test-1', test_id: 'ILR-LIS-001', title: 'Test 1', test_type: 'full' },
  ...patch,
});

const listPayload = (patch = {}) => ({
  items: [baseRow()], total: 1, limit: 50, offset: 0,
  association_lookup_failed: false, association_lookup_failures: [], ...patch,
});

describe('Admin Listening attempts model', () => {
  test('normalizes URL filters and owns stable native/rollback hrefs', () => {
    assert.deepEqual(normalizeListeningAttemptFilters({ user: ' a@b.com ', type: 'evil', status: 'submitted', page: '2', attempt: 'a1' }), { user: 'a@b.com', test: '', type: 'all', status: 'submitted', page: 2, attempt: 'a1' });
    assert.equal(listeningAttemptsHref({ user: 'a@b.com', test: 'ILR 1', type: 'full', status: 'submitted', page: 2, attempt: 'a1' }), '/admin/listening/attempts?user=a%40b.com&test=ILR+1&type=full&status=submitted&page=2&attempt=a1');
    assert.equal(listeningAttemptsRollbackHref({ user: 'a@b.com', attempt: 'a1' }), '/pages/admin/listening/attempts.html?user=a%40b.com');
  });

  test('preserves canonical total while counting malformed rows', () => {
    const normalized = normalizeListeningAttemptList(listPayload({ items: [baseRow(), baseRow({ id: 'bad', accuracy: 0.4 })], total: 75 }), { limit: 50, offset: 0, type: 'all', status: 'all' });
    assert.equal(normalized.rows.length, 1);
    assert.equal(normalized.malformedCount, 1);
    assert.equal(normalized.total, 75);
  });

  test('rejects inconsistent association lookup truth', () => {
    assert.equal(normalizeListeningAttemptList(listPayload({ association_lookup_failed: true })), null);
    const normalized = normalizeListeningAttemptList(listPayload({ association_lookup_failed: true, association_lookup_failures: ['users'] }));
    assert.equal(normalized.associationLookupFailed, true);
    assert.deepEqual(normalized.associationLookupFailures, ['users']);
  });

  test('test join failure does not erase rows already selected by backend type filter', () => {
    const row = baseRow({ test: { id: 'test-1', test_id: null, title: null, test_type: null } });
    const normalized = normalizeListeningAttemptList(listPayload({ items: [row], association_lookup_failed: true, association_lookup_failures: ['listening_tests'] }), { type: 'full' });
    assert.equal(normalized.rows.length, 1);
    assert.equal(normalized.malformedCount, 0);
  });

  test('rejects score/accuracy drift and exact-detail identity drift', () => {
    assert.equal(normalizeListeningAttemptList(listPayload({ items: [baseRow({ accuracy: 0.7 })] })).rows.length, 0);
    const detail = normalizeListeningAttemptDetail({ ...baseRow(), grading_details: [{ q_num: 1, correct: true, user_answer: '<script>', expected: 'A', trap_caught: true }, { q_num: 1, correct: false }, { q_num: 0, correct: false }], trap_analytics: { trap_mechanism: { caught: 1, missed: 0 } }, band_estimate: 7, association_lookup_failed: false, association_lookup_failures: [] }, 'attempt-1');
    assert.equal(detail.questions.length, 1);
    assert.equal(detail.malformedQuestionCount, 2);
    assert.equal(detail.questions[0].userAnswer, '<script>');
    assert.equal(normalizeListeningAttemptDetail({ ...baseRow(), grading_details: [], association_lookup_failed: false, association_lookup_failures: [] }, 'other'), null);
    assert.equal(normalizeListeningAttemptDetail({ ...baseRow(), grading_details: [], band_estimate: 12, association_lookup_failed: false, association_lookup_failures: [] }, 'attempt-1'), null);
  });

  test('accepts backend ties-to-even accuracy for both list and detail', () => {
    const gradingDetails = Array.from({ length: 32 }, (_, index) => ({
      q_num: index + 1, correct: index === 0, user_answer: 'A', expected: index === 0 ? 'A' : 'B',
    }));
    const halfway = baseRow({ score: 1, total_questions: 32, accuracy: 0.0312 });
    const list = normalizeListeningAttemptList(listPayload({ items: [halfway] }));
    assert.equal(list.rows.length, 1);
    const detail = normalizeListeningAttemptDetail({
      ...halfway, grading_details: gradingDetails, association_lookup_failed: false,
      association_lookup_failures: [],
    }, 'attempt-1');
    assert.equal(detail.questions.length, 32);
    assert.equal(detail.accuracy, 0.0312);
  });

  test('formats duration without inventing missing values', () => {
    assert.equal(formatListeningAttemptDuration(750), '12 phút 30 giây');
    assert.equal(formatListeningAttemptDuration(null), '—');
    assert.equal(formatListeningAttemptDuration(-1), '—');
  });
});

describe('native route ownership and operational behavior', () => {
  test('page uses admin gate, Suspense and correct subsection', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<Suspense/);
    assert.match(PAGE, /subsection="attempts"/);
  });

  test('client pins account/filter scope, exact detail identity and explicit lookup failure', () => {
    assert.match(CLIENT, /profile\.id/);
    assert.match(CLIENT, /sequence\.current/);
    assert.match(CLIENT, /scope\.current !== owner/);
    assert.match(CLIENT, /normalizeListeningAttemptDetail/);
    assert.match(CLIENT, /Lookup association thất bại/);
    assert.match(CLIENT, /Không đồng nghĩa|không bị diễn giải thành dữ liệu trống/i);
  });

  test('native route is linked from sidebar and overview while rollback remains explicit', () => {
    assert.match(CHROME, /slug: 'attempts',\s+label: 'Lượt làm bài',\s+href: '\/admin\/listening\/attempts'/);
    assert.match(OVERVIEW, /"link":\s+"\/admin\/listening\/attempts"/);
    assert.match(CLIENT, /listeningAttemptsRollbackHref/);
  });

  test('layout loads route-scoped stylesheet and UI has real labeled controls', () => {
    assert.match(LAYOUT, /admin-listening-attempts-next\.css/);
    assert.match(CLIENT, /<form className="ala-filters"/);
    assert.match(CLIENT, /aria-label="Bảng lượt làm bài Listening"/);
    assert.match(CLIENT, /aria-label="Đáp án từng câu"/);
  });
});
