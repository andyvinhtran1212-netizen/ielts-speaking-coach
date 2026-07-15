/**
 * mock-review-band-prefill.test.mjs — the mock review console pre-fills the
 * Writing band from the band computed off the two graded essays
 * (mock_review_workflow.sync_writing_band_for_essay → review.ai_draft.writing),
 * so the examiner doesn't retype it. Source-sentinel (the page is a DOM/IIFE).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(__dirname, '..', 'js', 'admin-mock-reviews.js'), 'utf8');

describe('admin-mock-reviews — Writing band flows back from graded essays', () => {
  test('band input falls back to the ai_draft band when final_bands is empty', () => {
    // Still true — the lookup just widened: draftBandOf reads the draft for ANY
    // skill, so this no longer hard-codes writing (see the pre-fill describe).
    assert.match(JS, /var draftBand = draftBandOf\(draft, s\);/);
    assert.match(JS, /var val = \(fb\[s\] != null\) \? fb\[s\] : \(draftBand != null \? draftBand : ''\)/);
  });
  test('shows a hint that the band was suggested from the two graded essays', () => {
    assert.match(JS, /Gợi ý từ 2 bài đã chấm/);
  });
  test('the suggestion never overrides a confirmed final band (fb wins)', () => {
    // fb[s] is checked first in the value expression — a saved final band stays.
    assert.match(JS, /\(fb\[s\] != null\) \? fb\[s\]/);
  });
});

// The roster showed word counts only, so a Writing band the backend already had
// was invisible until the examiner opened the row — while Listening/Reading
// showed theirs inline. Source-sentinel (the page is a DOM/IIFE).
describe('admin-mock-reviews — roster Writing cell carries the band', () => {
  test('wCell renders the band next to the word counts', () => {
    const body = JS.match(/function wCell\(w\) \{([\s\S]*?)\n  \}/);
    assert.ok(body, 'wCell() not found — sentinel is stale');
    assert.match(body[1], /w\.band == null/);            // no band → counts only
    assert.match(body[1], /Number\(w\.band\)\.toFixed\(1\)/);
  });
  // A suggestion rendered like a confirmed band would show the examiner a score
  // nobody signed off on — the two states must be visually distinct.
  test('a suggestion is muted + tilde-prefixed; only a confirmed band is bold', () => {
    const body = JS.match(/function wCell\(w\) \{([\s\S]*?)\n  \}/);
    assert.match(body[1], /w\.band_is_final/);
    assert.match(body[1], /<b>' \+ b \+ '<\/b>/);         // confirmed → bold, like L/R
    assert.match(body[1], /mr-muted[\s\S]*?'~' \+ b|mr-muted[\s\S]*?~' \+ b/);   // suggestion → muted "~B6.5"
  });
  // Counts and band are independent facts. The first cut bailed to "—" on
  // missing word counts BEFORE looking at the band, which would hide a band the
  // cell exists to show (Codex review, PR #775).
  test('wCell shows "—" only when the counts AND the band are both absent', () => {
    const body = JS.match(/function wCell\(w\) \{([\s\S]*?)\n  \}/);
    assert.ok(body, 'wCell() not found — sentinel is stale');
    assert.match(body[1], /!hasWc && w\.band == null/);
    // the old conflated guard must not come back
    assert.doesNotMatch(body[1], /task1_wc == null && w\.task2_wc == null/);
  });
  test('a band with no word counts still renders (band alone, no prefix)', () => {
    const body = JS.match(/function wCell\(w\) \{([\s\S]*?)\n  \}/);
    // counts are pushed only when present; the band is pushed independently,
    // so a band-only cell joins to just the band.
    assert.match(body[1], /if \(hasWc\) \{[\s\S]*?parts\.push/);
    assert.match(body[1], /if \(w\.band != null\) \{[\s\S]*?parts\.push/);
    assert.match(body[1], /parts\.join\(' · '\)/);
  });
});

// The L/R bands were already in ai_draft — derived from the auto-graded score —
// but the form only ever read draft.writing, so the examiner retyped numbers the
// machine had computed and stored. Nothing on this form is a judgement call:
// L/R come off the answer key, Writing off the two essays the admin approved one
// by one. Saving is a confirmation, not data entry.
describe('admin-mock-reviews — every band pre-fills, not just Writing', () => {
  const grab = (re, what) => {
    const m = JS.match(re);
    assert.ok(m, `${what} not found — sentinel is stale`);
    return m[0];
  };
  const draftBandOf = new Function(
    grab(/  function draftBandOf\(draft, skill\) \{[\s\S]*?\n  \}/, 'draftBandOf()')
    + '\nreturn draftBandOf;')();

  test('reads the band out of the real ai_draft shapes', () => {
    // Production: L/R are {raw, band} from the auto-grader; writing is
    // {band, task1_band, task2_band} from sync_writing_band_for_essay.
    const draft = {
      listening: { raw: 18, band: 5.5 },
      reading:   { raw: 30, band: 7.0 },
      writing:   { band: 5.0, task1_band: 5.0, task2_band: 5.0 },
    };
    assert.equal(draftBandOf(draft, 'listening'), 5.5);
    assert.equal(draftBandOf(draft, 'reading'), 7.0);
    assert.equal(draftBandOf(draft, 'writing'), 5.0);
  });
  test('a bare number is tolerated — the shape is not schema-pinned', () => {
    assert.equal(draftBandOf({ listening: 6.5 }, 'listening'), 6.5);
  });
  test('absent / null / band-less yield null, never 0 or NaN', () => {
    // A falsy-but-wrong value here would silently pre-fill a band nobody computed.
    assert.equal(draftBandOf({}, 'listening'), null);
    assert.equal(draftBandOf({ listening: null }, 'listening'), null);
    assert.equal(draftBandOf({ writing: { band: null } }, 'writing'), null);
    assert.equal(draftBandOf(null, 'reading'), null);
  });
  test('the form pre-fills from the draft for ANY skill, not just writing', () => {
    assert.match(JS, /var draftBand = draftBandOf\(draft, s\);/);
    // the skill-name test is exactly what hid the L/R drafts
    assert.doesNotMatch(JS, /s === 'writing' && draft\.writing/);
  });
  test('each pre-filled band names where it came from', () => {
    // The examiner is confirming a number — they are owed its provenance.
    assert.match(JS, /listening: 'Tự tính từ số câu đúng'/);
    assert.match(JS, /writing:   'Gợi ý từ 2 bài đã chấm'/);
    assert.match(JS, /DRAFT_SOURCE\[s\]/);
  });
  test('a confirmed final band still wins over the draft', () => {
    assert.match(JS, /var val = \(fb\[s\] != null\) \? fb\[s\] : \(draftBand != null \? draftBand : ''\)/);
  });
});

// Codex P2 (PR #782): Speaking has no draft source — nothing derives it (no
// answer key like L/R, no per-essay approval like Writing). It arrives blank
// among pre-filled boxes and doSave refuses it. Presenting the form as one-click
// and then rejecting it is the lie; the box has to say it needs a band.
describe('admin-mock-reviews — a skill with no draft says it needs typing', () => {
  test('an undraftable, unblankable skill is captioned, not left bare', () => {
    assert.match(JS, /if \(!hint && fb\[s\] == null\) \{[\s\S]*?Chưa có band tự tính — cần bạn nhập/);
  });
  test('the caption never overrides a draft hint or the blankable notice', () => {
    // It is the LAST fallback: `!hint` guards it, so a pre-filled or blankable
    // skill keeps its own, more specific explanation.
    const body = JS.match(/var hint = \(draftBand != null[\s\S]*?Chưa có band tự tính[\s\S]*?\n      \}/);
    assert.ok(body, 'the hint chain not found — sentinel is stale');
    const iBlank = body[0].indexOf('blankableSkills()');
    const iNeed = body[0].indexOf('Chưa có band tự tính');
    assert.ok(iBlank !== -1 && iBlank < iNeed, 'the blankable notice must be checked first');
  });
  test('a confirmed band gets no caption at all', () => {
    assert.match(JS, /if \(!hint && fb\[s\] == null\)/);
  });
});
