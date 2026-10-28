/**
 * B10 — Task 1 charts live in the private `writing-images` bucket and are
 * signed per request. When signing fails the backend returns
 * `prompt_image_url: null` + `prompt_image_lookup_failed: true`; learner
 * surfaces must say so (with a retry), never present a chartless Task 1 prompt.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const BEHAVIOR = read('app', '(authed-writing)', 'writing', 'dashboard', 'writing-behavior.tsx');
const SHELL = read('app', '(authed-writing)', 'writing', 'dashboard', 'page-shell.tsx');
const CSS = read('public', 'css', 'writing-dashboard.css');

describe('Writing workspace / private Task 1 chart', () => {
  test('assignment modal renders the image through one helper that reads the failure flag', () => {
    assert.match(BEHAVIOR, /function applyModalPromptImage\(/);
    assert.match(BEHAVIOR, /applyModalPromptImage\(prompt, ms, /);
    assert.match(BEHAVIOR, /prompt\?\.prompt_image_lookup_failed === true/);
    assert.match(BEHAVIOR, /\$\('modal-prompt-image-failed'\)/);
  });

  test('retry re-reads the assignment (GET only) and keeps the current workspace', () => {
    const helper = BEHAVIOR.slice(BEHAVIOR.indexOf('function applyModalPromptImage('), BEHAVIOR.indexOf('function renderModal('));
    assert.match(helper, /window\.api\.get<any>\('\/api\/writing\/my-assignments\/' \+ encodeURIComponent\(assignmentId\)\)/);
    assert.doesNotMatch(helper, /\/start'|api\.post/);
    assert.match(helper, /ms\.assignmentId !== assignmentId/);
  });

  test('shell has an announced warning with a retry button, hidden by default', () => {
    assert.match(SHELL, /id="modal-prompt-image-failed" className="wd-modal-prompt__image-failed hidden" role="alert"/);
    assert.match(SHELL, /id="modal-prompt-image-retry" type="button"/);
    assert.match(CSS, /\.wd-modal-prompt__image-failed\.hidden \{ display: none; \}/);
  });

  test('prompt bank flags a chart even when no URL is returned and says it failed', () => {
    assert.match(BEHAVIOR, /p\.prompt_image_url \|\| p\.has_prompt_image \? ' 🖼️'/);
    assert.match(BEHAVIOR, /Không tải được hình đề\. Tải lại trang để thử lại\./);
  });
});

describe('Result and grade pages / private Task 1 chart', () => {
  const RESULT = read('app', '(authed-writing-result)', 'writing', 'result', 'writing-result-behavior.tsx');
  const GRADE = read('app', '(authed-admin-writing-grade)', 'admin', 'writing', 'grade', 'writing-grade-behavior.tsx');
  const LIGHTBOX_CSS = read('public', 'css', 'image-lightbox.css');
  test('both pages announce an unsigned chart instead of rendering nothing', () => {
    assert.match(RESULT, /!essay\.prompt_image_url && essay\.prompt_image_lookup_failed \? <p className="prompt-chart-failed" role="status">/);
    assert.match(GRADE, /detail\.prompt_image_lookup_failed \? <p className="prompt-chart-failed" role="status">/);
    assert.match(LIGHTBOX_CSS, /\.prompt-chart-failed \{/);
  });
});
