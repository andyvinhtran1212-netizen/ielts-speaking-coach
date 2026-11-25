/**
 * mock-roster-retest-picker.test.mjs — the roster's TEST LẠI cell records the
 * skills a student must retake (2026-07-15), replacing the old single
 * sitting-level checkbox, and the roster can publish results in bulk.
 *
 * The picker RECORDS a decision; it must never gate grading. needs_retest (the
 * sitting flag the old checkbox wrote) makes Writing bulk-grade skip the
 * sitting, and picking "Listening" must not stop a gradable essay being graded.
 *
 * LEGACYJS-0075 W2 retired `admin-mock-reviews.js`. The Next roster in
 * `admin-mock-reviews.tsx` draws one checkbox per skill inline, so the legacy
 * popover (`<details>` menu, flip-up placement, its CSS) has no counterpart and
 * those pins are retired; the decision rules are pinned here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MOCK_REVIEW_SKILLS, normalizeReviewRoster, retestFlagConfirmed } from '../lib/admin-mock-reviews-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSX = readFileSync(join(__dirname, '..', 'app', '(authed-admin-mock-reviews)', 'admin', 'mock-reviews', 'admin-mock-reviews.tsx'), 'utf8');

const block = (re, what) => {
  const m = TSX.match(re);
  assert.ok(m, `${what} not found — sentinel is stale`);
  return m[0];
};
const setRetestFlags = () => block(/const setRetestFlags = async \([\s\S]*?\n  \};/, 'setRetestFlags');
const reconcileBulk = () => block(/const reconcileBulk = async \([\s\S]*?\n  \};/, 'reconcileBulk');

const rosterRow = (over) => ({
  sitting_id: 's1', review_id: 'r1', review_status: 'claimed', student_name: 'An', sitting_status: 'submitted',
  listening: {}, reading: {}, writing: {}, speaking: { count: 0 }, ...over,
});

describe('roster TEST LẠI — skill picker', () => {
  test('one checkbox per review skill, labelled by initial', () => {
    assert.deepEqual([...MOCK_REVIEW_SKILLS], ['listening', 'reading', 'writing', 'speaking']);
    assert.match(TSX, /<div className="mrr-flags">\{MOCK_REVIEW_SKILLS\.map\(/);
    assert.match(TSX, /\{skill\[0\]\.toUpperCase\(\)\}<\/label>/);
  });

  test('flagged skills come through as checked, unticked ones are absent', () => {
    const { rows } = normalizeReviewRoster({ roster: [rosterRow({ retest_flags: { listening: true, writing: true, reading: false } })] });
    assert.deepEqual(rows[0].retestFlags, { listening: true, writing: true });
    assert.match(TSX, /const checked = row\.retestFlags\[skill\] === true;/);
  });

  test('a flagged row is highlighted', () => {
    assert.match(TSX, /row\.needsRetest \|\| Object\.values\(row\.retestFlags\)\.some\(Boolean\) \? 'is-retest' : ''/);
  });

  test('a sitting still in progress cannot be flagged (nothing to decide yet)', () => {
    assert.match(TSX, /disabled=\{!row\.reviewId \|\| Boolean\(busy\) \|\| \(!tickable && !checked\)\}/);
  });
});

describe('roster TEST LẠI — wiring', () => {
  test('posts to /retest-flags, never to the grading-gate /retest route', () => {
    const body = setRetestFlags();
    assert.match(body, /\/retest-flags`, \{ retest_flags: flags \}/);
    assert.doesNotMatch(body, /needs_retest/);
  });
  test('posts the FULL picture so unticking can clear a skill', () => {
    assert.match(setRetestFlags(), /MOCK_REVIEW_SKILLS\.forEach\(\(key: string\) => \{ flags\[key\] = key === skill \? value :/);
  });
  test('success is read back from the canonical roster, not assumed', () => {
    assert.match(setRetestFlags(), /retestFlagConfirmed\(canonicalRow \? canonicalRow\.retestFlags : ack\?\.retest_flags, skill, value\)/);
    assert.equal(retestFlagConfirmed({ listening: true }, 'listening', true), true);
    assert.equal(retestFlagConfirmed({}, 'listening', false), true);
    assert.equal(retestFlagConfirmed(null, 'listening', false), false);
  });
  test('a failed post refetches instead of keeping the rejected tick', () => {
    assert.match(setRetestFlags(), /catch \(caught\) \{ await loadRoster\(\);/);
  });
  test('the old sitting-level checkbox is gone from the roster', () => {
    assert.doesNotMatch(TSX, /mr-retest-row|needs_retest:/);
  });
});

describe('roster — bulk release (công bố hàng loạt)', () => {
  test('only a reviewed sitting counts toward the release button', () => {
    assert.match(TSX, /disabled=\{!actionRows\(\['reviewed'\]\)\.length \|\| Boolean\(busy\)\} onClick=\{\(\) => setReleaseTarget\(\{ kind: 'bulk'/);
  });
  test('it confirms with the count before publishing, and says it is not freely undoable', () => {
    assert.match(TSX, /`Công bố \$\{releaseTarget\.ids\.length\} kết quả\?`/);
    assert.match(TSX, /cần quy trình thu hồi riêng/);
  });
  test('refusals are named per sitting, not just counted', () => {
    assert.match(TSX, /skips\.map\(\(skip\) => <li key=\{`\$\{skip\.sittingId\}:\$\{skip\.reason\}`\}><code>\{skip\.sittingId\.slice\(0, 8\)\}<\/code> — \{skip\.reason\}<\/li>\)/);
  });
  test('a failed batch refetches rather than leaving a stale roster', () => {
    assert.match(reconcileBulk(), /catch \(caught\) \{\s*await loadRoster\(\);/);
  });
  test('every submitted sitting is selectable, not just the gradable ones', () => {
    assert.match(TSX, /checked=\{selected\.has\(row\.sittingId\)\} disabled=\{!row\.reviewId\}/);
  });
});

describe('roster — bulk release, review fixes', () => {
  test('refusals are set AFTER the roster reload, not before it wipes them', () => {
    const body = reconcileBulk();
    const iLoad = body.indexOf('await loadRoster()');
    const iSkips = body.indexOf('setSkips(allSkips)');
    assert.ok(iLoad !== -1, 'the roster reload must be awaited');
    assert.ok(iSkips > iLoad, 'setSkips must run AFTER the reload');
  });
  test('the grading control is what depends on essays; release does not', () => {
    assert.match(TSX, /\(row\.writing\.task1EssayId \|\| row\.writing\.task2EssayId\)\) \|\| Boolean\(busy\)\} onClick=\{\(\) => void bulkGrade\(\)\}/);
    assert.doesNotMatch(block(/<button className="adm-btn-primary" disabled=\{!actionRows\(\['reviewed'\]\)[^>]*>/, 'release button'), /EssayId/);
  });
});
