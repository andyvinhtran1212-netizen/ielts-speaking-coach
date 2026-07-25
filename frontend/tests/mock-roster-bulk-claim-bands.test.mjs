/**
 * mock-roster-bulk-claim-bands.test.mjs — the roster's two new bulk steps:
 * NHẬN and CHỐT BAND, which used to cost one click per student.
 *
 * The pipeline is queued → claimed → reviewed → released. Bulk release (#778)
 * only ever covered the last hop, so a 13-student class still meant 13 claims
 * and 13 saves by hand.
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

const fn = (name) => {
  const m = JS.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(m, `${name}() not found — sentinel is stale`);
  return m[1];
};

describe('roster — bulk NHẬN', () => {
  test('the bar carries a claim button', () => {
    assert.match(JS, /id="bulk-claim-btn"/);
  });

  // claim() only takes a 'queued' row. Counting a claimed one would promise the
  // admin an action the server turns into a no-op refusal.
  test('only a "chưa nhận" row counts toward the button', () => {
    assert.match(fn('wireBulkBar'), /function claimable\(\)[\s\S]*?data-review-status'\) === 'queued'/);
  });

  test('it sends only the claimable rows, not everything ticked', () => {
    assert.match(fn('wireBulkBar'), /claimable\(\)\.map[\s\S]*?bulkClaim\(ids\)/);
  });

  // Publishing confirms because a student sees it and it needs a revoke to undo.
  // Claiming shows the student nothing and has an explicit "bỏ nhận" — a confirm
  // there would just train the admin to click through dialogs.
  test('claiming does not confirm — it is reversible and invisible to the student', () => {
    assert.doesNotMatch(fn('bulkClaim'), /confirm\(/);
  });
});

describe('roster — bulk CHỐT BAND', () => {
  test('the bar carries a chốt band button', () => {
    assert.match(JS, /id="bulk-bands-btn"/);
  });

  test('only a row this admin holds and has not banded counts', () => {
    const body = fn('wireBulkBar');
    assert.match(body, /function bandable\(\)[\s\S]*?s === 'claimed' \|\| s === 'edited'/);
    // a released row must never be re-banded from the roster — save refuses it
    assert.doesNotMatch(body, /function bandable\(\)[\s\S]*?'released'[\s\S]*?\n    \}/);
  });

  // The whole point: the client must not post bands. The server re-derives what
  // the form would have pre-filled, so a stale tab cannot publish a stale number.
  test('the client posts sitting ids ONLY — never a band', () => {
    const body = fn('bulkSaveBands');
    assert.match(body, /\{ sitting_ids: sittingIds \}/);
    assert.doesNotMatch(body, /final_bands|collectBands|data-band/);
  });

  test('it hits the bulk-final-bands route', () => {
    assert.match(fn('bulkSaveBands'), /\/bulk-final-bands/);
  });
});

describe('roster — the bulk bar is wired on every roster that renders it', () => {
  // #778 widened bulkBarHtml to anySubmitted so an essay-less L/R-only roster
  // keeps its release button — but the wiring stayed on `gradable`, so on such a
  // roster every control was rendered permanently disabled. Same shape as the
  // .hidden bug in #785: drawn, but dead.
  test('wireBulkBar runs on anySubmitted, not on gradable', () => {
    assert.match(JS, /if \(anySubmitted\) wireBulkBar\(list\)/);
    assert.doesNotMatch(JS, /if \(gradable\) wireBulkBar\(list\)/);
  });
});

describe('roster — refusals are named for every bulk action', () => {
  // "Chưa công bố được 2 bài" is simply false after a bulk NHẬN, so the shared
  // renderer takes the action's name.
  test('the skip renderer is action-named, not release-only', () => {
    assert.match(JS, /function renderSkips\(skips, what\)/);
    assert.match(JS, /Chưa ' \+ esc\(what\) \+ ' được '/);
  });

  for (const [name, what] of [['bulkClaim', 'nhận'], ['bulkSaveBands', 'chốt band']]) {
    test(`${name} names its refusals ("${what}") after the awaited reload`, () => {
      const body = fn(name);
      // The #778 Codex P2: loadRoster() blanks #queue-list, which is where the box
      // goes — rendering first wipes it before the admin can read it.
      const iLoad = body.indexOf('await loadRoster()');
      const iSkips = body.indexOf(`renderSkips(sk, '${what}')`);
      assert.ok(iLoad !== -1, 'the roster reload must be awaited');
      assert.ok(iSkips > iLoad, `renderSkips must run AFTER the reload in ${name}`);
    });

    test(`${name} refetches rather than leaving a stale roster on failure`, () => {
      assert.match(fn(name), /catch \(e\)[\s\S]*?loadRoster\(\)/);
    });
  }
});
