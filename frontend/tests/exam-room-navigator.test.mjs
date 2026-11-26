// EXAMROOM-0066 FR-006–FR-008: navigator model from the test structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { navigatorDensity, navigatorModel, groupQuestions } from '../lib/exam-room/navigator-model.mjs';
import { EXAM_ROOM_STRINGS_EN as EN } from '../lib/exam-room/strings-en.mjs';
import { EXAM_ROOM_STRINGS_VI as VI } from '../lib/exam-room/strings-vi.mjs';

function build(sizes, kind = 'passage', { answered = new Set(), flagged = new Set() } = {}) {
  const sections = [];
  const questions = [];
  let q = 1;
  sizes.forEach((size, i) => {
    const id = `${kind}-${i + 1}`;
    sections.push({ id, kind, index: i + 1, firstQ: q, lastQ: q + size - 1 });
    for (let k = 0; k < size; k += 1, q += 1) questions.push({ q, sectionId: id, answered: answered.has(q), flagged: flagged.has(q) });
  });
  return { sections, questions };
}

test('Reading 40 questions 13/13/14: the current section is open, others are chips', () => {
  const data = build([13, 13, 14], 'passage', { answered: new Set([1, 2, 3, 14, 15, 16, 17]), flagged: new Set([20]) });
  const m = navigatorModel({ ...data, currentQ: 5, strings: EN });
  assert.equal(m.total, 40);
  assert.deepEqual(m.sections.map((s) => [s.expanded, s.total]), [[true, 13], [false, 13], [false, 14]]);
  assert.equal(m.sections[0].cells.length, 13);
  assert.equal(m.sections[1].cells.length, 0);
  assert.equal(m.sections[1].chipLabel, 'Passage 2 · 4/13');
  assert.equal(m.sections[1].flagRule, true);
  assert.equal(m.sections[1].ariaLabel, 'Passage 2: 4 of 13 answered, 1 flagged. Show questions 14–26');
  assert.equal(m.sections[1].jumpTo, 18);
  assert.equal(m.sections[2].jumpTo, 27);
  assert.equal(m.answeredText, 'Answered 7 of 40');
  const cell = m.sections[0].cells[4];
  assert.equal(cell.current, true);
  assert.equal(cell.ariaLabel, 'Question 5, not answered, current question');
});

test('Listening 10×4 parts and Vietnamese practice labels', () => {
  const data = build([10, 10, 10, 10], 'part');
  const m = navigatorModel({ ...data, currentQ: 1, strings: EN });
  assert.deepEqual(m.sections.map((s) => s.chipLabel), ['Part 1 · 0/10', 'Part 2 · 0/10', 'Part 3 · 0/10', 'Part 4 · 0/10']);
  const vi = navigatorModel({ ...data, currentQ: 12, strings: VI });
  assert.equal(vi.sections[1].expanded, true);
  assert.equal(vi.sections[0].ariaLabel, 'Phần 1: đã làm 0 trên 10 câu, 0 câu đánh dấu. Mở câu 1–10');
  assert.equal(vi.sections[1].cells[1].ariaLabel, 'Câu 12, chưa trả lời, câu đang làm');
});

test('uneven three-passage test, current question in the last section', () => {
  const data = build([12, 15, 13], 'passage', { flagged: new Set([2]) });
  const m = navigatorModel({ ...data, currentQ: 40, strings: EN, width: 1280 });
  assert.deepEqual(m.sections.map((s) => s.expanded), [false, false, true]);
  assert.equal(m.sections[2].firstQ, 28);
  assert.equal(m.sections[0].flagRule, true);
  assert.equal(m.sections[0].ariaLabel, 'Passage 1: 0 of 12 answered, 1 flagged. Show questions 1–12');
  assert.equal(m.nextQ, null);
  assert.equal(m.previousQ, 39);
  assert.equal(m.position, 'Q40 of 40 · Passage 3 · 0/13');
});

test('a collapsed section can be opened without moving the current question', () => {
  const data = build([13, 13, 14]);
  const m = navigatorModel({ ...data, currentQ: 3, strings: EN, expandedSectionId: 'passage-2' });
  assert.deepEqual(m.sections.map((s) => s.expanded), [false, true, false]);
  assert.equal(m.sections[0].flagRule, false);
});

test('section order follows index, not input order; questions keep their numbers', () => {
  const data = build([13, 13, 14]);
  const m = navigatorModel({ sections: [...data.sections].reverse(), questions: [...data.questions].reverse(), currentQ: 27, strings: EN });
  assert.deepEqual(m.sections.map((s) => s.index), [1, 2, 3]);
  assert.deepEqual(m.sections[2].cells.map((c) => c.q).slice(0, 3), [27, 28, 29]);
});

test('rejects structures it cannot draw truthfully', () => {
  const data = build([13, 13]);
  assert.throws(() => groupQuestions(data.sections, [...data.questions, { q: 5, sectionId: 'passage-1', answered: false, flagged: false }]), /duplicate question 5/);
  assert.throws(() => groupQuestions(data.sections, [{ q: 30, sectionId: 'passage-1', answered: false, flagged: false }]), /outside section/);
  assert.throws(() => groupQuestions([...data.sections, { id: 'x', kind: 'passage', index: 3, firstQ: 20, lastQ: 30 }], []), /overlaps/);
});

test('FR-008 densities at 1280, 1100, 768 and 390', () => {
  assert.deepEqual(
    [1280, 1100, 768, 390].map((w) => { const d = navigatorDensity(w); return [d.density, d.cellWidth, d.showAnsweredText, d.compactBar, d.sheetColumns]; }),
    [['wide', 32, true, false, null], ['medium', 28, false, false, null], ['compact', 44, false, true, 10], ['phone', 44, false, true, 6]],
  );
  const data = build([13, 13, 14], 'passage', { answered: new Set([14, 15, 16, 17]) });
  assert.equal(navigatorModel({ ...data, currentQ: 18, strings: EN, width: 768 }).position, 'Q18 of 40 · Passage 2 · 4/13');
  assert.equal(navigatorModel({ ...data, currentQ: 18, strings: EN, width: 390 }).position, 'Q18 of 40');
});
