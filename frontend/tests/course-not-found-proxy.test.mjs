// PUBLICSITE-0059 FR-009 / FR-029 — `/courses/<slug>` answers a real HTTP 404
// for an unknown or non-public course, and for every course while the build
// flag AVER_PUBLIC_COMMERCE is off. The (public-commerce) layout prerenders a
// shell, so the page's own notFound() can only give 200 + noindex; proxy.ts
// decides first, like the Grammar article check. Runs the real proxy with
// isolated dependencies (same harness as grammar-article-not-found.test.mjs).
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
const { unstable_doesMiddlewareMatch: matches } = require('next/experimental/testing/server');

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NOT_FOUND = 'https://staging.averlearning.com/__aver-not-found';

function load(enabled, fetch) {
  const compiled = ts.transpileModule(readFileSync(path.join(FRONTEND, 'proxy.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modules = {
    '@/lib/backend': { API_BASE: 'https://fixture.invalid' },
    '@/lib/public-commerce.mjs': { publicCommerceEnabled: () => enabled },
    '@/lib/grammar-article-index.mjs': { createArticleIndex: () => ({ has: async () => true }) },
    '@/tooling/content-security-policy.mjs': csp,
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', compiled)((name) => modules[name] ?? require(name), exports, fetch);
  return exports;
}

const request = (pathname) => new NextRequest(`https://staging.averlearning.com${pathname}`);
// G04 courses_public.get_course: HTTPException(404, detail={"error_code": "course_not_found", ...}).
const COURSE_MISS = JSON.stringify({ detail: { error_code: 'course_not_found', message: 'Không tìm thấy khoá học này.' } });
const json = (status, body) => new Response(body, { status, headers: { 'content-type': 'application/json' } });

describe('course page real 404 (proxy.ts)', () => {
  test('flag off: every course URL is the 404, without asking the backend', async () => {
    const calls = [];
    const { proxy } = load(false, async (url) => { calls.push(url); return json(200, '{}'); });
    const result = await proxy(request('/courses/khoa-a'));
    assert.equal(result.headers.get('x-middleware-rewrite'), NOT_FOUND);
    assert.deepEqual(calls, []);
  });

  test('flag on: the course API\'s own course_not_found rewrites to the 404', async () => {
    const calls = [];
    const response = json(404, COURSE_MISS);
    const { proxy } = load(true, async (url, options) => {
      calls.push(url);
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal, 'the check is bounded');
      return response;
    });
    const result = await proxy(request('/courses/khong-co'));
    assert.deepEqual(calls, ['https://fixture.invalid/api/courses/khong-co']);
    assert.equal(result.headers.get('x-middleware-rewrite'), NOT_FOUND);
    assert.equal(response.bodyUsed, true);
  });

  for (const [label, response] of [
    ['a public course (200)', () => json(200, '{"slug":"khoa-a"}')],
    ['a backend outage (503)', () => json(503, '{"detail":{"error_code":"catalog_unavailable"}}')],
    ['a gateway 404 as HTML', () => new Response('<h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } })],
    ['a 404 with another JSON body', () => json(404, '{"detail":"Not Found"}')],
  ]) {
    test(`flag on: ${label} goes on to the page`, async () => {
      const body = response();
      const result = await load(true, async () => body).proxy(request('/courses/khoa-a'));
      assert.equal(result.headers.get('x-middleware-rewrite'), null);
      assert.equal(result.headers.get('x-middleware-next'), '1');
      assert.equal(body.bodyUsed, true, 'unused body is released');
    });
  }

  test('flag on: a network error or timeout goes on to the page (its error screen, not a false 404)', async () => {
    for (const error of [new TypeError('network'), new DOMException('timed out', 'TimeoutError')]) {
      const result = await load(true, async () => { throw error; }).proxy(request('/courses/khoa-a'));
      assert.equal(result.headers.get('x-middleware-next'), '1', error.name);
    }
  });

  test('a slug that is not valid percent-encoding is the 404 (no course can have it)', async () => {
    const calls = [];
    const result = await load(true, async (url) => { calls.push(url); return json(200, '{}'); }).proxy(request('/courses/%E0%A4'));
    assert.equal(result.headers.get('x-middleware-rewrite'), NOT_FOUND);
    assert.deepEqual(calls, []);
  });

  test('one check per slug per minute: a definite answer is kept 60 s, an outage is asked again', async () => {
    const calls = [];
    let answer = () => json(404, COURSE_MISS);
    const { proxy } = load(true, async (url) => { calls.push(url); return answer(); });
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      assert.equal((await proxy(request('/courses/khong-co'))).headers.get('x-middleware-rewrite'), NOT_FOUND);
      now += 59_000;
      assert.equal((await proxy(request('/courses/khong-co'))).headers.get('x-middleware-rewrite'), NOT_FOUND);
      assert.equal(calls.length, 1, 'the miss is kept inside 60 s');
      now += 2_000;
      answer = () => json(200, '{"slug":"khong-co"}');
      assert.equal((await proxy(request('/courses/khong-co'))).headers.get('x-middleware-next'), '1');
      assert.equal(calls.length, 2, 'after 60 s the course is asked again (it may have been published)');

      answer = () => json(503, '{}');
      await proxy(request('/courses/khoa-b'));
      await proxy(request('/courses/khoa-b'));
      assert.equal(calls.length, 4, 'an outage is not kept');
    } finally {
      Date.now = realNow;
    }
  });

  test('the enrol step of an unknown course is the 404 too; deeper paths are not course pages', async () => {
    const calls = [];
    const { proxy } = load(true, async (url) => { calls.push(url); return json(404, COURSE_MISS); });
    assert.equal((await proxy(request('/courses/khong-co/enroll'))).headers.get('x-middleware-rewrite'), NOT_FOUND);
    assert.deepEqual(calls, ['https://fixture.invalid/api/courses/khong-co']);
    const deeper = await proxy(request('/courses/khong-co/enroll/x'));
    assert.equal(deeper.headers.get('x-middleware-rewrite'), null);
    assert.equal(calls.length, 1);
    const off = await load(false, async () => { throw new Error('no call'); }).proxy(request('/courses/khoa-a/enroll'));
    assert.equal(off.headers.get('x-middleware-rewrite'), NOT_FOUND, 'flag off: the enrol step is the 404');
  });

  test('the matcher takes a course page and its enrol step only: not /courses, nothing deeper', () => {
    const { config } = load(true, async () => json(200, '{}'));
    const on = (url) => matches({ config, url, headers: { host: 'www.averlearning.com' } });
    assert.equal(on('/courses/khoa-a'), true);
    assert.equal(on('/courses'), false);
    assert.equal(on('/courses/khoa-a/enroll'), true);
    assert.equal(on('/courses/khoa-a/enroll/x'), false);
    assert.equal(on('/courses/khoa-a/other'), false);
  });
});
