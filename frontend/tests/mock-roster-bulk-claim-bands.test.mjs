/**
 * mock-roster-bulk-claim-bands.test.mjs — the roster's bulk steps NHẬN and
 * CHỐT BAND, which used to cost one click per student.
 *
 * The pipeline is queued → claimed → reviewed → released. Bulk release (#778)
 * only covered the last hop, so a 13-student class still meant 13 claims and 13
 * saves by hand.
 *
 * LEGACYJS-0075 W2 retired `admin-mock-reviews.js`; these now pin the Next
 * roster in `admin-mock-reviews.tsx` (`reconcileBulk`, the bulk bar).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSX = readFileSync(join(__dirname, '..', 'app', '(authed-admin-mock-reviews)', 'admin', 'mock-reviews', 'admin-mock-reviews.tsx'), 'utf8');

const reconcileBulk = () => {
  const m = TSX.match(/const reconcileBulk = async \([\s\S]*?\n  \};/);
  assert.ok(m, 'reconcileBulk not found — sentinel is stale');
  return m[0];
};

describe('roster — bulk NHẬN', () => {
  test('the bar carries a claim button', () => {
    assert.match(TSX, /onClick=\{\(\) => void reconcileBulk\('claim', actionRows\(\['queued'\]\)\.map\(\(row\) => row\.sittingId\)\)\}>Nhận bài \(/);
  });

  // claim() only takes a 'queued' row. Counting a claimed one would promise an
  // action the server turns into a refusal.
  test('only a "chưa nhận" row counts toward the button', () => {
    assert.match(TSX, /disabled=\{!actionRows\(\['queued'\]\)\.length \|\| Boolean\(busy\)\}/);
  });

  // Publishing confirms because a student sees it. Claiming shows the student
  // nothing and has "bỏ nhận"; a confirm there would train click-through.
  test('claiming does not confirm: only release opens the dialog', () => {
    assert.doesNotMatch(TSX, /confirm\(/);
    assert.match(TSX, /setReleaseTarget\(\{ kind: 'bulk', ids: actionRows\(\['reviewed'\]\)/);
  });
});

describe('roster — bulk CHỐT BAND', () => {
  test('the bar carries a chốt band button', () => {
    assert.match(TSX, />Chốt band \(\{actionRows\(\['claimed', 'edited'\]\)\.length\}\)</);
  });

  test('only a row held and not yet banded counts; a released row never does', () => {
    assert.match(TSX, /reconcileBulk\('bands', actionRows\(\['claimed', 'edited'\]\)\.map/);
  });

  // The client must not post bands. The server re-derives what the form would
  // have pre-filled, so a stale tab cannot publish a stale number.
  test('the client posts sitting ids ONLY — never a band', () => {
    const body = reconcileBulk();
    assert.match(body, /\{ sitting_ids: ids \}/);
    assert.doesNotMatch(body, /final_bands|bandDraft|buildFinalBandsPayload/);
  });

  test('it hits the bulk-final-bands route', () => {
    assert.match(reconcileBulk(), /\/bulk-\$\{kind === 'bands' \? 'final-bands' : kind\}/);
  });
});

describe('roster — the bulk bar is shown on every loaded roster', () => {
  // #778: a roster without essays kept its release control rendered but dead.
  // The Next bar is drawn for every loaded roster; only the grade button depends on essays.
  test('the bulk bar is not gated on gradable rows', () => {
    assert.match(TSX, /<section className="mrr-roster-card">\s*<div className="mrr-bulkbar">/);
  });
});

describe('roster — refusals are named for every bulk action', () => {
  test('the notice names the action that ran', () => {
    assert.match(reconcileBulk(), /kind === 'claim' \? 'nhận' : kind === 'bands' \? 'chốt band' : 'công bố'/);
  });

  test('refusals are set AFTER the awaited reload, so the reload cannot wipe them', () => {
    const body = reconcileBulk();
    const iLoad = body.indexOf('await loadRoster()');
    const iSkips = body.indexOf('setSkips(allSkips)');
    assert.ok(iLoad !== -1, 'the roster reload must be awaited');
    assert.ok(iSkips > iLoad, 'setSkips must run AFTER the reload');
  });

  test('a failed batch refetches rather than leaving a stale roster', () => {
    assert.match(reconcileBulk(), /catch \(caught\) \{\s*await loadRoster\(\);/);
  });
});
