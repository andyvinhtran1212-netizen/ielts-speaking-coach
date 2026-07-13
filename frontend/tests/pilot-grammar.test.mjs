// Pilot 2 — grammar article (dark launch tại /grammar-preview/[category]/[slug]).
// Pin kiến trúc ADR-008/ADR-004 + kỷ luật ownership.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(FRONTEND, 'app', '(public-content)', 'grammar-preview', '[category]', '[slug]');
const LIB = readFileSync(path.join(FRONTEND, 'lib', 'grammar-api.ts'), 'utf8');
const PAGE = readFileSync(path.join(DIR, 'page.tsx'), 'utf8');
const SHELL = readFileSync(path.join(DIR, 'page-shell.tsx'), 'utf8');

test('data layer: server-only + use cache + cacheLife + abort timeout (ADR-008)', () => {
  assert.match(LIB, /import 'server-only'/);
  assert.match(LIB, /'use cache'/);
  assert.match(LIB, /cacheLife\(/);
  assert.match(LIB, /AbortSignal\.timeout\(/);
  assert.match(LIB, /cache\(fetchArticle\)/, 'metadata + body must share one memoized loader');
});

test('page: Server Component, async params, notFound TRƯỚC khi stream (404 thật)', () => {
  assert.ok(!PAGE.includes("'use client'"));
  assert.match(PAGE, /await params/);
  assert.match(PAGE, /generateMetadata[\s\S]*?notFound\(\)/, 'notFound must fire in generateMetadata (PPR soft-404 guard)');
});

test('shell: skeleton legacy nguyên bản — các id mà grammar.js nhắm tới', () => {
  for (const id of ['article-title', 'article-meta', 'article-body', 'toc-container',
                    'breadcrumb', 'reading-progress', 'guest-cta-bar', 'prev-next']) {
    assert.ok(SHELL.includes(`id="${id}"`), `missing legacy skeleton id: ${id}`);
  }
  assert.ok(!SHELL.includes("'use server'"), 'page-shell must not be a Server Action module');
});

test('canonical /grammar/:category/:slug vẫn thuộc legacy (cutover phải atomic)', () => {
  const cfg = readFileSync(path.join(FRONTEND, 'next.config.ts'), 'utf8');
  assert.ok(cfg.includes("source: '/grammar/:category/:slug'"), 'legacy grammar rewrite must stay until pilot-2 cutover');
});
