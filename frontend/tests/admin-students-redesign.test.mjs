/**
 * frontend/tests/admin-students-redesign.test.mjs — Sprint 6.14b.
 *
 * Pins the migration of /pages/admin-students.html (admin student
 * management). Uses WC.bootstrap({onReady}) + real HTML <table> +
 * 2 modals (edit/create + Phase 2.5 student summary).
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
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin-students.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),     'utf8');
});


describe('admin-students.html / foundation + IIFE + WC.bootstrap', () => {
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
  });

  test('WC.bootstrap called with onReady callback', () => {
    assert.match(html, /WC\.bootstrap\(\s*\{[\s\S]*?onReady\s*:/);
  });

  test('writing-admin.js script loaded', () => {
    assert.match(html, /src=["']\/js\/writing-admin\.js["']/);
  });
});


describe('admin-students.html / 36 JS-coupled IDs preserved byte-identical', () => {
  const REQUIRED_IDS = [
    // WC.bootstrap state machine
    'state-loading', 'state-denied', 'state-ready', 'header-email',
    // page chrome
    'csv-input', 'btn-new', 'search-input', 'row-count', 'alert-area',
    // table
    'students-table', 'students-tbody',
    // edit/create modal
    'modal', 'modal-title',
    'f-code', 'f-name', 'f-target-band', 'f-current-band', 'f-target-date', 'f-notes',
    'student-form', 'btn-cancel', 'btn-save',
    // Phase 2.5 summary modal
    'summary-modal', 'summary-title', 'summary-subtitle', 'summary-close',
    'stat-total', 'stat-graded', 'stat-flagged', 'stat-avg-band',
    'summary-essays', 'summary-assignments',
  ];
  for (const id of REQUIRED_IDS) {
    test(`#${id} present in markup`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing id="${id}"`);
    });
  }
});


describe('admin-students.html / table contract preserved', () => {
  test('semantic <table id="students-table" class="aw-table"> present', () => {
    assert.match(html, /<table\s+id=["']students-table["']\s+class=["']aw-table["']/);
  });

  test('6-column thead preserved: Code / Name / Target / Current / Date / Actions', () => {
    const thead = html.match(/<thead>[\s\S]*?<\/thead>/);
    assert.ok(thead);
    for (const col of ['Code', 'Name', 'Target', 'Current', 'Date', 'Actions']) {
      assert.match(thead[0], new RegExp(`>\\s*${col}\\s*<`), `Missing column: ${col}`);
    }
  });

  test('table renders Actions column with 4 button data-act values', () => {
    for (const act of ['summary', 'essay', 'edit', 'delete']) {
      assert.match(html, new RegExp(`data-act=["']${act}["']`), `Missing data-act="${act}"`);
    }
  });

  test('row code cell uses aw-table__code (monospace)', () => {
    assert.match(html, /class=["']aw-table__code["']/);
  });
});


describe('admin-students.html / endpoints preserved', () => {
  test('GET /admin/students with limit+search params', () => {
    assert.match(html, /\/admin\/students\?limit=200/);
    assert.ok(
      html.includes("'&search=' + encodeURIComponent(_searchValue)"),
      'Missing search-param concat: \'&search=\' + encodeURIComponent(_searchValue)',
    );
  });

  test('GET /admin/students/{id} (edit fetch)', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/students\/['"]\s*\+\s*id\s*\)/);
  });

  test('POST /admin/students (create)', () => {
    assert.match(html, /window\.api\.post\(\s*['"]\/admin\/students['"]/);
  });

  test('PATCH /admin/students/{id} (edit)', () => {
    assert.match(html, /window\.api\.patch\(\s*['"]\/admin\/students\/['"]\s*\+\s*_editingId/);
  });

  test('DELETE /admin/students/{id} (delete)', () => {
    assert.match(html, /window\.api\.delete\(\s*['"]\/admin\/students\/['"]\s*\+\s*id/);
  });

  test('POST /admin/students/import (CSV upload)', () => {
    assert.match(html, /window\.api\.upload\(\s*['"]\/admin\/students\/import['"]/);
  });

  test('GET /admin/writing/students/{id}/summary (Phase 2.5 summary modal)', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/writing\/students\/['"]\s*\+\s*studentId\s*\+\s*['"]\/summary['"]/);
  });
});


describe('admin-students.html / form payload preserved', () => {
  test('payload always includes student_code + full_name', () => {
    const block = html.match(/handleSave[\s\S]*?try\s*\{/);
    assert.ok(block);
    assert.match(block[0], /student_code\s*:/);
    assert.match(block[0], /full_name\s*:/);
  });

  test('optional payload keys conditional on non-empty input', () => {
    for (const key of ['target_band', 'current_band_estimate', 'target_date', 'persona_notes']) {
      assert.match(html, new RegExp(`payload\\.${key}\\s*=`), `Missing optional payload assignment: ${key}`);
    }
  });
});


describe('admin-students.html / Phase 2.5 summary modal contract preserved', () => {
  test('summary modal opens via openSummary(studentId, fallbackName)', () => {
    assert.match(html, /function\s+openSummary\(\s*studentId\s*,\s*fallbackName\s*\)/);
  });

  test('4 stat fields populated: total / graded / flagged / avg-band', () => {
    for (const field of ['stat-total', 'stat-graded', 'stat-flagged', 'stat-avg-band']) {
      assert.match(html, new RegExp(`getElementById\\(\\s*['"]${field}['"]\\s*\\)\\.textContent`), `Missing population for #${field}`);
    }
  });

  test('summary stats source fields preserved (total_essays, graded_count, flagged_count, average_band_last5)', () => {
    for (const f of ['total_essays', 'graded_count', 'flagged_count', 'average_band_last5']) {
      assert.match(html, new RegExp(`st\\.${f}`), `Missing st.${f} source`);
    }
  });

  test('_bandFromEssay handles both array and object writing_feedback shapes', () => {
    assert.match(html, /Array\.isArray\(fb\)\s*&&\s*fb\.length/);
    assert.match(html, /fb\s*&&\s*typeof\s+fb\s*===\s*['"]object['"]/);
  });

  test('Escape key closes summary modal', () => {
    assert.match(html, /e\.key\s*===\s*['"]Escape['"]/);
    assert.match(html, /closeSummary\(\)/);
  });
});


describe('admin-students.html / search debounce + delete confirm preserved', () => {
  test('WC.debounce wraps the search handler with 300ms', () => {
    assert.match(html, /WC\.debounce\(function\s*\(\s*\)\s*\{[\s\S]*?_searchValue\s*=\s*document\.getElementById\(\s*['"]search-input['"][\s\S]*?\}\s*,\s*300\)/);
  });

  test('Delete confirm uses Vietnamese with embedded student code', () => {
    assert.match(html, /confirm\(\s*['"]Xóa học viên/);
    assert.match(html, /Tất cả essays của học viên này cũng sẽ bị xóa/);
  });
});


describe('admin-students.html / row action redirect to admin-writing-new.html', () => {
  test('Essay action navigates to admin-writing-new.html?student_id={id}', () => {
    assert.match(html, /\/pages\/admin-writing-new\.html\?student_id=/);
  });

  test('Summary essay rows link to admin-writing-grade.html?essay_id={id}', () => {
    assert.match(html, /\/pages\/admin-writing-grade\.html\?essay_id=/);
  });
});


describe('admin-students.html / body class + theme toggle', () => {
  test('body uses av-page', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
  });

  test('canonical theme toggle present', () => {
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });
});


describe('admin-students.html / Vietnamese microcopy preserved', () => {
  const phrases = [
    'Students',
    'Quản lý profile + theo dõi lịch sử bài viết',
    'Import CSV',
    'New Student',
    'Tìm theo mã hoặc tên',
    'học viên',
    'Đang tải…',
    'Chưa có học viên.',
    'Tổng quan',
    'New Essay',
    'Edit',
    'Delete',
    'Mã học viên',
    'Họ và tên',
    'Target Band',
    'Current Band',
    'Target Date',
    'Persona Notes',
    'Cancel',
    'Save',
    'Đóng',
    'Tổng bài',
    'Đã chấm',
    'Flagged',
    'Avg band 5 bài gần nhất',
    'Bài viết gần đây',
    'Đề bài giao gần đây',
    'Chưa có bài viết.',
    'Chưa có bài giao.',
    'Đã cập nhật học viên.',
    'Đã tạo học viên mới.',
    'Đã xóa học viên.',
    'Tất cả essays của học viên này cũng sẽ bị xóa',
    'Import xong:',
    'Không tải được danh sách:',
    'Không tải được tổng quan:',
    'Under review',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});


describe('admin-writing.css / Sprint 6.14b table + stat-card primitives defined', () => {
  test('aw-table semantic primitives defined', () => {
    for (const sel of ['.aw-table', '.aw-table__code', '.aw-table__empty', '.aw-table__row-count']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('aw-stat-card + aw-stat-num + aw-stat-label primitives defined', () => {
    for (const sel of ['.aw-stat-card', '.aw-stat-num', '.aw-stat-num--flagged', '.aw-stat-label']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('aw-summary-list primitives defined', () => {
    for (const sel of ['.aw-summary-list', '.aw-summary-list__empty', '.aw-summary-section-heading']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)));
    }
  });

  test('aw-mini-pill defined (flagged + plain)', () => {
    assert.match(css, /\.aw-mini-pill\b/);
    assert.match(css, /\.aw-mini-pill--flagged\b/);
  });

  test('aw-file-button + aw-search-meta defined', () => {
    assert.match(css, /\.aw-file-button\b/);
    assert.match(css, /\.aw-search-meta\b/);
  });

  test('stat numbers + table code use mono font (tnum)', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.aw-stat-num', '.aw-table__code']) {
      const escaped = sel.replace(/[.\-]/g, m => '\\' + m);
      const block = stripped.match(new RegExp('^' + escaped + '[^{]*\\{[^}]*\\}', 'm'));
      assert.ok(block, `${sel} block missing`);
      assert.match(block[0], /--av-font-mono/, `${sel} must use --av-font-mono`);
    }
  });
});


describe('admin-writing.css / token discipline (students page)', () => {
  test('no Era B / production-typo hex literals in runtime CSS', () => {
    const runtime = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const h of ['#0a1628', '#14b8a6', '#0d9488', '#14a8ae', '#f87171', '#fbbf24', '#5eead4']) {
      assert.ok(!runtime.includes(h), `runtime CSS should not contain ${h}`);
    }
  });

  test('--av-text-faint usage stays under the 10-instance cap (this page only)', () => {
    const total = (html.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint on this page ≤ 10, got ${total}`);
  });
});
