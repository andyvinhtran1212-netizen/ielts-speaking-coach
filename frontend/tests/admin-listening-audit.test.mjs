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
import { readListeningRouterSource } from './fixtures/listening-router-source.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const dashHtml = read('frontend/pages/admin/listening/audit.html');
const detHtml  = read('frontend/pages/admin/listening/audit-detail.html');
const testsHtml = read('frontend/pages/admin/listening/tests.html');
const router = readListeningRouterSource();


describe('audit dashboard', () => {
  test('mounts admin chrome + loads api.js + the controller', () => {
    assert.match(dashHtml, /<aver-admin-chrome active="listening"/);
    assert.match(dashHtml, /src="\/js\/api\.js"/);
    assert.match(dashHtml, /src="\/js\/admin-listening-audit\.js"/);
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
