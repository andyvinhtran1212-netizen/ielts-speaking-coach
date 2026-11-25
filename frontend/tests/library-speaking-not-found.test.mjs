// LIBRARY-0061 T013: an unknown Speaking question answers a real HTTP 404.
// Under cacheComponents the page streams its shell first, so notFound() there
// is only a soft 404 (200 + noindex). proxy.ts decides before rendering from
// the published-question index and rewrites a miss to the root 404 path, as
// it does for Grammar articles (PC-J526 rules for an unavailable index).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';

import { createArticleIndex } from '../lib/grammar-article-index.mjs';
import * as csp from '../tooling/content-security-policy.mjs';

const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROXY = readFileSync(path.join(FRONTEND, 'proxy.ts'), 'utf8');
const NOT_FOUND = 'https://staging.averlearning.com/__aver-not-found';

/** The real proxy; `indexed` fixes the Speaking index answer (undefined = real index over `fetch`). */
function proxyFor(fetch, indexed) {
  const compiled = ts.transpileModule(PROXY, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let made = 0;
  const modules = {
    '@/lib/backend': { API_BASE: 'https://fixture.invalid' },
    '@/lib/grammar-article-index.mjs': {
      // proxy.ts builds the Grammar index first, then the Speaking one.
      createArticleIndex: (options) => {
        made += 1;
        if (made === 1) return { has: async () => true };
        return indexed === undefined ? createArticleIndex(options) : { has: async () => indexed };
      },
    },
    '@/tooling/content-security-policy.mjs': csp,
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', compiled)((name) => modules[name] ?? require(name), exports, fetch);
  return exports;
}

const request = (slug) => new NextRequest(`https://staging.averlearning.com/library/speaking/${slug}`);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rewritten = (response) => response.headers.get('x-middleware-rewrite');

describe('Speaking question 404 in proxy.ts', () => {
  test('the matcher takes one segment under /library/speaking/, routed before the nonce branch', () => {
    assert.match(PROXY, /'\/library\/speaking\/:slug',/);
    assert.match(PROXY, /startsWith\('\/library\/speaking\/'\)\) return speakingQuestion\(request\)/);
    assert.ok(!csp.nonceRouteAllowed('/library/speaking/a-city-part-2'), 'the public Library never gets a nonce policy');
  });

  test('index: a published slug passes, an unknown one is the root 404', async () => {
    const calls = [];
    const rows = [{ slug: 'a-city-part-2', updated_at: null }];
    const { proxy } = proxyFor(async (url, options) => {
      calls.push(url);
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
      return url.endsWith('/index') ? json(200, rows) : json(200, { slug: 'a-city-part-2' });
    });
    assert.equal(rewritten(await proxy(request('a-city-part-2'))), null);
    assert.equal(rewritten(await proxy(request('no-such-question'))), NOT_FOUND);
    assert.deepEqual(calls, [
      'https://fixture.invalid/api/library/speaking/index',
      'https://fixture.invalid/api/library/speaking/a-city-part-2',
    ], 'one index read serves fresh lookups; a hit is confirmed, a miss is not');
  });

  test('a question unpublished after the index was cached answers 404 (warm index, same slug)', async () => {
    let published = true;
    const calls = [];
    const { proxy } = proxyFor(async (url) => {
      calls.push(url);
      if (url.endsWith('/index')) return json(200, [{ slug: 'a-city-part-2', updated_at: null }]);
      return published ? json(200, { slug: 'a-city-part-2' }) : json(404, { detail: 'speaking_not_found' });
    });
    assert.equal(rewritten(await proxy(request('a-city-part-2'))), null);
    published = false;
    assert.equal(rewritten(await proxy(request('a-city-part-2'))), NOT_FOUND);
    assert.equal(calls.filter((u) => u.endsWith('/index')).length, 1, 'the index was still cached');
  });

  test('an empty index is unknown: each slug asks the detail, so a re-import never 404s real questions', async () => {
    const calls = [];
    const { proxy } = proxyFor(async (url) => {
      calls.push(url);
      if (url.endsWith('/index')) return json(200, []);
      return url.endsWith('/a-city-part-2') ? json(200, { slug: 'a-city-part-2' }) : json(404, { detail: 'speaking_not_found' });
    });
    assert.equal(rewritten(await proxy(request('a-city-part-2'))), null);
    assert.equal(rewritten(await proxy(request('gone'))), NOT_FOUND);
    assert.ok(calls.includes('https://fixture.invalid/api/library/speaking/a-city-part-2'));
    assert.ok(calls.includes('https://fixture.invalid/api/library/speaking/gone'));
  });

  test('a malformed percent-encoding cannot name a question', async () => {
    const { proxy } = proxyFor(() => assert.fail('no fetch needed'), true);
    assert.equal(rewritten(await proxy(new NextRequest('https://staging.averlearning.com/library/speaking/%E0%A4%A'))), NOT_FOUND);
  });

  // Index unavailable: only the backend's own `speaking_not_found` is a miss.
  const outcomes = [
    ['speaking_not_found JSON 404', json(404, { detail: 'speaking_not_found' }), true],
    ['other JSON 404', json(404, { detail: 'Not Found' }), false],
    ['HTML 404 (gateway)', new Response('<h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } }), false],
    ['200', json(200, { slug: 'x' }), false],
    ['503 library_unavailable', json(503, { detail: 'library_unavailable' }), false],
  ];
  for (const [name, response, miss] of outcomes) {
    test(`index unknown, detail answers ${name}: ${miss ? '404' : 'page handles it'}`, async () => {
      const calls = [];
      const { proxy } = proxyFor(async (url, options) => {
        calls.push(url);
        assert.equal(options.redirect, 'manual');
        return response;
      }, null);
      const result = await proxy(request('x'));
      assert.deepEqual(calls, ['https://fixture.invalid/api/library/speaking/x']);
      assert.equal(rewritten(result), miss ? NOT_FOUND : null);
      assert.equal(response.bodyUsed, true, 'the body is released');
    });
  }

  test('index unknown and the detail read fails: the page handles it', async () => {
    const { proxy } = proxyFor(async () => { throw new TypeError('network'); }, null);
    const result = await proxy(request('x'));
    assert.equal(rewritten(result), null);
    assert.equal(result.headers.get('x-middleware-next'), '1');
  });

  test('a failed index load fails open (falls back to the detail read)', async () => {
    const calls = [];
    const { proxy } = proxyFor(async (url) => {
      calls.push(url);
      return url.endsWith('/index') ? json(503, { detail: 'library_unavailable' }) : json(200, {});
    });
    assert.equal(rewritten(await proxy(request('a-city-part-2'))), null);
    assert.deepEqual(calls, ['https://fixture.invalid/api/library/speaking/index', 'https://fixture.invalid/api/library/speaking/a-city-part-2']);
  });
});
