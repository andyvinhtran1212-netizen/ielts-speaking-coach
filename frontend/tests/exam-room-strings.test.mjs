// EXAMROOM-0066 FR-002 and GOI-08 §5.3: both string sets have the same keys, the
// English set has no Vietnamese, and no string leaks an HTTP code, a parameter
// name or an attempt id.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EXAM_ROOM_STRINGS_EN as EN } from '../lib/exam-room/strings-en.mjs';
import { EXAM_ROOM_STRINGS_VI as VI } from '../lib/exam-room/strings-vi.mjs';

const SAMPLE = {
  nextUp: ['Reading'], savedAt: ['10:42'], answered: [3, 40], qShort: [5],
  qLabel: [{ n: 18, answered: true, flagged: true, current: true }],
  sectionChip: [{ kind: 'Passage', index: 2, answered: 3, total: 13 }],
  sectionCollapsed: [{ kind: 'Passage', index: 2, answered: 3, total: 13, flagged: 1, first: 14, last: 26 }],
  position: [{ q: 18, total: 40, section: 'Passage 2 · 4/13' }],
  submitBlankTitle: [3], submitBlankBody: ['Q7, Q12 and Q13', 3], questionList: [['7', '12'], 3],
  offline: ['10:42'], sessionExpiredBody: ['10:42'], sessionExpiredNoCopy: ['10:42'],
  unconfirmedManual: ['10:42'], closedUnconfirmed: ['10:45', '10:42'],
};

function render(set) {
  const out = {};
  for (const [k, v] of Object.entries(set)) {
    if (typeof v === 'function') out[k] = v(...(SAMPLE[k] ?? []));
    else if (typeof v === 'string') out[k] = v;
  }
  return out;
}

test('same keys in both sets, every function has a sample', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(VI).sort());
  for (const [k, v] of Object.entries(EN)) if (typeof v === 'function') assert.ok(SAMPLE[k], `sample for ${k}`);
});

test('English set has no Vietnamese letters; tools stay English in both', () => {
  const vietnamese = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  for (const [k, v] of Object.entries(render(EN))) assert.ok(!vietnamese.test(v), `${k}: ${v}`);
  for (const k of ['highlight', 'note', 'clear']) assert.equal(VI[k], EN[k]);
});

test('no HTTP codes, parameter names or attempt ids in any string', () => {
  for (const set of [EN, VI]) {
    for (const [k, v] of Object.entries(render(set))) {
      assert.ok(!/\b(401|403|404|409|422|500)\b|attempt_id|session_id|noRedirect|\{|\}/.test(v), `${set.lang}.${k}: ${v}`);
    }
  }
});

test('key copy matches the approved spec', () => {
  assert.equal(EN.savedAt('10:42'), 'Saved at 10:42');
  assert.equal(VI.savedAt('10:42'), 'Đã lưu lúc 10:42');
  assert.equal(EN.qLabel({ n: 18, answered: true, flagged: true, current: false }), 'Question 18, answered, flagged for review');
  assert.equal(EN.answered(37, 40), 'Answered 37 of 40');
  assert.equal(EN.questionList(['7', '12'], 3), 'Q7, Q12 and 3 more');
  assert.equal(EN.questionList(['7', '12'], 0), 'Q7 and Q12');
  assert.equal(VI.questionList(['7', '12'], 3), 'Câu 7, 12 và 3 câu khác');
  assert.equal(EN.submitBlankTitle(1), 'Submit with 1 unanswered question?');
  assert.equal(EN.abandonBody, 'Your answers will not be marked and this attempt will not appear in your results.');
  assert.equal(EN.closedUnconfirmed('10:45', '10:42'), 'This test was closed by our server at 10:45. Answers after 10:42 may not have been recorded.');
  assert.ok(!Object.values(render(VI)).some((v) => /\bem\b/i.test(v)), 'practice copy addresses the learner as "bạn"');
});
