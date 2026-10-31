import assert from 'node:assert/strict';
import test from 'node:test';

import {
  duplicatedBlankNumbers, hasDiagramPromptMarkup, numberedBlankPattern, plainDiagramPrompt, splitNumberedBlanks,
} from '../lib/numbered-blank.mjs';
import { examResultNextStepTitle, examResultOutcomes } from '../lib/exam-result-outcomes.mjs';
import { readingReviewPrompt, readingReviewTotals } from '../lib/reading-review-model.mjs';

test('a {{n}} marker absorbs only an underscore run of three or more on the same line (RV-05)', () => {
  assert.deepEqual(splitNumberedBlanks('drop in {{21}} ________ of cars'), ['drop in ', { qNum: 21, source: '{{21}} ________' }, ' of cars']);
  assert.deepEqual(splitNumberedBlanks('{{ 7 }}\t___x'), [{ qNum: 7, source: '{{ 7 }}\t___' }, 'x']);
  assert.deepEqual(splitNumberedBlanks('a {{1}} __ b'), ['a ', { qNum: 1, source: '{{1}}' }, ' __ b']);
  assert.deepEqual(splitNumberedBlanks('a {{1}}\n____ b'), ['a ', { qNum: 1, source: '{{1}}' }, '\n____ b']);
  assert.deepEqual(splitNumberedBlanks('____ {{2}} end'), ['____ ', { qNum: 2, source: '{{2}}' }, ' end']);
  assert.deepEqual(splitNumberedBlanks('{{1234}}'), ['{{1234}}']);
  assert.deepEqual(duplicatedBlankNumbers('{{21}} ________ and {{22}} and {{23}}___'), [21, 23]);
  assert.equal('x {{4}} ____ y'.replace(numberedBlankPattern(), '____'), 'x ____ y');
});

test('readingReviewPrompt renders B15-T1 Q21 as a single ____', () => {
  assert.equal(readingReviewPrompt({ prompt: 'be a 43 percent drop in {{21}} ________ of cars.' }), 'be a 43 percent drop in ____ of cars.');
  assert.equal(readingReviewPrompt({ prompt: '(see summary above)', solution: { question_text: '"drop in {{21}}____ of cars"' } }), 'drop in ____ of cars');
});

test('diagram row prompts never keep markdown images or {{n}} markers (T-DIAG)', () => {
  const prompt = 'Intro\n![Flow — Q8–10](assets/q8-10.png)\nuse {{10}} ____ to transport\nthe {{ 9 }} is completed\n\n\n![again](assets/q.png)';
  const plain = plainDiagramPrompt(prompt);
  assert.equal(plain, 'Intro\n\nuse (10) ______ to transport\nthe (9) ______ is completed');
  assert.doesNotMatch(plain, /!\[|\{\{\s*\d+\s*\}\}/);
  assert.equal(plainDiagramPrompt(undefined), '');
  assert.equal(plainDiagramPrompt('__________ to direct water'), '__________ to direct water');
  assert.equal(hasDiagramPromptMarkup(prompt), true);
  assert.equal(hasDiagramPromptMarkup('Use the visual shown with Question 8.'), false);
  assert.equal(hasDiagramPromptMarkup('![a](b)'), true);
});

test('result outcomes split blank from incorrect with the review-page precedence (RV-06, FR-013)', () => {
  const rows = [
    { q_num: 1, correct: true, user_answer: 'A' }, { q_num: 2, correct: false, user_answer: 'B' },
    { q_num: 3, correct: false, user_answer: '' }, { q_num: 4, correct: false, user_answer: '  ' },
    { q_num: 5, correct: false, user_answer: null }, { q_num: 6, correct: false, user_answer: 'C' }, { q_num: 7, correct: true },
  ];
  assert.deepEqual(examResultOutcomes(rows), { incorrect: 2, unanswered: 3 });
  const totals = readingReviewTotals(rows);
  assert.deepEqual({ incorrect: totals.incorrect, unanswered: totals.blank }, examResultOutcomes(rows));
  assert.deepEqual(examResultOutcomes(undefined), { incorrect: 0, unanswered: 0 });
  assert.equal(examResultNextStepTitle({ incorrect: 2, unanswered: 3 }, 'x'), 'Review 2 incorrect answers and 3 unanswered questions');
  assert.equal(examResultNextStepTitle({ incorrect: 1, unanswered: 1 }, 'x'), 'Review 1 incorrect answer and 1 unanswered question');
  assert.equal(examResultNextStepTitle({ incorrect: 0, unanswered: 2 }, 'x'), 'Review 2 unanswered questions');
  assert.equal(examResultNextStepTitle({ incorrect: 0, unanswered: 0 }, 'Review your answers'), 'Review your answers');
});
