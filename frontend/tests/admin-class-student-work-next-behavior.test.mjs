import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeStudentWork, studentWorkAction } from '../lib/admin-class-student-work-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const UI = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-student-work.tsx');
const DETAIL = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx');
const SUBMISSIONS = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-submissions.tsx');
const DIALOG = read('components', 'admin-directory-ui.tsx');
const LAYOUT = read('app', '(authed-admin-classes)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-class-student-work-next.css');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const BROWSER = read('tooling', 'verify-admin-class-student-work-flow.mjs');

describe('admin class student work model', () => {
  test('keeps canonical status, unknown score and partial-read warning', () => {
    const out = normalizeStudentWork({
      student: { id: 's1', name: '<img>', student_code: 'A01', activated: true },
      homework_stale: true,
      items: [
        { assignment_id: 'a1', title: 'Speaking', skill: 'speaking', status: 'late', score: null, artifact_kind: 'session', artifact_id: 'sess 1' },
        { assignment_id: 'a2', title: 'Grammar', skill: 'course', status: 'submitted', score: '68', has_writing: true, bank_id: 'bank-1' },
        { title: 'Malformed', skill: 'course' },
      ],
    }, 's1');
    assert.equal(out.homework_stale, true);
    assert.equal(out.items[0].score, null);
    assert.equal(out.items[1].score, 68);
    assert.equal(out.discarded_item_count, 1);
  });

  test('rejects malformed and cross-student payloads', () => {
    assert.equal(normalizeStudentWork({ student: { id: 'other' }, items: [] }, 's1'), null);
    assert.equal(normalizeStudentWork({ student: { id: 's1' }, items: null }, 's1'), null);
  });

  test('only returns an action when a real artifact can be opened', () => {
    assert.deepEqual(studentWorkAction({ artifact_kind: 'session', artifact_id: 'a/b' }), { kind: 'external', label: 'Nghe bài', href: '/admin/speaking/sessions?session=a%2Fb' });
    assert.deepEqual(studentWorkAction({ has_writing: true }), { kind: 'writing', label: 'Xem tự luận' });
    assert.deepEqual(studentWorkAction({ bank_id: 'bank', artifact_id: 'attempt' }), { kind: 'report', label: 'Xem từng câu' });
    assert.equal(studentWorkAction({ bank_id: 'bank', artifact_id: null }), null);
  });
});

describe('admin class student work integration', () => {
  test('opens from roster and progress, owns URL state and uses one canonical endpoint', () => {
    assert.equal((DETAIL.match(/>Xem bài<\/button>/g) || []).length, 2);
    assert.match(DETAIL, /params\.get\('student_id'\)/);
    assert.match(DETAIL, /url\.searchParams\.set\('student_id', subject\.student_id\)/);
    assert.match(UI, /\/students\/\$\{encodeURIComponent\(subject\.student_id\)\}\/work/);
    assert.match(UI, /normalizeStudentWork/);
    assert.match(UI, /const requestId = \+\+sequence\.current/);
    assert.match(UI, /requestId !== sequence\.current/);
  });

  test('routes real artifacts to the existing canonical review surfaces', () => {
    assert.match(UI, /studentWorkAction\(item\)/);
    assert.match(UI, /target="_blank" rel="noopener noreferrer"/);
    assert.match(UI, /onOpenAssignment\(assignmentFrom\(item\)/);
    assert.match(DETAIL, /initialStudent=\{markingStudent\}/);
    assert.match(SUBMISSIONS, /initialStudent\) await openStudent\(initialStudent\)/);
    assert.match(DETAIL, /Quay lại bài của/);
    assert.match(DETAIL, /Học viên này không có phần trong bài giao của liên kết/);
    assert.match(DETAIL, /const item = normalized\?\.items\.find/);
  });

  test('keeps empty, failed, stale and malformed states truthful', () => {
    assert.match(UI, /Không đọc được bài mới nhất/);
    assert.match(UI, /Chưa được giao bài nào/);
    assert.match(UI, /data\.homework_stale/);
    assert.match(UI, /data\.discarded_item_count > 0/);
    assert.match(UI, /Chưa có bài để mở/);
    assert.doesNotMatch(UI, /dangerouslySetInnerHTML|\.innerHTML|window\.confirm|alert\(/);
  });

  test('ships an accessible responsive dialog and updates route ownership', () => {
    assert.match(DIALOG, /panelClassName/);
    assert.match(DIALOG, /role="dialog" aria-modal="true"/);
    assert.match(LAYOUT, /admin-class-student-work-next\.css/);
    assert.match(CSS, /@media \(max-width: 680px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(LEDGER, /student-centric cross-assignment work-history ownership/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-class-student-work-flow\.mjs/);
    assert.match(BROWSER, /unexpectedWrites/);
  });
});
