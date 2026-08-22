import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignmentFilters, assignmentHref, assignmentPrefill, groupAssignments, normalizeAssignmentList,
  normalizeCreateReceipt, normalizeFanoutReceipt, receiptMatchesVerification,
  normalizeStoredAssignmentReceipt, normalizeStoredAssignmentRequest, isDefinitiveClientRejection, validateAssignmentDraft,
} from '../lib/admin-writing-assignments-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-writing-assignments)', 'admin', 'writing', 'assignments', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-writing-assignments)', 'admin', 'writing', 'assignments', 'admin-writing-assignments.tsx');
const LAYOUT = read('app', '(authed-admin-writing-assignments)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-writing-assignments-next.css');
const CONFIG = read('next.config.ts'); const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const HUB = read('app', '(authed-admin-writing)', 'admin', 'writing', 'page.tsx'); const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');

const raw = { id: 'a1', status: 'pending', prompt_id: 'p1', student_id: 's1', assignment_group_id: 'g1', name: 'Buổi 2', created_at: '2026-08-13T00:00:00Z', deadline: null, essay_id: null, is_timed: true, time_limit_minutes: 40, writing_prompts: { id: 'p1', title: '<img onerror=x>', task_type: 'task2', difficulty: 'intermediate' }, students: { id: 's1', student_code: 'S001', full_name: 'Lan' } };

describe('Admin Writing Assignments native model', () => {
  test('normalizes strict list envelope, drops malformed and duplicate identity', () => {
    const list = normalizeAssignmentList({ assignments: [raw, raw, { bad: true }], capped: true });
    assert.equal(list.rows.length, 1); assert.equal(list.rows[0].promptTitle, '<img onerror=x>'); assert.equal(list.malformedCount, 2); assert.equal(list.capped, true);
    assert.equal(normalizeAssignmentList({ assignments: [raw] }), null);
    assert.equal(normalizeAssignmentList({ assignments: [{ ...raw, status: 'done' }], capped: false }).rows.length, 0);
    assert.equal(normalizeAssignmentList({ assignments: [{ ...raw, is_timed: false }], capped: false }).rows.length, 0);
  });

  test('groups by canonical give id and preserves standalone rows', () => {
    const second = normalizeAssignmentList({ assignments: [{ ...raw, id: 'a2', student_id: 's2' }, { ...raw, id: 'a3', assignment_group_id: null }], capped: false }).rows;
    const groups = groupAssignments([normalizeAssignmentList({ assignments: [raw], capped: false }).rows[0], ...second]);
    assert.equal(groups.length, 2); assert.equal(groups[0].rows.length, 2); assert.equal(groups[1].key, 'single:a3');
  });

  test('pins URL filters and server limits before review', () => {
    assert.deepEqual(assignmentFilters({ status: 'bad', cohort: ' c1 ', q: ' Lan ' }), { status: 'all', cohort: 'c1', q: 'Lan' });
    assert.equal(assignmentHref({ status: 'submitted', cohort: 'c1', q: 'Lan' }), '/admin/writing/assignments?status=submitted&cohort=c1&q=Lan');
    assert.equal(validateAssignmentDraft({ mode: 'individual', isTimed: false, deadline: '' }, 1, 0, 0).ok, false);
    assert.equal(validateAssignmentDraft({ mode: 'individual', isTimed: true, timeLimitMinutes: '181', deadline: '' }, 1, 1, 0).ok, false);
    assert.equal(validateAssignmentDraft({ mode: 'cohort', cohortId: 'c1', isTimed: false, deadline: '' }, 2, 0, 7).expectedCount, 14);
  });

  test('builds one canonical prefill contract without mixing individual and cohort targets', () => {
    assert.deepEqual(assignmentPrefill({ assign_student: ' s1 ', prompt_id: ' p1 ' }), { studentId: 's1', cohortId: '', promptId: 'p1', conflict: false });
    assert.deepEqual(assignmentPrefill({ assign_cohort: ' c1 ', prompt_id: 'p1' }), { studentId: '', cohortId: 'c1', promptId: 'p1', conflict: false });
    assert.deepEqual(assignmentPrefill({ assign_student: 's1', assign_cohort: 'c1' }), { studentId: '', cohortId: '', promptId: '', conflict: true });
    assert.equal(assignmentHref({}, { studentId: 's1', promptId: 'p1' }), '/admin/writing/assignments?assign_student=s1&prompt_id=p1');
    assert.equal(assignmentHref({}, { cohortId: 'c1' }), '/admin/writing/assignments?assign_cohort=c1');
    assert.equal(assignmentHref({}, { studentId: 's1', cohortId: 'c1' }), '/admin/writing/assignments');
  });

  test('accepts only exact immutable mutation receipts and matching readback', () => {
    const requestId = '00000000-0000-4000-8000-000000000123';
    const receipt = normalizeCreateReceipt({ count: 2, group_id: 'g1', created: [{ id: 'a1' }, { id: 'a2' }], duplicates_warning: ['s1'] }, 2, requestId);
    assert.equal(receipt.createdCount, 2); assert.equal(normalizeCreateReceipt({ count: 1, group_id: 'g1', created: [{ id: 'a1' }], duplicates_warning: [] }, 2), null);
    assert.equal(normalizeFanoutReceipt({ student_count: 1, created_count: 2, group_id: 'g1', assignment_ids: ['a1', 'a2'], duplicates_warning: [] }, 1, 2, requestId).firstId, 'a1');
    assert.equal(normalizeFanoutReceipt({ student_count: 2, created_count: 2, group_id: 'g1', assignment_ids: ['a1', 'a2'], duplicates_warning: [] }, 1, 2), null);
    assert.deepEqual(receiptMatchesVerification({ request_id: requestId, group_id: 'g1', expected_count: 2, assignment_ids: ['a2', 'a1'] }, receipt).assignmentIds, ['a1', 'a2']);
    assert.equal(receiptMatchesVerification({ request_id: requestId, group_id: 'g1', expected_count: 2, assignment_ids: ['a1'] }, receipt), null);
    assert.deepEqual(normalizeStoredAssignmentReceipt(receipt), receipt); assert.equal(normalizeStoredAssignmentReceipt({ createdCount: 2 }), null);
    const request = { requestId: '00000000-0000-4000-8000-000000000123', path: '/admin/writing/assignments', mode: 'individual', expectedStudents: 1, expectedCount: 1, body: { request_id: '00000000-0000-4000-8000-000000000123', prompt_ids: ['p1'], student_ids: ['s1'] } };
    assert.deepEqual(normalizeStoredAssignmentRequest(request), request); assert.equal(normalizeStoredAssignmentRequest({ ...request, path: '/evil' }), null);
    assert.equal(isDefinitiveClientRejection(400), true); assert.equal(isDefinitiveClientRejection(422), true); assert.equal(isDefinitiveClientRejection(408), false); assert.equal(isDefinitiveClientRejection(429), false); assert.equal(isDefinitiveClientRejection(503), false);
  });
});

