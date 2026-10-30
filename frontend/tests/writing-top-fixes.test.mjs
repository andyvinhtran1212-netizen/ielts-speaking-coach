import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { writingTopFixes } from '../lib/writing-result-model.mjs';

const criteria = (bands) => Object.fromEntries(
  Object.entries(bands).map(([key, bandScore]) => [key, { bandScore }]),
);
const mistake = (mistakeType, criterion, extra = {}) => ({
  original: `orig ${mistakeType}`,
  mistakeType,
  explanation: `why ${mistakeType}`,
  suggestion: `fix ${mistakeType}`,
  criterion,
  ...extra,
});

describe('writingTopFixes (PC-J382 R3)', () => {
  test('orders groups by the lowest criterion band first', () => {
    const fixes = writingTopFixes({
      criteriaFeedback: criteria({ mainCriterion: 7, coherenceCohesion: 6, lexicalResource: 5, grammaticalRange: 6.5 }),
      mistakeAnalysis: [
        mistake('Article', 'Grammatical Range'),
        mistake('Word choice', 'Lexical Resource'),
        mistake('Linking', 'Coherence and Cohesion'),
        mistake('Off topic', 'Task Response'),
      ],
    });
    assert.deepEqual(fixes.map((fix) => fix.title), ['Word choice', 'Linking', 'Article']);
  });

  test('breaks a band tie by group size, then by first appearance', () => {
    const fixes = writingTopFixes({
      criteriaFeedback: criteria({ grammaticalRange: 6, lexicalResource: 6 }),
      mistakeAnalysis: [
        mistake('Tense', 'Grammatical Range', { original: 'first tense' }),
        mistake('Collocation', 'Từ vựng'),
        mistake('Article', 'GRA'),
        mistake('Article', 'ngữ pháp'),
        mistake('Tense', 'grammar'),
        mistake('Article', 'Grammatical Range'),
        mistake('Spelling', 'Lexical Resource'),
      ],
    });
    assert.deepEqual(fixes, [
      { title: 'Article', detail: 'fix Article', example: 'orig Article', count: 3 },
      { title: 'Tense', detail: 'fix Tense', example: 'first tense', count: 2 },
      { title: 'Collocation', detail: 'fix Collocation', example: 'orig Collocation', count: 1 },
    ]);
  });

  test('places an unknown or band-less criterion after every banded group', () => {
    const fixes = writingTopFixes({
      criteriaFeedback: criteria({ grammaticalRange: 8 }),
      mistakeAnalysis: [
        mistake('Mystery', 'z'),
        mistake('Mystery', 'z'),
        mistake('Word choice', 'Lexical Resource'),
        mistake('Article', 'Grammatical Range'),
      ],
    });
    assert.deepEqual(fixes.map((fix) => fix.title), ['Article', 'Mystery', 'Word choice']);
    assert.equal(fixes[1].count, 2);
  });

  test('tops up two groups with one non-duplicate area for improvement', () => {
    const fixes = writingTopFixes({
      criteriaFeedback: criteria({ grammaticalRange: 6 }),
      mistakeAnalysis: [mistake('Article', 'Grammatical Range'), mistake('Tense', 'Grammatical Range')],
      keyTakeaways: { areasForImprovement: ['  article ', '', 'Phát triển ý rõ hơn', 'Thêm ví dụ'] },
    });
    assert.deepEqual(fixes.map((fix) => fix.title), ['Article', 'Tense', 'Phát triển ý rõ hơn']);
    assert.deepEqual(fixes[2], { title: 'Phát triển ý rõ hơn', detail: '', count: 1 });
  });

  test('returns [] when there are no mistakes and no areas for improvement', () => {
    assert.deepEqual(writingTopFixes({}), []);
    assert.deepEqual(writingTopFixes(null), []);
    assert.deepEqual(writingTopFixes({ mistakeAnalysis: [], keyTakeaways: { areasForImprovement: [] } }), []);
  });

  test('skips empty and non-object entries', () => {
    const fixes = writingTopFixes({
      mistakeAnalysis: [null, 'Article', 7, { mistakeType: '   ' }, { mistakeType: 3 }, mistake('Tense', 'x')],
      keyTakeaways: { areasForImprovement: [null, 5, '   '] },
    });
    assert.deepEqual(fixes.map((fix) => fix.title), ['Tense']);
  });

  test('falls back to explanation when the suggestion is empty and omits an empty example', () => {
    const [fix] = writingTopFixes({
      mistakeAnalysis: [{ mistakeType: 'Tense', original: ' ', suggestion: '', explanation: 'Sai thì', criterion: 'GRA' }],
    });
    assert.deepEqual(fix, { title: 'Tense', detail: 'Sai thì', count: 1 });
  });

  test('groups NFD and NFC spellings, case and spacing of the same mistake type', () => {
    const nfc = 'Lỗi  dùng từ'.normalize('NFC');
    const nfd = ' lỗi dùng   TỪ '.normalize('NFD');
    assert.notEqual(nfc.normalize('NFD'), nfc);
    const fixes = writingTopFixes({
      mistakeAnalysis: [mistake(nfc, 'Lexical Resource'), mistake(nfd, 'Lexical Resource')],
      keyTakeaways: { areasForImprovement: ['LỖI DÙNG TỪ'.normalize('NFD')] },
    });
    assert.equal(fixes.length, 1);
    assert.equal(fixes[0].title, nfc.trim());
    assert.equal(fixes[0].count, 2);
  });

  test('never returns more than three fixes and leaves AI text unchanged', () => {
    const fixes = writingTopFixes({
      mistakeAnalysis: ['A', 'B', 'C', 'D'].map((type) => mistake(type, 'Grammatical Range', { suggestion: `<b>${type}</b>` })),
      keyTakeaways: { areasForImprovement: ['E'] },
    });
    assert.equal(fixes.length, 3);
    assert.equal(fixes[0].detail, '<b>A</b>');
  });
});
