// LEARNERCORE-0063 T14: pure logic of the new Today page.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignedRows, creditRows, goalCopy, headingCopy, lessonActionCopy, normalizeToday, safePath, todayCount,
} from '../lib/today-v2-model.mjs';

const base = { state: 'learning', student: { name: 'An' } };

test('only the four server states and three banners pass the boundary (FR-019)', () => {
  assert.equal(normalizeToday({ ...base, state: 'guessing' }), null);
  assert.equal(normalizeToday({ ...base, banner: 'soon' }), null);
  assert.equal(normalizeToday({ ...base, banner: 'expired' }).banner, 'expired');
  assert.equal(normalizeToday(null), null);
});

test('links are same-origin paths only', () => {
  assert.equal(safePath('/writing/result?essay_id=1'), '/writing/result?essay_id=1');
  for (const bad of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)', '/\\evil']) {
    assert.equal(safePath(bad), null, bad);
  }
  const today = normalizeToday({ ...base, resume: [{ kind: 'reading', title: 'T', href: 'https://x.example' }] });
  assert.deepEqual(today.resume, []);
});

test('N and the heading (FR-020)', () => {
  const today = normalizeToday({ ...base, assigned_due_soon: 6, next_lesson: { title: 'L', href: '/c' } });
  assert.equal(todayCount(today), 7);
  assert.equal(headingCopy('An', 7), 'Chào An. Hôm nay bạn có 7 việc.');
  assert.equal(headingCopy('An', 0), 'Hôm nay không có bài đến hạn.');
});

test('goal line with and without exam date (FR-070)', () => {
  assert.equal(goalCopy({ targetBand: 6.5, weeksLeft: 17 }), 'Mục tiêu 6.5 · còn 17 tuần tới ngày thi');
  assert.equal(goalCopy({ targetBand: 7, weeksLeft: null }), 'Mục tiêu 7.0');
  assert.equal(goalCopy(null), null);
  assert.equal(normalizeToday({ ...base, goal: { target_band: null } }).goal, null);
});

test('lesson action resumes from a whole minute (FR-021)', () => {
  assert.equal(lessonActionCopy({ resumeSeconds: 250 }), 'Học tiếp từ phút 4');
  assert.equal(lessonActionCopy({ resumeSeconds: 30 }), 'Bắt đầu bài');
  assert.equal(lessonActionCopy({ resumeSeconds: null }), 'Bắt đầu bài');
});

test('credits: null hides, two sources give two rows (FR-024)', () => {
  assert.equal(normalizeToday({ ...base, credits: null }).credits, null);
  assert.equal(normalizeToday({ ...base, credits: { total: -1 } }).credits, null);
  const rows = creditRows(normalizeToday({ ...base, credits: { total: 5, by_kind: { online: 3, class: 2 } } }).credits);
  assert.deepEqual(rows.map((r) => [r.kind, r.remaining]), [['online', 3], ['class', 2]]);
});

test('overdue uses the server rule: missing or past deadline (FR-022)', () => {
  const now = Date.parse('2026-11-23T03:00:00Z');
  const rows = assignedRows([
    { isMissing: true, assignment: { dueAt: '2026-11-22T00:00:00Z' } },
    { isMissing: false, assignment: { dueAt: '2026-11-23T02:00:00Z' } },
    { isMissing: false, assignment: { dueAt: '2026-11-24T02:00:00Z' } },
    null,
  ], now);
  assert.deepEqual(rows.map((r) => r.overdue), [true, true, false]);
});
