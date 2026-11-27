/**
 * mock-review-band-prefill.test.mjs — the mock review console pre-fills each
 * band from the draft the backend already computed (L/R off the answer key,
 * Writing off the two graded essays via
 * mock_review_workflow.sync_writing_band_for_essay → review.ai_draft.writing),
 * so the examiner confirms a number instead of retyping it.
 *
 * LEGACYJS-0075 W2 retired `admin-mock-reviews.js`; these now pin the Next
 * owners: `draftBandOf` / `initialBandDraft` (lib/admin-mock-reviews-model.mjs)
 * run for real, and the roster's `writingText` is lifted out of
 * `admin-mock-reviews.tsx` and run.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BAND_SOURCE, bandCaption, draftBandOf, initialBandDraft, normalizeReviewDetail } from '../lib/admin-mock-reviews-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSX = readFileSync(join(__dirname, '..', 'app', '(authed-admin)', '(mock-reviews)', 'admin', 'mock-reviews', 'admin-mock-reviews.tsx'), 'utf8');

function grab(re, what) {
  const m = TSX.match(re);
  assert.ok(m, `${what} not found — sentinel is stale`);
  return m[0];
}

// writingText is a pure string builder; strip its two type annotations and run it.
const writingText = new Function([
  grab(/function fmtBand\(value[^)]*\) \{[^\n]*\}/, 'fmtBand()').replace(/\(value[^)]*\)/, '(value)'),
  grab(/function writingText\(row[^)]*\) \{[\s\S]*?\n\}/, 'writingText()').replace(/\(row[^)]*\)/, '(row)'),
  'return writingText;',
].join('\n'))();

const detailWith = ({ draft = {}, final = {}, required = ['listening', 'reading', 'writing'], blankable = [] } = {}) => normalizeReviewDetail({
  required_skills: required,
  blankable_skills: blankable,
  review: { id: 'rv-1', sitting_id: 'st-1', status: 'claimed', ai_draft: draft, final_bands: final, retest_flags: {} },
  sitting: { id: 'st-1' },
});

describe('admin-mock-reviews — Writing band flows back from graded essays', () => {
  test('the form falls back to the ai_draft band when final_bands is empty', () => {
    const detail = detailWith({ draft: { writing: { band: 5.0, task1_band: 5.0, task2_band: 5.0 } } });
    assert.equal(initialBandDraft(detail).writing, '5');
  });
  // The caption rule moved into bandCaption() (lib/admin-mock-reviews-model.mjs,
  // staging 53bc1ccb); the form renders it under each band box.
  test('shows a hint that the band was suggested from the two graded essays', () => {
    const detail = detailWith({ draft: { writing: { band: 5.0, task1_band: 5.0, task2_band: 5.0 } } });
    assert.equal(bandCaption(detail, 'writing'), 'Gợi ý từ hai bài đã chấm');
    assert.match(TSX, /\{bandCaption\(detail, skill\) && <small>\{bandCaption\(detail, skill\)\}<\/small>\}/);
  });
  test('the suggestion never overrides a confirmed final band (final wins)', () => {
    const detail = detailWith({ draft: { writing: { band: 5.0 } }, final: { writing: 6.5 } });
    assert.equal(initialBandDraft(detail).writing, '6.5');
  });
});

// The roster showed word counts only, so a Writing band the backend already had
// was invisible until the examiner opened the row.
describe('admin-mock-reviews — roster Writing cell carries the band', () => {
  const row = (over) => ({ task1Wc: null, task2Wc: null, task1EssayId: null, task2EssayId: null, band: null, bandIsFinal: false, ...over });
  test('the cell renders the band next to the word counts', () => {
    assert.equal(writingText(row({ task1Wc: 160, task2Wc: 270 })), 'T1 160 · T2 270 từ');
    assert.equal(writingText(row({ task1Wc: 160, task2Wc: 270, band: 6.5, bandIsFinal: true })), 'T1 160 · T2 270 từ · B6.5');
  });
  // A suggestion rendered like a confirmed band would show a score nobody signed off on.
  test('a suggestion is tilde-prefixed; a confirmed band is not', () => {
    assert.equal(writingText(row({ band: 6.5, bandIsFinal: false })), '~B6.5');
    assert.equal(writingText(row({ band: 6.5, bandIsFinal: true })), 'B6.5');
  });
  // Counts and band are independent facts (Codex review, PR #775).
  test('"—" only when the counts AND the band are both absent', () => {
    assert.equal(writingText(row({})), '—');
  });
  test('a band with no word counts still renders (band alone, no prefix)', () => {
    assert.equal(writingText(row({ band: 5, bandIsFinal: true })), 'B5.0');
  });
});

// The L/R bands were already in ai_draft, but the form only ever read
// draft.writing, so the examiner retyped numbers the machine had stored.
describe('admin-mock-reviews — every band pre-fills, not just Writing', () => {
  test('reads the band out of the real ai_draft shapes', () => {
    const draft = {
      listening: { raw: 18, band: 5.5 },
      reading: { raw: 30, band: 7.0 },
      writing: { band: 5.0, task1_band: 5.0, task2_band: 5.0 },
    };
    assert.equal(draftBandOf(draft, 'listening'), 5.5);
    assert.equal(draftBandOf(draft, 'reading'), 7.0);
    assert.equal(draftBandOf(draft, 'writing'), 5.0);
  });
  test('a bare number is tolerated — the shape is not schema-pinned', () => {
    assert.equal(draftBandOf({ listening: 6.5 }, 'listening'), 6.5);
  });
  test('absent / null / band-less yield null, never 0 or NaN', () => {
    assert.equal(draftBandOf({}, 'listening'), null);
    assert.equal(draftBandOf({ listening: null }, 'listening'), null);
    assert.equal(draftBandOf({ writing: { band: null } }, 'writing'), null);
    assert.equal(draftBandOf(null, 'reading'), null);
  });
  test('the form pre-fills from the draft for ANY skill, not just writing', () => {
    const detail = detailWith({ draft: { listening: { raw: 18, band: 5.5 }, reading: { raw: 30, band: 7 } } });
    assert.deepEqual(initialBandDraft(detail), { listening: '5.5', reading: '7', writing: '' });
  });
  test('each pre-filled band names where it came from', () => {
    const detail = detailWith({ draft: { listening: { raw: 18, band: 5.5 }, reading: { raw: 30, band: 7 } } });
    assert.equal(bandCaption(detail, 'listening'), 'Tự tính từ số câu đúng');
    assert.equal(bandCaption(detail, 'reading'), 'Tự tính từ số câu đúng');
    assert.equal(BAND_SOURCE.listening, 'Tự tính từ số câu đúng');
  });
  test('a confirmed band gets no caption', () => {
    const detail = detailWith({ draft: { listening: { band: 5.5 } }, final: { listening: 6 } });
    assert.equal(bandCaption(detail, 'listening'), '');
  });
});

// Writing/L/R blank for a reason: the caption says the box may stay empty.
describe('admin-mock-reviews — a blankable skill says it may stay empty', () => {
  test('the blankable caption replaces the "must type" caption', () => {
    const detail = detailWith({ blankable: ['listening', 'writing'] });
    assert.match(bandCaption(detail, 'listening'), /có thể để trống/);
    assert.match(bandCaption(detail, 'writing'), /^Chưa chấm đủ 2 bài .*có thể để trống/);
    assert.equal(bandCaption(detail, 'reading'), 'Chưa có band tự tính — cần bạn nhập.');
  });
});
