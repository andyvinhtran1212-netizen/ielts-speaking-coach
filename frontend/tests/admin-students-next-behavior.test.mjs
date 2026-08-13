import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cohortTruth,
  formatBandGoal,
  mergeStudentDetail,
  normalizeStudentsPayload,
  studentDraft,
  studentSummary,
  validateStudentDraft,
} from '../lib/admin-students-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-students)', 'admin', 'students', 'page.tsx');
const DIRECTORY = read('app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx');
const LAYOUT = read('app', '(authed-admin-students)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-students-next.css');
const CLASSES = read('app', '(authed-admin-classes)', 'admin', 'classes', 'admin-classes-directory.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const BROWSER = read('tooling', 'verify-admin-students-flow.mjs');
const MODEL = read('lib', 'admin-students-model.mjs');

describe('/admin/students — native directory ownership', () => {
  test('uses admin gate, native IA and keeps legacy class detail rollback', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /active="classes" subsection="students"/);
    assert.match(CLASSES, /href="\/admin\/students"/);
    assert.match(CHROME, /slug:\s*'students'[^}]*href:\s*'\/admin\/students'/);
    assert.match(LEDGER, /`\/admin\/students`[^\n]+native/);
  });

  test('loads canonical contracts and reconciles every write', () => {
    assert.match(DIRECTORY, /\/admin\/students\?limit=\$\{LIMIT\}/);
    assert.match(DIRECTORY, /'\/admin\/cohorts\?is_active=true'/);
    assert.match(DIRECTORY, /await canonicalReload/);
    assert.match(DIRECTORY, /\/students\/bulk/);
    assert.match(DIRECTORY, /setSelected\(new Set\(\)\);\s*setBulkCohort\(''\);\s*await canonicalReload/);
    assert.match(DIRECTORY, /aria-label="Chọn tất cả học viên trong kết quả"[^>]*disabled=\{busy\}/);
    assert.match(DIRECTORY, /aria-label=\{`Chọn \$\{student\.full_name\}`\}[\s\S]{0,180}?disabled=\{busy\}/);
    assert.match(DIRECTORY, /placeholder="Tên hoặc mã học viên…" disabled=\{busy\}/);
    assert.match(DIRECTORY, />Thử lại<\/button>/);
    assert.match(DIRECTORY, /disabled=\{loading \|\| busy\}>Thử lại/);
    assert.match(DIRECTORY, /window\.api\.upload/);
    assert.match(DIRECTORY, /Promise\.allSettled/);
    assert.doesNotMatch(DIRECTORY, /window\.api\.delete|Xoá học viên/);
    assert.match(DIRECTORY, /href=\{`\/admin\/writing\/new\?student_id=/);
    assert.doesNotMatch(DIRECTORY, /pages\/admin\/writing\/new\.html/);
  });

  test('never turns failed reads into canonical empty/zero states', () => {
    assert.match(DIRECTORY, /hasSnapshot \? summary\.total : null/);
    assert.match(DIRECTORY, /showingStale = Boolean\(loadError && hasSnapshot\)/);
    assert.match(DIRECTORY, /cohort_lookup_failed/);
    assert.match(MODEL, /Không đọc được tên lớp/);
    assert.match(DIRECTORY, /Dữ liệu bên dưới có thể đã cũ/);
    assert.doesNotMatch(DIRECTORY, /dangerouslySetInnerHTML|\.innerHTML/);
  });

  test('ships responsive contained table, focus-safe dialog and CI browser fixture', () => {
    assert.match(CSS, /\.asd-table\s*\{[^}]*min-width/s);
    assert.match(CSS, /@media \(max-width: 768px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(LAYOUT, /admin-students-next\.css/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-students\)\/\*\*/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-students-flow\.mjs/);
    assert.match(BROWSER, /unexpectedWrites/);
    assert.match(BROWSER, /explicit null/);
  });
});

describe('admin students model — canonical truth and drafts', () => {
  const rows = normalizeStudentsPayload([
    { id: 'a', student_code: 'A1', full_name: '<img>', cohort_id: null, target_date: '2026-10-01' },
    { id: 'b', student_code: 'B1', full_name: 'B', cohort_id: 'c1', cohort_name: null, cohort_lookup_failed: true, user_id: 'u1', current_band_estimate: '6.5', target_band: 7.5, target_date: 'bad' },
    { full_name: 'missing id' },
  ]);

  test('normalizes partial payloads without inventing membership truth', () => {
    assert.equal(rows.length, 2);
    assert.equal(rows[0].full_name, '<img>');
    assert.deepEqual(cohortTruth(rows[0]), { kind: 'unassigned', label: 'Chưa xếp lớp' });
    assert.deepEqual(cohortTruth(rows[1]), { kind: 'unknown', label: 'Không đọc được tên lớp' });
    assert.equal(formatBandGoal(rows[1]), '6.5 → 7.5');
  });

  test('summary counts cohort_id and bounded valid target dates', () => {
    assert.deepEqual(studentSummary(rows, new Date('2026-08-12T12:00:00+07:00')), { total: 2, unassigned: 1, upcoming: 1 });
  });

  test('detail keeps the directory cohort enrichment when the detail endpoint omits it', () => {
    const fallback = { ...rows[1], cohort_name: 'Lớp Nền Tảng', cohort_lookup_failed: false };
    const detail = { ...rows[1], cohort_name: null, cohort_lookup_failed: false };
    assert.equal(mergeStudentDetail(detail, fallback).cohort_name, 'Lớp Nền Tảng');
    assert.equal(mergeStudentDetail({ ...detail, cohort_id: 'other' }, fallback).cohort_name, null);
  });

  test('edit draft sends explicit null for every clearable optional field', () => {
    const draft = studentDraft(rows[1]);
    draft.currentBand = '';
    draft.targetBand = '';
    draft.targetDate = '';
    draft.notes = '';
    assert.deepEqual(validateStudentDraft(draft), { ok: true, body: {
      student_code: 'B1', full_name: 'B', target_band: null,
      current_band_estimate: null, target_date: null, persona_notes: null,
    } });
    assert.equal(validateStudentDraft({ ...draft, studentCode: '' }).ok, false);
    assert.equal(validateStudentDraft({ ...draft, targetBand: '10' }).ok, false);
  });
});
