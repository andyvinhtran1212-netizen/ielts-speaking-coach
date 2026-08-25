import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeVocabularyArticle,
  normalizeVocabularyCategories,
  resolveVocabularySelection,
  vocabularyKey,
} from '../lib/vocabulary-model.mjs';

describe('Vocabulary Wiki canonical payload', () => {
  test('category feed preserves compound identity and authored summaries', () => {
    const categories = normalizeVocabularyCategories([{ slug: 'health', title: 'Health', article_count: 1, articles: [{
      slug: 'balance', category: 'health', headword: 'Balance', pronunciation: '/ˈbæl.əns/', gloss_vi: 'sự cân bằng',
    }] }]);
    assert.equal(categories[0].articleCount, 1);
    assert.equal(vocabularyKey(categories[0].slug, categories[0].articles[0].slug), 'health\u0000balance');
    assert.equal(categories[0].articles[0].glossVi, 'sự cân bằng');
  });

  test('category feed fails closed on count, ownership and duplicate mismatches', () => {
    for (const payload of [null, {}, [{ slug: 'health', title: 'Health' }], [
      { slug: 'health', title: 'Health', article_count: 2, articles: [{ slug: 'x', category: 'health', headword: 'X' }] },
    ], [
      { slug: 'health', title: 'Health', articles: [{ slug: 'x', category: 'work', headword: 'X' }] },
    ], [
      { slug: 'health', title: 'Health', articles: [{ slug: 'x', category: 'health', headword: 'X' }, { slug: 'x', category: 'health', headword: 'X2' }] },
    ]]) assert.throws(() => normalizeVocabularyCategories(payload), /invalid|duplicate/);
  });

  test('article normalizer verifies requested category + slug and rich arrays', () => {
    const article = normalizeVocabularyArticle({
      slug: 'balance', category: 'health', headword: 'Balance', collocations: ['work-life balance'],
      related_words: [{ slug: 'equilibrium', headword: 'Equilibrium', category: 'health' }],
    }, 'health', 'balance');
    assert.deepEqual(article.collocations, ['work-life balance']);
    assert.deepEqual(article.relatedWords, ['Equilibrium']);
    assert.throws(() => normalizeVocabularyArticle({ ...article, category: 'work' }, 'health', 'balance'), /invalid/);
  });

  test('article arrays reject object/string shape drift', () => {
    assert.throws(() => normalizeVocabularyArticle({
      slug: 'balance', category: 'health', headword: 'Balance', synonyms: [{ value: 'poise' }],
    }, 'health', 'balance'), /invalid/);
    assert.throws(() => normalizeVocabularyArticle({
      slug: 'balance', category: 'health', headword: 'Balance', related_words: [{}],
    }, 'health', 'balance'), /invalid/);
  });

  test('deep-link selection fails closed on compound mismatch and ambiguous slug', () => {
    const words = [
      { category: 'health', slug: 'balance', headword: 'Balance' },
      { category: 'work', slug: 'balance', headword: 'Work-life balance' },
      { category: 'work', slug: 'deadline', headword: 'Deadline' },
    ];
    assert.equal(resolveVocabularySelection(words, 'work', 'deadline'), words[2]);
    assert.equal(resolveVocabularySelection(words, 'health', 'deadline'), null);
    assert.equal(resolveVocabularySelection(words, '', 'balance'), null);
    assert.equal(resolveVocabularySelection(words, '', 'deadline'), words[2]);
    assert.equal(resolveVocabularySelection(words, 'health', ''), words[0]);
  });
});
