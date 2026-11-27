// LIBRARY-0061 T010 (FR-014): frontend/lib/delta-highlight.mjs — exact-string
// match, no match → margin only, lower-band-only error → right column only,
// a phrase found twice → first occurrence; marks sit on the original text.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComparison,
  criterionStyle,
  locate,
  normaliseText,
  segmentText,
  splitParagraphs,
} from '../lib/delta-highlight.mjs';

const marked = (segments) => segments.filter((s) => s.n !== undefined).map((s) => [s.n, s.text]);
const joined = (segments) => segments.map((s) => s.text).join('');

describe('normalising and locating', () => {
  test('normalises like the importer: NFC, one quote style, single spaces, trimmed', () => {
    assert.equal(normaliseText('  It’s   “fine”\n\tnow '), 'It\'s "fine" now');
    assert.equal(normaliseText('café'), 'café');
  });

  test('locate maps the normalised hit back onto the original text', () => {
    const text = 'Workers  save\n time, and it’s cheaper.';
    const hit = locate(text, "save time, and it's");
    assert.ok(hit);
    assert.equal(text.slice(hit.start, hit.end), 'save\n time, and it’s');
  });

  test('locate returns the first occurrence and null for an absent or empty phrase', () => {
    const text = 'a big city and a big park';
    assert.deepEqual(locate(text, 'a big'), { start: 0, end: 5 });
    assert.equal(locate(text, 'a huge'), null);
    assert.equal(locate(text, '   '), null);
    assert.equal(locate(text, null), null);
  });

  test('a decomposed accent in the essay still matches a composed phrase', () => {
    const text = 'the café culture';
    const hit = locate(text, 'café culture');
    assert.ok(hit);
    assert.equal(text.slice(hit.start, hit.end), 'café culture');
  });

  test('splitParagraphs splits on blank lines, else on single line breaks', () => {
    assert.deepEqual(splitParagraphs('One.\n\nTwo.\n \nThree.'), ['One.', 'Two.', 'Three.']);
    assert.deepEqual(splitParagraphs('One.\nTwo.'), ['One.', 'Two.']);
    assert.deepEqual(splitParagraphs(''), []);
    assert.deepEqual(splitParagraphs(null), []);
  });

  test('segmentText keeps every character and marks exactly the spans', () => {
    const segments = segmentText('abcdef', [{ start: 3, end: 5, n: 2, criterion: 'x' }, { start: 0, end: 1, n: 1, criterion: 'y' }]);
    assert.equal(joined(segments), 'abcdef');
    assert.deepEqual(marked(segments), [[1, 'a'], [2, 'de']]);
  });
});

