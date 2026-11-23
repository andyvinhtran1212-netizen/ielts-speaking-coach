/**
 * mock-review-roster-status.test.mjs — the roster's "Trạng thái" column reflects
 * the whole review lifecycle (queued → claimed → reviewed → released), not just
 * whether the row was claimed.
 *
 * Why: claimed_by is set at claim and cleared only by unclaim, so it stays true
 * through 'reviewed' and 'released'. A cell keyed off that flag showed "đã nhận"
 * for all three, and an admin who had just published a result saw no sign of it.
 *
 * LEGACYJS-0075 W2 retired `admin-mock-reviews.js`; these now pin the Next
 * roster in `admin-mock-reviews.tsx`, its model and its stylesheet.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeReviewRoster } from '../lib/admin-mock-reviews-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSX = readFileSync(join(__dirname, '..', 'app', '(authed-admin-mock-reviews)', 'admin', 'mock-reviews', 'admin-mock-reviews.tsx'), 'utf8');
const CSS = readFileSync(join(__dirname, '..', 'public', 'css', 'admin-mock-reviews-next.css'), 'utf8');

const rosterRow = (over) => ({
  sitting_id: 's1', review_id: 'r1', student_name: 'An', sitting_status: 'submitted', claimed: true,
  listening: {}, reading: {}, writing: {}, speaking: { count: 0 }, ...over,
});

describe('admin-mock-reviews — roster status column tracks the lifecycle', () => {
  const cell = () => {
    const m = TSX.match(/<span className=\{`mrr-status is-\$\{row\.reviewStatus \|\| 'wip'\}`\}>([^\n]*?)<\/span>/);
    assert.ok(m, 'the roster status cell not found — sentinel is stale');
    return m[1];
  };

  test('the cell reads review_status, not the claim flag', () => {
    assert.match(cell(), /STATUS\[row\.reviewStatus \|\| ''\]/);
    assert.doesNotMatch(cell(), /row\.claimed/);
  });

  test('a released sitting reads "Đã trả bài" — the reported gap', () => {
    assert.match(TSX, /released: 'Đã trả bài'/);
  });

  test('a reviewed sitting reads "Đã duyệt", and only reviewed rows count toward release', () => {
    assert.match(TSX, /reviewed: 'Đã duyệt'/);
    assert.match(TSX, /actionRows\(\['reviewed'\]\)\.map/);
  });

  test('queued and claimed keep their labels', () => {
    assert.match(TSX, /queued: 'Chưa nhận'/);
    assert.match(TSX, /claimed: 'Đã nhận'/);
  });

  test('a sitting with no review is still "Đang làm"', () => {
    assert.match(cell(), /row\.reviewId \? row\.reviewStatus : 'Đang làm'/);
  });

  // An unknown status must never render an empty pill. The Next model goes one
  // step further than the legacy claim-flag fallback: such a row is malformed.
  test('an unknown status is refused by the model, never rendered blank', () => {
    const ok = normalizeReviewRoster({ roster: [rosterRow({ review_status: 'released' })] });
    assert.equal(ok.rows[0].reviewStatus, 'released');
    const bad = normalizeReviewRoster({ roster: [rosterRow({ review_status: 'archived' })] });
    assert.equal(bad.rows.length, 0);
    assert.equal(bad.malformedCount, 1);
  });
});

describe('admin-mock-reviews — the released pill is actually styled', () => {
  // PR #785: classes the page never defined never did anything. A modifier no
  // stylesheet declares is that same bug.
  test('the released modifier is declared in the stylesheet the route loads', () => {
    assert.match(CSS, /\.mrr-status\.is-released\s*\{/);
  });

  test('the pill styles itself from theme tokens, not hardcoded colour', () => {
    const rule = CSS.match(/\.mrr-status\.is-released\s*\{([^}]*)\}/);
    assert.ok(rule, '.mrr-status.is-released rule not found — sentinel is stale');
    assert.match(rule[1], /var\(--av-success/);
    assert.doesNotMatch(rule[1], /#[0-9a-fA-F]{3,6}/);
  });
});
