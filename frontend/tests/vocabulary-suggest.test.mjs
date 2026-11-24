// LIBRARY-0061 T015 (FR-051): look-up suggestions and near words.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { baseForms, editDistance, entryHref, matchWords, nearWords, suggestWords } from '../lib/vocabulary-suggest.mjs';

const words = ['mitigate', 'mitigation', 'misinformation', 'mobility', 'carbon footprint', 'stop', 'study', 'work', 'mile', 'mild', 'milk', 'mind', 'mint']
  .map((headword) => ({ headword, category: 'c', slug: headword.replace(/ /g, '-') }));
const heads = (list) => list.map((word) => word.headword);

describe('suggestWords', () => {
  test('nothing before the second character', () => {
    assert.deepEqual(suggestWords('m', words), []);
    assert.deepEqual(suggestWords(' ', words), []);
  });

  test('headword prefix first, at most 5 rows', () => {
    const list = suggestWords('mi', words);
    assert.equal(list.length, 5);
    assert.ok(list.every((word) => word.headword.startsWith('mi')));
    assert.deepEqual(heads(suggestWords('miti', words)), ['mitigate', 'mitigation']);
  });

  test('a later word of a phrase matches after headword prefixes', () => {
    assert.deepEqual(heads(suggestWords('foot', words)), ['carbon footprint']);
  });

  test('inflected forms open the base form', () => {
    assert.deepEqual(heads(suggestWords('mitigated', words)), ['mitigate']);
    assert.deepEqual(heads(suggestWords('mitigating', words)), ['mitigate']);
    assert.deepEqual(heads(suggestWords('stopped', words)), ['stop']);
    assert.deepEqual(heads(suggestWords('studies', words)), ['study']);
    assert.deepEqual(heads(suggestWords('works', words)), ['work']);
  });

  test('prefix matches come before inflection matches', () => {
    const list = heads(matchWords('works', [...words, { headword: 'workshop', category: 'c', slug: 'workshop' }]));
    assert.deepEqual(list, ['workshop', 'work']);
    assert.deepEqual(heads(matchWords('work', [...words, { headword: 'workshop', category: 'c', slug: 'workshop' }])), ['work', 'workshop']);
  });
});

describe('nearWords', () => {
  test('one typo away, at most 3, closest first', () => {
    assert.deepEqual(heads(nearWords('mitigrate', words)), ['mitigate']);
    const near = nearWords('milx', words);
    assert.ok(near.length <= 3);
    assert.deepEqual(heads(near), ['mild', 'mile', 'milk']);
  });

  test('nothing close enough gives an empty list', () => {
    assert.deepEqual(nearWords('zzzzzz', words), []);
  });
});

test('baseForms and editDistance', () => {
  assert.ok(baseForms('mitigated').includes('mitigate'));
  assert.ok(baseForms('running').includes('run'));
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('abc', 'abcdef', 1), 2);
});

test('entryHref is the canonical entry URL', () => {
  assert.equal(entryHref({ category: 'people-society', slug: 'a b' }), '/vocabulary?cat=people-society&slug=a%20b');
});
