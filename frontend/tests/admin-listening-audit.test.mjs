/**
 * admin-listening-audit.test.mjs
 *
 * Pin the listening content-audit dashboard + in-place editor (sentinel match
 * over static page + controller source). Catches:
 *   - admin chrome + module wiring regressing
 *   - the audit endpoints the pages depend on being renamed
 *   - the per-question PATCH edit contract (exercises/{id}/questions/{q})
 *   - windowed playback (segment-start/segment-end) disappearing
 *   - the tests page losing its Audit entry link
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const dashHtml = read('frontend/pages/admin/listening/audit.html');
const dashJs   = read('frontend/js/admin-listening-audit.js');
const detHtml  = read('frontend/pages/admin/listening/audit-detail.html');
const detJs    = read('frontend/js/admin-listening-audit-detail.js');
const testsHtml = read('frontend/pages/admin/listening/tests.html');
const router   = read('backend/routers/listening.py');


describe('audit dashboard', () => {
  test('mounts admin chrome + loads api.js + the controller', () => {
    assert.match(dashHtml, /<aver-admin-chrome active="listening"/);
    assert.match(dashHtml, /src="\/js\/api\.js"/);
    assert.match(dashHtml, /src="\/js\/admin-listening-audit\.js"/);
  });
  test('fetches per-test audit via GET .../audit and links to the editor', () => {
    assert.match(dashJs, /\/admin\/listening\/tests\/'?\s*\+\s*encodeURIComponent\([^)]+\)\s*\+\s*'\/audit/);
    assert.match(dashJs, /audit-detail\.html\?id=/);
  });
  test('uses design tokens, no raw hex', () => {
    const hex = dashHtml.match(/#[0-9a-fA-F]{3,6}/g) || [];
    assert.equal(hex.length, 0, `unexpected hex: ${hex}`);
  });
});


describe('audit editor', () => {
  test('mounts admin chrome + audio-player + controller', () => {
    assert.match(detHtml, /<aver-admin-chrome active="listening"/);
    assert.match(detHtml, /components\/audio-player\.js/);
    assert.match(detHtml, /<audio-player id="ad-player"/);
    assert.match(detHtml, /src="\/js\/admin-listening-audit-detail\.js"/);
  });
  test('per-question edit → PATCH exercises/{id}/questions/{q}', () => {
    assert.match(detJs, /\/admin\/listening\/exercises\/'?\s*\+\s*encodeURIComponent\([^)]+\)\s*\+\s*'\/questions\//);
    assert.match(detJs, /window\.api\.patch/);
  });
  test('transcript edit → PATCH content/{id}', () => {
    assert.match(detJs, /\/admin\/listening\/content\//);
  });
  test('windowed playback uses segment-start/segment-end + seekTo', () => {
    assert.match(detJs, /segment-start/);
    assert.match(detJs, /segment-end/);
    assert.match(detJs, /seekTo/);
  });
  test('run-full-audit → POST .../audit/run ; triage → PATCH .../audit', () => {
    assert.match(detJs, /\/audit\/run/);
    assert.match(detJs, /\/audit['"]\s*,\s*\n?\s*\{\s*status/);
  });
  test('no raw hex in editor page', () => {
    const hex = detHtml.match(/#[0-9a-fA-F]{3,6}/g) || [];
    assert.equal(hex.length, 0, `unexpected hex: ${hex}`);
  });
});


describe('backend + nav wiring', () => {
  test('backend exposes the audit + edit routes', () => {
    assert.match(router, /@admin_router\.get\(["']\/tests\/\{test_id\}\/audit["']\)/);
    assert.match(router, /@admin_router\.post\(["']\/tests\/\{test_id\}\/audit\/run["']\)/);
    assert.match(router, /@admin_router\.patch\(["']\/tests\/\{test_id\}\/audit["']\)/);
    assert.match(router, /@admin_router\.patch\(["']\/exercises\/\{exercise_id\}\/questions\/\{q_num\}["']\)/);
  });
  test('tests page links to the audit dashboard', () => {
    assert.match(testsHtml, /href="\/pages\/admin\/listening\/audit\.html"/);
  });
});
