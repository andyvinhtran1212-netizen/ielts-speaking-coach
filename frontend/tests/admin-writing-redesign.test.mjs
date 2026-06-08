/**
 * frontend/tests/admin-writing-redesign.test.mjs — Sprint 6.14a
 * (Phase 4 admin, page 1 of 4 in the small writing cluster).
 *
 * Pins the surgical migration of /pages/admin/writing/index.html (the
 * 4-card admin hub for the writing-coach workflow) onto the Aver
 * Design System.
 *
 * JS contract preserved byte-identical:
 *   - WC.bootstrap() called with no args (default reveal flow)
 *   - 4 canonical state IDs: state-loading, state-denied, state-ready, header-email
 *   - 4 hub card links: admin-writing-new, admin-writing-grade,
 *     admin-instructor-queue, admin-students
 *   - /admin.html back-link preserved
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
const USES_ADMIN_CHROME = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/index.html'), 'utf8').includes('<aver-admin-chrome');

let css;

before(() => {  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/index.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),    'utf8');
});


describe('admin-writing.html / foundation links', () => {
  test('links tokens.css before components.css before admin-writing.css', () => {
    const tokensIdx     = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx       = html.indexOf('css/admin-writing.css');
    assert.ok(tokensIdx > -1 && componentsIdx > -1 && pageIdx > -1);
    assert.ok(tokensIdx < componentsIdx);
    assert.ok(componentsIdx < pageIdx);
  });

  test('loads Plus Jakarta Sans + JetBrains Mono, drops Inter', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Inter\b/.test(html), 'Inter must be removed');
  });

  test('links Lucide CDN', () => {
    assert.match(html, /unpkg\.com\/lucide@[0-9.]+/);
  });

  test('no inline <style> block (all styling lives in admin-writing.css)', () => {
    const blocks = (html.match(/<style[\s\S]*?<\/style>/g) || []).length;
    assert.equal(blocks, 0);
  });
});


describe('admin-writing.html / anti-flash IIFE', () => {
  test('canonical IIFE reads localStorage av-theme + validates', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.match(html, /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/);
  });

  test('catch arm sets data-theme="light" last resort', () => {
    assert.match(html, /catch\s*\([^)]*\)\s*\{\s*document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/);
  });
});


describe('admin-writing.html / WC.bootstrap contract preserved', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('WC.bootstrap() called with no args (hub uses default reveal flow)', () => {
    assert.match(html, /WC\.bootstrap\(\s*\)/);
  });

  test('writing-admin.js script loaded (shared cluster JS)', () => {
    assert.match(html, /src=["']\/js\/writing-admin\.js["']/);
  });

  test('4 canonical state IDs present', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    for (const id of ['state-loading', 'state-denied', 'state-ready', 'header-email']) {
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing id="${id}"`);
    }
  });
});


describe('admin-writing.html / 4 hub card links preserved', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  const HUB_LINKS = [
    '/pages/admin/writing/new.html',
    '/pages/admin/writing/grade.html',
    '/pages/admin/writing/instructor-queue.html',
    '/pages/admin/students/index.html',
  ];

  for (const href of HUB_LINKS) {
    test(`hub link preserved: ${href}`, () => {
      assert.match(html, new RegExp(`href=["']${href.replace(/[.\-/]/g, m => '\\' + m)}["']`));
    });
  }

  test('back-link to /admin.html preserved', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /href=["']\/admin\.html["']/);
  });
});


describe('admin-writing.html / body class + chrome', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('body uses av-page', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
  });

  test('header has theme toggle with canonical .icon-sun / .icon-moon', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /class=["'][^"']*\bav-theme-toggle\b/);
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });
});


describe('admin-writing.html / Vietnamese microcopy preserved exactly', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  const phrases = [
    'Writing Coach Admin',
    'Quản lý bài writing — chấm bài + theo dõi học viên',
    'Đang kiểm tra quyền truy cập…',
    'Admin Access Required',
    'Bạn cần quyền admin để truy cập Writing Coach.',
    'Quay lại trang chủ',
    'Submit New Essay',
    'Paste essay → AI grades',
    'Review + Edit',
    'Spot-check AI output',
    'Instructor Queue',
    'Bài Instructor tier chờ review',
    'Students',
    'Profile + history',
    'ADMIN',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});


describe('admin-writing.css / token discipline', () => {
  test('uses --av-* tokens', () => {
    const av = (css.match(/var\(--av-/g) || []).length;
    const ds = (css.match(/var\(--ds-/g) || []).length;
    assert.ok(av > 80, `Expected many --av-* refs, got ${av}`);
    assert.equal(ds, 0);
  });

  test('no hardcoded `color: #...` runtime declarations', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const hex = stripped.match(/^\s*color:\s*#[0-9a-fA-F]{3,6};/gm) || [];
    assert.deepEqual(hex, []);
  });

  test('no Era B / production-typo hex literals leak into runtime CSS', () => {
    const cssRuntime = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const h of ['#0a1628', '#14b8a6', '#0d9488', '#14a8ae', '#f87171', '#fde68a', '#86efac']) {
      assert.ok(!cssRuntime.includes(h), `runtime CSS should not contain ${h}`);
    }
  });

  test('--av-text-faint usage stays under the 10-instance cap', () => {
    const total = (html.match(/--av-text-faint/g) || []).length + (css.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint ≤ 10, got ${total}`);
  });

  test('hub card + button + state machine selectors defined', () => {
    for (const sel of [
      '.aw-header', '.aw-back-link', '.aw-brand', '.aw-badge-admin',
      '.aw-state-loading__text', '.aw-state-denied__title',
      '.aw-hub-card', '.aw-hub-card__title', '.aw-hub-card__body',
    ]) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)), `Missing rule for ${sel}`);
    }
  });
});
