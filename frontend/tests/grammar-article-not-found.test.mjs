// A non-existent Grammar article answers a real HTTP 404 (content audit
// 2026-10-27): the article route streams under cacheComponents, so proxy.ts
// decides from the backend article list before rendering and rewrites a miss
// to a path no route matches, so Next serves the root 404 with its full
// server HTML (PC-J230). The served HTML itself is checked after a build by
// tooling/verify-grammar-404-ssr-flow.mjs.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
    // The matcher also lists the CSP-nonce route groups (PC-J38,
    // csp-nonce-report-only.test.mjs); only /grammar/* reaches this branch.
    assert.match(proxy, /matcher: \[\n\s*'\/grammar\/:category\/:slug',/);
    assert.match(proxy, /pathname\.startsWith\('\/grammar\/'\)\n\s*\? grammarArticle\(request\)/);
    assert.match(proxy, /\/api\/grammar\/categories/);
    assert.match(proxy, /const GRAMMAR_ARTICLE_NOT_FOUND_PATH = '\/__aver-not-found'/);
    assert.match(proxy, /=== false;/, 'only a definite miss (false) is a 404; null passes through');
    assert.match(proxy, /NextResponse\.rewrite\(new URL\(GRAMMAR_ARTICLE_NOT_FOUND_PATH, request\.url\)\)/);
    assert.match(proxy, /: NextResponse\.next\(\)/);
  });

  test('the rewrite target matches no app route, so the root 404 renders it', () => {
    // PC-J230: the old target, a static notFound() page inside the Grammar
    // layout, prerendered as a bare `__next_error__` shell (no CSS, no
    // <title> until JS ran). An unmatched path gets the root 404 instead.
    assert.equal(existsSync(path.join(FRONTEND, 'app', '(public-content)', 'grammar', 'article-not-found')), false);
    assert.ok(existsSync(path.join(FRONTEND, 'app', 'not-found.tsx')));
    // A root-level segment is the only way a page could claim
    // `/__aver-not-found`: walk the route groups that sit at the URL root.
    const rootSegments = [];
    const collect = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (/^\(.*\)$/.test(entry.name)) collect(path.join(dir, entry.name));
        else rootSegments.push(entry.name);
      }
    };
    collect(path.join(FRONTEND, 'app'));
    assert.ok(rootSegments.includes('grammar'), 'the walk reaches the route groups');
    assert.deepEqual(rootSegments.filter((name) => name.startsWith('[') || name === '__aver-not-found'), []);
  });

  test('no public/ file or directory can answer the rewrite target either', () => {
    // PC-J235: a static asset at the target (e.g. public/__aver-not-found.html)
    // would be served instead of the root 404. Name read from proxy.ts so a
    // renamed target is still covered.
    const target = proxy.match(/const GRAMMAR_ARTICLE_NOT_FOUND_PATH = '\/([^'/]+)'/)?.[1];
    assert.ok(target, 'GRAMMAR_ARTICLE_NOT_FOUND_PATH is a single root segment');
    assert.deepEqual(readdirSync(path.join(FRONTEND, 'public')).filter((name) => name.startsWith(target)), []);
  });

  test('the fail-open soft 404 renders the shared error card inside the token-loading public layout', () => {
    const notFound = read('app', '(public-content)', 'grammar', 'not-found.tsx');
    assert.match(notFound, /export \{ default \} from '\.\.\/\.\.\/not-found';/);
    assert.match(read('app', '(public-content)', 'layout.tsx'), /<link rel="stylesheet" href="\/css\/aver-design\/tokens\.css" \/>/);
  });
});
