/**
 * frontend/tests/vocab-exam-split.test.mjs
 *
 * Exam-prep vocab is kept SEPARATE from the self-curated topic vocab:
 *  • vocabulary.html hub gains a "Luyện thi" mode-card → /pages/vocab-exam.html
 *  • vocab-exam.js renders exam families (AWL/TOEIC/THPT) → their non-empty lists,
 *    each launching flashcard-study.html?stack=examlist:<slug>
 *  • flashcard-study.js gains an examlist branch (reuses the wiki renderer) that
 *    loads /api/vocabulary/exam/<slug>/cards
 *  • vocab-landing.js drops 0-word topic cards (a topic emptied by the split)
 *
 * Mix of behavioural (renderFamilies) + source-string assertions (same approach
 * as vocab-topic-study.test.mjs).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FE = join(__dirname, '..');
const read = (p) => readFileSync(join(FE, p), 'utf8');
const require = createRequire(import.meta.url);

describe('vocab-exam.js renderFamilies', () => {
  const { renderFamilies } = require('../js/vocab-exam.js');

  const FAMILIES = [
    { family: 'awl', title: 'AWL', lists: [
      { slug: 'awl-sublist-1', title: 'AWL Sublist 1', count: 60 },
      { slug: 'awl-sublist-2', title: 'AWL Sublist 2', count: 0 },  // empty → hidden
    ] },
    { family: 'toeic', title: 'TOEIC', lists: [
      { slug: 'toeic-core', title: 'TOEIC Core', count: 12 },
    ] },
    { family: 'thpt', title: 'THPT', lists: [
      { slug: 'thpt-core', title: 'THPT Core', count: 0 },          // empty family → hidden
    ] },
  ];

  test('renders only non-empty lists, each linking to the examlist flashcard stack', () => {
    const html = renderFamilies(FAMILIES);
    assert.match(html, /stack=examlist:awl-sublist-1/);
    assert.match(html, /stack=examlist:toeic-core/);
    // Empty list + empty family are dropped.
    assert.doesNotMatch(html, /awl-sublist-2/);
    assert.doesNotMatch(html, /thpt-core/);
    // Count surfaced.
    assert.match(html, /60 từ/);
  });

  test('no families → empty string (page then shows the empty state)', () => {
    assert.equal(renderFamilies([]), '');
    assert.equal(renderFamilies([{ family: 'awl', title: 'AWL', lists: [] }]), '');
  });
});

describe('wiring across pages', () => {
  test('hub exposes a Luyện thi entry to the exam page', () => {
    const html = read('pages/vocabulary.html');
    assert.match(html, /href="\/pages\/vocab-exam\.html"/);
    assert.match(html, /Luyện thi/);
  });

  test('exam page loads api + the exam script', () => {
    const html = read('pages/vocab-exam.html');
    assert.match(html, /\/js\/vocab-exam\.js/);
    assert.match(html, /\/js\/api\.js/);
  });

  test('flashcard-study has an examlist branch hitting the exam endpoint', () => {
    const js = read('js/flashcard-study.js');
    assert.match(js, /examlist:/);
    assert.match(js, /loadExamCards/);
    assert.match(js, /\/api\/vocabulary\/exam\//);
  });

  test('vocab-landing drops 0-word topic cards', () => {
    const js = read('js/vocab-landing.js');
    assert.match(js, /withWords/);
  });
});
