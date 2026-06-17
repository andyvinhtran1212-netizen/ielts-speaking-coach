/**
 * admin-writing-dashboard.test.mjs — F4 writing hub redesign.
 *
 * Pins the workflow-grouped dashboard tiles → functional pages, the dead
 * tiles dropped (bare grade.html "Review + Edit", stale English labels), and
 * token-driven styling. Lightweight source-assertion (the page is static).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const H = read('pages', 'admin', 'writing', 'index.html');


describe('writing dashboard — 3 workflow groups', () => {
  for (const label of ['Soạn &amp; chuẩn bị', 'Chấm &amp; trả', 'Giao &amp; theo dõi']) {
    test(`group present: ${label}`, () => {
      assert.match(H, new RegExp(`class="dash-group__label"[^>]*>${label}`));
    });
  }
});


describe('writing dashboard — every tile → a functional page', () => {
  const TILES = [
    ['Soạn bài viết',        '/pages/admin/writing/new.html'],
    ['Thư viện prompt',      '/pages/admin/writing/prompts.html'],
    ['Mẹo viết',             '/pages/admin/writing/tips.html'],
    ['Hàng chờ chấm',        '/pages/admin/writing/queue.html'],
    ['Yêu cầu chấm lại',     '/pages/admin/writing/regrade-requests.html'],
    ['Hàng đợi Instructor',  '/pages/admin/writing/instructor-queue.html'],
    ['Gán bài tập',          '/pages/admin/writing/assignments.html'],
    ['Lớp học',              '/pages/admin/writing/cohorts.html'],
    ['Học viên',             '/pages/admin/students/index.html'],
  ];
  for (const [label, href] of TILES) {
    test(`tile "${label}" → ${href}`, () => {
      const re = new RegExp(
        `href="${href.replace(/[.\-/?]/g, m => '\\' + m)}"[\\s\\S]{0,160}?dash-tile__title">${label}<`,
      );
      assert.match(H, re, `tile "${label}" must link ${href}`);
    });
  }
  test('exactly 9 tiles', () => {
    assert.equal((H.match(/class="dash-tile"/g) || []).length, 9);
  });
});


describe('writing dashboard — dead/stale tiles dropped', () => {
  test('no bare grade.html tile (Review + Edit) — grading is reached via the queue', () => {
    assert.doesNotMatch(H, /href="\/pages\/admin\/writing\/grade\.html"/);
    assert.doesNotMatch(H, /Review \+ Edit/);
  });
  test('stale English labels gone', () => {
    for (const s of ['Submit New Essay', 'Instructor Queue</', 'Students</']) {
      assert.ok(!H.includes(s), `stale label present: ${s}`);
    }
  });
});


describe('writing dashboard — token-driven + accessible', () => {
  test('tiles styled via --av-* tokens (light + dark)', () => {
    assert.match(H, /\.dash-tile\s*\{[\s\S]*?var\(--av-surface-card\)/);
    assert.match(H, /var\(--av-shadow-sm\)/);
  });
  test('groups use aria-labelledby; reveal is motion-safe', () => {
    assert.match(H, /aria-labelledby="dash-g-compose"/);
    assert.match(H, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
  });
});
