/**
 * frontend/tests/admin-writing-new-redesign.test.mjs — Sprint 6.14a.
 *
 * Pins the migration of /pages/admin-writing-new.html (paste-essay
 * submission form). JS contract preserved byte-identical: all 14
 * form IDs, WC.bootstrap({onReady}), POST /admin/writing/essays
 * payload shape, redirect to status page on success.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let html;
let css;

before(() => {
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin-writing-new.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),        'utf8');
});


describe('admin-writing-new.html / foundation + IIFE + WC.bootstrap', () => {
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

  test('WC.bootstrap called with onReady callback', () => {
    assert.match(html, /WC\.bootstrap\(\s*\{[\s\S]*?onReady\s*:/);
  });
});


describe('admin-writing-new.html / 14 form IDs preserved byte-identical', () => {
  const REQUIRED_IDS = [
    'state-loading', 'state-denied', 'state-ready', 'header-email',
    'alert-area', 'essay-form',
    'f-student', 'f-task-type', 'f-level', 'f-model',
    'f-prompt', 'f-essay', 'word-count', 'btn-submit',
  ];
  for (const id of REQUIRED_IDS) {
    test(`#${id} present in markup`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing id="${id}"`);
    });
  }
});


describe('admin-writing-new.html / radio groups preserved', () => {
  test('form-of-address radio group: bạn / em / anh / chị (em is default checked)', () => {
    for (const v of ['bạn', 'em', 'anh', 'chị']) {
      assert.match(html, new RegExp(`name=["']foa["']\\s+value=["']${v}["']`), `Missing foa radio value="${v}"`);
    }
    assert.match(html, /name=["']foa["']\s+value=["']em["']\s+checked/);
  });

  test('grading_tier radio group: standard (default) / deep / instructor', () => {
    for (const v of ['standard', 'deep', 'instructor']) {
      assert.match(html, new RegExp(`name=["']grading_tier["']\\s+value=["']${v}["']`), `Missing grading_tier value="${v}"`);
    }
    assert.match(html, /name=["']grading_tier["']\s+value=["']standard["']\s+checked/);
  });
});


describe('admin-writing-new.html / submit JS contract preserved', () => {
  test('payload shape: student_id + task_type + analysis_level + selected_model + form_of_address + grading_tier + prompt_text + essay_text', () => {
    for (const key of ['student_id', 'task_type', 'analysis_level', 'selected_model', 'form_of_address', 'grading_tier', 'prompt_text', 'essay_text']) {
      assert.match(html, new RegExp(`${key}\\s*:`), `Missing payload key: ${key}`);
    }
  });

  test('POST /admin/writing/essays endpoint preserved', () => {
    assert.match(html, /window\.api\.post\(\s*['"]\/admin\/writing\/essays['"]/);
  });

  test('redirects to /pages/admin-writing-status.html?essay_id=… on success', () => {
    assert.match(html, /\/pages\/admin-writing-status\.html\?essay_id=/);
  });

  test('loadStudents calls GET /admin/students?limit=200', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/students\?limit=200['"]/);
  });

  test('word-count updater reads f-essay value', () => {
    assert.match(html, /getElementById\(\s*['"]f-essay['"]\s*\)\s*\.value/);
  });
});


describe('admin-writing-new.html / body class + theme toggle', () => {
  test('body uses av-page', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
  });

  test('canonical theme toggle present', () => {
    assert.match(html, /class=["'][^"']*\bav-theme-toggle\b/);
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });
});


describe('admin-writing-new.html / Vietnamese microcopy preserved', () => {
  const phrases = [
    'Submit New Essay',
    'Chọn học viên, dán đề + bài viết, AI sẽ chấm trong nền.',
    'Học viên',
    'Đang tải danh sách',
    'Task Type',
    'Task 1 — Academic',
    'Task 1 — General',
    'Analysis Level',
    'Level 1 — Mistake-only',
    'Level 5 — Pedantic / Full',
    'Gemini 2.5 Pro',
    'Gemini 2.5 Flash (rẻ hơn, nhanh hơn)',
    'Cách xưng hô (form of address)',
    'Grading tier',
    'Standard',
    '~30–60s · 12 sections · Pro',
    'Deep',
    '~3–5 phút · 12 sections + sentence rewrite · Pro multi-pass',
    'Instructor',
    '~24–48h · Human review',
    'giảng viên review',
    'Đề bài (prompt)',
    'Bài viết của học viên',
    '0 từ',
    'Hủy',
    'Submit for grading',
    'Đang kiểm tra quyền truy cập…',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});


describe('admin-writing.css / tier-picker + form CSS defined', () => {
  test('tier-picker selectors defined', () => {
    for (const sel of [
      '.aw-tier-picker', '.aw-tier-option', '.aw-tier-card',
      '.aw-tier__name', '.aw-tier__meta', '.aw-tier__desc',
    ]) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('form-of-address pill rules defined', () => {
    assert.match(css, /\.aw-foa-pill\b/);
    assert.match(css, /\.aw-foa-pill--checked\b/);
  });

  test('input + button + alert rules defined', () => {
    for (const sel of [
      '.aw-input', '.aw-btn-primary',
      '.aw-alert', '.aw-alert--error', '.aw-alert--warn',
    ]) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });
});
