/**
 * frontend/tests/writing-independent-upload.test.mjs — Sprint 19.3.
 *
 * Pins the independent-grading file-upload UI:
 *   • new.html  — .docx upload panel → extract → fills the essay field
 *   • grade.html — export UX polish (copy-for-Google-Docs + .docx labels)
 *   • admin-writing.css — extract-warning chips
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let newHtml, gradeHtml, css;

before(() => {
  newHtml   = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/new.html'), 'utf8');
  gradeHtml = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/grade.html'), 'utf8');
  css       = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'), 'utf8');
});


describe('new.html / Sprint 19.3 upload', () => {
  test('drag-drop upload panel present (reuses 19.1C .aw-import-* idiom)', () => {
    assert.match(newHtml, /id="upload-panel"/);
    assert.match(newHtml, /id="extract-dropzone"/);
    assert.match(newHtml, /id="extract-file"[^>]*accept="\.docx/);
    assert.match(newHtml, /aw-import-dropzone/);
  });

  test('extract posts to the admin endpoint + fills the essay textarea (source of truth)', () => {
    assert.match(newHtml, /\/admin\/writing\/extract-text/);
    assert.match(newHtml, /function\s+extractFile\s*\(/);
    // Fills #f-essay then dispatches input so the word count updates.
    assert.match(newHtml, /getElementById\('f-essay'\)/);
    assert.match(newHtml, /dispatchEvent\(new Event\('input'/);
  });

  test('paste textarea is preserved (not hidden) — upload is an assist', () => {
    assert.match(newHtml, /id="f-essay"/);
    assert.match(newHtml, /wireExtractUpload\(\)/);
  });

  test('extraction warnings rendered as chips', () => {
    assert.match(newHtml, /id="extract-warnings"/);
    assert.match(newHtml, /function\s+renderExtractWarnings\s*\(/);
    assert.ok(css.includes('.aw-extract-warn'), '.aw-extract-warn must be declared');
  });
});


describe('grade.html / Sprint 19.3 export polish', () => {
  test('copy-for-Google-Docs + .docx download buttons with clear VN labels', () => {
    assert.match(gradeHtml, /id="btn-copy"[^>]*>📋 Sao chép \(Google Docs\)/);
    assert.match(gradeHtml, /id="btn-download"[^>]*>⬇ Tải \.docx/);
  });

  test('export backend mechanism unchanged (render→clipboard + export.docx)', () => {
    assert.match(gradeHtml, /\/render/);
    assert.match(gradeHtml, /export\.docx/);
    assert.match(gradeHtml, /navigator\.clipboard/);
  });

  test('loading state added to copy + download handlers', () => {
    assert.match(gradeHtml, /Đang sao chép/);
    assert.match(gradeHtml, /Đang tải/);
  });
});
