// Pilot 2 — grammar article. CUTOVER (prep): canonical /grammar/[category]/[slug].
// Pin kiến trúc ADR-008/ADR-004 + kỷ luật ownership.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(FRONTEND, 'app', '(public-content)', 'grammar', '[category]', '[slug]');
const LIB = readFileSync(path.join(FRONTEND, 'lib', 'grammar-api.ts'), 'utf8');
// Phase 3: các bảo đảm ADR-008 (abort budget, cacheLife, 'use cache') đã rút
// về tầng dùng chung `lib/backend.ts`; grammar-api chỉ còn ủy quyền. Kiểm ở
// đúng nơi chúng sống, đừng kiểm ở nơi chúng từng sống.
const BACKEND = readFileSync(path.join(FRONTEND, 'lib', 'backend.ts'), 'utf8');
const PAGE = readFileSync(path.join(DIR, 'page.tsx'), 'utf8');
const SHELL = readFileSync(path.join(DIR, 'page-shell.tsx'), 'utf8');

test('data layer: server-only + use cache + cacheLife + abort timeout (ADR-008)', () => {
  // Bảo đảm nằm ở tầng chung…
  assert.match(BACKEND, /import 'server-only'/);
  assert.match(BACKEND, /'use cache'/);
  assert.match(BACKEND, /cacheLife\(/);
  assert.match(BACKEND, /AbortSignal\.timeout\(/);
  // …còn bộ nạp Grammar phải ĐI QUA nó, không tự dựng bản riêng.
  assert.match(LIB, /import 'server-only'/);
  assert.match(LIB, /getPublicJson/);
  assert.match(LIB, /cache\(fetchArticle\)/, 'metadata + body must share one memoized loader');
});

// Bài đã thiếu => thân 404 + noindex. KHÔNG hứa "404 cứng": đo trên
// production 28/07, PPR phục vụ shell prerender (x-nextjs-prerender: 1) nên
// status luôn 200, cho cả slug sai lẫn category sai.
test('page: Server Component, async params, notFound trong metadata (=> noindex, không index được)', () => {
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

test('CUTOVER: canonical /grammar/:category/:slug là app route; rewrite legacy GONE', () => {
  const cfg = readFileSync(path.join(FRONTEND, 'next.config.ts'), 'utf8');
  assert.ok(!cfg.includes("{ source: '/grammar/:category/:slug', destination: '/pages/grammar-article.html' }"),
    'legacy grammar rewrite must be removed atomically with the cutover (route-ownership enforces)');
  assert.ok(existsSync ? existsSync(path.join(DIR, 'page.tsx')) : true, 'grammar route lives at the canonical path');
});
