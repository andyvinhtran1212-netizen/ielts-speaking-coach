import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEEP_MIN_CHARS, keepExplanationError, normalizeRegradeDecision, normalizeRegradeList, normalizeRegradeRequest, regradeFilters, regradeHref, regradeLane, regradeMatches, regradeSort, regradeWait, waitLabel } from '../lib/admin-writing-regrade-model.mjs';

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
    assert.deepEqual(regradeFilters({ status: 'bad', q: ' student ' }), { status: 'new', q: 'student' });
    // Old ?status= links land on the FR-062 lane that holds them.
    assert.deepEqual(regradeFilters({ status: 'fulfilled' }), { status: 'answered', q: '' });
    assert.deepEqual(regradeFilters({ status: 'accepted' }), { status: 'regrading', q: '' });
    assert.equal(regradeHref({ status: 'fulfilled', q: 'S001' }), '/admin/writing/regrade-requests?status=answered&q=S001');
    assert.equal(regradeHref({ status: 'new', q: '' }), '/admin/writing/regrade-requests');
    assert.equal(regradeMatches(normalizeRegradeRequest(raw), { status: 'new', q: 's001' }), true);
  });

  test('prioritizes oldest pending requests while keeping history newest first', () => {
    const older = normalizeRegradeRequest({ ...raw, id: 'older', created_at: '2026-08-11T00:00:00Z' });
    const newer = normalizeRegradeRequest({ ...raw, id: 'newer', created_at: '2026-08-13T00:00:00Z' });
    assert.deepEqual(regradeSort([newer, older], 'new').map((row) => row.id), ['older', 'newer']);
    assert.deepEqual(regradeSort([older, newer], 'answered').map((row) => row.id), ['newer', 'older']);
  });

  test('FR-062 lanes: Mới, Đang chấm lại, Đã trả lời (rejected and fulfilled)', () => {
    assert.deepEqual(['pending', 'accepted', 'rejected', 'fulfilled'].map(regradeLane), ['new', 'regrading', 'answered', 'answered']);
    const rejected = normalizeRegradeRequest({ ...raw, status: 'rejected' });
    assert.equal(regradeMatches(rejected, { status: 'answered', q: '' }), true);
    assert.equal(regradeMatches(rejected, { status: 'new', q: '' }), false);
  });

  test('wait counts from the request and is overdue only for open requests past regrade_hours', () => {
    const sent = Date.parse('2026-08-13T00:00:00Z');
    const row = normalizeRegradeRequest(raw);
    assert.deepEqual(regradeWait(row, sent + 49 * 3_600_000, 48), { hours: 49, open: true, overdue: true });
    assert.deepEqual(regradeWait(row, sent + 47 * 3_600_000, 48), { hours: 47, open: true, overdue: false });
    // Unknown threshold: never shown as on time.
    assert.equal(regradeWait(row, sent + 49 * 3_600_000, null).overdue, null);
    const answered = normalizeRegradeRequest({ ...raw, status: 'rejected' });
    assert.equal(regradeWait(answered, sent + 99 * 3_600_000, 48).overdue, false);
    assert.equal(waitLabel(0), 'dưới 1 giờ'); assert.equal(waitLabel(5), '5 giờ'); assert.equal(waitLabel(73), '3 ngày');
  });

  test('list envelope carries regrade_hours; a missing or failed threshold is reported', () => {
    assert.deepEqual(
      (({ regradeHours, thresholdsFailed }) => ({ regradeHours, thresholdsFailed }))(normalizeRegradeList({ requests: [raw], capped: false, regrade_hours: 48, thresholds_failed: false })),
      { regradeHours: 48, thresholdsFailed: false });
    assert.equal(normalizeRegradeList({ requests: [raw], capped: false, regrade_hours: null, thresholds_failed: true }).thresholdsFailed, true);
    assert.equal(normalizeRegradeList({ requests: [raw], capped: false }).thresholdsFailed, true);
    assert.equal(normalizeRegradeList({ requests: [raw], capped: false, regrade_hours: 0 }).regradeHours, null);
  });

  test('"Giữ nguyên điểm" needs at least 40 characters after trimming', () => {
    assert.equal(KEEP_MIN_CHARS, 40);
    assert.match(keepExplanationError('   '), /Viết giải thích/);
    assert.match(keepExplanationError(`  ${'x'.repeat(39)}  `), /ít nhất 40 ký tự \(đang có 39\)/);
    assert.equal(keepExplanationError('x'.repeat(40)), null);
  });
});

