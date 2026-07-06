/**
 * admin-listening-drills-import.test.mjs — admin batch import for skill drills.
 *
 * Static sentinels pin the wiring + the contracts (same approach as the
 * full-test import test):
 *   • the page loads the batch controller + api.js;
 *   • directory picker (webkitdirectory) so a whole drills folder can be picked;
 *   • dry-run hits /admin/listening/drills/import, commit hits …/commit;
 *   • bundles are matched by test_id (JSON name ↔ audio_output/<TEST_ID>/);
 *   • a drill with no audio still commits (no `audio` part → draft);
 *   • the backend exposes both endpoints;
 *   • the tests-list page links to the drills import page.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const html      = read('frontend/pages/admin/listening/import-drills.html');
const js        = read('frontend/js/admin-listening-drills-import.js');
const testsHtml = read('frontend/pages/admin/listening/tests.html');
const router    = read('backend/routers/listening.py');


describe('import-drills page shell', () => {
  test('loads api.js + the batch controller', () => {
    assert.match(html, /src="\/js\/api\.js"/);
    assert.match(html, /src="\/js\/admin-listening-drills-import\.js"/);
  });
  test('offers a directory picker + scan + import buttons', () => {
    assert.match(html, /id="di-dir"[^>]*webkitdirectory/);
    assert.match(html, /id="di-scan"/);
    assert.match(html, /id="di-import"/);
    assert.match(html, /id="di-rows"/);
  });
  test('back-links to the admin tests list', () => {
    assert.match(html, /href="\/pages\/admin\/listening\/tests\.html"/);
  });
});


describe('import-drills controller contract', () => {
  test('dry-run posts to /admin/listening/drills/import via api.upload', () => {
    assert.match(js, /window\.api\.upload\(\s*['"]\/admin\/listening\/drills\/import['"]/);
  });
  test('commit posts to /admin/listening/drills/import/commit', () => {
    assert.match(js, /\/admin\/listening\/drills\/import\/commit/);
  });
  test('matches bundles by test_id (json name ↔ audio_output/<TEST_ID>/)', () => {
    assert.match(js, /audio_output/);
    assert.match(js, /testIdFromJsonName/);
    assert.match(js, /full_test\.mp3/);
    assert.match(js, /timings\.json/);
  });
  test('audio is optional — appended only when present (no audio → draft)', () => {
    assert.match(js, /if\s*\(b\.audioFile\)\s*fd\.append\(\s*['"]audio['"]/);
  });
  test('a valid dry-run row is checkbox-selectable; errors block it', () => {
    assert.match(js, /p\.ok/);
    assert.match(js, /di-check/);
  });
});


describe('backend endpoints + admin entry point', () => {
  test('backend exposes drills import + commit routes', () => {
    assert.match(router, /@admin_router\.post\(["']\/drills\/import["']\)/);
    assert.match(router, /@admin_router\.post\(["']\/drills\/import\/commit["']\)/);
  });
  test('tests list page links to the drills import page', () => {
    assert.match(testsHtml, /href="\/pages\/admin\/listening\/import-drills\.html"/);
  });
});
