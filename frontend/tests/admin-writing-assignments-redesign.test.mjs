/**
 * frontend/tests/admin-writing-assignments-redesign.test.mjs — Sprint 6.14b.
 *
 * Pins the migration of /pages/admin/writing/assignments.html
 * (teacher → student writing-assignment management).
 *
 * Outlier (like admin-writing-prompts): inline Supabase init, no
 * WC.bootstrap. Card-list rendering (NOT real <table>) — 5 status
 * pills (pending/in_progress/submitted/graded/delivered) + timed
 * pill + task pill. 4-step modal: prompt picker → student
 * multi-select → deadline/instructions → IELTS-mode timer.
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
const USES_ADMIN_CHROME = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/assignments.html'), 'utf8').includes('<aver-admin-chrome');

let css;

before(() => {  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/assignments.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),                  'utf8');
});


describe('admin-writing-assignments.html / foundation + IIFE', () => {
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


describe('admin-writing-assignments.html / outlier — does NOT use WC.bootstrap', () => {
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


describe('admin-writing-assignments.html / JS-coupled IDs preserved', () => {
  const REQUIRED_IDS = [
    'filter-status', 'btn-create',
    'state-loading', 'state-error', 'state-empty', 'assignments-list',
    'modal', 'btn-close-modal', 'modal-error',
    'prompts-list', 'prompts-empty', 'prompt-search', 'selected-prompt-count',
    'student-search', 'btn-select-all', 'btn-clear-all',
    'students-list', 'students-empty', 'selected-count',
    'form-name', 'form-allow-soft-check',
    'form-deadline', 'form-instructions',
    'form-is-timed', 'timer-fields', 'form-time-limit',
    'btn-cancel', 'btn-save',
  ];
  for (const id of REQUIRED_IDS) {
    test(`#${id} present in markup`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing id="${id}"`);
    });
  }
});


describe('admin-writing-assignments.html / status maps preserved', () => {
  test('STATUS_LABELS preserves 5 keys with Vietnamese labels', () => {
    const block = html.match(/var\s+STATUS_LABELS\s*=\s*\{[\s\S]*?\};/);
    assert.ok(block);
    for (const key of ['pending', 'in_progress', 'submitted', 'graded', 'delivered']) {
      assert.match(block[0], new RegExp(`${key}\\s*:`), `STATUS_LABELS missing ${key}`);
    }
    assert.match(block[0], /⏳ Chờ làm/);
    assert.match(block[0], /📝 Đang làm/);
    assert.match(block[0], /📥 Đã nộp/);
    assert.match(block[0], /✓ Đã chấm/);
    assert.match(block[0], /📨 Đã trả/);
  });

  test('TASK_LABELS preserves 3 keys', () => {
    const block = html.match(/var\s+TASK_LABELS\s*=\s*\{[\s\S]*?\};/);
    assert.ok(block);
    for (const key of ['task2', 'task1_academic', 'task1_general']) {
      assert.match(block[0], new RegExp(`${key}\\s*:`), `TASK_LABELS missing ${key}`);
    }
  });
});


describe('admin-writing-assignments.html / endpoints + payload preserved', () => {
  test('GET /admin/writing/assignments with status_filter query param', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/writing\/assignments\?/);
  });

  test('GET /admin/writing/prompts (modal data load)', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/writing\/prompts['"]/);
  });

  test('GET /admin/students?limit=200 (modal data load)', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/students\?limit=200['"]/);
  });

  test('POST /admin/writing/assignments payload shape preserved', () => {
    assert.match(html, /window\.api\.post\(\s*['"]\/admin\/writing\/assignments['"]/);
    // W-ASSIGN: multi-prompt (prompt_ids) + name + allow_soft_check.
    for (const key of ['prompt_ids', 'student_ids', 'name', 'allow_soft_check',
                       'deadline', 'instructions', 'is_timed', 'time_limit_minutes']) {
      assert.match(html, new RegExp(`${key}\\s*:`), `Missing payload key: ${key}`);
    }
  });

  test('Timer pair client-side validation (1-180 minutes)', () => {
    assert.match(html, /timeLimit\s*<\s*1\s*\|\|\s*timeLimit\s*>\s*180/);
  });
});


describe('admin-writing-assignments.html / student picker JS contract preserved', () => {
  test('_selectedStudentIds Set drives the selection', () => {
    assert.match(html, /var\s+_selectedStudentIds\s*=\s*new\s+Set\(\)/);
  });

  test('btn-select-all selects only VISIBLE rows (respects filter)', () => {
    assert.match(html, /querySelectorAll\(\s*['"]#students-list input\[type="checkbox"\]\[data-student-id\]['"]/);
  });

  test('updateSelectedCount renders "(N chọn)" Vietnamese', () => {
    assert.ok(
      html.includes("'(' + _selectedStudentIds.size + ' chọn)'"),
      'Missing selected-count concat: \'(\' + _selectedStudentIds.size + \' chọn)\'',
    );
  });
});


describe('admin-writing-assignments.html / body class + theme toggle', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('body uses av-page', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
  });

  test('canonical theme toggle present', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /class=["'][^"']*\bav-theme-toggle\b/);
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });
});


describe('admin-writing-assignments.html / Vietnamese microcopy preserved', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  const phrases = [
    'Bài giao — Writing Coach Admin',
    'Bài giao',
    'Giao đề bài từ thư viện cho học viên.',
    'Tất cả trạng thái',
    'Chờ làm',
    'Đang làm',
    'Đã nộp',
    'Đã chấm',
    'Đã trả',
    'Giao bài mới',
    'Đang tải…',
    'Chưa có bài giao nào.',
    'Bước 1 — Chọn đề từ thư viện',
    'Bước 2 — Chọn học viên',
    'Chọn đề bài',
    'Chọn tất cả',
    'Bỏ chọn',
    'Tìm theo tên hoặc mã học viên',
    'Không có học viên trùng bộ lọc.',
    'Hạn nộp (tùy chọn)',
    'Ghi chú cho học viên (tùy chọn)',
    'VD: Tập trung vào câu phức + linking words.',
    'IELTS-mode (đếm ngược + tự nộp)',
    'Thời gian (phút)',
    'Task 1: 20 phút · Task 2: 40 phút (chuẩn IELTS).',
    'Vui lòng chọn đề bài.',
    'Vui lòng chọn ít nhất 1 học viên.',
    'Vui lòng nhập thời gian (1-180 phút).',
    'Đã giao bài cho',
    'Hủy',
    'Giao bài',
    '(Đề bài đã xóa)',
    'Nộp tự động (hết giờ)',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});


describe('admin-writing.css / Sprint 6.14b assignment primitives defined', () => {
  test('aw-assign-pill data-status variants defined (5 statuses)', () => {
    for (const s of ['pending', 'in_progress', 'submitted', 'graded', 'delivered']) {
      assert.match(css, new RegExp(`\\.aw-assign-pill\\[data-status=["']${s}["']\\]`), `Missing aw-assign-pill[data-status=${s}]`);
    }
  });

  test('aw-assign-pill task + timed variants defined', () => {
    assert.match(css, /\.aw-assign-pill--task\b/);
    assert.match(css, /\.aw-assign-pill--timed\b/);
  });

  test('aw-modal-step-label primitive defined', () => {
    assert.match(css, /\.aw-modal-step-label\b/);
    assert.match(css, /\.aw-modal-step-label__count\b/);
  });

  test('aw-student-row picker primitives defined', () => {
    for (const sel of ['.aw-student-picker', '.aw-student-row', '.aw-student-row__checkbox', '.aw-student-row__name', '.aw-student-row__code']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('aw-prompt-preview defined', () => {
    assert.match(css, /\.aw-prompt-preview\b/);
  });
});


describe('admin-writing.css / token discipline (assignments page)', () => {
  test('no Era B / production-typo hex literals in runtime CSS', () => {
    const runtime = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const h of ['#0a1628', '#14b8a6', '#0d9488', '#14a8ae', '#f87171', '#fde68a', '#5eead4']) {
      assert.ok(!runtime.includes(h), `runtime CSS should not contain ${h}`);
    }
  });

  test('--av-text-faint usage stays under the 10-instance cap (this page only)', () => {
    const total = (html.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint on this page ≤ 10, got ${total}`);
  });
});


// ── Sprint 19.2 — cohort fan-out + filter ─────────────────────────────

describe('admin-writing-assignments.html / Sprint 19.2 cohort', () => {
  test('cohort filter dropdown + fan-out mode toggle present', () => {
    assert.match(html, /id="filter-cohort"/);
    assert.match(html, /data-assign-mode="individual"/);
    assert.match(html, /data-assign-mode="cohort"/);
    assert.match(html, /id="step-cohort"/);
    assert.match(html, /id="form-cohort"/);
  });

  test('fan-out posts to the fan-out endpoint with cohort_id', () => {
    assert.match(html, /\/admin\/writing\/assignments\/fan-out/);
    assert.match(html, /function\s+setAssignMode\s*\(/);
    assert.match(html, /loadCohorts\(\)/);
  });

  test('cohort_id passed to the assignments list filter', () => {
    assert.match(html, /params\.set\('cohort_id'/);
  });

  test('assign-mode toggle CSS declared', () => {
    assert.match(css, /\.aw-assign-mode__btn/);
  });
});


describe('admin-writing-assignments.html / W-ASSIGN multi-prompt + group', () => {
  test('multi-prompt checkbox picker (not a single select)', () => {
    assert.match(html, /data-prompt-id=/);                       // checkbox list
    assert.match(html, /_selectedPromptIds\s*=\s*new Set\(\)/);
    assert.doesNotMatch(html, /id=["']form-prompt["']/);         // old single select gone
  });

  test('name + allow_soft_check inputs + read in save', () => {
    assert.match(html, /id=["']form-name["']/);
    assert.match(html, /id=["']form-allow-soft-check["']/);
    assert.match(html, /allow_soft_check:\s*allowSoftCheck/);
  });

  test('fan-out also sends prompt_ids + name + allow_soft_check', () => {
    const fanout = html.match(/assignments\/fan-out['"][\s\S]{0,400}?\}\)/);
    assert.ok(fanout, 'fan-out call not found');
    assert.match(fanout[0], /prompt_ids:/);
    assert.match(fanout[0], /allow_soft_check:/);
  });

  test('admin list groups rows by assignment_group_id', () => {
    assert.match(html, /assignment_group_id/);
    assert.match(html, /function\s+renderAssignmentRow\s*\(/);
    assert.match(html, /function\s+renderAssignmentCard\s*\(/);   // legacy standalone
  });
});