describe('/admin/writing/regrade-requests native ownership and safety', () => {
  test('owns clean route while retaining direct rollback HTML', () => {
    assert.match(PAGE, /function AdminWritingRegradePage/);
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing\/regrade-requests['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'regrade-requests.html')));
    assert.match(CHROME, /slug:\s*'regrade-requests'[^\n]+href:\s*'\/admin\/writing\/regrade-requests'/);
    assert.match(HUB, /Yêu cầu chấm lại[^\n]+href: '\/admin\/writing\/regrade-requests'[^\n]+status: 'Quản lý'/);
    assert.match(LEDGER, /`\/admin\/writing\/regrade-requests`[^\n]+authed-admin-writing-regrade[^\n]+native React ownership/);
  });

  test('uses atomic backend transitions and canonical readback', () => {
    assert.match(MIGRATION, /fn_action_writing_regrade_request/);
    assert.match(MIGRATION, /fn_deliver_writing_essay/);
    assert.match(MIGRATION, /FOR UPDATE/);
    assert.match(COMPONENT, /pendingDecision\.current/);
    assert.match(COMPONENT, /const detail = normalizeRegradeDecision/);
    assert.match(COMPONENT, /const canonical = await loadAll\(true\)/);
    assert.match(COMPONENT, /window\.api\.get<unknown>\('\/admin\/writing\/regrade-requests'\)/);
    assert.doesNotMatch(COMPONENT, /Promise\.all\(TABS\.map/);
    assert.match(COMPONENT, /detailRequestId !== detailSequence\.current/);
    assert.match(COMPONENT, /mutationLock\.current/);
    assert.doesNotMatch(COMPONENT, /window\.confirm|window\.alert|\bconfirm\(/);
  });

  test('FR-062 decision screen: three decisions, the no-deduct line always, answered is read-only', () => {
    for (const label of ['Giữ nguyên điểm', 'Điều chỉnh điểm', 'Chấm lại bằng AI']) assert.ok(COMPONENT.includes(`label: '${label}'`));
    assert.match(COMPONENT, /const NO_DEDUCT = 'Không trừ lượt chấm AI của học viên\.'/);
    // The line sits outside every status/decision condition of the dialog.
    assert.match(COMPONENT, /\n {8}<p className="awr-no-deduct" role="note"><strong>\{NO_DEDUCT\}<\/strong>/);
    assert.match(COMPONENT, /keepExplanationError\(trimmed\)/);
    assert.match(COMPONENT, /Cảnh báo · tốn chi phí AI/);
    assert.match(COMPONENT, /\/admin\/writing\/essays\/\$\{encodeURIComponent\(essayId\)\}\/regrade/);
    assert.match(COMPONENT, /Đã nhận yêu cầu nhưng chưa gửi được bài cho AI/);
    // Decisions render only for a pending request; others get Đóng (+ Mở màn chấm while regrading).
    assert.match(COMPONENT, /selected\.status === 'pending' && !pendingDecision\.current && <fieldset className="awr-decisions"/);
    assert.match(COMPONENT, /Chưa đọc được ngưỡng/);
  });

  test('renders contract failures, cap truth and accessible responsive UI', () => {
    assert.match(COMPONENT, /Có lane chạm ngưỡng 300/);
    assert.match(COMPONENT, /regradeSort\(/);
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
