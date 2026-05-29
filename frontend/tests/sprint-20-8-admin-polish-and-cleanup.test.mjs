/**
 * frontend/tests/sprint-20-8-admin-polish-and-cleanup.test.mjs
 *
 * Sprint 20.8 — cluster 20.x close sentinel:
 *   - A1 — drag-drop accepts .md / .markdown by extension (MIME-independent)
 *   - A3 — Reading admin sidebar entry has its icon glyph (book-open)
 *   - A4 — library filter includes L3 Full Test button
 *   - A5 — admin reading page references reading_content_format_v2
 *   - B1 — reading-exam-mockup.{html,js} + their sentinel are removed
 *
 * Static-analysis only — no DOM. Mirrors the cluster's existing sentinel
 * pattern (sprint-20-2 / 20-3 / 20-6).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read   = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const exists = (rel) => existsSync(path.join(REPO_ROOT, rel));


// ── A1 — Drag-drop .md acceptance (extension-only) ────────────────────

describe('Sprint 20.8 A1 — admin-reading.js drag-drop .md file acceptance', () => {
  const js = read('frontend/js/admin-reading.js');

  test('pickFile() exists', () => {
    assert.match(js, /function pickFile\s*\(/);
  });

  test('rejection regex checks ONLY the extension (not the MIME)', () => {
    // The 20.8 fix replaces `file.name + ' ' + file.type` with the name alone.
    // Regression-guard: no concatenated test against file.type, no
    // `^text\/markdown$` alternative.
    assert.ok(!/file\.name\s*\+\s*['"]\s+['"]\s*\+\s*\(?\s*file\.type/.test(js),
      'pickFile must not concatenate file.name + file.type into the validator regex');
    assert.match(js, /\/\\\.\(md\|markdown\)\$\/i/,
      'pickFile must use the case-insensitive extension regex /\\.(md|markdown)$/i');
  });

  test('preserves the dragover/drop wiring (regression guard)', () => {
    assert.match(js, /dz\.addEventListener\('drop'/);
    assert.match(js, /e\.dataTransfer\.files/);
  });

  test('preserves the file-input change handler (regression guard)', () => {
    assert.match(js, /input\.addEventListener\('change'/);
  });
});


// ── A3 — Reading sidebar icon ────────────────────────────────────────

describe('Sprint 20.8 A3 — Reading admin sidebar icon', () => {
  const chrome = read('frontend/js/components/aver-admin-chrome.js');

  test("Reading nav item still references icon 'book-open'", () => {
    assert.match(chrome, /section: 'reading',[^}]*icon: 'book-open'/);
  });

  test("ICONS map now defines a 'book-open' glyph (the bug was the missing key)", () => {
    // 20.1 set icon:'book-open' but no key existed → fallback to ''.
    // Sentinel: the key is present and carries a non-trivial SVG path.
    assert.match(chrome, /'book-open':\s*'<path[^']{20,}'/);
  });
});


// ── A4 — L3 library filter button ────────────────────────────────────

describe('Sprint 20.8 A4 — admin content page library filter includes L3', () => {
  const html = read('frontend/pages/admin/reading/content.html');

  test('filter ships L1, L2, AND L3 buttons (in that order)', () => {
    assert.match(html, /data-library="l1_vocab"[^>]*>L1 Vocab/);
    assert.match(html, /data-library="l2_skill"[^>]*>L2 Skill/);
    assert.match(html, /data-library="l3_test"[^>]*>L3 Full Test/);
  });

  test('default filter is "Tất cả" (no library)', () => {
    assert.match(html, /data-library=""\s+role="tab" aria-selected="true">Tất cả/);
  });
});


describe('Sprint 20.8 A4 — admin-reading.js library label map', () => {
  const js = read('frontend/js/admin-reading.js');
  test('friendly labels exist for all three libraries', () => {
    assert.match(js, /l1_vocab:\s*'L1 Vocab'/);
    assert.match(js, /l2_skill:\s*'L2 Skill'/);
    assert.match(js, /l3_test:\s*'L3 Test'/);
  });
});


// ── A5 — Doc reference v1 → v2 ───────────────────────────────────────

describe('Sprint 20.8 A5 — content_format_v2 reference', () => {
  const html = read('frontend/pages/admin/reading/content.html');

  test('admin reading page references reading_content_format_v2 (NOT v1)', () => {
    assert.match(html, /reading_content_format_v2/);
    assert.ok(!/reading_content_format_v1/.test(html),
      'admin reading page must not reference the outdated v1 spec');
  });

  test('reference is a clickable link to the v2 doc', () => {
    assert.match(html,
      /href="[^"]*reading_content_format_v2\.md"[^>]*target="_blank"/);
  });
});


// ── A2 — Structured-content preview wiring ───────────────────────────

describe('Sprint 20.8 A2 — structured preview container + renderer wiring', () => {
  const html = read('frontend/pages/admin/reading/content.html');
  const js   = read('frontend/js/admin-reading.js');

  test('preview container #ar-structure is present in the import panel', () => {
    assert.match(html, /id="ar-structure"\s+class="ar-structure"\s+hidden/);
  });

  test('renderPreview reads the structure container and conditionally fills it', () => {
    assert.match(js, /\$\('ar-structure'\)/);
    // Only renders on a CLEAN dry-run (errs.length must short-circuit it).
    assert.match(js, /if\s*\(\s*errs\.length\s*\|\|\s*!struct\s*\)/);
  });

  test('L3 branch renders a passage-summary table (Part / Slug / Title / Words / Câu hỏi)', () => {
    assert.match(js, /Cấu trúc bài test/);
    assert.match(js, /Part /);
    assert.match(js, /passage_order/);
    assert.match(js, /question_count/);
  });

  test('L1/L2 branch renders glossary + body excerpt blocks', () => {
    assert.match(js, /Glossary/);
    assert.match(js, /ar-struct__body/);
  });
});


// ── B1 — Mockup retirement ───────────────────────────────────────────

describe('Sprint 20.8 B1 — reading-exam-mockup retirement', () => {
  test('mockup HTML file is deleted', () => {
    assert.ok(!exists('frontend/pages/reading-exam-mockup.html'),
      'frontend/pages/reading-exam-mockup.html must be deleted in 20.8');
  });

  test('mockup JS file is deleted', () => {
    assert.ok(!exists('frontend/js/reading-exam-mockup.js'),
      'frontend/js/reading-exam-mockup.js must be deleted in 20.8');
  });

  test("the 20.4 mockup sentinel is deleted (mockup-specific, can't pin a deleted file)", () => {
    assert.ok(!exists('frontend/tests/sprint-20-4-exam-chrome-mockup.test.mjs'),
      'the 20.4 mockup sentinel test must be deleted in 20.8');
  });

  test('production exam page (reading-exam.html) still exists and loads its CSS', () => {
    // The CSS file `reading-exam-mockup.css` is INTENTIONALLY kept (production
    // chrome styles share that filename — rename is a separate deferred item).
    assert.ok(exists('frontend/pages/reading-exam.html'));
    const html = read('frontend/pages/reading-exam.html');
    assert.match(html, /href="\/css\/reading-exam-mockup\.css"/);
  });
});
