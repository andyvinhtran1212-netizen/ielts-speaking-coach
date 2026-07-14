// Pilot 1 — landing. CUTOVER 2026-07-14: canonical `/` = app/(marketing)/page.tsx.
// Pin các ràng buộc pilot: parity-first, client boundary hẹp nhất (ADR-004).
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = path.join(FRONTEND, 'app', '(marketing)', 'page.tsx');
const BEHAVIOR = path.join(FRONTEND, 'app', '(marketing)', 'landing-behavior.tsx');
const LAYOUT = path.join(FRONTEND, 'app', '(marketing)', 'layout.tsx');

test('page là Server Component; chỉ landing-behavior là client', () => {
  const page = readFileSync(PAGE, 'utf8');
  assert.ok(!page.includes("'use client'"), 'page.tsx must stay a Server Component');
  const behavior = readFileSync(BEHAVIOR, 'utf8');
  assert.match(behavior, /^'use client'/m, 'behavior component must be the client boundary');
});

test('layout giữ legacy chrome: OAuth recovery + anti-flash + 4 stylesheet + runtime-config', () => {
  const layout = readFileSync(LAYOUT, 'utf8');
  assert.match(layout, /access_token/, 'OAuth-redirect recovery is REQUIRED for root cutover');
  assert.match(layout, /av-theme/, 'anti-flash theme IIFE');
  for (const css of ['aver-design/tokens.css', 'aver-design/components.css', 'css/index.css', 'tailwind.build.css']) {
    assert.ok(layout.includes(css), `missing legacy stylesheet ${css}`);
  }
  assert.match(layout, /runtime-config\.js/);
  assert.match(layout, /lucide@1\.17\.0/, 'CDN pin must match legacy');
});

test('parity: các marker nội dung chính của index.html có mặt trong page.tsx', () => {
  const page = readFileSync(PAGE, 'utf8');
  for (const marker of [
    'Luyện thi IELTS', 'AI Coach', 'Bắt đầu miễn phí',
    'data-stat="total_users"', 'data-stat="sessions_completed"',
    '3 bước đơn giản', 'Kết quả thực tế',
  ]) {
    assert.ok(page.includes(marker), `missing content marker: ${marker}`);
  }
});

test('legacy index.html còn nguyên (dark launch không chạm canonical)', () => {
  assert.ok(existsSync(path.join(FRONTEND, 'public', 'index.html')));
});

test('CUTOVER: `/` is the Next app route; the legacy `/`→/index.html rewrite is GONE', () => {
  const cfg = readFileSync(path.join(FRONTEND, 'next.config.ts'), 'utf8');
  assert.ok(!cfg.includes("{ source: '/', destination: '/index.html' }"),
    'the `/` rewrite must be removed atomically with the cutover (route-ownership check enforces it)');
  assert.match(cfg, /source: '\/index\.html', destination: '\/'/,
    'legacy /index.html consolidates to the canonical `/`');
  assert.ok(existsSync(PAGE), 'landing page.tsx now lives directly under (marketing) → route `/`');
});

test('ADR-012: migrated landing emits implementation=next telemetry (observability, review)', () => {
  const layout = readFileSync(LAYOUT, 'utf8');
  const behavior = readFileSync(BEHAVIOR, 'utf8');
  // error signal: self-contained error-reporter is loaded (tags next via __next_f)
  assert.match(layout, /error-reporter\.js/, 'error-reporter must load so landing errors are reported + tagged next');
  // page-view denominator: raw beacon (no api.js dep) tagged next + release
  assert.match(behavior, /\/api\/analytics\/events/, 'landing must emit a page_view beacon');
  assert.match(behavior, /implementation: 'next'/, 'beacon must tag implementation=next for the ADR-012 dashboard');
  assert.match(behavior, /event_name: 'page_view'/);
});
