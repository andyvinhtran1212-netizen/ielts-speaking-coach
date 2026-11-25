/**
 * frontend/tests/admin-students-redesign.test.mjs — Sprint 6.14b.
 *
 * Pinned the migration of the admin students page (table + edit/create dialog
 * + Phase 2.5 summary). LEGACYJS-0075 W3b: admin-students-panel.js is deleted
 * and the merged legacy page is a retired fixture. The surviving invariants —
 * Vietnamese five-column table, merged goal cell, no decorative emoji, the
 * canonical endpoints, 300 ms search debounce, one cohort read and the WF-1
 * bulk assignment — are pinned on the native owner,
 * app/(authed-admin)/(students)/admin/students/admin-students-directory.tsx.
 * Legacy-only pins (WC.bootstrap, the 36 DOM ids, data-act values, English
 * microcopy) retired with the file; behaviour is covered by
 * admin-students-next-behavior.test.mjs and verify-admin-students-flow.mjs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { formatBandGoal } from '../lib/admin-students-model.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const DIR = read('frontend/app/(authed-admin)/(students)/admin/students/admin-students-directory.tsx');
const css = read('frontend/css/admin-writing.css');

describe('/admin/students — legacy panel retired', () => {
  test('admin-students-panel.js no longer ships', () => {
    assert.equal(existsSync(path.join(REPO_ROOT, 'frontend/public/js/admin-students-panel.js')), false);
  });
});

describe('/admin/students — table contract', () => {
  test('thead: selection + 5 Vietnamese columns in order', () => {
    const thead = DIR.match(/<table className="acd-table asd-table"><thead>([\s\S]*?)<\/thead>/);
    assert.ok(thead, 'students table not found');
    const cols = [...thead[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim());
    assert.deepEqual(cols, ['', 'Học viên', 'Lớp', 'Tài khoản', 'Mục tiêu', 'Thao tác']);
  });

  test('goal cell merges current, target and date without dropping one', () => {
    assert.equal(formatBandGoal({ current_band_estimate: 5.5, target_band: 7 }), '5.5 → 7');
    assert.equal(formatBandGoal({ current_band_estimate: null, target_band: 7 }), '? → 7');
    // Nothing set reads as one state, not three broken dashes.
    assert.equal(formatBandGoal({ current_band_estimate: null, target_band: null }), 'Chưa đặt');
    assert.match(DIR, /<strong>\{formatBandGoal\(student\)\}<\/strong>\{student\.target_date && <span>\{dateLabel\(student\.target_date\)\}<\/span>\}/);
  });

  test('row actions are Vietnamese and the name opens the profile', () => {
    for (const vi of ['>Giao bài Writing<', '>Gửi bài chấm<', '>Sửa<', '>Lưu trữ<']) assert.ok(DIR.includes(vi), `thiếu ${vi}`);
    for (const en of ['New Essay', '>Edit<', '>Delete<', 'Under review', '>Flagged<', 'Admin Access Required']) {
      assert.ok(!DIR.includes(en), `còn tiếng Anh: ${en}`);
    }
    assert.match(DIR, /className="asd-student-name" type="button" onClick=\{\(\) => void openProfile\(student\)\}/);
  });

  test('no decorative emoji', () => {
    assert.doesNotMatch(DIR, /[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('/admin/students — endpoints preserved', () => {
  test('list, detail, create, edit, archive, import and summary', () => {
    assert.match(DIR, /getAdminStudents\(\{ limit: LIMIT, search: search \|\| undefined/);
    assert.match(DIR, /window\.api\.get<unknown>\(`\/admin\/students\/\$\{encodeURIComponent\(student\.id\)\}`\)/);
    assert.match(DIR, /window\.api\.post\('\/admin\/students'/);
    assert.match(DIR, /window\.api\.patch\(`\/admin\/students\/\$\{encodeURIComponent\(draft\.id/);
    assert.match(DIR, /window\.api\.delete\(archiveStudentPath\(student\.id/);
    assert.match(DIR, /window\.api\.upload<[^>]+>\('\/admin\/students\/import'/);
    assert.match(DIR, /\/admin\/writing\/students\/\$\{encodeURIComponent\(student\.id\)\}\/summary/);
  });
  test('search is debounced 300 ms', () => {
    assert.match(DIR, /window\.setTimeout\(\(\) => setDebouncedQuery\(query\.trim\(\)\), 300\)/);
  });
  test('summary stats read the canonical fields', () => {
    for (const f of ['total_essays', 'graded_count', 'flagged_count', 'average_band_last5']) {
      assert.match(DIR, new RegExp(`stats\\.${f} \\?\\? '—'`));
    }
  });
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
    const total = (DIR.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint on this page ≤ 10, got ${total}`);
  });
});


describe('/admin/students — WF-1 Lớp column + bulk-assign', () => {
  test('Lớp cell lists every cohort and keeps lookup failure visible', () => {
    assert.match(DIR, /aria-label=\{`Các lớp của \$\{student\.full_name\}`\}/);
    assert.match(DIR, /⚠ lookup failed/);
  });
  test('bulk bar POSTs student_ids to /students/bulk', () => {
    assert.match(DIR, /window\.api\.post<\{ assigned\?: number \}>\(`\/admin\/cohorts\/\$\{encodeURIComponent\(bulkCohort\)\}\/students\/bulk`, \{ student_ids: \[\.\.\.selected\] \}\)/);
  });
  test('cohort dropdown read once from the active cohorts (no N+1)', () => {
    assert.equal((DIR.match(/getAdminCohorts\(/g) || []).length, 1);
    assert.match(DIR, /getAdminCohorts\(\{ isActive: true \}\)/);
  });
});

import { readFileSync as _rf } from 'node:fs';
const USERS_HTML = _rf(path.join(REPO_ROOT, 'frontend/pages/admin/users/index.html'), 'utf8');
// LEGACYJS-0075 W3a: admin-users.js is deleted; the users table is the Next panel.
const USERS_JS   = _rf(path.join(REPO_ROOT, 'frontend/app/(authed-admin)/(users)/admin/users/admin-users-panel.tsx'), 'utf8');

describe('admin/users — WF-1 Lớp column', () => {
  test('users table has a Lớp header + the Next panel renders cohort names with "—"', () => {
    assert.match(USERS_HTML, /<th>Lớp<\/th>/);
    assert.match(USERS_JS, /onSort=\{sortBy\}>Lớp<\/SortButton><\/th>/);
    assert.match(USERS_JS, /user\.cohort_name \|\| '—'/);
  });
});
