/**
 * grade-queue.test.mjs — grade-flow PR-2 (FE global grade-queue).
 *
 * Pins: new queue.html (aver-design, NOT the .aw-* island) with status tabs +
 * cross-cutting overdue overlay + reviewed-only bulk-deliver + sessionStorage
 * queue-context; the chrome nav entry; and the secondary cohorts.html matrix
 * status filter.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const HTML = read('pages', 'admin', 'writing', 'queue.html');
// LEGACYJS-0075 W4b: admin-writing-queue.js is deleted; the Next queue and its
// model own the controller invariants (queue.html stays as a fixture, ADR-005).
const JS = read('app', '(authed-admin-writing-queue)', 'admin', 'writing', 'queue', 'admin-writing-queue.tsx');
const Q = await import('../lib/admin-writing-queue-model.mjs');
const F = (raw) => Q.normalizeWritingQueueFilters(raw);
const CHROME = read('js', 'components', 'aver-admin-chrome.js');
const COHORTS = read('pages', 'admin', 'writing', 'cohorts.html');


describe('queue.html — aver-design shell (not the .aw-* island)', () => {
  test('links admin-components.css + tokens, NOT admin-writing-grade/.aw chrome', () => {
    assert.match(HTML, /href="\/css\/aver-design\/admin-components\.css"/);
    assert.match(HTML, /href="\/css\/aver-design\/tokens\.css"/);
  });
  test('uses admin primitives (.adm-table / .adm-subtab) — no .aw-* island classes', () => {
    assert.match(HTML, /class="adm-table"/);
    assert.match(HTML, /class="adm-subtabs"/);
    assert.doesNotMatch(HTML, /class="aw-/);
  });
  test('chrome active=writing subsection=queue', () => {
    assert.match(HTML, /<aver-admin-chrome active="writing" subsection="queue">/);
  });
});


describe('queue.html — status tabs + overdue overlay (cross-cutting)', () => {
  test('status tabs incl. the F1 grading lane', () => {
    for (const s of ['grading', 'graded', 'reviewed', 'delivered']) {
      assert.match(HTML, new RegExp(`data-status="${s}"`), `Missing tab ${s}`);
    }
    assert.match(HTML, /data-status=""/);   // "Tất cả"
  });
  test('default active lane stays "Cần chấm" (graded), not grading', () => {
    assert.match(HTML, /class="adm-subtab is-active"\s+data-status="graded"/);
  });
  test('overdue is a separate toggle, NOT a tab', () => {
    assert.match(HTML, /id="q-overdue"/);
    assert.doesNotMatch(HTML, /data-status="overdue"/);   // never a tab
  });
  test('overdue derived deadline<now && status!=delivered (cross-cutting)', () => {
    const past = '2020-01-01T00:00:00Z';
    assert.equal(Q.isWritingEssayOverdue({ status: 'graded', deadline: past }), true);
    assert.equal(Q.isWritingEssayOverdue({ status: 'delivered', deadline: past }), false);
    assert.match(JS, /const overdue = filters\.overdue \|\| isWritingEssayOverdue\(row\)/);
  });
  test('F1: grading lane auto-refreshes (poll only when _status === grading)', () => {
    assert.equal(Q.shouldPollWritingQueue(F({ status: 'grading' })), true);
    assert.equal(Q.shouldPollWritingQueue(F({ status: 'graded' })), false);
    assert.match(JS, /if \(!shouldPollWritingQueue\(filters\)\) return;\s*const timer = window\.setInterval\(/);
  });
  test('F1: in-flight rows (pending/grading) open the status poller, not grade', () => {
    assert.match(Q.writingQueueDestination({ id: 'e1', status: 'grading' }, F({})), /^\/admin\/writing\/status\?essay_id=e1&/);
    assert.match(Q.writingQueueDestination({ id: 'e1', status: 'pending' }, F({})), /^\/admin\/writing\/status\?essay_id=e1&/);
  });
});


describe('queue.html — table + row → grade.html + queue-context', () => {
  test('table columns: học viên / task / status / band / tuổi / hạn', () => {
    for (const c of ['Học viên', 'Task', 'Trạng thái', 'Band', 'Tuổi', 'Hạn']) {
      assert.match(HTML, new RegExp(`<th[^>]*>\\s*${c}`), `Missing column ${c}`);
    }
  });
  test('row opens the grade workspace ?essay_id', () => {
    assert.match(Q.writingQueueDestination({ id: 'e 1', status: 'graded' }, F({})), /^\/admin\/writing\/grade\?essay_id=e\+1&/);
    assert.match(JS, /window\.location\.href = writingQueueDestination\(row, filters\)/);
  });
  test('writes sessionStorage queue-context {ids,i,status} on open (for PR-3)', () => {
    assert.match(JS, /sessionStorage\.setItem\(QUEUE_KEY, JSON\.stringify\(\{ accountId: profile\.id, contextKey: writingQueueSearch\(filters\), ids, i: ids\.indexOf\(row\.id\) \}\)\)/);
    assert.match(JS, /const ids = visibleRows\.map\(\(item\) => item\.id\)/);
    assert.match(JS, /const QUEUE_KEY = 'gradeQueue'/);
  });
});


describe('queue.html — Task 1 "graded without image" badge', () => {
  test('renders the "Thiếu hình" badge only when task1_image_missing', () => {
    assert.match(JS, /\{row\.task1ImageMissing && <span className="is-warning" title="Task 1 được chấm khi thiếu hình đề">Thiếu hình<\/span>\}/);
    // Badge sits in the Task column cell.
    assert.match(JS, /<td data-label="Task"><strong>\{taskLabel\(row\.taskType\)\}<\/strong><RowBadges row=\{row\}/);
  });
  test('badge styled token-only (warning tokens, no raw hex)', () => {
    assert.match(HTML, /\.q-badge-noimg\s*\{[\s\S]*?var\(--av-warning/);
    const block = HTML.match(/\.q-badge-noimg\s*\{[^}]*\}/);
    assert.ok(block, 'q-badge-noimg CSS present');
    assert.doesNotMatch(block[0], /#[0-9a-fA-F]{3,6}\b/);
  });
});


describe('queue.html — bulk-deliver (reviewed-only, partial-success, refetch)', () => {
  test('GET /admin/writing/essays?status= drives the lane', () => {
    // The Next queue reads the paged essay-queue endpoint (limit 25).
    assert.equal(Q.writingQueueApiPath(F({ status: 'reviewed' })), '/admin/writing/essay-queue?limit=25&offset=0&mock=false&status=reviewed');
  });
  test('bulk POSTs to bulk-mark-delivered then refetches canonical', () => {
    assert.match(JS, /'\/admin\/writing\/essays\/bulk-mark-delivered', \{ essay_ids: action\.ids \}/);
    assert.match(JS, /const canonical = await loadQueue\(filters, true\)/);
  });
  test('bulk UI enabled ONLY on the reviewed lane', () => {
    assert.match(JS, /const bulkable = filters\.lane === 'reviewed'/);
    assert.match(JS, /\{bulkable && selected\.size > 0 && <div className="awq-bulk">/);
  });
  test('surfaces delivered/skipped counts from the partial-success payload', () => {
    assert.deepEqual(Q.normalizeBulkDelivery({ delivered: ['a'], skipped: [{ id: 'b' }], delivered_count: 1, skipped_count: 1 }, ['a', 'b']),
      { delivered: ['a'], skipped: [{ id: 'b', status: null, reason: null }] });
    assert.equal(Q.normalizeBulkDelivery({ delivered: ['a'], skipped: [], delivered_count: 2, skipped_count: 0 }, ['a']), null);
    assert.match(JS, /Đã trả \$\{result\.delivered\.length\} bài; \$\{result\.skipped\.length\} bài bị backend bỏ qua/);
  });
  test('select-all + per-row checkbox feed a selection Set', () => {
    assert.match(HTML, /id="q-select-all"/);
    assert.match(JS, /aria-label="Chọn tất cả bài đang hiển thị" checked=\{allSelected\} onChange=\{\(event\) => toggleAll\(/);
    assert.match(JS, /const toggleOne = \(id: string, on: boolean\) => setSelected\(/);
    assert.match(JS, /useState<Set<string>>\(new Set\(\)\)/);
  });
});


describe('queue.html — Mock (bài thi) review lane', () => {
  test('Mock tab button + hidden actions column present', () => {
    assert.match(HTML, /id="q-mock-tab"/);
    assert.match(HTML, /id="q-actions-th" hidden/);
  });
  test('every lane sends &mock= — regular lanes exclude, Mock lane includes', () => {
    assert.match(Q.writingQueueApiPath(F({ status: 'graded' })), /&mock=false/);
    assert.equal(Q.writingQueueApiPath(F({ mocklane: '1' })), '/admin/writing/essay-queue?limit=25&offset=0&mock=true');
    assert.match(JS, /const setLane = \(lane: QueueLane\) => navigate\(\{ \.\.\.filters, lane, overdue: false \}\)/);
  });
  test('bulk-deliver never offered on the Mock lane', () => {
    assert.match(JS, /const bulkable = filters\.lane === 'reviewed'/);   // the mock lane is never 'reviewed'
  });
  test('too-short badge derives from the IELTS task minimum (150 / 250)', () => {
    assert.equal(Q.writingMockMinimum('task1_academic'), 150);
    assert.equal(Q.writingMockMinimum('task2'), 250);
    assert.match(JS, /const minimum = writingMockMinimum\(row\.taskType\)/);
  });
  test('pending mock essay offers grade-anyway + skip; actions intercept row-open', () => {
    // Actions are their own buttons (rows open only through their own button),
    // each behind a confirm dialog.
    assert.match(JS, /filters\.lane === 'mock' && row\.status === 'pending' && !row\.gradingSkippedAt && <>/);
    assert.match(JS, /onClick=\{\(\) => setConfirm\(\{ kind: 'grade', row \}\)\}/);
    assert.match(JS, /\{short && <button[^>]*onClick=\{\(\) => setConfirm\(\{ kind: 'skip', row \}\)\}>Bỏ qua<\/button>\}/);
  });
  test('grade-anyway → start-grading; skip → mock skip-grading endpoint', () => {
    assert.match(JS, /`\/admin\/writing\/essays\/\$\{encodeURIComponent\(action\.row\.id\)\}\/start-grading`/);
    assert.match(JS, /`\/admin\/mock-exams\/writing\/essays\/\$\{encodeURIComponent\(action\.row\.id\)\}\/skip-grading`/);
  });
});


describe('grade-queue — chrome nav entry', () => {
  test('queue nav slot added after cohorts in the writing section', () => {
    assert.match(CHROME, /slug: 'queue'[\s\S]*?\/admin\/writing\/queue/);
    // ordering: cohorts then queue
    const i = CHROME.indexOf("slug: 'cohorts'");
    const j = CHROME.indexOf("slug: 'queue'");
    assert.ok(i !== -1 && j !== -1 && j > i, 'queue should follow cohorts');
  });
});


describe('F3/F4 — dead bare-nav entries fixed', () => {
  test('F4 nav-dedup: "Chấm bài viết" removed (was a duplicate of Hàng chờ chấm)', () => {
    assert.doesNotMatch(CHROME, /label: 'Chấm bài viết'/);
    assert.doesNotMatch(CHROME, /slug: 'grade'/);
  });
  test('"Trạng thái chấm" (slug status) → native queue?status=grading (F1 lane)', () => {
    assert.match(CHROME, /slug: 'status',\s*label: 'Trạng thái chấm',\s*href: '\/admin\/writing\/queue\?status=grading'/);
  });
  test('"Trạng thái chấm" no longer points at the bare status.html', () => {
    assert.doesNotMatch(CHROME, /label: 'Trạng thái chấm',\s*href: '\/pages\/admin\/writing\/status\.html'/);
  });
  test('"Hàng chờ chấm" remains the canonical queue entry', () => {
    assert.match(CHROME, /slug: 'queue',\s*label: 'Hàng chờ chấm',\s*href: '\/admin\/writing\/queue'/);
  });
  test('queue reads ?status= deep-link → lands on that lane', () => {
    assert.match(JS, /status: params\?\.has\('status'\) \? params\.get\('status'\) : undefined/);
    for (const lane of ['grading', 'graded', 'reviewed', 'delivered']) assert.equal(F({ status: lane }).lane, lane);
    assert.equal(F({ status: '' }).lane, 'all');
    assert.equal(F({}).lane, 'graded');
  });
});


describe('cohorts.html — secondary matrix status filter (small)', () => {
  test('status-filter select + dim class wired', () => {
    assert.match(COHORTS, /id="matrix-status-filter"/);
    assert.match(COHORTS, /function applyMatrixFilter/);
    assert.match(COHORTS, /matrix-cell--dim/);
  });
  test('cells carry data-status + data-overdue for the filter', () => {
    assert.match(COHORTS, /data-status="'\s*\+\s*escapeHtml\(cell\.status\)/);
    assert.match(COHORTS, /data-overdue="1"/);
  });
  test('overdue option is cross-cutting (matches data-overdue, not a status)', () => {
    assert.match(COHORTS, /f === 'overdue'[\s\S]*?data-overdue/);
  });
});
