import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  answerForQuestion,
  normalizeReadingCheck,
  normalizeReadingDetail,
  readingDetailPath,
  validReadingSlug,
} from '../lib/reading-detail-model.mjs';

const detail = (overrides = {}) => ({
  id: 'p1', slug: 'a-short-history-of-tea', title: 'Tea', body_markdown: 'Body',
  difficulty_level: 'foundation', topic_tags: ['history', 'history'],
  image_url: 'https://res.cloudinary.com/demo/image/upload/tea.jpg',
  glossary: [{ term: 'tea', definition: 'trà' }], translation_vi: 'Bản dịch',
  grammar_focus: [{ point: 'Past simple', analysis: 'Narrative time' }],
  questions: [{ q_num: 1, question_type: 'mcq_single', prompt: 'Pick one', payload: { options: [{ label: 'A', text: 'One' }] }, skill_tag: 'detail' }],
  ...overrides,
});

describe('reading detail model', () => {
  test('requires a canonical safe slug and builds only known API paths', () => {
    assert.equal(validReadingSlug('a-short-history-of-tea'), true);
    assert.equal(validReadingSlug('../secret'), false);
    assert.equal(readingDetailPath('vocab', 'a-short-history-of-tea'), '/api/reading/vocab/a-short-history-of-tea');
    assert.equal(readingDetailPath('other', 'a-short-history-of-tea'), null);
  });

  test('normalizes authored metadata, glossary, grammar and deduplicated topics', () => {
    const value = normalizeReadingDetail(detail(), 'a-short-history-of-tea');
    assert.equal(value.title, 'Tea');
    assert.deepEqual(value.topics, ['history']);
    assert.equal(value.questions[0].options[0].label, 'A');
    assert.equal(value.glossary[0].definition, 'trà');
    assert.equal(value.grammarFocus[0].point, 'Past simple');
  });

  test('fails closed on identity mismatch, malformed questions and duplicate q_num', () => {
    assert.equal(normalizeReadingDetail(detail({ slug: 'other' }), 'a-short-history-of-tea'), null);
    assert.equal(normalizeReadingDetail(detail({ questions: [{ q_num: 0 }] }), 'a-short-history-of-tea'), null);
    const q = detail().questions[0];
    assert.equal(normalizeReadingDetail(detail({ questions: [q, q] }), 'a-short-history-of-tea'), null);
  });

  test('rejects any pre-check answer, explanation or nested solution leak', () => {
    for (const leak of [
      { answer: 'A' }, { explanation: 'Because' },
      { payload: { options: [], solution: { solution_steps: ['A'] } } },
    ]) {
      const question = { ...detail().questions[0], ...leak };
      assert.equal(normalizeReadingDetail(detail({ questions: [question] }), 'a-short-history-of-tea'), null);
    }
  });

  test('accepts exactly one matching canonical check result', () => {
    const value = normalizeReadingCheck({ results: [{ q_num: 1, correct: false, expected: 'A', explanation: 'Why', skill_tag: 'detail' }] }, 1);
    assert.deepEqual(value, { qNum: 1, correct: false, expected: 'A', explanation: 'Why', skillTag: 'detail' });
    assert.equal(normalizeReadingCheck({ results: [] }, 1), null);
    assert.equal(normalizeReadingCheck({ results: [{ q_num: 2, correct: true, expected: 'A' }] }, 1), null);
  });

  test('trims answers without mutating question identity', () => {
    assert.equal(answerForQuestion({ qNum: 3 }, { 3: '  YES  ' }), 'YES');
    assert.equal(answerForQuestion({ qNum: 3 }, { 3: 12 }), '');
  });
});
