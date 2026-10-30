import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeListeningReview } from '../lib/listening-review-model.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/listening-review-group-and-editorial.json', import.meta.url)));
const clone = (value) => structuredClone(value);

// Staging B20-T1 Q17/18 (exercise aee36f37…) and B20-T4 Q21/22 (728216be…):
// the exercise payload has no response_type, so question_type is null, and
// the authored identity is "<exercise uuid>:<q_num>".
function pair(exerciseId, first, { questionType = 'mcq_multi' } = {}) {
  const raw = clone(fixture.group_review);
  raw.review = raw.review.map((row, index) => ({
    ...row,
    q_num: first + index,
    question_type: questionType,
    question_context: { ...row.question_context, question_id: `${exerciseId}:${first + index}` },
  }));
  return raw;
}
const B20_T1 = 'aee36f37-5675-5370-9834-b49013380ca4';
const B20_T4 = '728216be-2118-5cab-b063-9f19b7ebfc8e';

test('C20L1-06: a second slot with its own rationale links the shared solution without copying it', () => {
  const raw = pair(B20_T1, 17);
  raw.review[1].solution = { ...raw.review[1].solution, why_correct: 'E: participants may use the kilns.' };
  const before = JSON.stringify(raw);
  const [first, second] = normalizeListeningReview(raw).review;
  assert.deepEqual(first.solution_group, { question_numbers: [17, 18], source_question_number: 17 });
  assert.deepEqual(second.solution_group, { question_numbers: [17, 18], source_question_number: 17, own_solution: true });
  assert.deepEqual(second.solution, raw.review[1].solution);
  assert.equal(second.solution.script, undefined);
  assert.equal(JSON.stringify(raw), before);
});

test('C20L4-06: an empty second slot shows the shared body and both cards carry the link', () => {
  const [first, second] = normalizeListeningReview(pair(B20_T4, 21)).review;
  assert.deepEqual(first.solution_group, { question_numbers: [21, 22], source_question_number: 21 });
  assert.deepEqual(second.solution_group, { question_numbers: [21, 22], source_question_number: 21 });
  assert.equal(second.solution.why_correct, first.solution.why_correct);
  assert.equal(second.expected, 'C');
});

test('a second slot served the same shared body is linked without an own-rationale claim', () => {
  const raw = pair(B20_T1, 17);
  raw.review[1].solution = { ...raw.review[0].solution, audio_window: raw.review[1].solution.audio_window };
  const second = normalizeListeningReview(raw).review[1];
  assert.deepEqual(second.solution_group, { question_numbers: [17, 18], source_question_number: 17 });
  assert.deepEqual(second.solution, raw.review[1].solution);
});

test('groups a staging row whose question_type is absent by its authored mcq_multi template', () => {
  for (const questionType of [null, '']) {
    const [first, second] = normalizeListeningReview(pair(B20_T1, 17, { questionType })).review;
    assert.equal(first.solution_group.source_question_number, 17);
    assert.equal(second.solution_group.source_question_number, 17);
  }
});

test('staging pair without any authored solution gets no link and no invented body', () => {
  const raw = pair(B20_T1, 17, { questionType: null });
  raw.review.forEach((row) => { row.solution = {}; });
  for (const item of normalizeListeningReview(raw).review) {
    assert.equal(item.solution_group, undefined);
    assert.deepEqual(item.solution, {});
  }
});

test('links back to the fuller second slot when the first only has its own rationale', () => {
  const raw = pair(B20_T1, 17);
  const shared = raw.review[0].solution;
  raw.review[0].solution = { why_correct: 'A: she explains what a kiln does.' };
  raw.review[1].solution = shared;
  const [first, second] = normalizeListeningReview(raw).review;
  assert.deepEqual(first.solution_group, { question_numbers: [17, 18], source_question_number: 18, own_solution: true });
  assert.deepEqual(second.solution_group, { question_numbers: [17, 18], source_question_number: 18 });
  assert.deepEqual(first.solution, raw.review[0].solution);
});

test('slots that authored a different passage are not linked as one shared solution', () => {
  for (const key of ['script', 'translation_vi']) {
    const raw = pair(B20_T1, 17);
    raw.review[1].solution = { ...raw.review[1].solution, [key]: 'A different authored passage.' };
    for (const item of normalizeListeningReview(raw).review) assert.equal(item.solution_group, undefined);
  }
});

test('single questions and an explicit non-multi type stay unchanged', () => {
  const raw = clone(fixture.group_review);
  raw.review = raw.review.map((row, index) => ({ ...row, q_num: 27 + index, question_type: 'gap_fill',
    question_context: { ...row.question_context, template_kind: 'gap_fill', question_id: `${B20_T1}:${27 + index}` } }));
  const normalized = normalizeListeningReview(raw).review;
  normalized.forEach((item, index) => {
    assert.equal(item.solution_group, undefined);
    assert.deepEqual(item.solution, raw.review[index].solution);
  });
  const typed = pair(B20_T1, 17, { questionType: 'mcq_3option' });
  for (const item of normalizeListeningReview(typed).review) assert.equal(item.solution_group, undefined);
});

test('a web explanation slot keeps its own object and leaves the author unlabelled', () => {
  const raw = pair(B20_T1, 17);
  raw.review[1].web_explanation_object = { explanation: { why_correct: 'Web object.' } };
  const [first, second] = normalizeListeningReview(raw).review;
  assert.equal(second.solution_group, undefined);
  assert.equal(second.solution.script, undefined);
  assert.equal(first.solution_group, undefined);
});
