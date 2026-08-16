/**
 * admin-vocab-quiz-analytics.test.mjs
 *
 * Source-sentinel checks for the admin "Kết quả luyện tập từ vựng" page: it wires
 * the per-student rollup + drill-down + class-wide hard-words endpoints, ships the
 * canonical admin chrome, and is linked from the vocab admin hub. Zero-dep node:test.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const PAGE = read('pages', 'admin', 'vocab', 'quiz-analytics.html');
const HUB = read('pages', 'admin', 'vocab', 'index.html');

describe('admin quiz-analytics.html — chrome + endpoints', () => {
  test('canonical admin chrome (active=vocab) + design-system width', () => {
    // subsection="quiz-analytics" added so the nav highlights this page (it is
    // now a real entry in the vocab nav, no longer orphaned).
    assert.match(PAGE, /<aver-admin-chrome active="vocab" subsection="quiz-analytics">/);
    assert.match(PAGE, /aver-admin-chrome\.js/);
    assert.match(PAGE, /max-width: var\(--av-width-page\)/);
  });
  test('defines a real .hidden rule (page loads no tailwind → modal/tab toggles need it)', () => {
    assert.match(PAGE, /\.hidden\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
  test('per-student rollup + overview cards', () => {
    // Ghim ĐƯỜNG GỌI, không ghim phạm vi: phạm vi nay do ô chọn quyết định
    // (vocab | course) nên đóng cứng 'vocab' ở đây là ghim lại đúng cái vừa bỏ.
    assert.match(PAGE, /\/admin\/quiz\/students\?skill_area=/);
    assert.match(PAGE, /Học viên hoạt động/);
    assert.match(PAGE, /Độ chính xác TB/);
    assert.match(PAGE, /id="qa-overview"/);
  });
  test('per-student drill-down modal via the detail endpoint', () => {
    assert.match(PAGE, /\/admin\/quiz\/students\/'\s*\+\s*encodeURIComponent\(uid\)/);
    assert.match(PAGE, /function openStudent\(/);
    assert.match(PAGE, /class="av-modal-backdrop/);
  });
  test('hard-words tab reuses the class-wide bank analytics endpoint', () => {
    assert.match(PAGE, /\/admin\/quiz\/banks\?skill_area=/);
    assert.match(PAGE, /\/analytics/);
    assert.match(PAGE, /data-tab="hard"/);
    assert.match(PAGE, /data-tab="students"/);
  });
});

describe('admin vocab rollback hub links to the native analytics route', () => {
  test('hub card points at the clean route', () => {
    assert.match(HUB, /href="\/admin\/vocab\/quiz-analytics"/);
  });
});
