// ADMINIA-0074 FR-090…093 (G09-T18b): the Việc cần làm model over GET /admin/attention.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QUEUE_ROWS, lessonText, liveHref, normalizeAttention, summaryText, visibleRows, waitedText,
} from '../lib/admin-todo-model.mjs';

const ok = (count, extra = {}) => ({ count, oldest_at: null, overdue: false, error: false, unavailable: false, ...extra });
const body = (queues = {}, extra = {}) => ({
  queues: Object.fromEntries(QUEUE_ROWS.map((r) => [r.key, ok(0)]).concat(Object.entries(queues))),
  classes_week: [], attention_learners: [],
  ops_week: { on_time_rate: null, inactive_learners: 3, review_wait_median_hours: 2.5 },
  sources_failed: [], generated_at: '2026-11-23T10:00:00Z', ...extra,
});

test('FR-090: twelve rows in the fixed order', () => {
  assert.deepEqual(QUEUE_ROWS.map((r) => r.key), [
    'exams_today', 'writing_review', 'speaking_mock_pending', 'course_tests_awaiting_release',
    'assignments_overdue', 'regrade_new', 'enrollments_reported', 'care_due_today',
    'incident_groups_open', 'feedback_open', 'entitlements_expiring', 'classes_unmetered',
  ]);
});

test('a failed or missing source is an error with no count, never 0', () => {
  const data = normalizeAttention(body({
    writing_review: ok(null, { error: true }),
    regrade_new: ok(4, { oldest_at: '2026-11-23T08:00:00Z', overdue: true }),
    feedback_open: ok(null, { unavailable: true }),
    incident_groups_open: undefined,
    enrollments_reported: ok('7'),
  }));
  assert.deepEqual(data.queues.writing_review, { state: 'error', count: null, oldestAt: null, overdue: false, aiFailed: null });
  assert.equal(data.queues.regrade_new.count, 4);
  assert.equal(data.queues.regrade_new.overdue, true);
  assert.equal(data.queues.feedback_open.state, 'unavailable');
  assert.equal(data.queues.incident_groups_open.state, 'error');
  assert.equal(data.queues.enrollments_reported.state, 'error');
  assert.equal(data.queues.classes_unmetered.count, 0);
});

test('a foreign shape is null; a null block stays null', () => {
  assert.equal(normalizeAttention(null), null);
  assert.equal(normalizeAttention({ queues: {} }), null);
  assert.equal(normalizeAttention([]), null);
  const data = normalizeAttention(body({}, { classes_week: null, attention_learners: null, sources_failed: ['thresholds', 3] }));
  assert.equal(data.classes, null);
  assert.equal(data.learners, null);
  assert.equal(data.thresholdsFailed, true);
  assert.equal(data.ops.onTimeRate, null);
  assert.equal(data.ops.inactiveLearners, 3);
});

test('FR-092: learners by number of reasons, then name; at most 8; bad rows dropped', () => {
  const learner = (ref, name, n) => ({ ref, name, cohort: null, reasons: Array.from({ length: n }, (_, i) => ({ code: `c${i}`, text: `Lý do ${i}` })) });
  const list = [learner('a', 'Bình', 1), learner('b', 'An', 1), learner('c', 'Cường', 3), { ref: '', name: 'X' }];
  for (let i = 0; i < 8; i += 1) list.push(learner(`z${i}`, `Zed ${i}`, 0));
  const data = normalizeAttention(body({}, { attention_learners: list }));
  assert.equal(data.learners.length, 8);
  assert.deepEqual(data.learners.slice(0, 3).map((l) => l.name), ['Cường', 'An', 'Bình']);
});

test('exams_today shows only on a day with an exam or when it failed; summary counts', () => {
  const quiet = normalizeAttention(body());
  assert.equal(visibleRows(quiet).some((r) => r.key === 'exams_today'), false);
  assert.equal(summaryText(quiet), 'Không còn việc nào đang chờ');
  const busy = normalizeAttention(body({ exams_today: ok(1), regrade_new: ok(2), feedback_open: ok(null, { error: true }) }));
  assert.equal(visibleRows(busy)[0].key, 'exams_today');
  assert.equal(summaryText(busy), '2 loại việc đang chờ, 1 nguồn chưa tải được');
  const failed = normalizeAttention(body({ exams_today: ok(null, { error: true }) }));
  assert.equal(visibleRows(failed)[0].key, 'exams_today');
});

test('links only to live pages; text helpers', () => {
  assert.equal(liveHref('/admin/writing/queue'), '/admin/writing/queue');
  assert.equal(liveHref('/admin/classes?metering=legacy'), '/admin/classes?metering=legacy');
  assert.equal(liveHref('/admin/speaking/grading'), null);
  assert.equal(liveHref(null), null);
  const now = new Date('2026-11-23T10:00:00Z');
  assert.equal(waitedText('2026-11-23T09:15:00Z', now), '45 phút');
  assert.equal(waitedText('2026-11-23T07:00:00Z', now), '3 giờ');
  assert.equal(waitedText('2026-11-20T10:00:00Z', now), '3 ngày');
  assert.equal(waitedText(null, now), null);
  assert.equal(lessonText({ no: 4, date: '2026-11-23', startsAt: '19:30:00' }, now), 'Buổi 4 · hôm nay, Thứ Hai 23/11, 19:30');
  assert.equal(lessonText({ no: null, date: '2026-11-25', startsAt: null }, now), 'Thứ Tư 25/11');
});
