/**
 * frontend/tests/bundle-import-ui.test.mjs
 *
 * bundle-import-ui — the admin content page gains a 2-file (đề + giải) upload
 * that posts to POST /admin/reading/content/import-bundle (Part A #376). The
 * prose format has no YAML frontmatter, so it can't use the single-file
 * dropzone; the answer keys live in the GIẢI file, so both files go together.
 * Reuses the single-file dry-run → preview → commit panel. The single-file
 * YAML import must stay intact.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const html = read('frontend/pages/admin/reading/content.html');
const js = read('frontend/js/admin-reading.js');
const router = read('backend/routers/admin_reading.py');


describe('A — bundle UI markup (đề + giải inputs)', () => {
  test('content.html has two labelled file inputs in a bundle section', () => {
    assert.match(html, /class="ar-bundle"/);
    assert.match(html, /id="ar-bundle-test"[^>]*type="file"/);
    assert.match(html, /id="ar-bundle-solution"[^>]*type="file"/);
    assert.match(html, /Import full test/);
  });
});


describe('B — bundle JS flow (dry-run → preview → commit)', () => {
  test('picking both files runs a dry-run preview against /import-bundle', () => {
    assert.match(js, /function pickBundleFile\(which, file\)/);
    assert.match(js, /STATE\.testFile && STATE\.solutionFile[\s\S]{0,80}runBundlePreview/);
    assert.match(js, /import-bundle\?dry_run=true/);
    // both files posted under the endpoint's field names
    assert.match(js, /fd\.append\('test_file', STATE\.testFile\)/);
    assert.match(js, /fd\.append\('solution_file', STATE\.solutionFile\)/);
  });

  test('commit routes by mode to the bundle endpoint (published)', () => {
    assert.match(js, /STATE\.mode === 'bundle'\)\s*\{\s*runBundleCommit\(\)/);
    assert.match(js, /import-bundle\?dry_run=false&published=true/);
  });

  test('one file only → helpful info nudge, not an error', () => {
    const fn = js.slice(js.indexOf('function pickBundleFile'),
                        js.indexOf('function _bundleFormData'));
    // the nudge is an 'info' status (not 'error'), naming the missing file
    assert.match(fn, /Chọn thêm file ' \+ need[\s\S]{0,40}'info'/);
    assert.match(fn, /need = STATE\.testFile \? 'GIẢI/);
  });

  test('preview surfaces the bundle_summary (translation / IMG-PROMPT / solution)', () => {
    assert.match(js, /res\.bundle_summary/);
    assert.match(js, /bản dịch[\s\S]{0,40}passages_with_translation/);
    assert.match(js, /IMG-PROMPT[\s\S]{0,40}img_prompt_blocks/);
    assert.match(js, /giải chi tiết[\s\S]{0,40}questions_with_solution/);
  });

  test('resetImport clears the bundle state + inputs', () => {
    const fn = js.slice(js.indexOf('function resetImport'));
    assert.match(fn, /STATE\.testFile = null/);
    assert.match(fn, /STATE\.solutionFile = null/);
    assert.match(fn, /STATE\.mode = 'single'/);
    assert.match(fn, /ar-bundle-test'\)\.value = ''/);
  });
});


describe('C — single-file YAML import intact (no regression)', () => {
  test('single-file pick still posts to /import (not the bundle endpoint)', () => {
    assert.match(js, /function pickFile\(file\)/);
    assert.match(js, /content\/import\?dry_run=true/);
    // pickFile sets single mode so the shared commit routes correctly
    const fn = js.slice(js.indexOf('function pickFile'), js.indexOf('function resetImport'));
    assert.match(fn, /STATE\.mode = 'single'/);
  });
});


describe('D — backend endpoint adds bundle_summary', () => {
  test('import-bundle attaches translation / img-prompt / solution counts', () => {
    assert.match(router, /result\["bundle_summary"\]\s*=\s*\{/);
    assert.match(router, /"passages_with_translation":/);
    assert.match(router, /"img_prompt_blocks":/);
    assert.match(router, /"questions_with_solution":/);
  });
});
