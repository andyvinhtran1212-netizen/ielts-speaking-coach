// LEARNERCORE-0063 FR-060 / FR-061 / FR-077 / FR-087: pure helpers of /account and /progress.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  carryLine,
  classesFromClassMe,
  contentVisibleLine,
  courseTimeLine,
  formatDelta,
  normalizeCreditPage,
  normalizeMyCourses,
} from '../lib/account-model.mjs';
import {
  goalFromMe,
  isContentExpired,
  isFeatureDisabled,
  listeningRow,
  speakingRow,
  vocabRow,
  writingRow,
} from '../lib/progress-model.mjs';

const item = (over) => ({ course_code: 'X', title: 'X', kind: 'online', state: 'active', days_left: 5, expires_at: null, credits: {}, ...over });

describe('account model', () => {
  test('not G04 shape → null (the page falls back, never prints 0)', () => {
    assert.equal(normalizeMyCourses(null), null);
    assert.equal(normalizeMyCourses({ detail: 'Not Found' }), null);
  });

  test('groups by kind; active by fewest days first (unlimited last), then expired newest first; revoked dropped', () => {
    const c = normalizeMyCourses({ items: [
      item({ course_code: 'old', state: 'expired', expires_at: '2026-01-01T00:00:00Z' }),
      item({ course_code: 'unl', days_left: null }),
      item({ course_code: 'new', state: 'expired', expires_at: '2026-10-01T00:00:00Z' }),
      item({ course_code: 'soon', days_left: 2 }),
      item({ course_code: 'rev', state: 'revoked' }),
      item({ course_code: 'cls', kind: 'class' }),
      item({ course_code: 'rep', kind: 'repractice' }),
      item({ course_code: 'mem', kind: null, source: 'class_membership', days_left: 30 }),
      item({ course_code: 'leg', kind: undefined, source: 'legacy_access_code', days_left: null }),
    ], credits: { total: 3, by_kind: { online: 2, class: 1 } } });
    assert.deepEqual(c.online.map((x) => x.code), ['soon', 'unl', 'new', 'old']);
    assert.deepEqual(c.classes.map((x) => x.code), ['cls', 'rep', 'mem', 'leg']);
    assert.equal(c.total, 3);
  });

  test('time line, carry line and cut-off line print only what G04 sent', () => {
    const [a] = normalizeMyCourses({ items: [item({ days_left: 12 })] }).online;
    assert.equal(courseTimeLine(a), 'Còn 12 ngày');
    assert.equal(courseTimeLine({ ...a, daysLeft: null }), null);
    assert.equal(courseTimeLine({ ...a, state: 'expired', expiresAt: '2026-11-01T03:00:00Z' }), 'Đã hết hạn ngày 01/11/2026');
    assert.equal(carryLine({ ...a, carryBalance: 0 }), null);
    assert.equal(carryLine({ ...a, carryBalance: null }), null);
    assert.equal(carryLine({ ...a, carryBalance: 3, carryExpiresAt: '2027-01-30T16:59:59Z' }), 'Trong đó 3 lượt chuyển từ kỳ trước, dùng đến hết 30/01/2027.');
    assert.equal(contentVisibleLine({ contentVisibleUntil: null }), null);
    assert.equal(contentVisibleLine(null), null);
  });

  test('credit page keeps label_vi and balance_after verbatim; rows without a label are dropped', () => {
    const page = normalizeCreditPage({ items: [
      { at: '2026-11-20T00:00:00Z', delta: -1, label_vi: 'Chấm bài', balance_after: 9 },
      { at: '2026-11-19T00:00:00Z', delta: 4, reason: 'grant', balance_after: 10 },
    ], next_cursor: 'n' });
    assert.deepEqual(page.items, [{ at: '2026-11-20T00:00:00Z', label: 'Chấm bài', delta: -1, balanceAfter: 9 }]);
    assert.equal(page.nextCursor, 'n');
    assert.equal(normalizeCreditPage({}), null);
    assert.equal(formatDelta(4), '+4');
    assert.equal(formatDelta(-2), '−2');
  });

  test('class fallback lists named classes only', () => {
    assert.deepEqual(classesFromClassMe({ has_class: false }), []);
    assert.deepEqual(
      classesFromClassMe({ has_class: true, classes: [{ id: 1, name: ' Lớp A ', course: { name: 'IELTS' } }, { id: 2, name: null }] }),
      [{ id: '1', name: 'Lớp A', course: 'IELTS' }],
    );
  });
});