describe('/admin/writing/assignments native ownership and safety', () => {
  test('owns clean route while preserving direct rollback HTML', () => {
    assert.match(PAGE, /function AdminWritingAssignmentsPage/); assert.match(PAGE, /<AdminAccessGate>/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing\/assignments['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'assignments.html')));
    assert.match(CHROME, /slug:\s*'assignments'[^\n]+href:\s*'\/admin\/writing\/assignments'/);
    assert.match(HUB, /Gán bài tập[^\n]+NATIVE/); assert.match(LEDGER, /`\/admin\/writing\/assignments`[^\n]+authed-admin-writing-assignments[^\n]+native React ownership/);
  });

  test('uses source-specific errors and readback-only retry after exact ACK', () => {
    assert.match(COMPONENT, /Promise\.allSettled/); assert.match(COMPONENT, /sourceErrors\.students/); assert.match(COMPONENT, /sourceErrors\.cohorts/); assert.match(COMPONENT, /sourceErrors\.prompts/);
    assert.match(COMPONENT, /awa-pending-request:/); assert.match(COMPONENT, /crypto\.randomUUID\(\)/); assert.match(COMPONENT, /receiptMatchesVerification/); assert.match(COMPONENT, /const canonical = await loadList\(true\)/);
    assert.match(COMPONENT, /Thử đối chiếu lại/); assert.match(COMPONENT, /isDefinitiveClientRejection\(statusCode\)/); assert.match(COMPONENT, /Không có bài nào được tạo từ yêu cầu cũ/); assert.doesNotMatch(COMPONENT, /window\.confirm|window\.alert|\bconfirm\(/);
  });

  test('validates student, cohort and prompt prefills against loaded canonical options', () => {
    for (const token of ['assign_student', 'assign_cohort', 'prompt_id', 'optionsReady', 'Không tìm thấy học viên', 'Không tìm thấy lớp', 'Không tìm thấy đề Writing']) assert.ok(COMPONENT.includes(token), token);
    assert.match(COMPONENT, /sourceErrors\.students/);
    assert.match(COMPONENT, /sourceErrors\.cohorts/);
    assert.match(COMPONENT, /sourceErrors\.prompts/);
    assert.match(COMPONENT, /window\.history\.replaceState\(window\.history\.state, '', cleanHref\)/);
    assert.match(COMPONENT, /`student:\$\{prefill\.studentId\}\|cohort:\$\{prefill\.cohortId\}\|prompt:\$\{prefill\.promptId\}`/);
    assert.match(COMPONENT, /if \(prefill\.conflict\)[\s\S]*deepLinkHandled\.current = prefillKey;[\s\S]*setSelectedStudents\(new Set\(\)\); setSelectedPrompts\(new Set\(\)\)/);
    assert.match(COMPONENT, /if \(sourceError\)[\s\S]*deepLinkHandled\.current = prefillKey;[\s\S]*setSelectedStudents\(new Set\(\)\); setSelectedPrompts\(new Set\(\)\)/);
    assert.match(COMPONENT, /deepLinkHandled\.current = ''; void loadOptions\(\)/);
    const listEffect = COMPONENT.match(/useEffect\(\(\) => \{ setSnapshot\(null\);[\s\S]*?\}, \[profile\.id, loadList\]\);/)?.[0] || '';
    assert.ok(listEffect);
    assert.doesNotMatch(listEffect, /setOptionsReady\(false\)/);
  });

  test('keeps legacy capabilities and governed responsive interaction', () => {
    for (const token of ['assign_student', 'allow_soft_check', 'time_limit_minutes', 'analysis_level', '/fan-out']) assert.ok(COMPONENT.includes(token), token);
    assert.match(COMPONENT, /Đề × học viên = số bài/); assert.match(COMPONENT, /Danh sách bị giới hạn/); assert.match(COMPONENT, /Dữ liệu bị loại/);
    assert.match(CSS, /min-height:44px/); assert.match(CSS, /@media\(max-width:720px\)/); assert.match(CSS, /@media\(max-width:430px\)/); assert.match(CSS, /:focus-visible/); assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    for (const style of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-writing-assignments-next.css']) assert.ok(LAYOUT.includes(style));
  });
});
