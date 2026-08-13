import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cellMatchesFilter, cohortFilters, cohortHref, cohortMatches,
  isOverdue, normalizeCohortDetail, normalizeCohortList,
} from '../lib/admin-writing-cohorts-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-writing-cohorts)', 'admin', 'writing', 'cohorts', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-writing-cohorts)', 'admin', 'writing', 'cohorts', 'admin-writing-cohorts.tsx');
const LAYOUT = read('app', '(authed-admin-writing-cohorts)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-writing-cohorts-next.css'); const CONFIG = read('next.config.ts');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const HUB = read('app', '(authed-admin-writing)', 'admin', 'writing', 'page.tsx'); const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');

const listRow = { id: 'c1', name: '<img onerror=x>', description: 'Khoá 1', student_count: 2, active_assignments: 3, essays_pending: 1, essays_delivered: 2 };
const detail = { cohort: { id: 'c1', name: 'Lớp A', description: null, student_count: 1 }, students: [{ id: 's1', full_name: 'Lan', student_code: 'S1' }], assignments: [
  { id: 'group:g1:prompt:p1', prompt_id: 'p1', group_id: 'g1', name: 'Buổi 1', title: 'Đề lặp', task_type: 'task2', assigned_at: '2026-08-01T00:00:00Z' },
  { id: 'group:g2:prompt:p1', prompt_id: 'p1', group_id: 'g2', name: 'Buổi 2', title: 'Đề lặp', task_type: 'task2', assigned_at: '2026-08-08T00:00:00Z' },
], matrix: { s1: {
  'group:g1:prompt:p1': { assignment_id: 'a1', status: 'delivered', essay_id: 'e1', deadline: null, updated_at: null, band: 7 },
  'group:g2:prompt:p1': { assignment_id: 'a2', status: 'submitted', essay_id: 'e2', deadline: '2026-08-10T00:00:00Z', updated_at: null, band: null },
} }, stats: { students: 1, assignments: 2, essays_pending: 1, essays_delivered: 1, overdue: 1 } };

describe('Admin Writing Cohorts native model', () => {
  test('normalizes list strictly and reports malformed identities', () => {
    const result = normalizeCohortList({ cohorts: [listRow, listRow, { bad: true }] });
    assert.equal(result.rows.length, 1); assert.equal(result.malformedCount, 2); assert.equal(result.rows[0].name, '<img onerror=x>');
    assert.equal(normalizeCohortList([]), null);
  });
  test('preserves two gives of the same prompt as separate columns', () => {
    const result = normalizeCohortDetail(detail);
    assert.deepEqual(result.columns.map((column) => column.id), ['group:g1:prompt:p1', 'group:g2:prompt:p1']);
    assert.equal(result.matrix.s1['group:g1:prompt:p1'].band, 7);
    assert.equal(normalizeCohortDetail({ ...detail, stats: {} }), null);
  });
  test('pins shareable filters and exact operational lanes', () => {
    assert.deepEqual(cohortFilters({ cohort: ' c1 ', status: 'bad', activity: 'active', q: ' Lan ' }), { cohort: 'c1', status: 'all', activity: 'active', q: 'Lan' });
    assert.equal(cohortHref({ cohort: 'c1', status: 'overdue', activity: 'active', q: 'Lan' }), '/admin/writing/cohorts?cohort=c1&status=overdue&activity=active&q=Lan');
    assert.equal(cohortMatches({ ...normalizeCohortList({ cohorts: [listRow] }).rows[0] }, { activity: 'active', q: 'khoá' }), true);
    const cell = normalizeCohortDetail(detail).matrix.s1['group:g2:prompt:p1'];
    assert.equal(isOverdue(cell, Date.parse('2026-08-13T00:00:00Z')), true); assert.equal(cellMatchesFilter(cell, 'needs_grade'), true); assert.equal(cellMatchesFilter(cell, 'delivered'), false);
    assert.equal(isOverdue({ ...cell, status: 'flagged' }, Date.parse('2026-08-13T00:00:00Z')), false);
  });
});

describe('/admin/writing/cohorts native ownership and UX', () => {
  test('owns clean route and preserves rollback artifact', () => {
    assert.match(PAGE, /function AdminWritingCohortsPage/); assert.match(PAGE, /<AdminAccessGate>/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing\/cohorts['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'cohorts.html')));
    assert.match(HUB, /Lớp học[^\n]+NATIVE/); assert.match(LEDGER, /`\/admin\/writing\/cohorts`[^\n]+authed-admin-writing-cohorts[^\n]+native React ownership/);
  });
  test('renders canonical stale/malformed truth and only essay-backed actions', () => {
    assert.match(COMPONENT, /Snapshot cũ|snapshot cũ/); assert.match(COMPONENT, /sai contract/); assert.match(COMPONENT, /cell\.essayId \?/);
    assert.match(COMPONENT, /params\?\.get\('cohort'\) \|\| params\?\.get\('cohort_id'\)/);
    assert.match(COMPONENT, /\/admin\/writing\/grade\?essay_id=/); assert.doesNotMatch(COMPONENT, /window\.alert|window\.confirm|\bconfirm\(/);
  });
  test('uses governed accessible responsive layout', () => {
    for (const style of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-writing-cohorts-next.css']) assert.ok(LAYOUT.includes(style));
    assert.match(CSS, /min-height:44px/); assert.match(CSS, /@media\(max-width:800px\)/); assert.match(CSS, /@media\(max-width:560px\)/); assert.match(CSS, /:focus-visible/); assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /verify-admin-writing-cohorts-flow\.mjs/);
  });
});