describe('progress model (FR-077)', () => {
  test('Speaking: band only from a graded session that has one', () => {
    assert.deepEqual(speakingRow({ sessions: [{ status: 'completed', overall_band: null }, { status: 'completed', overall_band: 6.5 }], total: 4 }), { done: '4 buổi đã chấm', result: 'Band 6.5' });
    assert.deepEqual(speakingRow({ sessions: [], total: 0 }), { done: 'Chưa có buổi nào', result: null });
    assert.deepEqual(speakingRow({ sessions: [{ status: 'completed', overall_band: null }], total: 1 }), { done: '1 buổi đã chấm', result: 'Chưa có band' });
    assert.equal(speakingRow({ detail: 'x' }), null);
  });

  test('Writing: band from a delivered essay; pending essays say "Đang chấm"', () => {
    assert.deepEqual(writingRow({ essays: [{ status: 'submitted' }] }), { done: '1 bài đã nộp', result: 'Đang chấm' });
    assert.deepEqual(writingRow({ essays: [{ status: 'delivered', overall_band_score: 6 }] }), { done: '1 bài đã nộp', result: 'Band 6.0' });
    assert.deepEqual(writingRow({ essays: [] }), { done: 'Chưa nộp bài nào', result: null });
    assert.equal(writingRow(null), null);
  });

  test('Listening and vocabulary: "Đúng a trên b câu" only when b > 0', () => {
    assert.deepEqual(listeningRow({ programmes: [], recent: [{ checked_count: 0, correct_count: 0 }] }), { done: 'Chưa làm bài nào trong lộ trình nghe', result: null });
    assert.deepEqual(listeningRow({ programmes: [{ completed_form_count: 2 }], recent: [{ checked_count: 8, correct_count: 5 }] }), { done: '2 bài trong lộ trình nghe', result: 'Đúng 5 trên 8 câu' });
    assert.equal(listeningRow({ programmes: [], recent: [], partial_data: true }), null);
    assert.deepEqual(listeningRow({ programmes: [{ completed_form_count: 1 }], recent: [], partial_data: true }), { done: '1 bài trong lộ trình nghe', result: null, warning: 'Một phần số liệu Listening chưa tải được, số trên có thể thiếu.' });
    assert.equal(listeningRow({ programmes: [{ completed_form_count: 1 }], recent: [] }).warning, undefined);
    assert.deepEqual(vocabRow({ totals: { sessions: 0 }, recent_sessions: [] }), { done: 'Chưa luyện lượt nào', result: null });
    assert.equal(vocabRow({}), null);
  });

  test('goal, kill switch and content_expired detection', () => {
    assert.deepEqual(goalFromMe({ target_band: 7, exam_date: '2027-03-20' }), { band: '7.0', examDate: '2027-03-20' });
    assert.deepEqual(goalFromMe(null), { band: '', examDate: '' });
    assert.equal(isFeatureDisabled({ status: 503, detail: { error_code: 'feature_disabled' } }), true);
    assert.equal(isFeatureDisabled({ status: 503, detail: null }), false);
    assert.equal(isContentExpired({ status: 410, detail: { error_code: 'content_expired' } }), true);
    assert.equal(isContentExpired({ status: 410, detail: 'content_expired' }), true);
    assert.equal(isContentExpired({ status: 404, detail: 'content_expired' }), false);
  });
});

test('classMeIncomplete: degraded, unnamed rows or no list are a warning; a real "no class" is not', async () => {
  const { classMeIncomplete } = await import('../lib/account-model.mjs');
  assert.equal(classMeIncomplete({ has_class: true, degraded: ['class'], classes: [{ id: 'k', name: 'Lớp tối' }] }), true);
  assert.equal(classMeIncomplete({ has_class: true, classes: [{ id: 'k', name: null }] }), true);
  assert.equal(classMeIncomplete({ has_class: true }), true);
  assert.equal(classMeIncomplete({ has_class: true, classes: [{ id: 'k', name: 'Lớp tối' }] }), false);
  assert.equal(classMeIncomplete({ has_class: false }), false);
  assert.equal(classMeIncomplete(null), false);
});
