// EXAMROOM-0066 FR-010, FR-013, FR-014, FR-034: submit dialog, button lock,
// save status and time-up outcome copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clockTime, formatQuestionList, saveStatusText, submitButtonState, submitDialogModel,
  submitOutcomeModel, unansweredQuestions,
} from '../lib/exam-room/submit-guard.mjs';
import { EXAM_ROOM_STRINGS_EN as EN } from '../lib/exam-room/strings-en.mjs';
import { EXAM_ROOM_STRINGS_VI as VI } from '../lib/exam-room/strings-vi.mjs';

const qs = (blank) => Array.from({ length: 40 }, (_, i) => ({ q: i + 1, answered: !blank.includes(i + 1) }));

test('37 of 40 answered: warning dialog listing Q7, Q12 and Q13', () => {
  const d = submitDialogModel({ questions: qs([13, 7, 12]), strings: EN });
  assert.equal(d.kind, 'warning');
  assert.equal(d.badge, 'Warning');
  assert.equal(d.title, 'Submit with 3 unanswered questions?');
  assert.equal(d.body, 'Questions Q7, Q12 and Q13 are blank. You cannot change your answers after submitting.');
  assert.equal(d.confirm, 'Submit test');
  assert.equal(d.cancel, 'Return to test');
  assert.equal(d.initialFocus, 'cancel');
  assert.equal(d.costNote, null);
});

test('at most five numbers, then "and N more"', () => {
  const blank = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(unansweredQuestions(qs(blank)), blank);
  assert.equal(formatQuestionList(blank, EN), 'Q1, Q2, Q3, Q4, Q5 and 3 more');
  assert.equal(formatQuestionList(blank, VI), 'Câu 1, 2, 3, 4, 5 và 3 câu khác');
  assert.equal(submitDialogModel({ questions: qs([9]), strings: EN }).body, 'Question Q9 is blank. You cannot change your answers after submitting.');
});

test('nothing blank: plain dialog; cost note only when given', () => {
  const d = submitDialogModel({ questions: qs([]), strings: VI, costNote: 'Bài này dùng 1 lượt chấm.' });
  assert.equal(d.kind, 'plain');
  assert.equal(d.title, 'Nộp bài?');
  assert.equal(d.costNote, 'Bài này dùng 1 lượt chấm.');
});

test('button: offline changes the label; then submitting, read-only, saving', () => {
  assert.deepEqual(submitButtonState({ online: false, unsaved: 2, strings: EN }), { label: 'Waiting for connection', disabled: true, reason: 'Waiting for connection', why: 'offline' });
  assert.equal(submitButtonState({ online: true, submitting: true, strings: EN }).why, 'submitting');
  assert.equal(submitButtonState({ online: true, readOnly: true, strings: EN }).why, 'read_only');
  assert.equal(submitButtonState({ online: true, unsaved: 1, strings: EN }).reason, 'Saving your answers…');
  assert.equal(submitButtonState({ online: true, strings: EN, disabledReason: 'Play the audio first' }).reason, 'Play the audio first');
  assert.deepEqual(submitButtonState({ online: true, strings: EN }), { label: 'Submit test', disabled: false, reason: null, why: null });
  assert.equal(submitButtonState({ online: false, strings: VI }).label, 'Chờ kết nối');
});

test('save status text uses the last successful save time', () => {
  const at = new Date(2026, 10, 23, 10, 42, 30);
  assert.equal(clockTime(at), '10:42');
  assert.equal(clockTime(null), null);
  assert.equal(clockTime(Number.NaN), null);
  assert.deepEqual(saveStatusText({ state: 'saved', lastSavedAt: at }, EN), { text: 'Saved at 10:42', retry: null, tone: 'quiet' });
  assert.deepEqual(saveStatusText({ state: 'saving', lastSavedAt: at }, VI), { text: 'Đang lưu…', retry: null, tone: 'busy' });
  assert.deepEqual(saveStatusText({ state: 'retrying' }, EN), { text: 'Not saved. Retrying…', retry: null, tone: 'warning' });
  assert.deepEqual(saveStatusText({ state: 'failed' }, VI), { text: 'Chưa lưu được, đang thử lại', retry: 'Thử lưu lại', tone: 'warning' });
  assert.equal(saveStatusText({ state: 'idle' }, EN).text, null);
});

test('time-up outcome never says submitted unless confirmed', () => {
  assert.equal(submitOutcomeModel({ outcome: 'confirmed', strings: EN }).text, 'Your answers have been saved and submitted.');
  for (const outcome of ['submitting', 'unconfirmed', 'unconfirmed_manual', 'closed_unconfirmed', 'expired_unsubmitted']) {
    const m = submitOutcomeModel({ outcome, savedUpTo: '10:42', closedAt: '10:45', strings: EN });
    assert.ok(!/saved and submitted/.test(m.text), outcome);
    assert.equal(m.inputsLocked, true);
  }
  assert.equal(submitOutcomeModel({ outcome: 'unconfirmed_manual', savedUpTo: '10:42', strings: EN }).action, 'retry');
  assert.equal(submitOutcomeModel({ outcome: 'closed_unconfirmed', savedUpTo: '10:42', closedAt: '10:45', strings: VI }).text,
    'Máy chủ đã đóng bài lúc 10:45. Các câu sau 10:42 có thể chưa được ghi nhận.');
  assert.equal(submitOutcomeModel({ outcome: 'closed_unconfirmed', closedAt: '10:45', strings: EN }).action, 'exit');
  assert.equal(submitOutcomeModel({ outcome: 'idle', strings: EN }).inputsLocked, false);
});

test('expired_unsubmitted: refused after the grace period, never "submitted", no retry, copy cleared', () => {
  const en = submitOutcomeModel({ outcome: 'expired_unsubmitted', savedUpTo: '10:42', strings: EN });
  assert.equal(en.text, 'Time ran out before your answers reached our server. This attempt was not submitted and has no score. Your answers were saved on our server up to 10:42.');
  assert.deepEqual([en.action, en.inputsLocked, en.clearCopy], ['exit', true, true]);
  assert.equal(submitOutcomeModel({ outcome: 'expired_unsubmitted', strings: VI }).text,
    'Hết giờ trước khi bài tới máy chủ. Lượt này chưa được nộp và không có điểm.');
  assert.equal(submitOutcomeModel({ outcome: 'expired_unsubmitted', savedUpTo: '10:42', strings: VI }).text,
    'Hết giờ trước khi bài tới máy chủ. Lượt này chưa được nộp và không có điểm. Máy chủ đã lưu bài của bạn tới 10:42.');
  // "submitted" appears only as "not submitted"; Vietnamese never says "đã nộp".
  assert.ok(!/submitted/.test(en.text.replace('not submitted', '')), en.text);
  assert.ok(!/đã nộp/.test(submitOutcomeModel({ outcome: 'expired_unsubmitted', savedUpTo: '10:42', strings: VI }).text));
  assert.equal(submitOutcomeModel({ outcome: 'closed_unconfirmed', closedAt: '10:45', strings: EN }).clearCopy, true);
  for (const outcome of ['submitting', 'confirmed', 'unconfirmed', 'unconfirmed_manual', 'idle']) {
    assert.equal(submitOutcomeModel({ outcome, strings: EN }).clearCopy, false, outcome);
  }
});
