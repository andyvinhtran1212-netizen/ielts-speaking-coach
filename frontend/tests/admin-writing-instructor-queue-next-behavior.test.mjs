import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimReadback, instructorGradeHref, instructorQueueFilters, instructorQueueHref,
  instructorQueuePath, instructorReconcilePath, normalizeClaimAck, normalizeInstructorQueue, normalizeReleaseAck,
  pendingInstructorOperation, releaseReadback,
} from '../lib/admin-writing-instructor-queue-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-writing-instructor-queue)', 'admin', 'writing', 'instructor-queue', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-writing-instructor-queue)', 'admin', 'writing', 'instructor-queue', 'admin-writing-instructor-queue.tsx');
const LAYOUT = read('app', '(authed-admin-writing-instructor-queue)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-writing-instructor-queue-next.css');
const CONFIG = read('next.config.ts'); const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const HUB = read('app', '(authed-admin-writing)', 'admin', 'writing', 'page.tsx'); const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

const review = { id: 'r1', essay_id: 'e1', status: 'queued', claimed_by: null, claimed_at: null, delivered_at: null, instructor_note: null, created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' };
const item = { review, essay_id: 'e1', student_email: '<img onerror=x>', student_level: 3, task_type: 'task2', submitted_at: '2026-08-10T00:00:00Z', age_hours: 12, is_overdue: false };

describe('Admin Writing Instructor Queue native model', () => {
  test('normalizes strict queue rows and reports malformed/duplicate identities', () => {
    const result = normalizeInstructorQueue([item, item, { bad: true }]);
    assert.equal(result.rows.length, 1); assert.equal(result.malformedCount, 2); assert.equal(result.rows[0].studentEmail, '<img onerror=x>');
    assert.equal(normalizeInstructorQueue({}), null);
    assert.equal(normalizeInstructorQueue([{ ...item, student_level: 7 }]).rows.length, 0);
    assert.equal(normalizeInstructorQueue([{ ...item, review: { ...review, status: 'unknown' } }]).rows.length, 0);
  });

  test('includes edited in active and my-claims server filters', () => {
    assert.equal(instructorQueuePath('all_active'), '/admin/instructor/queue?status=queued&status=claimed&status=edited');
    assert.equal(instructorQueuePath('my_claims', 'admin-1'), '/admin/instructor/queue?status=claimed&status=edited&instructor_id=admin-1');
  });

  test('pins URL state and forwards cockpit flags to native grade', () => {
    assert.deepEqual(instructorQueueFilters({ view: 'bad', embed: '1', mocklane: '1' }), { view: 'all_active', embed: '1', mocklane: '1' });
    assert.equal(instructorQueueHref({ view: 'my_claims', embed: '1', mocklane: '1' }), '/admin/writing/instructor-queue?view=my_claims&embed=1&mocklane=1');
    assert.equal(instructorGradeHref('e1', { embed: '1', mocklane: '1' }), '/admin/writing/grade?essay_id=e1&embed=1&mocklane=1');
  });

  test('accepts only exact mutation ACKs and canonical readbacks', () => {
    const claimed = { ...review, status: 'claimed', claimed_by: 'admin-1', claimed_at: '2026-08-13T00:00:00Z' };
    assert.equal(normalizeClaimAck(claimed, 'r1', 'admin-1').essayId, 'e1');
    assert.equal(normalizeClaimAck(claimed, 'r1', 'admin-2'), null);
    assert.equal(claimReadback(normalizeInstructorQueue([{ ...item, review: claimed }]).rows[0], 'admin-1').essayId, 'e1');
    assert.equal(claimReadback(normalizeInstructorQueue([{ ...item, review: { ...claimed, status: 'edited' } }]).rows[0], 'admin-1').essayId, 'e1');
    assert.equal(normalizeReleaseAck(review, 'r1').status, 'queued');
    assert.equal(normalizeReleaseAck({ ...review, claimed_at: '2026-08-13T00:00:00Z' }, 'r1'), null);
    assert.equal(releaseReadback(normalizeInstructorQueue([item]).rows[0]).review.id, 'r1');
  });

  test('pending operation is account-keyed and rejects malformed state', () => {
    const pending = { account: 'admin-1', action: 'claim', reviewId: 'r1', essayId: 'e1', startedAt: '2026-08-13T00:00:00Z' };
    assert.deepEqual(pendingInstructorOperation(pending, 'admin-1'), pending);
    assert.equal(pendingInstructorOperation(pending, 'admin-2'), null);
    assert.equal(pendingInstructorOperation({ ...pending, action: 'deliver' }, 'admin-1'), null);
  });

  test('bounds canonical reconciliation to the receipt essay when available', () => {
    assert.equal(instructorReconcilePath({ essayId: 'e1' }), '/admin/instructor/queue?status=queued&status=claimed&status=edited&status=delivered&status=released&essay_id=e1');
    assert.equal(instructorReconcilePath({ essayId: null }), '/admin/instructor/queue?status=queued&status=claimed&status=edited&status=delivered&status=released');
  });
});

describe('/admin/writing/instructor-queue native ownership and safety', () => {
  test('owns clean route while preserving direct rollback HTML', () => {
    assert.match(PAGE, /AdminWritingInstructorQueuePage/); assert.match(PAGE, /<AdminAccessGate>/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing\/instructor-queue['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'instructor-queue.html')));
    assert.match(CHROME, /slug:\s*'instructor-queue'[^\n]+href:\s*'\/admin\/writing\/instructor-queue'/);
    assert.match(HUB, /Hàng đợi Instructor[^\n]+NATIVE/); assert.match(LEDGER, /`\/admin\/writing\/instructor-queue`[^\n]+authed-admin-writing-instructor-queue[^\n]+native React ownership/);
  });

  test('never replays POST during reconciliation and keeps stale truth visible', () => {
    assert.match(COMPONENT, /instructorReconcilePath\(operation\)/); assert.match(COMPONENT, /không gửi lại POST/i); assert.match(COMPONENT, /awiq-pending:/);
    assert.match(COMPONENT, /normalizeClaimAck/); assert.match(COMPONENT, /normalizeReleaseAck/); assert.match(COMPONENT, /claimReadback/); assert.match(COMPONENT, /releaseReadback/);
    assert.match(COMPONENT, /accountRef\.current !== account/); assert.match(COMPONENT, /Claim chưa được ghi nhận/); assert.match(COMPONENT, /Workflow đã đi tiếp/);
    assert.match(COMPONENT, /status === 403\) await reconcile/); assert.match(instructorReconcilePath({ essayId: 'e1' }), /status=released/);
    assert.match(COMPONENT, /pendingRef\.current/); assert.match(COMPONENT, /mutationsBlocked=\{mutationsBlocked\}/); assert.match(COMPONENT, /disabled=\{mutationsBlocked\}/);
    assert.doesNotMatch(COMPONENT, /Đã trả gần đây/);
    assert.match(COMPONENT, /snapshot cũ/); assert.match(COMPONENT, /sai contract/); assert.doesNotMatch(COMPONENT, /window\.confirm|window\.alert|\bconfirm\(/);
  });

  test('uses governed accessible responsive interaction and parity fixture', () => {
    for (const style of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-writing-instructor-queue-next.css']) assert.ok(LAYOUT.includes(style));
    assert.match(CSS, /min-height:44px/); assert.match(CSS, /@media\(max-width:720px\)/); assert.match(CSS, /@media\(max-width:430px\)/); assert.match(CSS, /:focus-visible/); assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /verify-admin-writing-instructor-queue-flow\.mjs/);
  });
});
