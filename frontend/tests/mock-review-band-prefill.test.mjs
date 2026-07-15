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
  test('band input falls back to ai_draft.writing.band when final_bands is empty', () => {
    assert.match(JS, /draft\.writing && draft\.writing\.band != null/);
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
