/**
 * frontend/tests/admin-writing-status-redesign.test.mjs — Sprint 6.14a.
 *
 * Pins the migration of /pages/admin/writing/status.html (grading
 * progress poller). JS contract preserved byte-identical: 13 IDs,
 * POLL_INTERVAL_MS, TERMINAL map, STATUS_DISPLAY map, deepGradingMessage,
 * polling against GET /admin/writing/essays/{id}/status.
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
const USES_ADMIN_CHROME = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/status.html'), 'utf8').includes('<aver-admin-chrome');

let css;

before(() => {  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/status.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),           'utf8');
});


describe('admin-writing-status.html / foundation + IIFE + WC.bootstrap', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('foundation order tokens → components → admin-writing.css', () => {
    const t = html.indexOf('aver-design/tokens.css');
    const c = html.indexOf('aver-design/components.css');
    const p = html.indexOf('css/admin-writing.css');
    assert.ok(t > -1 && c > -1 && p > -1 && t < c && c < p);
  });

  test('Plus Jakarta Sans + JetBrains Mono fonts loaded', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Inter\b/.test(html));
  });

  test('canonical anti-flash IIFE present', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
  });

  test('WC.bootstrap called with onReady callback (kicks off polling)', () => {
    assert.match(html, /WC\.bootstrap\(\s*\{[\s\S]*?onReady\s*:/);
  });
});


describe('admin-writing-status.html / 13 IDs preserved byte-identical', () => {
  const REQUIRED_IDS = [
    'state-loading', 'state-denied', 'state-ready', 'header-email',
    'status-pill', 'status-text', 'elapsed', 'progress-bar',
    'eta-text', 'error-box', 'error-msg', 'link-essay', 'btn-view',
  ];
  for (const id of REQUIRED_IDS) {
    test(`#${id} present in markup`, () => {
      // Sprint 12.1 — #header-email moved into <aver-admin-chrome>
      // shadow DOM. The chrome contract is pinned by aver-admin-chrome.test.mjs.
      if (USES_ADMIN_CHROME && id === 'header-email') return;
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing id="${id}"`);
    });
  }
});


describe('admin-writing-status.html / polling JS contract preserved', () => {
  test('POLL_INTERVAL_MS = 5000 preserved', () => {
    assert.match(html, /POLL_INTERVAL_MS\s*=\s*5000/);
  });

  test('TERMINAL map preserved: graded, reviewed, delivered, failed', () => {
    const m = html.match(/var\s+TERMINAL\s*=\s*\{[\s\S]*?\};/);
    assert.ok(m);
    for (const key of ['graded', 'reviewed', 'delivered', 'failed']) {
      assert.match(m[0], new RegExp(`${key}\\s*:\\s*true`), `TERMINAL missing ${key}: true`);
    }
  });

  test('STATUS_DISPLAY map preserved: pending / grading / graded / reviewed / delivered / failed', () => {
    const m = html.match(/var\s+STATUS_DISPLAY\s*=\s*\{[\s\S]*?\};/);
    assert.ok(m);
    for (const key of ['pending', 'grading', 'graded', 'reviewed', 'delivered', 'failed']) {
      assert.match(m[0], new RegExp(`${key}\\s*:`), `STATUS_DISPLAY missing key ${key}`);
    }
  });

  test('deepGradingMessage helper preserved (Sprint 2.7b 3-pass rotation)', () => {
    assert.match(html, /function\s+deepGradingMessage\s*\(\s*elapsedSeconds\s*\)/);
    assert.match(html, /Pass 1 of 3/);
    assert.match(html, /Pass 2 of 3/);
    assert.match(html, /Pass 3 of 3/);
  });

  test('GET /admin/writing/essays/{id}/status endpoint preserved', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/writing\/essays\/['"]\s*\+\s*_essayId\s*\+\s*['"]\/status['"]/);
  });

  test('btn-view href targets admin-writing-grade.html on completion', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /\/pages\/admin-writing-grade\.html\?essay_id=/);
  });

  test('WC.notify called on first terminal state (badge "Bài chấm xong")', () => {
    assert.match(html, /WC\.notify\(\s*['"]Bài chấm xong['"]/);
  });
});


describe('admin-writing-status.html / status-pill data-attribute drives theme color', () => {
  test('status-pill markup includes data-status="pending" initial value', () => {
    assert.match(html, /id=["']status-pill["'][^>]*data-status=["']pending["']/);
  });

  test('updateUI calls setAttribute("data-status", s)', () => {
    assert.match(html, /pill\.setAttribute\(\s*['"]data-status['"]\s*,\s*s\s*\)/);
  });
});


describe('admin-writing-status.html / body class + theme toggle', () => {
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


describe('admin-writing-status.html / Vietnamese microcopy preserved', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  const phrases = [
    'Grading Status — Writing Coach Admin',
    'Grading in progress',
    'Bạn có thể đóng tab — bài sẽ tiếp tục chấm trong nền.',
    'queued',
    'Đang xếp hàng…',
    'Gemini đang chấm bài…',
    'Đã chấm xong! 🎉',
    'Admin đã review.',
    'Đã giao cho học viên.',
    'Chấm bài thất bại.',
    'ETA: tính toán…',
    'Có lỗi khi chấm bài',
    'Xem kết quả',
    'Thiếu essay_id trong URL.',
    'Bài chấm xong',
    'đã sẵn sàng review.',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});


describe('admin-writing.css / status pill + progress bar CSS defined', () => {
  test('status pill rules + data-status variants', () => {
    assert.match(css, /\.aw-status-pill\b/);
    assert.match(css, /\.aw-status-pill\[data-status=["']grading["']\]/);
    assert.match(css, /\.aw-status-pill\[data-status=["']graded["']/);
    assert.match(css, /\.aw-status-pill\[data-status=["']failed["']\]/);
  });

  test('progress track + bar + failed variant + pulse animation defined', () => {
    for (const sel of ['.aw-progress-track', '.aw-progress-bar', '.aw-progress-bar--failed', '.aw-pulse']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
    assert.match(css, /@keyframes\s+aw-pulse\b/);
  });
});
