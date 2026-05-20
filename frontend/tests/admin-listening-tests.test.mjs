/**
 * frontend/tests/admin-listening-tests.test.mjs — Sprint 13.4
 * (DEBT-ADMIN-LISTENING-AUTHORING 6/N).
 *
 * Pins the markup + JS-module contract for the Cambridge IELTS tests
 * admin browser:
 *   - /pages/admin/listening/tests.html (filter + search + table)
 *   - /js/admin-listening-tests-list.js (GET /admin/listening/tests,
 *     pagination, status filter, search-by-test-id debounce)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const read = (...parts) =>
  readFileSync(path.join(REPO_ROOT, 'frontend', ...parts), 'utf8');


// ── Tests browser page structure ────────────────────────────────────────────


describe('Sprint 13.4 — tests page structure', () => {
  const html = read('pages', 'admin', 'listening', 'tests.html');

  test('embeds chrome with active=listening + subsection=tests', () => {
    assert.match(
      html,
      /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']tests["']/,
    );
  });

  test('header copy mentions Cambridge IELTS bundles', () => {
    assert.match(html, /Cambridge IELTS/);
  });

  test('status filter dropdown carries all 4 options', () => {
    assert.match(html, /id=["']tl-status["']/);
    for (const v of ['all', 'draft', 'published', 'archived']) {
      assert.match(html, new RegExp(`<option value=["']${v}["']`));
    }
  });

  test('search-by-test-id input present', () => {
    assert.match(html, /id=["']tl-search["']/);
    assert.match(html, /placeholder=["']ILR-LIS-/);
  });

  test('"Convert đề mới từ DOCX" CTA links to convert.html', () => {
    assert.match(
      html,
      /href=["']\/pages\/admin\/listening\/convert\.html["'][^>]*>[^<]*Convert/,
    );
  });

  test('table has all 9 columns (test_id / title / band / accent / sections / audio / status / created / actions)', () => {
    const headRe = /<thead[\s\S]*?<\/thead>/i;
    const head = html.match(headRe);
    assert.ok(head, 'table head not found');
    for (const col of ['Test ID', 'Title', 'Band', 'Accent',
                       'Sections', 'Audio', 'Status', 'Created', 'Hành động']) {
      assert.match(head[0], new RegExp(col),
        `missing table column "${col}"`);
    }
  });

  test('empty state copy mentions convert flow', () => {
    assert.match(
      html,
      /Convert đề đầu tiên từ DOCX/,
    );
  });

  test('pagination prev + next buttons present', () => {
    assert.match(html, /id=["']tl-prev["']/);
    assert.match(html, /id=["']tl-next["']/);
  });
});


// ── Tests browser controller logic ──────────────────────────────────────────


describe('Sprint 13.4 — tests list controller logic', () => {
  const js = read('js', 'admin-listening-tests-list.js');

  test('GET /admin/listening/tests called on mount', () => {
    assert.match(
      js,
      /window\.api\.get\(\s*`?\/admin\/listening\/tests/,
    );
  });

  test('status filter is wired into the query string', () => {
    assert.match(js, /status:\s*STATE\.status/);
  });

  test('search debounced (setTimeout) before re-fetch', () => {
    assert.match(js, /setTimeout/);
    assert.match(js, /STATE\.search/);
  });

  test('row renders test_id + audio_ready_count + section_count', () => {
    assert.match(js, /t\.test_id/);
    assert.match(js, /audio_ready_count/);
    assert.match(js, /section_count/);
  });

  test('row exposes status chip with is-<status> class', () => {
    assert.match(js, /tl-chip is-\$\{escapeHtml\(t\.status\)\}/);
  });

  test('pagination prev/next buttons bound', () => {
    assert.match(js, /tl-prev/);
    assert.match(js, /tl-next/);
  });
});
