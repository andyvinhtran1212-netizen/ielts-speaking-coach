/**
 * admin-a11y-labels.test.mjs — admin-upgrade a11y tail (attribute-only).
 *
 * grade.html: the 15 editor textareas (.aw-* island) get accessible names via
 * aria-label (they have visual section headers, not <label> — so aria-label, not
 * for/id). + interactive prompt-image. Admin sweep: students toolbar/bulk/row
 * controls. NO layout/logic/structure change.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const GRADE = read('pages', 'admin', 'writing', 'grade.html');
const STU = read('pages', 'admin', 'students', 'index.html');

const DATA_INPUTS = [
  'criteria', 'overview', 'trajectory', 'mistakes', 'recurring', 'lexical',
  'sentence-structure', 'coherence', 'idea-development', 'counterargument',
  'instructor-note', 'improved', 'ai-content', 'key-takeaways',
];


describe('grade.html — 15 editor textareas have accessible names', () => {
  for (const k of DATA_INPUTS) {
    test(`textarea[data-input="${k}"] has aria-label`, () => {
      // aria-label is emitted before data-input on the same <textarea> tag.
      assert.match(GRADE, new RegExp(`<textarea aria-label="[^"]+"[^>]*data-input="${k.replace(/-/g, '\\-')}"`));
    });
  }
  test('instructor-note-input textarea has aria-label', () => {
    assert.match(GRADE, /<textarea aria-label="[^"]+"\s*\n?\s*id="instructor-note-input"/);
  });
  test('exactly 15 textareas carry aria-label', () => {
    assert.equal((GRADE.match(/<textarea aria-label="/g) || []).length, 15);
  });
  test('interactive prompt-image (role=button) has an accessible name', () => {
    assert.match(GRADE, /id="prompt-image"[^>]*role="button"[^>]*aria-label="[^"]+"/);
  });
});


describe('grade.html — attribute-only (logic/structure untouched)', () => {
  test('data-input hooks preserved (JS selectors still resolve)', () => {
    for (const k of DATA_INPUTS) assert.match(GRADE, new RegExp(`data-input="${k.replace(/-/g, '\\-')}"`));
  });
  test('save path unchanged (still PATCHes /feedback)', () => {
    assert.match(GRADE, /window\.api\.patch\('\/admin\/writing\/essays\/'\s*\+\s*_essayId\s*\+\s*'\/feedback'/);
  });
});


describe('admin sweep — students.html controls have accessible names', () => {
  test('toolbar search-input has aria-label', () => {
    assert.match(STU, /id="search-input"[^>]*aria-label="[^"]+"/);
  });
  test('bulk-cohort select has aria-label', () => {
    assert.match(STU, /id="bulk-cohort"[^>]*aria-label="[^"]+"/);
  });
  test('per-row checkbox has aria-label', () => {
    assert.match(STU, /class="row-check" aria-label="[^"]+"/);
  });
});
