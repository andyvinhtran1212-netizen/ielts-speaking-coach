import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeRegradeDecision, normalizeRegradeList, normalizeRegradeRequest, regradeFilters, regradeHref, regradeMatches } from '../lib/admin-writing-regrade-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-writing-regrade)', 'admin', 'writing', 'regrade-requests', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-writing-regrade)', 'admin', 'writing', 'regrade-requests', 'admin-writing-regrade-requests.tsx');
const LAYOUT = read('app', '(authed-admin-writing-regrade)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-writing-regrade-next.css');
const CONFIG = read('next.config.ts');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const HUB = read('app', '(authed-admin-writing)', 'admin', 'writing', 'page.tsx');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const MIGRATION = read('..', 'backend', 'migrations', '205_writing_regrade_atomic_transitions.sql');

const raw = { id: 'r1', essay_id: 'e1', student_id: 's1', reason: 'The learner gives a sufficiently specific reason for requesting a review.', status: 'pending', student_name: '<img onerror=x>', student_code: 'S001', cohort_name: 'A1', essay_task_type: 'task2', essay_prompt: 'Discuss public transport.', essay_status: 'delivered', essay_band: 6.5, admin_response: null, created_at: '2026-08-13T00:00:00Z', updated_at: '2026-08-13T00:00:00Z', actioned_at: null, fulfilled_at: null };

describe('Admin Writing Regrade native model', () => {
  test('normalizes canonical rows and rejects impossible identity/status', () => {
    assert.equal(normalizeRegradeRequest(raw).studentName, '<img onerror=x>');
    assert.equal(normalizeRegradeRequest({ ...raw, id: '' }), null);
    assert.equal(normalizeRegradeRequest({ ...raw, status: 'done' }), null);
    assert.equal(normalizeRegradeRequest({ ...raw, essay_band: 12 }), null);
    assert.equal(normalizeRegradeList({ requests: [raw, raw], capped: false }), null);
  });

  test('pins list envelope, exact decision ACK and URL filters', () => {
    const list = normalizeRegradeList({ requests: [raw, { bad: true }], capped: true });
    assert.equal(list.rows.length, 1); assert.equal(list.malformedCount, 1); assert.equal(list.capped, true);
    assert.equal(normalizeRegradeList({ requests: [raw] }).capped, false);
    assert.equal(normalizeRegradeList({ requests: [raw], capped: 'yes' }), null);
    assert.equal(normalizeRegradeDecision({ ...raw, status: 'accepted' }, 'r1', 'accepted').id, 'r1');
    assert.equal(normalizeRegradeDecision({ ...raw, status: 'accepted' }, 'other', 'accepted'), null);
    assert.deepEqual(regradeFilters({ status: 'bad', q: ' student ' }), { status: 'pending', q: 'student' });
    assert.equal(regradeHref({ status: 'fulfilled', q: 'S001' }), '/admin/writing/regrade-requests?status=fulfilled&q=S001');
    assert.equal(regradeMatches(normalizeRegradeRequest(raw), { status: 'pending', q: 's001' }), true);
  });
});

describe('/admin/writing/regrade-requests native ownership and safety', () => {
  test('owns clean route while retaining direct rollback HTML', () => {
    assert.match(PAGE, /function AdminWritingRegradePage/);
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing\/regrade-requests['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'regrade-requests.html')));
    assert.match(CHROME, /slug:\s*'regrade-requests'[^\n]+href:\s*'\/admin\/writing\/regrade-requests'/);
    assert.match(HUB, /Yêu cầu chấm lại[^\n]+NATIVE/);
    assert.match(LEDGER, /`\/admin\/writing\/regrade-requests`[^\n]+authed-admin-writing-regrade[^\n]+native React ownership/);
  });

  test('uses atomic backend transitions and canonical readback', () => {
    assert.match(MIGRATION, /fn_action_writing_regrade_request/);
    assert.match(MIGRATION, /fn_deliver_writing_essay/);
    assert.match(MIGRATION, /FOR UPDATE/);
    assert.match(COMPONENT, /pendingDecision\.current/);
    assert.match(COMPONENT, /const detail = normalizeRegradeDecision/);
    assert.match(COMPONENT, /const canonical = await loadAll\(true\)/);
    assert.match(COMPONENT, /mutationLock\.current/);
    assert.doesNotMatch(COMPONENT, /window\.confirm|window\.alert|\bconfirm\(/);
  });

  test('renders contract failures, cap truth and accessible responsive UI', () => {
    assert.match(COMPONENT, /Có lane chạm ngưỡng 300/);
    assert.match(COMPONENT, /Promise\.all\(TABS\.map/);
    assert.match(COMPONENT, /Dữ liệu bị loại/);
    assert.match(COMPONENT, /detailStale/);
    assert.match(COMPONENT, /aria-label="Trạng thái yêu cầu"/);
    assert.match(CSS, /min-height:44px/);
    assert.match(CSS, /@media\(max-width:720px\)/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    for (const style of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-writing-regrade-next.css']) assert.ok(LAYOUT.includes(style));
  });
});
