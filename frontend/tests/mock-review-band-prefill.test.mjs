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
