// LIBRARY-0061 FR-019 (G06-T10): `/library/writing-samples/:slug` is a partial
// prerender, so the page can only give a soft 404 (200 + noindex) or a client
// redirect. proxy.ts asks the backend detail endpoint before rendering: its own
// `sample_not_found` 404 → the root 404, its 308 → a 308 to the current page,
// anything else → the page's own handling. Exercised on the real proxy with
// isolated dependencies, as the Grammar and CSP proxy tests do.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';

import * as csp from '../tooling/content-security-policy.mjs';

const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const { unstable_doesMiddlewareMatch } = require('next/experimental/testing/server');

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROXY_SOURCE = readFileSync(path.join(FRONTEND, 'proxy.ts'), 'utf8');

function proxyModule(fetch) {
  const compiled = ts.transpileModule(PROXY_SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modules = {
    '@/lib/backend': { API_BASE: 'https://fixture.invalid' },
    '@/lib/grammar-article-index.mjs': {
      createArticleIndex: () => ({ has: async () => assert.fail('grammar index must not be read') }),
      articleKeys: () => new Set(),
    },
    '@/tooling/content-security-policy.mjs': csp,
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', compiled)((name) => modules[name] ?? require(name), exports, fetch);
  return exports;
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});
const request = (pathAndQuery) => new NextRequest(`https://staging.averlearning.com${pathAndQuery}`);
const NOT_FOUND = 'https://staging.averlearning.com/__aver-not-found';

describe('Library sample proxy (FR-019)', () => {
  test('a published set passes through after one uncached, bounded, manual-redirect read', async () => {
    const calls = [];
    const response = json(200, { slug: 'working-from-home' });
    const { proxy } = proxyModule(async (url, options) => {
      calls.push(url);
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      return response;
    });
    const result = await proxy(request('/library/writing-samples/working-from-home'));
    assert.deepEqual(calls, ['https://fixture.invalid/api/library/writing-samples/working-from-home']);
    assert.equal(result.headers.get('x-middleware-next'), '1');
    assert.equal(result.headers.get('x-middleware-rewrite'), null);
    assert.equal(response.bodyUsed, true, 'the unused body is released');
  });

  test("the backend's own miss is a real 404 (rewrite to the root 404)", async () => {
    const { proxy } = proxyModule(async () => json(404, { detail: 'sample_not_found' }));
    const result = await proxy(request('/library/writing-samples/unpublished-set'));
    assert.equal(result.headers.get('x-middleware-rewrite'), NOT_FOUND);
  });

  test('a renamed slug answers 308 to the current page, keeping the view query', async () => {
    const response = json(308, {}, { location: '/api/library/writing-samples/new-slug' });
    const { proxy } = proxyModule(async () => response);
    const result = await proxy(request('/library/writing-samples/old-slug?xem=so-sanh&cap=7.0-6.0'));
    assert.equal(result.status, 308);
    assert.equal(result.headers.get('location'), 'https://staging.averlearning.com/library/writing-samples/new-slug?xem=so-sanh&cap=7.0-6.0');
    assert.equal(response.bodyUsed, true);
  });

  const notAMiss = [
    ['gateway 404 as HTML', new Response('<h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } })],
    ['404 JSON with another detail', json(404, { detail: 'Not Found' })],
    ['503 library_unavailable', json(503, { detail: 'library_unavailable' })],
    ['308 to somewhere else', json(308, {}, { location: 'https://evil.example/' })],
    ['308 to the same slug', json(308, {}, { location: '/api/library/writing-samples/same' })],
  ];
  for (const [label, response] of notAMiss) {
    test(`${label} keeps the page's own handling`, async () => {
      const { proxy } = proxyModule(async () => response);
      const result = await proxy(request('/library/writing-samples/same'));
      assert.equal(result.headers.get('x-middleware-next'), '1', label);
      assert.equal(result.headers.get('x-middleware-rewrite'), null);
      assert.equal(result.headers.get('location'), null);
    });
  }

  for (const error of [new TypeError('network unavailable'), new DOMException('timed out', 'TimeoutError')]) {
    test(`${error.name} keeps the page's own handling`, async () => {
      const { proxy } = proxyModule(async () => { throw error; });
      const result = await proxy(request('/library/writing-samples/x'));
      assert.equal(result.headers.get('x-middleware-next'), '1');
    });
  }

  test('a slug that is not valid percent-encoding or holds a slash is a 404 without a backend read', async () => {
    const { proxy } = proxyModule(async () => assert.fail('no backend read'));
    for (const p of ['/library/writing-samples/%E0%A4%A', '/library/writing-samples/a%2Fb']) {
      const result = await proxy(request(p));
      assert.equal(result.headers.get('x-middleware-rewrite'), NOT_FOUND, p);
    }
  });

  test('matcher: the sample page on every host (production too), not the list or deeper paths', () => {
    const { config } = proxyModule(async () => json(200, {}));
    for (const host of ['www.averlearning.com', 'averlearning.com', 'staging.averlearning.com']) {
      const matches = (url) => unstable_doesMiddlewareMatch({ config, url: `https://${host}${url}`, headers: { host } });
      assert.equal(matches('/library/writing-samples/working-from-home'), true, host);
      assert.equal(matches('/library/writing-samples'), false, host);
      assert.equal(matches('/library'), false, host);
    }
  });
});
