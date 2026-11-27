// LIBRARY-0061 T013 (FR-031, FR-033, FR-034): Speaking transcript helpers.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { activeCueIndex, answerStatus, formatClock, markSegments } from '../lib/library-cues.mjs';

describe('activeCueIndex', () => {
  const starts = [0, 2400, 5100, 9000];
  test('largest start not after the current time', () => {
    assert.equal(activeCueIndex(starts, 0), 0);
    assert.equal(activeCueIndex(starts, 2399), 0);
    assert.equal(activeCueIndex(starts, 2400), 1);
    assert.equal(activeCueIndex(starts, 8999), 2);
    assert.equal(activeCueIndex(starts, 120000), 3);
  });
  test('before the first start, untimed lines or a bad time give -1', () => {
    assert.equal(activeCueIndex([500, 900], 100), -1);
    assert.equal(activeCueIndex([null, null], 100), -1);
    assert.equal(activeCueIndex([], 100), -1);
    assert.equal(activeCueIndex(starts, Number.NaN), -1);
  });
});

test('formatClock', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(102_400), '1:42');
  assert.equal(formatClock(3_725_000), '1:02:05');
  assert.equal(formatClock(null), null);
  assert.equal(formatClock(-1), null);
});

describe('markSegments', () => {
  test('splits text and numbers marks in reading order from the running count', () => {
    const { parts, next } = markSegments('The old citadel is calm.', [
      { kind: 'structure', start: 16, end: 23, note: 'b' },
      { kind: 'vocab', start: 4, end: 15, note: 'kinh thành cổ' },
    ], 3);
    assert.deepEqual(parts, [
      { text: 'The ' },
      { text: 'old citadel', kind: 'vocab', n: 3, note: 'kinh thành cổ' },
      { text: ' ' },
      { text: 'is calm', kind: 'structure', n: 4, note: 'b' },
      { text: '.' },
    ]);
    assert.equal(next, 5);
  });
  test('overlapping and out-of-range marks are dropped, text is kept whole', () => {
    const { parts, next } = markSegments('abcdef', [
      { kind: 'vocab', start: 0, end: 3 },
      { kind: 'vocab', start: 2, end: 4 },
      { kind: 'vocab', start: 4, end: 99 },
    ]);
    assert.equal(parts.map((p) => p.text).join(''), 'abcdef');
    assert.equal(next, 2);
  });
});

test('answerStatus says the delivery in words', () => {
  assert.equal(answerStatus({ answer_kind: 'video', duration_s: 102 }), 'Có video trả lời mẫu · 1:42');
  assert.equal(answerStatus({ answer_kind: 'video', duration_s: null }), 'Có video trả lời mẫu');
  assert.equal(answerStatus({ answer_kind: 'audio' }), 'Chưa có video · câu trả lời mẫu dạng audio');
  assert.equal(answerStatus({ answer_kind: 'text' }), 'Chưa có video · câu trả lời mẫu dạng chữ');
});
