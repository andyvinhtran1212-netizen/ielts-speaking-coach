import assert from 'node:assert/strict';
import test from 'node:test';

import { readingVocabArticleHref, readingVocabContext, readingVocabHref, readingVocabReturnHref } from '../lib/reading-vocab-context.mjs';
import { listeningLessonHref, listeningLessonReturnHref, listeningLibraryFilter } from '../lib/listening-library-context.mjs';
test('Reading round trip preserves filters and every loaded batch, including encoded authored tags', () => {
  const context = { difficulty: 'foundation', tag: 'food & drink', batches: 3 };
  const library = readingVocabHref(context);
  const article = new URL(readingVocabArticleHref('tea', context), 'https://example.test');
  assert.equal(readingVocabReturnHref(article.searchParams), library);
  assert.deepEqual(readingVocabContext(article.searchParams), context);
  assert.equal(article.pathname, '/reading/vocab/tea');
});

test('Reading invalid/duplicate filters and batches normalize without an arbitrary return URL', () => {
  assert.deepEqual(readingVocabContext(new URLSearchParams('difficulty=evil&tag=a%00b&batches=-5')), { difficulty: '', tag: '', batches: 1 });
  assert.deepEqual(readingVocabContext(new URLSearchParams('difficulty=foundation&difficulty=advanced&tag=x&tag=y&batches=2&batches=3')), { difficulty: '', tag: '', batches: 1 });
  for (const value of ['0', 'NaN', '1e9', '1.2', '1000']) assert.equal(readingVocabContext({ batches: value }).batches, 1);
  assert.equal(readingVocabReturnHref(new URLSearchParams('from=other&difficulty=foundation&return_to=https://evil.test')), '/reading/vocab');
  assert.equal(readingVocabReturnHref(new URLSearchParams('from=vocab&from=vocab&tag=food')), '/reading/vocab');
  assert.equal(readingVocabHref({ difficulty: '', tag: '', batches: 1 }), '/reading/vocab');
});

test('Listening source belongs to the canonical programme and keeps only its filter', () => {
  const href = listeningLessonHref('general', 'lesson 3', { filter: 'new' });
  const params = new URL(href, 'https://example.test').searchParams;
  assert.equal(listeningLessonReturnHref('general', params), '/listening/general?filter=new');
  assert.equal(listeningLessonReturnHref('ielts', params), '/listening/ielts');
  assert.equal(listeningLibraryFilter(new URLSearchParams('filter=new&filter=completed')), 'all');
  assert.equal(listeningLibraryFilter({ filter: 'unsupported' }), 'all');
});

