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

test('links into a question page are plain anchors (CSP is per document)', async () => {
  // The YouTube sources are sent only with the question page's own response;
  // a next/link soft navigation would keep the previous page's policy.
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../app/(public-library)/library/speaking/', import.meta.url).pathname;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|mjs)$/.test(name)) files.push(path);
    }
  };
  walk(root);
  assert.ok(files.length > 3);
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /from 'next\/link'/, file);
});

test('relaxSuggestions: one line per active filter that shows questions, dropping only that filter', async () => {
  const { relaxSuggestions } = await import('../app/(public-library)/library/speaking/speaking-list-model.mjs');
  const f = { part: '3', chude: null, video: true, q: 'zoo' };
  const lines = relaxSuggestions(f, { part: 4, video: 2, q: 7 }, null);
  assert.deepEqual(lines.map((l) => [l.key, l.label, l.count, l.query]), [
    ['video', 'Bỏ “Chỉ đề có video”', 2, '?part=3&q=zoo'],
    ['part', 'Tìm “zoo” ở cả ba Part', 4, '?video=1&q=zoo'],
    ['q', 'Xoá chữ “zoo”, giữ Part 3 · chỉ đề có video', 7, '?part=3&video=1'],
  ]);
  // A condition whose removal still shows nothing, or with no count, gets no line.
  assert.deepEqual(relaxSuggestions(f, { part: 0, video: 2 }, null).map((l) => l.key), ['video']);
  assert.deepEqual(relaxSuggestions(f, undefined, null), []);
  const topic = relaxSuggestions({ part: null, chude: 'noi-chon', video: false, q: '' }, { chude: 5 }, 'Nơi chốn');
  assert.deepEqual(topic.map((l) => [l.label, l.query]), [['Bỏ chủ đề “Nơi chốn”', '']]);
});
