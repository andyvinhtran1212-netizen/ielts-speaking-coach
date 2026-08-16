import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildExamCreatePayload,
  configuredSections,
  filterContentByLevel,
  localDateTimeIn,
  localToIso,
  nextExamSection,
  normalizeAssignments,
  normalizeExamContent,
  normalizeExamList,
  normalizeProgress,
  normalizeRetestSummary,
  retakeServableSkills,
} from '../lib/admin-mock-exams-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-mock-exams)', 'admin', 'mock-exams', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-mock-exams)', 'admin', 'mock-exams', 'admin-mock-exams.tsx');
const ASSIGN = read('app', '(authed-admin-mock-exams)', 'admin', 'mock-exams', 'retake-assignment-dialog.tsx');
const CONTENT = read('app', '(authed-admin-mock-exams)', 'admin', 'mock-exams', 'exam-content-library.tsx');
const CSS = read('public', 'css', 'admin-mock-exams-next.css');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

const examRaw = {
  id: 'exam-1', code: 'M1', title: 'Mock 1', status: 'published', exam_mode: 'sequential',
  is_open: true, active_section: 'listening', cohort_id: 'class-1', listening_test_id: 'lis-1',
  reading_test_id: 'read-1', writing_task1_prompt_id: 'w1', writing_task2_prompt_id: 'w2',
};

describe('Admin Mock Exams native model', () => {
  test('keeps canonical exam identity and rejects duplicate or invalid contract rows', () => {
    const result = normalizeExamList({ exams: [examRaw, examRaw, { id: 'bad', status: 'mystery' }, { title: 'missing id' }] });
    assert.equal(result.rows.length, 1);
    assert.equal(result.malformedCount, 3);
    assert.equal(normalizeExamList({ items: [examRaw] }), null);
  });

  test('derives configured sequence without opening absent L/R sections', () => {
    const exam = normalizeExamList({ exams: [examRaw] }).rows[0];
    assert.deepEqual(configuredSections(exam), ['not_started', 'listening', 'reading', 'writing', 'done']);
    assert.equal(nextExamSection(exam, 'listening'), 'reading');
    assert.deepEqual(configuredSections({ readingTestId: 'r' }), ['not_started', 'reading', 'writing', 'done']);
    assert.deepEqual(retakeServableSkills({ readingTestId: 'r' }), ['reading', 'writing']);
  });

  test('requires canonical create fields and sequential cohort', () => {
    assert.deepEqual(buildExamCreatePayload({ code: '', title: '' }), { ok: false, error: 'Nhập mã đề và tiêu đề.' });
    assert.equal(buildExamCreatePayload({ code: 'M1', title: 'One', examMode: 'sequential' }).ok, false);
    const retake = buildExamCreatePayload({ code: 'R1', title: 'Retake', examMode: 'retake', totalMinutes: 0 });
    assert.equal(retake.ok, true);
    assert.equal(retake.value.cohort_id, null);
    assert.equal(retake.value.total_minutes, 150);
  });

  test('normalizes progress, assignments and retest candidates', () => {
    assert.deepEqual(normalizeProgress({ active_section: 'reading', sections: { reading: { submitted: 4, total: 7 } } }).sections.reading, { submitted: 4, total: 7 });
    assert.equal(normalizeProgress({ active_section: 'invented' }), null);
    assert.deepEqual(normalizeAssignments({ assignments: [{ user_id: 'u1', student_name: 'An', skills: ['reading', 'bad'] }] })[0].skills, ['reading']);
    assert.deepEqual(normalizeRetestSummary({ students: [{ user_id: 'u2', skills: ['writing'] }] })[0].skills, ['writing']);
  });

  test('normalizes cross-library content and preserves explicit empty-level filter', () => {
    const result = normalizeExamContent({
      items: [
        { id: 'r1', kind: 'reading', code: 'R1', course_level: 'C1', cohort_ids: ['c1'], exam_only: true },
        { id: 'w1', kind: 'writing', title: 'Task', course_level: '', cohort_ids: [], exam_only: false },
        { id: '', kind: 'listening' },
      ],
      levels: ['C1'], failed_kinds: ['listening', 'bad'],
    });
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.failedKinds, ['listening']);
    assert.deepEqual(filterContentByLevel(result.rows, '').map((row) => row.id), ['w1']);
    assert.equal(filterContentByLevel(result.rows, null).length, 2);
  });

  test('converts retake windows deterministically', () => {
    assert.equal(localDateTimeIn(1, new Date(2026, 0, 1, 8, 5).getTime()), '2026-01-02T08:05');
    assert.equal(localToIso('not-a-date'), null);
    assert.match(localToIso('2026-01-02T08:05'), /^2026-01-02T/);
  });
});

describe('/admin/mock-exams native ownership and mutation truth', () => {
  test('owns the clean route while preserving a named rollback target', () => {
    assert.match(PAGE, /AdminAccessGate/);
    assert.match(PAGE, /embed=\{embed \? '' : undefined\}/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'mock-exams', 'index.html')));
    assert.match(LEDGER, /`\/admin\/mock-exams`[^\n]+authed-admin-mock-exams[^\n]+native React ownership/);
  });

  test('forces canonical reconciliation and preserves irreversible guards', () => {
    for (const token of ['loadExams(false, true)', 'loadExams(true, true)', 'chưa xác nhận được trạng thái backend', 'from_section: current', 'document.visibilityState', '15_000', 'Không có snapshot tiến độ; thao tác chuyển phần đã bị khóa']) assert.ok(COMPONENT.includes(token), token);
    for (const token of ['open_until: until', 'retakeServableSkills', 'refresh_failed', 'assignmentRequestRef', 'Không xác nhận được assignment sau khi ghi']) assert.ok(ASSIGN.includes(token), token);
    for (const token of ['/admin/exam-content', 'failedKinds', 'cohort_ids: cohortDraft', 'exam_only: false', 'input.value = row.courseLevel']) assert.ok(CONTENT.includes(token), token);
    assert.doesNotMatch(`${COMPONENT}\n${ASSIGN}\n${CONTENT}`, /dangerouslySetInnerHTML|http:\/\/localhost:8000|railway\.app/);
  });

  test('pins responsive evidence in CI', () => {
    for (const token of ['min-height:44px', '@media(max-width:600px)', ':focus-visible', '@media(prefers-reduced-motion:reduce)']) assert.ok(CSS.includes(token), token);
    for (const token of ['frontend/app/(authed-admin-mock-exams)/**', 'frontend/lib/admin-mock-exams-model.mjs', 'verify-admin-mock-exams-flow.mjs', 'node tooling/verify-admin-mock-exams-flow.mjs']) assert.ok(WORKFLOW.includes(token), token);
  });
});
