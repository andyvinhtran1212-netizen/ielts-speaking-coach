/**
 * mock-review-roster-status.test.mjs — the roster's "Trạng thái" column reflects
 * the whole review lifecycle (queued → claimed → reviewed → released), not just
 * whether the row was claimed.
 *
 * Why: claimed_by is set at claim and cleared only by unclaim
 * (mock_review_workflow.claim / .release), so it stays true through 'reviewed'
 * and 'released'. A cell keyed off that flag showed "đã nhận" for all three —
 * an admin who had just published a result saw no sign of it.
 *
 * Source-sentinel (the page is a DOM/IIFE).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(__dirname, '..', 'js', 'admin-mock-reviews.js'), 'utf8');
const PAGE = readFileSync(
  join(__dirname, '..', 'pages', 'admin', 'mock-reviews', 'index.html'), 'utf8');

describe('admin-mock-reviews — roster status column tracks the lifecycle', () => {
  const body = () => {
    const m = JS.match(/function claimCell\(r\) \{([\s\S]*?)\n  \}/);
    assert.ok(m, 'claimCell() not found — sentinel is stale');
    return m[1];
  };

  test('the cell reads review_status, not the claim flag', () => {
    assert.match(body(), /REVIEW_STATUS_LABEL\[r\.review_status\]/);
  });

  test('a released sitting reads "đã trả bài" — the reported gap', () => {
    assert.match(JS, /released:\s*'đã trả bài'/);
  });

  test('a reviewed sitting reads "đã duyệt" — the label the bulk-release tooltip names', () => {
    assert.match(JS, /reviewed:\s*'đã duyệt'/);
    // The tooltip has always pointed at this state; the cell must be able to show it.
    assert.match(JS, /trạng thái "đã duyệt"/);
  });

  test('queued and claimed keep their existing labels', () => {
    assert.match(JS, /queued:\s*'chưa nhận'/);
    assert.match(JS, /claimed:\s*'đã nhận'/);
  });

  test('a sitting with no review is still "đang làm"', () => {
    assert.match(body(), /!r\.review_id[\s\S]*?đang làm/);
  });

  // 'edited' is in mig 147's CHECK but unused by the flow. An unknown status must
  // degrade to the old claim-flag reading rather than render an empty pill.
  test('an unknown status falls back to the claim flag, never to a blank label', () => {
    assert.match(body(), /\|\|\s*\(r\.claimed \? 'đã nhận' : 'chưa nhận'\)/);
  });

  // The regression this replaces: status collapsed onto `claimed` alone.
  test('the claim-only cell does not come back', () => {
    assert.doesNotMatch(
      body(),
      /return '<span class="mr-pill">' \+ \(r\.claimed \? 'đã nhận' : 'chưa nhận'\)/);
  });
});

describe('admin-mock-reviews — the released pill is actually styled', () => {
  test('released is the only status that earns a modifier class', () => {
    const m = JS.match(/function claimCell\(r\) \{([\s\S]*?)\n  \}/);
    assert.match(m[1], /r\.review_status === 'released' \? ' mr-pill--done' : ''/);
  });

  // PR #785 was three symptoms of classes the page never defined: .hidden was
  // added all over admin-mock-tests.js and styled nowhere, so it never hid
  // anything. A modifier that no stylesheet declares is that same bug — assert
  // the rule exists on the page that renders it.
  test('.mr-pill--done is declared on the page, not just added by the script', () => {
    assert.match(PAGE, /\.mr-pill--done\s*\{/);
  });

  test('the pill styles itself from theme tokens, not hardcoded colour', () => {
    const rule = PAGE.match(/\.mr-pill--done\s*\{([^}]*)\}/);
    assert.ok(rule, '.mr-pill--done rule not found — sentinel is stale');
    assert.match(rule[1], /var\(--av-success/);
    assert.doesNotMatch(rule[1], /#[0-9a-fA-F]{3,6}/);
  });
});
