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
  test('four mutually-exclusive status tabs', () => {
    for (const s of ['graded', 'reviewed', 'delivered']) {
      assert.match(HTML, new RegExp(`data-status="${s}"`), `Missing tab ${s}`);
    }
    assert.match(HTML, /data-status=""/);   // "Tất cả"
  });
  test('overdue is a separate toggle, NOT a tab', () => {
    assert.match(HTML, /id="q-overdue"/);
    assert.doesNotMatch(HTML, /data-status="overdue"/);   // never a tab
  });
  test('overdue derived deadline<now && status!=delivered (cross-cutting)', () => {
    assert.match(JS, /function isOverdue[\s\S]*?deadline[\s\S]*?!==\s*['"]delivered['"]/);
    assert.match(JS, /function visibleRows[\s\S]*?_overdue\s*\?[\s\S]*?isOverdue/);
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
