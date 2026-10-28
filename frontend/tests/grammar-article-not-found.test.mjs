// A non-existent Grammar article answers a real HTTP 404 (content audit
// 2026-10-27): the article route streams under cacheComponents, so proxy.ts
// decides from the backend article list before rendering and rewrites a miss
// to a statically prerendered 404 inside the Grammar layout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { articleKeys, createArticleIndex } from '../lib/grammar-article-index.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');

const CATEGORIES = [
  { slug: 'tenses', articles: [{ category: 'tenses', slug: 'present-simple' }] },
  { slug: 'foundations', articles: [{ category: 'foundations', slug: 'articles' }] },
];

function harness(loads) {
  let clock = 1_000_000;
  let calls = 0;
  const index = createArticleIndex({
    now: () => clock,
    ttlMs: 300_000,
    missRefreshMs: 30_000,
    async load() {
      const next = loads[Math.min(calls, loads.length - 1)];
      calls += 1;
      if (next instanceof Error) throw next;
      return articleKeys(next);
    },
  });
  return { index, advance: (ms) => { clock += ms; }, calls: () => calls };
}

describe('grammar article index', () => {
  test('articleKeys reads category/slug pairs and rejects an empty or malformed list', () => {
    assert.deepEqual([...articleKeys(CATEGORIES)], ['tenses/present-simple', 'foundations/articles']);
    assert.throws(() => articleKeys({ detail: 'oops' }));
    assert.throws(() => articleKeys([{ slug: 'tenses', articles: [] }]));
  });

  test('known article → true; missing slug or wrong category → false', async () => {
    const { index, calls } = harness([CATEGORIES]);
    assert.equal(await index.has('tenses', 'present-simple'), true);
    assert.equal(await index.has('foundations', 'nonexistent-slug'), false);
    assert.equal(await index.has('foundations', 'present-simple'), false);
    assert.equal(calls(), 1, 'one list fetch serves fresh lookups');
  });

  test('a miss on an older list refetches once, so a new article is not 404d for a full TTL', async () => {
    const withNew = [...CATEGORIES, { slug: 'verb-patterns', articles: [{ category: 'verb-patterns', slug: 'infinitive' }] }];
    const { index, advance, calls } = harness([CATEGORIES, withNew]);
    assert.equal(await index.has('verb-patterns', 'infinitive'), false);
    advance(31_000);
    assert.equal(await index.has('verb-patterns', 'infinitive'), true);
    assert.equal(calls(), 2);
  });

  test('fails open: no list → null; a failed refresh never 404s on an expired list', async () => {
    const down = harness([new Error('backend down')]);
    assert.equal(await down.index.has('tenses', 'present-simple'), null);
    assert.equal(await down.index.has('foundations', 'nonexistent-slug'), null);
    assert.equal(down.calls(), 1, 'failed loads back off instead of retrying every request');

    const flaky = harness([CATEGORIES, new Error('backend down')]);
    assert.equal(await flaky.index.has('tenses', 'present-simple'), true);
    flaky.advance(301_000);
    assert.equal(await flaky.index.has('tenses', 'present-simple'), true, 'stale hit still passes through');
    assert.equal(await flaky.index.has('foundations', 'nonexistent-slug'), null, 'expired list cannot call a miss');
  });
});

describe('grammar article 404 wiring', () => {
  const proxy = read('proxy.ts');

  test('proxy only intercepts /grammar/:category/:slug and rewrites misses to the 404 route', () => {
    assert.match(proxy, /matcher: '\/grammar\/:category\/:slug'/);
    assert.match(proxy, /\/api\/grammar\/categories/);
    assert.match(proxy, /const GRAMMAR_ARTICLE_NOT_FOUND_PATH = '\/grammar\/article-not-found'/);
    assert.match(proxy, /=== false;/, 'only a definite miss (false) is a 404; null passes through');
    assert.match(proxy, /NextResponse\.rewrite\(new URL\(GRAMMAR_ARTICLE_NOT_FOUND_PATH, request\.url\)\)/);
    assert.match(proxy, /: NextResponse\.next\(\)/);
  });

  test('the rewrite target is a static page whose notFound() is prerendered as a real 404', () => {
    const page = read('app', '(public-content)', 'grammar', 'article-not-found', 'page.tsx');
    assert.match(page, /notFound\(\);/);
    // Any request-time API would stream the shell first and turn this into a 200 soft 404.
    assert.doesNotMatch(page, /\bawait\b|connection\(|cookies\(|headers\(|searchParams|params/);
  });

  test('the Grammar 404 renders the shared error card inside the token-loading public layout', () => {
    const notFound = read('app', '(public-content)', 'grammar', 'not-found.tsx');
    assert.match(notFound, /export \{ default \} from '\.\.\/\.\.\/not-found';/);
    assert.match(read('app', '(public-content)', 'layout.tsx'), /<link rel="stylesheet" href="\/css\/aver-design\/tokens\.css" \/>/);
  });
});
