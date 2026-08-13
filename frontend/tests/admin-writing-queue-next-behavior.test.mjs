import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isWritingEssayOverdue,
  normalizeBulkDelivery,
  normalizeSkipGrading,
  normalizeStartGrading,
  normalizeWritingQueueCohorts,
  normalizeWritingQueueFilters,
  normalizeWritingQueueList,
  writingMockMinimum,
  writingQueueApiPath,
  writingQueueDestination,
  writingQueueSearch,
} from '../lib/admin-writing-queue-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-writing-queue)', 'admin', 'writing', 'queue', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-writing-queue)', 'admin', 'writing', 'queue', 'admin-writing-queue.tsx');
const LAYOUT = read('app', '(authed-admin-writing-queue)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-writing-queue-next.css');
const HUB = read('app', '(authed-admin-writing)', 'admin', 'writing', 'page.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const MOCK = read('public', 'js', 'admin-mock-tests.js');
const CONFIG = read('next.config.ts');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

const row = { id: 'e1', student_id: 's1', student_full_name: '<img onerror=x>', student_code: 'A01', task_type: 'task2', status: 'reviewed', analysis_level: 3, selected_model: 'gemini-2.5-pro', word_count: 280, created_at: '2026-08-13T00:00:00Z', deadline: '2026-08-12T00:00:00Z', band: 6.5, task1_image_missing: false };

describe('Admin Writing Queue native model', () => {
  test('normalizes restorable filters and canonical API scope', () => {
    assert.deepEqual(normalizeWritingQueueFilters({ status: 'reviewed', cohort_id: ' c1 ', overdue: '1', embed: '1' }), { lane: 'reviewed', cohortId: 'c1', overdue: true, embed: true });
    assert.equal(writingQueueSearch({ lane: 'reviewed', cohortId: 'c1', overdue: true, embed: false }), 'status=reviewed&cohort_id=c1&overdue=1');
    assert.equal(writingQueueSearch({ lane: 'mock', cohortId: '', overdue: false, embed: true }), 'mocklane=1&embed=1');
    assert.equal(writingQueueApiPath({ lane: 'all', cohortId: 'c/1' }), '/admin/writing/essays?limit=200&mock=false&cohort_id=c%2F1');
    assert.equal(writingQueueApiPath({ lane: 'mock', cohortId: '' }), '/admin/writing/essays?limit=200&mock=true');
    assert.equal(normalizeWritingQueueFilters({ status: 'evil' }).lane, 'graded');
  });

  test('excludes malformed rows without turning them into empty truth', () => {
    const result = normalizeWritingQueueList([row, { ...row, id: 'e2', band: 99 }, { ...row, id: 'e3', deadline: 'not-a-date' }, { nope: true }]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.malformedCount, 3);
    assert.equal(result.returnedCount, 4);
    assert.equal(result.rows[0].studentName, '<img onerror=x>');
    assert.equal(normalizeWritingQueueList({ rows: [] }), null);
    assert.deepEqual(normalizeWritingQueueCohorts({ cohorts: [{ id: 'c1', name: 'Lớp 1' }, { id: '', name: 'bad' }] }), { rows: [{ id: 'c1', name: 'Lớp 1' }], malformedCount: 1 });
  });

  test('pins overdue, Mock minimum and navigation semantics', () => {
    assert.equal(isWritingEssayOverdue(row, Date.parse('2026-08-13T00:00:00Z')), true);
    assert.equal(isWritingEssayOverdue({ ...row, status: 'delivered' }, Date.parse('2026-08-13T00:00:00Z')), false);
    assert.deepEqual([writingMockMinimum('task1_academic'), writingMockMinimum('task2')], [150, 250]);
    assert.equal(writingQueueDestination({ ...row, status: 'grading' }, { lane: 'graded', embed: false }), '/pages/admin/writing/status.html?essay_id=e1');
    assert.equal(writingQueueDestination({ ...row, status: 'pending', grading_skipped_at: '2026-08-13T00:00:00Z', gradingSkippedAt: '2026-08-13T00:00:00Z' }, { lane: 'mock', embed: false }), '/admin/writing/grade?essay_id=e1&mocklane=1');
    assert.equal(writingQueueDestination(row, { lane: 'mock', embed: true }), '/admin/writing/grade?essay_id=e1&embed=1&mocklane=1');
  });

  test('requires exact, fully-accounted mutation acknowledgements', () => {
    assert.deepEqual(normalizeBulkDelivery({ delivered: ['e1'], skipped: [{ id: 'e2', status: 'graded', reason: 'not_reviewed' }], delivered_count: 1, skipped_count: 1 }, ['e1', 'e2']).delivered, ['e1']);
    assert.equal(normalizeBulkDelivery({ delivered: ['e1'], skipped: [], delivered_count: 1, skipped_count: 0 }, ['e1', 'e2']), null);
    assert.ok(normalizeStartGrading({ essay_id: 'e1', status: 'queued', job_id: 'j1' }, 'e1'));
    assert.equal(normalizeStartGrading({ essay_id: 'other', status: 'queued', job_id: 'j1' }, 'e1'), null);
    assert.ok(normalizeSkipGrading({ ok: true, essay_id: 'e1', grading_skipped: true }, 'e1'));
    assert.equal(normalizeSkipGrading({ ok: true, essay_id: 'e1' }, 'e1'), null);
  });
});

describe('/admin/writing/queue native ownership and UX contract', () => {
  test('owns clean route and preserves direct rollback HTML', () => {
    assert.match(PAGE, /function AdminWritingQueuePage/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing\/queue['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'queue.html')));
    assert.ok(HUB.includes("href: '/admin/writing/queue'"));
    assert.ok(HUB.includes("status: 'NATIVE'"));
    assert.match(CHROME, /slug: 'queue'[^\n]+href: '\/admin\/writing\/queue'/);
    assert.match(MOCK, /return '\/admin\/writing\/queue\?embed=1&mocklane=1'/);
    assert.match(LEDGER, /`\/admin\/writing\/queue`[^\n]+authed-admin-writing-queue[^\n]+native React ownership/);
  });

  test('uses backend truth, stale guards, accessible dialog and readback', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="queue"/);
    assert.match(COMPONENT, /queueSequence/);
    assert.match(COMPONENT, /cohortSequence/);
    assert.match(COMPONENT, /profileId\.current !== account/);
    assert.match(COMPONENT, /currentViewKey\.current === key/);
    assert.match(COMPONENT, /mutationSequence\.current !== operationId/);
    assert.match(COMPONENT, /snapshot\?\.key === keyedFetch/);
    assert.match(COMPONENT, /normalizeBulkDelivery/);
    assert.match(COMPONENT, /await loadQueue\(filters, true\)/);
    assert.match(COMPONENT, /<Dialog open=/);
    assert.doesNotMatch(COMPONENT, /\balert\(|\bconfirm\(|dangerouslySetInnerHTML/);
  });

  test('loads governed responsive styles and CI browser verifier', () => {
    for (const style of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-writing-queue-next.css']) assert.ok(LAYOUT.includes(style));
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /@media\(max-width:480px\)/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /authed-admin-writing-queue/);
    assert.match(WORKFLOW, /verify-admin-writing-queue-flow\.mjs/);
  });
});
