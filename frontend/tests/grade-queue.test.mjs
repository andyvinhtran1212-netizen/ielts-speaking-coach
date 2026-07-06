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
const JS = read('js', 'admin-writing-queue.js');
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
    assert.match(JS, /function isOverdue[\s\S]*?deadline[\s\S]*?!==\s*['"]delivered['"]/);
    assert.match(JS, /function visibleRows[\s\S]*?_overdue\s*\?[\s\S]*?isOverdue/);
  });
  test('F1: grading lane auto-refreshes (poll only when _status === grading)', () => {
    assert.match(JS, /_startPollIfGrading/);
    assert.match(JS, /_status !== 'grading'[\s\S]*?return/);
    assert.match(JS, /setInterval\(/);
  });
  test('F1: in-flight rows (pending/grading) open the status poller, not grade', () => {
    assert.match(JS, /st === 'pending' \|\| st === 'grading'[\s\S]*?status\.html\?essay_id=/);
  });
});


describe('queue.html — table + row → grade.html + queue-context', () => {
  test('table columns: học viên / task / status / band / tuổi / hạn', () => {
    for (const c of ['Học viên', 'Task', 'Trạng thái', 'Band', 'Tuổi', 'Hạn']) {
      assert.match(HTML, new RegExp(`<th[^>]*>\\s*${c}`), `Missing column ${c}`);
    }
  });
  test('row opens grade.html?essay_id', () => {
    assert.match(JS, /grade\.html\?essay_id='\s*\+\s*encodeURIComponent\(essayId\)/);
  });
  test('writes sessionStorage queue-context {ids,i,status} on open (for PR-3)', () => {
    assert.match(JS, /sessionStorage\.setItem\(\s*QUEUE_KEY/);
    assert.match(JS, /ids[\s\S]*?visibleRows\(\)\.map/);
    assert.match(JS, /const QUEUE_KEY = 'gradeQueue'/);
  });
});


describe('queue.html — Task 1 "graded without image" badge', () => {
  test('renders q-badge-noimg only when e.task1_image_missing', () => {
    assert.match(JS, /e\.task1_image_missing/);
    assert.match(JS, /q-badge-noimg/);
    // Badge is appended into the Task column cell.
    assert.match(JS, /\$\{escapeHtml\(task\)\}\$\{lvl\}\$\{noImg\}/);
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
    assert.match(JS, /\/admin\/writing\/essays\?limit=200/);
    assert.match(JS, /'&status='\s*\+\s*encodeURIComponent\(_status\)/);
  });
  test('bulk POSTs to bulk-mark-delivered then refetches canonical', () => {
    assert.match(JS, /\/admin\/writing\/essays\/bulk-mark-delivered/);
    assert.match(JS, /function bulkDeliver[\s\S]*?await load\(\)/);
  });
  test('bulk UI enabled ONLY on the reviewed lane', () => {
    assert.match(JS, /const bulkable = _status === 'reviewed'/);
    assert.match(JS, /_status === 'reviewed' && _selected\.size > 0/);
  });
  test('surfaces delivered/skipped counts from the partial-success payload', () => {
    assert.match(JS, /delivered_count/);
    assert.match(JS, /skipped_count/);
  });
  test('select-all + per-row checkbox feed a selection Set', () => {
    assert.match(HTML, /id="q-select-all"/);
    assert.match(JS, /q-select-all'\)\.addEventListener/);
    assert.match(JS, /_selected\.add/);
    assert.match(JS, /let _selected = new Set\(\)/);
  });
});


describe('grade-queue — chrome nav entry', () => {
  test('queue nav slot added after cohorts in the writing section', () => {
    assert.match(CHROME, /slug: 'queue'[\s\S]*?writing\/queue\.html/);
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
  test('"Trạng thái chấm" (slug status) → queue.html?status=grading (F1 lane)', () => {
    assert.match(CHROME, /slug: 'status',\s*label: 'Trạng thái chấm',\s*href: '\/pages\/admin\/writing\/queue\.html\?status=grading'/);
  });
  test('"Trạng thái chấm" no longer points at the bare status.html', () => {
    assert.doesNotMatch(CHROME, /label: 'Trạng thái chấm',\s*href: '\/pages\/admin\/writing\/status\.html'/);
  });
  test('"Hàng chờ chấm" remains the canonical queue entry', () => {
    assert.match(CHROME, /slug: 'queue',\s*label: 'Hàng chờ chấm',\s*href: '\/pages\/admin\/writing\/queue\.html'/);
  });
  test('queue reads ?status= deep-link → lands on that lane', () => {
    assert.match(JS, /function _readUrlStatus\(\)/);
    assert.match(JS, /\['grading', 'graded', 'reviewed', 'delivered', ''\]\.includes\(v\)/);
    assert.match(JS, /if \(urlStatus !== null\) setStatus\(urlStatus\)/);
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
