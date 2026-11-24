/**
 * frontend/tests/admin-listening-content-management.test.mjs — Sprint 13.1
 * (DEBT-ADMIN-LISTENING-AUTHORING 1/N).
 *
 * Pins the structural contract for the new listening content management
 * surface: the promoted content list at /pages/admin/listening/index.html,
 * the new content-detail.html, the new content-meta.html, and the
 * cancel-link fix on the five legacy editors.
 *
 * The visible-behavior assertions live in backend pytests; these
 * sentinels guard the markup + JS-module wiring so future refactors
 * can't quietly regress the Sprint 13.1 IA promise.
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


// ── Content list (the promoted listening/index.html) ────────────────────────


describe('Sprint 13.1 — content list page', () => {
  const html = read('pages', 'admin', 'listening', 'index.html');

  test('embeds chrome with active=listening + subsection=content', () => {
    assert.match(html, /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']content["']/);
  });

  test('status filter dropdown present with 4 options', () => {
    assert.match(html, /id=["']lst-status["']/);
    for (const v of ['all', 'draft', 'published', 'archived']) {
      assert.match(
        html,
        new RegExp(`<option\\s+value=["']${v}["']`),
        `status filter missing option ${v}`,
      );
    }
  });

  test('table renders the 9 expected column headers', () => {
    const headers = [
      'Title', 'Accent', 'CEFR', 'Section', 'Status', 'Audio',
      'Exercises', 'Created', 'Hành động',
    ];
    for (const h of headers) {
      assert.match(html, new RegExp(`<th>${h}`), `missing column ${h}`);
    }
  });

  test('decommissioned create cards stay gone (MP3 upload / render / audio cutter)', () => {
    // 2026-07-17 usage audit: MP3 upload, ElevenLabs render, and the
    // audio cutter were removed from the hub. Guard against re-adding
    // dead links.
    assert.doesNotMatch(html, /data-create=["']upload["']/);
    assert.doesNotMatch(html, /data-create=["']render["']/);
    assert.doesNotMatch(html, /data-create=["']audio-cutter["']/);
    assert.doesNotMatch(html, /listening\/upload\.html/);
    assert.doesNotMatch(html, /listening\/render\.html/);
    assert.doesNotMatch(html, /listening\/audio-cutter\.html/);
  });

  test('pagination prev/next buttons render', () => {
    assert.match(html, /id=["']lst-prev["']/);
    assert.match(html, /id=["']lst-next["']/);
  });

  test('empty state copy mentions Sprint 13.2 + 13.3 future paths', () => {
    assert.match(html, /Chưa có nội dung.[\s\S]*?Tải MP3[\s\S]*?Render ElevenLabs/);
  });
});


// ── Content detail page ──────────────────────────────────────────────────────


describe('Sprint 13.1 — content-detail page', () => {
  const html = read('pages', 'admin', 'listening', 'content-detail.html');

  test('embeds chrome with active=listening + subsection=content', () => {
    assert.match(html, /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']content["']/);
  });

  test('Publish button → PATCH /status with target_status=published', () => {
    assert.match(html, /id=["']btn-publish["'][\s\S]*?data-target-status=["']published["']/);
  });

  test('Archive button → PATCH /status with target_status=archived', () => {
    assert.match(html, /id=["']btn-archive["'][\s\S]*?data-target-status=["']archived["']/);
  });

});


// ── Content meta (edit form) page ────────────────────────────────────────────


describe('Sprint 13.1 — content-meta edit form', () => {
  const html = read('pages', 'admin', 'listening', 'content-meta.html');

  test('embeds chrome with active=listening + subsection=content', () => {
    assert.match(html, /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']content["']/);
  });

  test('renders all 9 editable form fields', () => {
    for (const id of [
      'mta-title', 'mta-transcript',
      'mta-accent', 'mta-cefr', 'mta-section',
      'mta-tags', 'mta-premium',
      'mta-license', 'mta-source-url',
    ]) {
      assert.match(html, new RegExp(`id=["']${id}["']`), `missing form field ${id}`);
    }
  });

});


// ── Cancel-link fix on the 5 legacy editor pages ─────────────────────────────


describe('Sprint 13.1 — editor cancel/back links no longer point to /admin.html', () => {
  const editors = [
    'pages/admin/listening/segments.html',
    'pages/admin/listening/gist.html',
    'pages/admin/listening/tf.html',
    'pages/admin/listening/mcq.html',
  ];

  for (const rel of editors) {
    test(`${rel} cancel + back link → /pages/admin/listening/index.html`, () => {
      const html = readFileSync(path.join(REPO_ROOT, 'frontend', rel), 'utf8');
      assert.doesNotMatch(
        html,
        /href=["']\/admin\.html["']/,
        `${rel}: still references the dead /admin.html redirect`,
      );
      // The new cancel target must be present at least once.
      assert.match(
        html,
        /href=["']\/pages\/admin\/listening\/index\.html["']/,
        `${rel}: missing new cancel target /pages/admin/listening/index.html`,
      );
    });
  }

  test('admin-chrome exposes the inventory but not editors missing content context', () => {
    const chrome = read('js', 'components', 'aver-admin-chrome.js');
    assert.match(chrome, /slug:\s*['"]content['"]/);
    for (const s of ['create', 'segments', 'gist', 'tf', 'mcq']) {
      assert.doesNotMatch(
        chrome,
        new RegExp(`slug:\\s*['"]${s}['"]`),
        `editor ${s} requires content_id and must not be a context-free sidebar entry`,
      );
    }
  });
});
