import assert from 'node:assert/strict';
import test from 'node:test';

import { availableQuestionLanguages, displayQuestion, groupProgrammeQuestions } from '../lib/listening-programme-learning.mjs';

test('guided mode stays per-question even when questions share a stimulus', () => {
  const questions = [
    { q_num: 1, source_stimulus_ids: ['a'] }, { q_num: 2, source_stimulus_ids: ['a'] },
    { q_num: 3, source_stimulus_ids: ['b'] }, { q_num: 4, source_stimulus_ids: ['a'] },
  ];
  assert.deepEqual(groupProgrammeQuestions(questions).map((group) => group.questions.map((q) => q.q_num)), [[1], [2], [3], [4]]);
});

test('only complete, source-matched editorial translation unlocks the language switch', () => {
  const pilot = { source_item_id: 'manus:A0.2-018.P1', prompt: 'Mai đang rủ cả hai cùng làm hay yêu cầu riêng Ben làm?', options: { A: 'Rủ cả hai cùng làm', B: 'Chỉ yêu cầu Ben làm' } };
  assert.deepEqual(availableQuestionLanguages([pilot]), ['vi', 'en']);
  assert.match(displayQuestion(pilot, 'en').prompt, /Mai inviting both/);
  assert.equal(displayQuestion(pilot, 'en').options.B, 'Asking only Ben to act');
  assert.deepEqual(availableQuestionLanguages([{ ...pilot, prompt: 'Corrected source prompt' }]), []);
  assert.deepEqual(availableQuestionLanguages([{ ...pilot, options: { A: 'Changed', B: 'Chỉ yêu cầu Ben làm' } }]), []);
  assert.deepEqual(availableQuestionLanguages([pilot, { source_item_id: 'other', prompt: 'Other', options: {} }]), []);
});