describe('buildComparison (FR-014)', () => {
  const HIGH = 'Remote work saves commuting time.\n\nIt also blurs the line between home and office.';
  const LOW = 'Remote work save time of travel.\n\nIt also blurs the line between home and office.';

  test('a matching pair marks both columns in the same row with the same number', () => {
    const { rows, marginOnly } = buildComparison(HIGH, LOW, [
      { criterion: 'Lexical Resource', before: 'saves commuting time', after: 'save time of travel', why: 'Cụm tự nhiên hơn.' },
    ]);
    assert.equal(marginOnly.length, 0);
    assert.deepEqual(marked(rows[0].high), [[1, 'saves commuting time']]);
    assert.deepEqual(marked(rows[0].low), [[1, 'save time of travel']]);
    assert.deepEqual(rows[0].notes.map((n) => [n.n, n.inHigh, n.inLow, n.criterion]), [[1, true, true, 'Lexical Resource']]);
    assert.equal(joined(rows[0].high), 'Remote work saves commuting time.');
  });

  test('an entry that matches nowhere is shown in the margin only, nothing is marked', () => {
    const { rows, marginOnly } = buildComparison(HIGH, LOW, [
      { criterion: 'Task Response', before: 'not in the essay', after: 'also not there', why: 'Lý do.' },
    ]);
    assert.deepEqual(marginOnly, [{ criterion: 'Task Response', why: 'Lý do.', before: 'not in the essay', after: 'also not there' }]);
    for (const row of rows) {
      assert.deepEqual(marked(row.high), []);
      assert.deepEqual(marked(row.low), []);
      assert.equal(row.notes.length, 0);
    }
  });

  test('an error only the lower band has (no `before`) marks the right column only', () => {
    const { rows } = buildComparison(HIGH, LOW, [
      { criterion: 'Grammatical Range and Accuracy', before: '', after: 'work save', why: 'Thiếu -s.' },
    ]);
    assert.deepEqual(marked(rows[0].high), []);
    assert.deepEqual(marked(rows[0].low), [[1, 'work save']]);
    assert.deepEqual(rows[0].notes.map((n) => [n.inHigh, n.inLow]), [[false, true]]);
  });

  test('a phrase found twice in a paragraph is marked at its first occurrence only', () => {
    const high = 'People work at home, and people work in offices.';
    const low = 'Peoples work at home, and peoples work in offices.';
    const { rows } = buildComparison(high, low, [
      { criterion: 'Grammatical Range and Accuracy', before: 'people work', after: 'peoples work', why: 'Số nhiều.' },
    ]);
    const hiSegs = rows[0].high;
    const first = hiSegs.findIndex((s) => s.n === 1);
    assert.equal(hiSegs.filter((s) => s.n !== undefined).length, 1);
    assert.equal(joined(hiSegs.slice(0, first)), 'People work at home, and ');
    assert.equal(rows[0].low.filter((s) => s.n !== undefined).length, 1);
  });

  test('a mark is placed in the paragraph that holds the phrase; notes are numbered from 1 per paragraph in text order', () => {
    const { rows } = buildComparison(HIGH, LOW, [
      { criterion: 'Coherence and Cohesion', before: 'between home', after: 'between home', why: 'b' },
      { criterion: 'Lexical Resource', before: 'blurs', after: 'blurs', why: 'a' },
      { criterion: 'Lexical Resource', before: 'Remote work', after: 'Remote work', why: 'c' },
    ]);
    assert.deepEqual(rows[0].notes.map((n) => [n.n, n.why]), [[1, 'c']]);
    assert.deepEqual(rows[1].notes.map((n) => [n.n, n.why]), [[1, 'a'], [2, 'b']]);
    assert.deepEqual(marked(rows[1].high), [[1, 'blurs'], [2, 'between home']]);
  });

  test('a phrase overlapping an earlier mark on the same side is left unmarked there', () => {
    const { rows } = buildComparison('alpha beta gamma', 'alpha beta gamma', [
      { criterion: 'Lexical Resource', before: 'alpha beta', after: 'alpha beta', why: '1' },
      { criterion: 'Lexical Resource', before: 'beta gamma', after: '', why: '2' },
    ]);
    // The second entry has no free span anywhere, so it goes to the margin.
    assert.equal(rows[0].notes.length, 1);
  });

  test('identical paragraphs with no note are flagged `same`; a missing paragraph is null', () => {
    const { rows } = buildComparison('A.\n\nSame text.\n\nExtra.', 'B.\n\nSame   text.', []);
    assert.deepEqual(rows.map((r) => r.same), [false, true, false]);
    assert.equal(rows[2].low, null);
  });

  test('bad input never throws', () => {
    assert.deepEqual(buildComparison(null, undefined, null), { rows: [], marginOnly: [] });
    const { rows } = buildComparison('x', 'y', [null, 3, { before: null, after: null }]);
    assert.equal(rows[0].notes.length, 0);
  });
});

test('criterionStyle maps the four full criterion names and nothing else', () => {
  assert.equal(criterionStyle('Task Response'), 'tr');
  assert.equal(criterionStyle('Task Achievement'), 'tr');
  assert.equal(criterionStyle('Coherence and Cohesion'), 'cc');
  assert.equal(criterionStyle('Lexical Resource'), 'lr');
  assert.equal(criterionStyle('Grammatical Range and Accuracy'), 'gra');
  assert.equal(criterionStyle('TR'), null);
  assert.equal(criterionStyle(null), null);
});
