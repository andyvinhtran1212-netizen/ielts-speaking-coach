import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { listeningTranscriptDisplayText, listeningTranscriptParagraphs,
  normalizeListeningReview } from '../lib/listening-review-model.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/listening-review-group-and-editorial.json', import.meta.url)));
const clone = (value) => structuredClone(value);

test('captured production second slot displays its authored group body without changing its key, replay or raw payload', () => {
  const raw = clone(fixture.group_review);
  const before = JSON.stringify(raw);
  const [first, second] = normalizeListeningReview(raw).review;
  for (const key of ['script', 'translation_vi', 'why_correct', 'trap']) {
    assert.equal(second.solution[key], first.solution[key]);
  }
  assert.deepEqual(second.solution_group, { question_numbers: [11, 12], source_question_number: 11 });
  assert.equal(second.expected, 'C');
  assert.equal(second.correct, false);
  assert.equal(second.user_answer, '');
  assert.deepEqual(second.audio_window, raw.review[1].audio_window);
  assert.deepEqual(second.solution.audio_window, raw.review[1].solution.audio_window);
  assert.equal(second.solution.answer, undefined);
  assert.equal(JSON.stringify(raw), before);
});

test('same prompt and adjacent number cannot inherit from a different exercise group', () => {
  const raw = clone(fixture.group_review);
  raw.review[1].question_context.question_id = 'b1111111-1111-4111-8111-111111111111:12';
  const second = normalizeListeningReview(raw).review[1];
  assert.equal(second.solution.script, undefined);
  assert.equal(second.solution_group, undefined);
});

test('keeps an authored per-slot rationale, explicitly empty fields and non-multi question types', () => {
  const own = clone(fixture.group_review);
  own.review[1].solution.why_correct = 'Own slot-specific rationale.';
  assert.deepEqual(normalizeListeningReview(own).review[1].solution, own.review[1].solution);
  const empty = clone(fixture.group_review);
  empty.review[1].solution.translation_vi = '';
  assert.equal(normalizeListeningReview(empty).review[1].solution.translation_vi, '');
  const single = clone(fixture.group_review);
  single.review.forEach((row) => { row.question_type = 'mcq_3option'; });
  assert.equal(normalizeListeningReview(single).review[1].solution.script, undefined);
});

test('rejects conflicting individual solutions and a corrupt six-slot combined group', () => {
  const conflict = clone(fixture.group_review);
  conflict.review[1].solution.script = 'Distinct authored script.';
  assert.equal(normalizeListeningReview(conflict).review[1].solution.script, 'Distinct authored script.');
  const combined = clone(fixture.group_review);
  for (const qNum of [13, 14, 15, 16]) {
    const row = clone(combined.review[1]);
    row.q_num = qNum;
    row.question_context.question_id = `3c0cbc86-64d3-5fc9-bc76-a59968aaa0eb:${qNum}`;
    combined.review.push(row);
  }
  assert.equal(normalizeListeningReview(combined).review[1].solution.script, undefined);
});

test('preserves captured editorial words I, will and alight in the Script and transcript display', () => {
  for (const { script } of fixture.editorial_scripts) {
    const expected = script.replace(/\[(I|will|alight)\]/g, '$1');
    assert.equal(listeningTranscriptDisplayText(script, true), expected);
    assert.equal(listeningTranscriptParagraphs(script)[0].text, expected.trim().replace(/\s{2,}/g, ' '));
  }
  assert.equal(listeningTranscriptDisplayText('Hopefully that[will]change.'), 'Hopefully that will change.');
});

test('hides only known cues, retains stress content and unknown bracket syntax', () => {
  const raw = '[M-BrE-30s-professional] [emotion:polite] I [hesitate] heard [stress:arc lamp] [breath] [pause:1s] today.';
  assert.equal(listeningTranscriptDisplayText(raw, true).trim(), 'I heard [stress:arc lamp] today.');
  assert.equal(listeningTranscriptDisplayText(raw).trim(), 'I heard arc lamp today.');
  assert.equal(listeningTranscriptDisplayText('See [source: permitted] and [I].'), 'See [source: permitted] and I.');
  assert.equal(listeningTranscriptDisplayText('[alight] [chuckle] [pace:slow]'), 'alight ');
  for (const cue of ['pace:slow', 'pause:1s', 'emphasis:soft', 'emotion:polite',
    'hesitation:long', 'chuckle:soft', 'hesitate', 'breath', 'sigh',
    'sfx:phone-ring', 'tone:serious', 'ambience:room:3s']) {
    assert.equal(listeningTranscriptDisplayText(`Text [${cue}] continues.`), 'Text continues.');
  }
  assert.equal(listeningTranscriptDisplayText('My mobile is [digits:07700 924168].'), 'My mobile is 07700 924168.');
});
