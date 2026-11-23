// LIBRARY-0061 T013 (FR-030): URL filters and topic grouping of /library/speaking.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apiQuery, describeFilters, filterQuery, groupByTopic, readFilters } from '../app/(public-library)/library/speaking/speaking-list-model.mjs';

test('readFilters keeps only valid values', () => {
  assert.deepEqual(readFilters({ part: '2', chude: 'noi-chon', video: '1', q: '  zoo ' }), { part: '2', chude: 'noi-chon', video: true, q: 'zoo' });
  assert.deepEqual(readFilters({ part: '4', chude: 'Bad Slug', video: 'yes', q: 'x'.repeat(150) }), { part: null, chude: null, video: false, q: 'x'.repeat(100) });
  assert.deepEqual(readFilters({ part: ['1', '2'] }).part, '1');
});

test('filterQuery and apiQuery', () => {
  assert.equal(filterQuery({ part: '3', chude: null, video: true, q: 'zoo' }), '?part=3&video=1&q=zoo');
  assert.equal(filterQuery({}), '');
  assert.equal(apiQuery({ part: '3', video: true }), '?part=3&video=true');
});

test('groupByTopic follows shelf topic order, other topics last, empty groups dropped', () => {
  const topics = [{ slug: 'people', label_vi: 'Con người' }, { slug: 'places', label_vi: 'Nơi chốn' }, { slug: 'work', label_vi: 'Công việc' }];
  const items = [{ slug: 'a', topic_slug: 'places' }, { slug: 'b', topic_slug: null }, { slug: 'c', topic_slug: 'people' }, { slug: 'd', topic_slug: 'gone' }];
  const groups = groupByTopic(items, topics);
  assert.deepEqual(groups.map((g) => g.label), ['Con người', 'Nơi chốn', 'Chủ đề khác']);
  assert.deepEqual(groups[2].items.map((i) => i.slug), ['b', 'd']);
});

test('describeFilters says the active filters in words', () => {
  assert.equal(describeFilters({ part: '3', chude: 'places', video: true, q: 'zoo' }, 'Nơi chốn'), 'Part 3 · chủ đề Nơi chốn · chỉ đề có video · có chữ “zoo”');
});
