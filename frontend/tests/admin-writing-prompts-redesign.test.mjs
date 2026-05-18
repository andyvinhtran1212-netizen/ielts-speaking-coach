/**
 * frontend/tests/admin-writing-prompts-redesign.test.mjs — Sprint 6.14a.
 *
 * Pins the migration of /pages/admin/writing/prompts.html (prompts CRUD).
 *
 * Outlier: this page does NOT call WC.bootstrap. It initializes Supabase
 * inline (see SUPABASE_URL + SUPABASE_ANON constants + initSupabase()
 * call), and manages its own modal CRUD state machine. The migration
 * preserves all 30+ JS-coupled IDs, the soft-delete confirmation, the
 * Cloudinary upload flow, and the 4 admin endpoints
 * (GET/POST/PATCH/DELETE /admin/writing/prompts).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let html;

// Sprint 12.1 — chrome assertions (theme toggle, header email, brand badge,
// back-link) bail when the page uses <aver-admin-chrome>. The chrome
// contract is pinned by frontend/tests/aver-admin-chrome.test.mjs.
const USES_ADMIN_CHROME = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/prompts.html'), 'utf8').includes('<aver-admin-chrome');

let css;

before(() => {  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/prompts.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),            'utf8');
});


describe('admin-writing-prompts.html / foundation + IIFE', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('foundation order tokens → components → admin-writing.css', () => {
    const t = html.indexOf('aver-design/tokens.css');
    const c = html.indexOf('aver-design/components.css');
    const p = html.indexOf('css/admin-writing.css');
    assert.ok(t > -1 && c > -1 && p > -1 && t < c && c < p);
  });

  test('Plus Jakarta Sans + JetBrains Mono fonts loaded (Inter dropped)', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Inter\b/.test(html));
  });

  test('no inline <style> block', () => {
    assert.equal((html.match(/<style[\s\S]*?<\/style>/g) || []).length, 0);
  });

  test('canonical anti-flash IIFE present', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.match(html, /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/);
  });
});


describe('admin-writing-prompts.html / outlier — does NOT use WC.bootstrap', () => {
  test('initSupabase called inline (not via WC.bootstrap)', () => {
    assert.match(html, /initSupabase\(\s*SUPABASE_URL\s*,\s*SUPABASE_ANON\s*\)/);
  });

  test('writing-admin.js is NOT loaded on this page', () => {
    assert.ok(!/src=["'][^"']*writing-admin\.js/.test(html));
  });

  test('SUPABASE_URL + SUPABASE_ANON inline constants preserved', () => {
    assert.match(html, /var\s+SUPABASE_URL\s*=\s*['"]https:\/\/[^'"]+['"]/);
    assert.match(html, /var\s+SUPABASE_ANON\s*=\s*['"]sb_publishable_/);
  });
});


describe('admin-writing-prompts.html / 30+ form IDs preserved byte-identical', () => {
  const REQUIRED_IDS = [
    'filter-task-type', 'filter-difficulty', 'btn-create',
    'state-loading', 'state-error', 'state-empty', 'prompts-list',
    'modal', 'modal-title', 'btn-close-modal', 'modal-error',
    'form-title', 'form-task-type', 'form-difficulty', 'form-prompt-text', 'form-tags',
    'form-image-section', 'image-preview-container', 'image-preview', 'btn-remove-image',
    'image-upload-controls', 'form-image-file', 'upload-status', 'upload-error',
    'form-image-url', 'form-image-public-id',
    'btn-cancel', 'btn-save',
  ];
  for (const id of REQUIRED_IDS) {
    test(`#${id} present in markup`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing id="${id}"`);
    });
  }
});


describe('admin-writing-prompts.html / 4 CRUD endpoints preserved', () => {
  test('GET /admin/writing/prompts (with query params)', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/writing\/prompts\?/);
  });

  test('POST /admin/writing/prompts (create)', () => {
    assert.match(html, /window\.api\.post\(\s*['"]\/admin\/writing\/prompts['"]/);
  });

  test('PATCH /admin/writing/prompts/{id} (edit)', () => {
    assert.match(html, /window\.api\.patch\(\s*['"]\/admin\/writing\/prompts\/['"]\s*\+\s*_editingId/);
  });

  test('DELETE /admin/writing/prompts/{id} (soft delete)', () => {
    assert.match(html, /window\.api\.delete\(\s*['"]\/admin\/writing\/prompts\/['"]\s*\+\s*id/);
  });

  test('Cloudinary upload endpoint /admin/writing/prompts/upload-image preserved', () => {
    assert.match(html, /window\.api\.upload\(\s*['"]\/admin\/writing\/prompts\/upload-image['"]/);
  });
});


describe('admin-writing-prompts.html / image-section visibility tied to task1_academic', () => {
  test('syncImageSectionVisibility checks task1_academic', () => {
    assert.match(html, /taskType\s*===\s*['"]task1_academic['"]/);
  });

  test('image fields cleared to NULL for non-task1_academic in savePrompt', () => {
    assert.match(html, /if\s*\(\s*taskType\s*!==\s*['"]task1_academic['"]\s*\)\s*\{[\s\S]*?imageUrl\s*=\s*null/);
  });
});


describe('admin-writing-prompts.html / soft-delete confirmation preserved', () => {
  test('softDeletePrompt uses confirm() with "Tắt prompt này?" prompt', () => {
    assert.match(html, /confirm\(\s*['"]Tắt prompt này\?['"]\s*\)/);
  });
});


describe('admin-writing-prompts.html / body class + theme toggle', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('body uses av-page', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
  });

  test('canonical theme toggle present', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });
});


describe('admin-writing-prompts.html / Vietnamese microcopy preserved', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  const phrases = [
    'Library Prompts',
    'Quản lý kho đề bài IELTS Writing để giao cho học viên.',
    'Tất cả task types',
    'Tất cả độ khó',
    'Thêm prompt mới',
    'Đang tải…',
    'Chưa có prompt nào ở bộ lọc hiện tại.',
    'Tạo prompt mới',
    'Sửa prompt',
    'Tiêu đề',
    'VD: Climate change priority',
    'Task type',
    'Độ khó',
    'Đề bài',
    'Hình ảnh (Task 1 Academic)',
    'Tùy chọn — JPG/PNG/WEBP/GIF, tối đa 5MB.',
    'Cloudinary sẽ tự nén + cap 1200px.',
    'Xóa hình',
    'Đang upload…',
    'Upload lỗi:',
    'Tags (cách nhau bởi dấu phẩy)',
    'environment, opinion, advanced',
    'Hủy',
    'Lưu',
    'Tắt prompt này?',
    'không xác định',
    'Tiêu đề phải có ít nhất 2 ký tự.',
    'Đề bài phải có ít nhất 10 ký tự.',
    'Beginner',
    'Intermediate',
    'Advanced',
    'Sửa',
    'Xóa',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});


describe('admin-writing.css / modal + prompt-row + difficulty pills defined', () => {
  test('modal selectors defined', () => {
    for (const sel of [
      '.aw-modal-bg', '.aw-modal-panel', '.aw-modal-title', '.aw-modal-close',
      '.aw-form-label', '.aw-form-label__required',
    ]) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('prompt row + tag selectors defined', () => {
    for (const sel of [
      '.aw-prompt-row', '.aw-prompt-row__title', '.aw-prompt-row__body',
      '.aw-tag',
    ]) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('difficulty pill variants defined', () => {
    for (const sel of [
      '.aw-pill', '.aw-pill--task',
      '.aw-pill--difficulty-beginner', '.aw-pill--difficulty-intermediate', '.aw-pill--difficulty-advanced',
    ]) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });
});
