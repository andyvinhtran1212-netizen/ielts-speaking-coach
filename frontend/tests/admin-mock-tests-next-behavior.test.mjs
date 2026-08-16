import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterMockExams,
  mockExamStage,
  mockTestsFrame,
  mockTestsHref,
  mockTestsTab,
  normalizeMockExamList,
} from '../lib/admin-mock-tests-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-mock-tests)', 'admin', 'mock-tests', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-mock-tests)', 'admin', 'mock-tests', 'admin-mock-tests.tsx');
const LAYOUT = read('app', '(authed-admin-mock-tests)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-mock-tests-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

const rows = [
  { id: 'd1', code: 'DRAFT', title: 'Đề nháp', status: 'draft', is_open: false, active_section: 'not_started', exam_mode: 'sequential' },
  { id: 'l1', code: 'LIVE', title: 'Đang thi', status: 'published', is_open: true, active_section: 'reading', exam_mode: 'sequential' },
  { id: 'c1', code: 'CLOSED', title: 'Đã đóng', status: 'published', is_open: false, active_section: 'done', exam_mode: 'retake' },
];

describe('Admin Mock Tests native model', () => {
  test('normalizes canonical list and reports duplicate/malformed identities', () => {
    const result = normalizeMockExamList({ exams: [...rows, rows[0], { title: 'missing id' }] });
    assert.equal(result.rows.length, 3);
    assert.equal(result.malformedCount, 2);
    assert.equal(result.rows[2].examMode, 'retake');
    assert.equal(normalizeMockExamList({ items: rows }), null);
  });

  test('derives operational stages without inventing backend status', () => {
    const exams = normalizeMockExamList(rows).rows;
    assert.deepEqual(exams.map(mockExamStage), ['draft', 'live', 'closed']);
    assert.deepEqual(filterMockExams(exams, 'live').map((row) => row.id), ['l1']);
    assert.deepEqual(filterMockExams(exams, 'unknown').map((row) => row.id), ['d1', 'l1', 'c1']);
  });

  test('pins shareable tabs and exact child workspace identities', () => {
    assert.equal(mockTestsTab('bad'), 'manage');
    assert.equal(mockTestsHref('manage'), '/admin/mock-tests');
    assert.equal(mockTestsHref('review'), '/admin/mock-tests?tab=review');
    assert.equal(mockTestsHref('review', 'exam / 1'), '/admin/mock-tests?tab=review&exam_id=exam+%2F+1');
    assert.equal(mockTestsFrame('manage'), '/admin/mock-exams?embed=1');
    assert.equal(mockTestsFrame('live', 'exam / 1'), '/admin/mock-live?exam_id=exam%20%2F%201&embed=1');
    assert.equal(mockTestsFrame('review', 'exam / 1'), '/admin/mock-reviews?mock_exam_id=exam%20%2F%201&embed=1');
    assert.equal(mockTestsFrame('review', ''), null);
    assert.equal(mockTestsFrame('writing'), '/admin/writing/queue?embed=1&mocklane=1');
  });
});

describe('/admin/mock-tests native ownership and UX', () => {
  test('owns clean cockpit route while rollback artifacts remain available during parity', () => {
    assert.match(PAGE, /AdminMockTestsPage/);
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'mock-tests', 'index.html')));
    assert.match(CHROME, /section: 'mock-tests'[^\n]+href: '\/admin\/mock-tests'/);
    assert.doesNotMatch(CHROME, /section: 'mock-tests'[^\n]+href: '\/pages\/admin\/mock-tests/);
    assert.match(OVERVIEW, /href="\/admin\/mock-tests"/);
    assert.match(LEDGER, /`\/admin\/mock-tests`[^\n]+authed-admin-mock-tests[^\n]+native React ownership/);
  });

  test('keeps canonical selection truth, live safety and account-scoped refresh', () => {
    for (const token of ['/admin/mock-exams', 'requestedExam', 'mockTestsHref(tab, id)', 'frameEpoch', 'next === tab', 'key={`${frame}:${frameEpoch}`}', 'accountRef.current !== account', 'request !== requestRef.current', 'request === requestRef.current', 'document.visibilityState', '15_000', 'normalizeMockExamList', 'liveDraftBlocked', 'Publish đề trong tab Quản lý', 'snapshot cũ', 'MutationObserver', "event.key !== 'av-theme'", 'Đề đang thao tác bị ẩn bởi bộ lọc']) assert.ok(COMPONENT.includes(token), token);
    assert.doesNotMatch(COMPONENT, /id: 'review'[^\n]+legacy: true/);
    assert.doesNotMatch(COMPONENT, /dangerouslySetInnerHTML|window\.api\.(post|patch|delete)/);
  });

  test('uses governed accessible responsive layout and CI browser evidence', () => {
    for (const name of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-mock-tests-next.css']) assert.ok(LAYOUT.includes(name), name);
    for (const rule of ['min-height:44px', '@media(max-width:900px)', '@media(max-width:560px)', ':focus-visible', '@media(prefers-reduced-motion:reduce)']) assert.ok(CSS.includes(rule), rule);
    for (const token of ['frontend/app/(authed-admin-mock-tests)/**', 'frontend/lib/admin-mock-tests-model.mjs', 'frontend/public/css/admin-mock-tests-next.css', 'verify-admin-mock-tests-flow.mjs', 'node tooling/verify-admin-mock-tests-flow.mjs']) assert.ok(WORKFLOW.includes(token), token);
  });
});
