/**
 * frontend/tests/writing-task1-image.test.mjs — Sprint 19.3.5.
 *
 * Pins the Task 1 Academic image surfaces:
 *   • new.html        — prompt-image upload (task1_academic only) → prompt_image_url
 *   • grade.html      — chart display (admin)
 *   • writing-result.html — chart display (student)
 *   • shared lightbox js/css
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let newHtml, gradeHtml, resultHtml, lbJs, lbCss;

before(() => {
  newHtml    = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/new.html'), 'utf8');
  gradeHtml  = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/grade.html'), 'utf8');
  resultHtml = readFileSync(path.join(REPO_ROOT, 'frontend/pages/writing-result.html'), 'utf8');
  lbJs       = readFileSync(path.join(REPO_ROOT, 'frontend/js/image-lightbox.js'), 'utf8');
  lbCss      = readFileSync(path.join(REPO_ROOT, 'frontend/css/image-lightbox.css'), 'utf8');
});


describe('new.html / Task 1 Academic image upload', () => {
  test('prompt-image section + file input + hidden URL field present', () => {
    assert.match(newHtml, /id="prompt-image-section"/);
    assert.match(newHtml, /id="f-prompt-image"[^>]*accept="image\//);
    assert.match(newHtml, /id="f-prompt-image-url"/);
  });
  test('section toggled by task1_academic + reuses prompts upload endpoint', () => {
    assert.match(newHtml, /function\s+syncPromptImageSection\s*\(/);
    assert.match(newHtml, /'f-task-type'\)\.value === 'task1_academic'/);
    assert.match(newHtml, /\/admin\/writing\/prompts\/upload-image/);
  });
  test('essay-create payload carries prompt_image_url', () => {
    assert.match(newHtml, /prompt_image_url:\s*document\.getElementById\('f-prompt-image-url'\)\.value/);
  });
});


describe('grade.html / chart display (admin)', () => {
  test('prompt-image element + task1_academic gating + lightbox', () => {
    assert.match(gradeHtml, /id="prompt-image"/);
    // Gating is now via the _primaryImg helper (task1_academic → snapshot URL).
    assert.match(gradeHtml, /_primaryImg\s*=\s*\(detail\.task_type === 'task1_academic'\)\s*\?\s*detail\.prompt_image_url/);
    assert.match(gradeHtml, /AvImageLightbox\.open/);
  });
  test('stale-snapshot fallback: swaps to prompt_image_url_fallback on <img> error', () => {
    assert.match(gradeHtml, /detail\.prompt_image_url_fallback/);
    assert.match(gradeHtml, /promptImg\.onerror\s*=\s*function/);
    // One-shot: handler clears itself so a failing fallback can't loop.
    assert.match(gradeHtml, /promptImg\.onerror\s*=\s*null/);
  });
  test('lightbox assets linked', () => {
    assert.match(gradeHtml, /css\/image-lightbox\.css/);
    assert.match(gradeHtml, /js\/image-lightbox\.js/);
  });
});


describe('writing-result.html / chart display (student)', () => {
  test('prompt-image element + task1_academic gating + lightbox', () => {
    assert.match(resultHtml, /id="prompt-image"/);
    assert.match(resultHtml, /essay\.task_type === 'task1_academic' && essay\.prompt_image_url/);
    assert.match(resultHtml, /AvImageLightbox\.open/);
  });
  test('lightbox assets linked', () => {
    assert.match(resultHtml, /css\/image-lightbox\.css/);
    assert.match(resultHtml, /js\/image-lightbox\.js/);
  });
});


describe('shared image lightbox', () => {
  test('exposes window.AvImageLightbox.open + Esc/backdrop close', () => {
    assert.match(lbJs, /window\.AvImageLightbox\s*=\s*\{\s*open/);
    assert.match(lbJs, /key === 'Escape'/);
  });
  test('CSS declared, tokens only (no hex / skipped 4px steps)', () => {
    assert.match(lbCss, /\.prompt-chart-img/);
    assert.match(lbCss, /\.av-lightbox/);
    const stripped = lbCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(stripped), 'no hex literals');
    assert.ok(!/var\(--av-space-(5|7|9|10|11|13|14|15)\)/.test(lbCss), 'no skipped 4px steps');
  });
});
