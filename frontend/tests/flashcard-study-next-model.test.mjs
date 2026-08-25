import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  nextIntervalLabel,
  normalizePersonalStack,
  normalizePublicStack,
  normalizeReviewReceipt,
  parseFlashcardStack,
} from '../lib/flashcard-study-model.mjs';

const V = '00000000-0000-4000-8000-000000000101';
const personalCard = {
  id: V,
  headword: 'mitigate',
  definition_vi: 'giảm nhẹ',
  definition_en: 'make less severe',
  ipa: '/ˈmɪtɪɡeɪt/',
  example_sentence: 'Trees mitigate urban heat.',
  context_sentence: 'We can mitigate this issue.',
  topic: 'environment',
  source_type: 'used_well',
  audio_headword: 'https://cdn.example/mitigate.mp3',
  review: {
    interval_days: 4,
    ease_factor: 2.5,
    review_count: 2,
    lapse_count: 0,
    last_reviewed_at: '2026-08-15T00:00:00Z',
    next_review_at: '2026-08-19T00:00:00Z',
  },
};

const publicCard = {
  slug: 'mitigate', headword: 'Mitigate', pronunciation: '/ˈmɪtɪɡeɪt/',
  definition_vi: 'giảm nhẹ', definition_en: 'make less severe',
  example: 'Trees mitigate urban heat.', part_of_speech: 'verb', level: 'B2',
  collocations: ['mitigate risk'], synonyms: ['reduce'], antonyms: ['worsen'],
  memory_hook: 'Think: make it mild.', common_error: 'Do not use with “down”.',
};

describe('flashcard-study stack identity', () => {
  test('recognizes the three canonical modes and rejects ambiguous values', () => {
    assert.deepEqual(parseFlashcardStack('wiki:environment'), {
      raw: 'wiki:environment', mode: 'wiki', key: 'environment',
      storageKey: 'vocabflash:wiki:environment',
    });
    assert.equal(parseFlashcardStack('examlist:awl-1').mode, 'exam');
    assert.equal(parseFlashcardStack('auto:recent').mode, 'personal');
    assert.equal(parseFlashcardStack(V).mode, 'personal');
    assert.equal(parseFlashcardStack('wiki:'), null);
    assert.equal(parseFlashcardStack('../admin'), null);
  });
});

describe('flashcard-study payload boundaries', () => {
  test('normalizes a personal stack and rejects identity/schema drift', () => {
    const value = normalizePersonalStack({ stack_id: 'auto:recent', cards: [personalCard] }, 'auto:recent');
    assert.equal(value.cards[0].review.reviewCount, 2);
    assert.equal(value.cards[0].definitionVi, 'giảm nhẹ');
    assert.equal(normalizePersonalStack({ stack_id: 'auto:all_vocab', cards: [personalCard] }, 'auto:recent'), null);
    assert.equal(normalizePersonalStack({ stack_id: 'auto:recent', cards: [{ ...personalCard, id: '<script>' }] }, 'auto:recent'), null);
    assert.equal(normalizePersonalStack({ stack_id: 'auto:recent', cards: [personalCard, personalCard] }, 'auto:recent'), null);
  });

  test('normalizes public topic/exam cards and requires matching source identity', () => {
    const wiki = parseFlashcardStack('wiki:environment');
    assert.equal(normalizePublicStack({ category: 'environment', cards: [publicCard] }, wiki).cards[0].synonyms[0], 'reduce');
    assert.equal(normalizePublicStack({ category: 'business', cards: [publicCard] }, wiki), null);
    const exam = parseFlashcardStack('examlist:awl-1');
    assert.equal(normalizePublicStack({ list: 'awl-1', title: 'AWL 1', cards: [publicCard] }, exam).title, 'AWL 1');
    assert.equal(normalizePublicStack({ list: 'awl-2', title: 'AWL 2', cards: [publicCard] }, exam), null);
  });

  test('accepts null first-review state but rejects malformed SRS numbers', () => {
    const first = normalizePersonalStack({ stack_id: 'auto:recent', cards: [{ ...personalCard, review: null }] }, 'auto:recent');
    assert.equal(first.cards[0].review, null);
    assert.equal(normalizePersonalStack({ stack_id: 'auto:recent', cards: [{ ...personalCard, review: { ...personalCard.review, review_count: -1 } }] }, 'auto:recent'), null);
  });
});

describe('flashcard-study canonical review ACK', () => {
  test('requires a server success receipt tied to the exact vocabulary row', () => {
    const receipt = normalizeReviewReceipt({
      vocab_id: V, status: 'success', replayed: false,
      next_review_at: '2026-08-20T00:00:00Z', interval_days: 5,
      ease_factor: 2.5, review_count: 3,
    }, V);
    assert.equal(receipt.reviewCount, 3);
    assert.equal(normalizeReviewReceipt({ ...receipt, vocab_id: V }, V), null);
    assert.equal(normalizeReviewReceipt({
      vocab_id: V, status: 'success', replayed: 'false', next_review_at: 'x',
      interval_days: 5, ease_factor: 2.5, review_count: 3,
    }, V), null);
  });

  test('keeps interval hints deterministic and non-authoritative', () => {
    const normalized = normalizePersonalStack({ stack_id: 'auto:recent', cards: [personalCard] }, 'auto:recent');
    assert.equal(nextIntervalLabel(normalized.cards[0], 'again'), 'Hôm nay');
    assert.equal(nextIntervalLabel(normalized.cards[0], 'good'), '10 ngày');
  });
});
