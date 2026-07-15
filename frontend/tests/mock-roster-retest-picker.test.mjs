/**
 * mock-roster-retest-picker.test.mjs — the roster's TEST LẠI cell is a
 * multi-select of the skills the student must retake (2026-07-15), replacing the
 * old single sitting-level checkbox.
 *
 * The picker RECORDS a decision; it must never gate grading. That is the whole
 * point of the change: needs_retest (the sitting flag the old checkbox wrote)
 * makes Writing bulk-grade skip the sitting, and picking "Listening" should not
 * stop a perfectly gradable essay from being graded.
 *
 * retestCell is a pure string builder, so it is exercised for real below rather
 * than only source-matched — source-sentinels pin the shape you thought of, not
 * the behaviour you get.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(__dirname, '..', 'public', 'js', 'admin-mock-reviews.js'), 'utf8');
const HTML = readFileSync(
  join(__dirname, '..', 'public', 'pages', 'admin', 'mock-reviews', 'index.html'), 'utf8');

// Lift retestCell + its RETEST_SKILLS table out of the IIFE and run them.
function loadRetestCell() {
  const skills = JS.match(/var RETEST_SKILLS = \[[\s\S]*?\];/);
  const fn = JS.match(/  function retestCell\(r\) \{[\s\S]*?\n  \}/);
  assert.ok(skills, 'RETEST_SKILLS not found — sentinel is stale');
  assert.ok(fn, 'retestCell() not found — sentinel is stale');
  return new Function(
    'esc',
    `${skills[0]}\n${fn[0]}\nreturn retestCell;`,
  )((s) => String(s == null ? '' : s));
}

describe('roster TEST LẠI — skill picker markup', () => {
  const retestCell = loadRetestCell();

  test('offers exactly listening / reading / writing', () => {
    const html = retestCell({ sitting_id: 's1', review_id: 'r1', retest_flags: {} });
    for (const s of ['listening', 'reading', 'writing']) {
      assert.match(html, new RegExp(`data-skill="${s}"`), `missing skill ${s}`);
    }
    assert.doesNotMatch(html, /data-skill="speaking"/);   // not offered by the picker
  });

  test('no skill flagged → summary reads "—" and nothing is checked', () => {
    const html = retestCell({ sitting_id: 's1', review_id: 'r1', retest_flags: {} });
    assert.match(html, /<summary[^>]*>—<\/summary>/);
    assert.doesNotMatch(html, /checked/);
  });

  test('flagged skills are checked and summarised by initial', () => {
    const html = retestCell({
      sitting_id: 's1', review_id: 'r1',
      retest_flags: { listening: true, writing: true },
    });
    assert.match(html, />L · W</);                                  // summary
    assert.match(html, /data-skill="listening" checked/);
    assert.match(html, /data-skill="writing" checked/);
    assert.doesNotMatch(html, /data-skill="reading" checked/);
    assert.match(html, /is-on/);                                    // flagged styling
  });

  test('a sitting still in progress gets no picker (nothing to decide yet)', () => {
    const html = retestCell({ sitting_id: 's1', review_id: null, retest_flags: {} });
    assert.doesNotMatch(html, /<details/);
    assert.match(html, /—/);
  });

  test('the sitting id rides on the element the change handler reads', () => {
    const html = retestCell({ sitting_id: 'sit-abc', review_id: 'r1', retest_flags: {} });
    assert.match(html, /<details class="mr-retest" data-sitting-id="sit-abc"/);
  });
});

describe('roster TEST LẠI — wiring', () => {
  test('posts to /retest-flags, never to the grading-gate /retest route', () => {
    const body = JS.match(/async function setRetestSkills\(el, sittingId\) \{([\s\S]*?)\n  \}/);
    assert.ok(body, 'setRetestSkills() not found — sentinel is stale');
    assert.match(body[1], /\/retest-flags'/);
    assert.doesNotMatch(body[1], /\{ needs_retest:/);
  });
  test('posts the FULL picture so unticking can clear a skill', () => {
    const body = JS.match(/async function setRetestSkills\(el, sittingId\) \{([\s\S]*?)\n  \}/);
    // every skill seeded false first, then overwritten from the checkboxes —
    // a partial post would leave an unticked skill impossible to clear.
    assert.match(body[1], /RETEST_SKILLS\.forEach\(function \(s\) \{ flags\[s\.key\] = false; \}\)/);
  });
  test('a failed post refetches instead of keeping the rejected tick', () => {
    const body = JS.match(/async function setRetestSkills\(el, sittingId\) \{([\s\S]*?)\n  \}/);
    assert.match(body[1], /catch \(e\)[\s\S]*?loadRoster\(\)/);
  });
  test('clicking the picker does not open the review detail', () => {
    assert.match(JS, /closest\('\.mr-retest'\)\) return;/);
  });
  test('the old sitting-level checkbox is gone from the roster', () => {
    assert.doesNotMatch(JS, /mr-retest-row/);
  });
});

describe('roster TEST LẠI — popover styling', () => {
  // <details> hides its own content when closed, but an explicit
  // display+position on the menu overrides that — measured: the menu still laid
  // out 98px tall while closed, so all 13 popovers sat open over the table.
  test('the menu is explicitly hidden while the details is closed', () => {
    assert.match(HTML, /\.mr-retest:not\(\[open\]\) \.mr-retest__menu \{ display:none; \}/);
  });
  test('the menu floats instead of stretching the row', () => {
    assert.match(HTML, /\.mr-retest__menu \{ position:absolute; z-index:\d+/);
  });
});
