import assert from 'node:assert/strict';
import test from 'node:test';
import { readSourceGapAnswers, writeSourceGapAnswers, displaySourceAnswer } from '../lib/listening-source-responses.mjs';

test('multiple source blanks retain a single persisted position and restore each field', () => {
  const answer = writeSourceGapAnswers({ first: 'dinner', second: 'New York' });
  assert.deepEqual(readSourceGapAnswers(answer), { first: 'dinner', second: 'New York' });
  assert.equal(displaySourceAnswer(answer, 'multi_gap_completion', [{ field_id: 'first', prompt: 'What?' }, { field_id: 'second', prompt: 'Where?' }]), 'What?: dinner · Where?: New York');
  assert.equal(writeSourceGapAnswers({ first: '', second: '  ' }), '');
});

test('damaged structured answers cannot become object or array text in the learner result', () => {
  for (const value of ['broken', 'null', '[]', '123']) {
    assert.deepEqual(readSourceGapAnswers(value), {});
    assert.equal(displaySourceAnswer(value, 'multi_gap_completion'), '—');
  }
  assert.deepEqual(readSourceGapAnswers('{"a":"ribbons","bad":{"answer":"hidden"}}'), { a: 'ribbons' });
  assert.equal(displaySourceAnswer('C', 'single_choice'), 'C');
});
