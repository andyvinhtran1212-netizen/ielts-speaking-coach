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

// The table renders inside .adm-table-wrap, whose overflow-x:auto forces
// overflow-y to compute to auto — so the scroller clips the popover regardless
// of z-index. Measured on the last row: menu bottom 1116 vs scroller bottom
// 1027, leaving the Writing checkbox unreachable (Codex review, PR #776).
describe('roster TEST LẠI — the scroller must not clip the menu', () => {
  test('the menu flips up when it would not fit below', () => {
    const body = JS.match(/function placeRetestMenu\(dd\) \{([\s\S]*?)\n  \}/);
    assert.ok(body, 'placeRetestMenu() not found — sentinel is stale');
    assert.match(body[1], /closest\('\.adm-table-wrap'\)/);
    assert.match(body[1], /getBoundingClientRect\(\)\.bottom > scroller\.getBoundingClientRect\(\)\.bottom/);
    assert.match(body[1], /add\('mr-retest__menu--up'\)/);
  });
  test('the default placement is re-measured, not remembered', () => {
    // Without dropping the class first, a menu that flipped once would stay
    // flipped after a scroll made room below.
    const body = JS.match(/function placeRetestMenu\(dd\) \{([\s\S]*?)\n  \}/);
    assert.match(body[1], /remove\('mr-retest__menu--up'\)[\s\S]*?if \(/);
  });
  test('placement runs on open', () => {
    assert.match(JS, /addEventListener\('toggle', function \(\) \{ if \(dd\.open\) placeRetestMenu\(dd\); \}\)/);
  });
  test('the up variant anchors to the summary bottom', () => {
    assert.match(HTML, /\.mr-retest__menu--up \{ top:auto; bottom:calc\(100% \+ 4px\); \}/);
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

// Công bố hàng loạt (2026-07-15). This publishes to real students, so the UI's
// job is to never promise a release the server will refuse, and never hide one
// it refused.
describe('roster — bulk release (công bố hàng loạt)', () => {
  test('only a reviewed sitting counts toward the release button', () => {
    // final_bands are entered at save_final_bands → status 'reviewed'. Counting a
    // queued/claimed row would promise a release release_results rejects.
    const body = JS.match(/function releasable\(\) \{([\s\S]*?)\n    \}/);
    assert.ok(body, 'releasable() not found — sentinel is stale');
    assert.match(body[1], /data-review-status'\) === 'reviewed'/);
  });
  test('it confirms with the count before publishing', () => {
    assert.match(JS, /confirm\('Công bố kết quả cho ' \+ ids\.length \+ ' học viên\?/);
    assert.match(JS, /thu hồi trước/);   // says publishing is not freely undoable
  });
  test('refusals are named per sitting, not just counted', () => {
    const body = JS.match(/async function bulkRelease\(sittingIds\) \{([\s\S]*?)\n  \}/);
    assert.ok(body, 'bulkRelease() not found — sentinel is stale');
    assert.match(body[1], /if \(sk\.length\) renderReleaseSkips\(sk\)/);
    assert.match(JS, /function renderReleaseSkips\(skips\)[\s\S]*?s\.reason/);
  });
  test('a failed batch refetches rather than leaving a stale roster', () => {
    const body = JS.match(/async function bulkRelease\(sittingIds\) \{([\s\S]*?)\n  \}/);
    assert.match(body[1], /catch \(e\)[\s\S]*?loadRoster\(\)/);
  });
  test('every submitted sitting is selectable, not just the gradable ones', () => {
    // A retest-flagged sitting is exempt from the Writing release gate and a
    // Writing-less one still has results — both must be selectable to publish.
    assert.match(JS, /var check = r\.review_id/);
    assert.doesNotMatch(JS, /var check = \(hasWritingEssays\(r\) && !flagged\)/);
  });
});

// Two Codex P2s on PR #778 — both were mine, and the first defeated the very
// feature it lived in.
describe('roster — bulk release, review fixes', () => {
  test('refusals render AFTER the roster reload, not before it wipes them', () => {
    // loadRoster()'s first act is to blank #queue-list, which is where the box
    // goes. Rendering first wiped it before the admin could read it — leaving
    // only a toast count and hiding WHICH students were not published.
    const body = JS.match(/async function bulkRelease\(sittingIds\) \{([\s\S]*?)\n  \}/);
    assert.ok(body, 'bulkRelease() not found — sentinel is stale');
    const iLoad = body[1].indexOf('await loadRoster()');
    const iSkips = body[1].indexOf('renderReleaseSkips(sk)');
    assert.ok(iLoad !== -1, 'the roster reload must be awaited');
    assert.ok(iSkips > iLoad, 'renderReleaseSkips must run AFTER the reload');
  });
  test('the release control shows for a roster with no Writing essays at all', () => {
    // An L/R-only retake has results release_results can publish and no essay to
    // grade; gating the whole bar on `gradable` hid the button from exactly those.
    assert.match(JS, /var anySubmitted = rows\.some\(function \(r\) \{ return !!r\.review_id; \}\)/);
    assert.match(JS, /anySubmitted \? bulkBarHtml\(gradable\)/);
  });
  test('the grading half is what drops without essays — the release half stays', () => {
    const body = JS.match(/function bulkBarHtml\(gradable\) \{([\s\S]*?)\n  \}/);
    assert.ok(body, 'bulkBarHtml() not found — sentinel is stale');
    assert.match(body[1], /gradable[\s\S]*?bulk-grade-btn[\s\S]*?: ''/);
    assert.match(body[1], /bulk-release-btn/);
  });
  test('wiring survives a missing grade button', () => {
    assert.match(JS, /if \(btn\) \{[\s\S]*?btn\.disabled = !n;/);
    assert.match(JS, /if \(btn\) btn\.addEventListener\('click'/);
  });
});
