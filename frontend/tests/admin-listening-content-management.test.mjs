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
  const js   = read('js', 'admin-listening-content-list.js');

  test('embeds chrome with active=listening + subsection=content', () => {
    assert.match(html, /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']content["']/);
  });

  test('GET /admin/listening/content called from list controller', () => {
    // Path may be assembled into a `const path = …` before the api.get call.
    assert.match(
      js,
      /`\/admin\/listening\/content\?status=/,
      'content list module must call GET /admin/listening/content',
    );
    assert.match(
      js,
      /window\.api\.get\(/,
      'content list module must use window.api.get',
    );
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

  test('status filter change triggers re-fetch in controller', () => {
    assert.match(
      js,
      /lst-status[^]*addEventListener\(['"]change['"]/,
      'status filter must rebind to load() on change',
    );
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

  test('"Tải MP3" card present (Sprint 13.2 — flipped to live link)', () => {
    // Sprint 13.2 flipped the upload card from aria-disabled placeholder
    // to a live link into /pages/admin/listening/upload.html.
    assert.match(html, /data-create=["']upload["']/);
    assert.match(html, /Tải MP3/);
    const uploadCard = html.match(/<a[^>]*data-create=["']upload["'][^>]*>/);
    assert.ok(uploadCard, 'upload card markup not found');
    assert.match(
      uploadCard[0],
      /href=["']\/pages\/admin\/listening\/upload\.html["']/,
      'upload card must link to /pages/admin/listening/upload.html (Sprint 13.2)',
    );
  });

  test('"Render ElevenLabs" card live link (Sprint 13.3 flip)', () => {
    // Sprint 13.3 flipped the render card from aria-disabled placeholder
    // to a live link into /pages/admin/listening/render.html. The 13.1
    // pin that required "Sắp ra mắt (Sprint 13.3)" text retires here.
    assert.match(html, /data-create=["']render["']/);
    const renderCard = html.match(/<a[^>]*data-create=["']render["'][^>]*>/);
    assert.ok(renderCard, 'render card markup not found');
    assert.match(
      renderCard[0],
      /href=["']\/pages\/admin\/listening\/render\.html["']/,
      'render card must link to /pages/admin/listening/render.html (Sprint 13.3)',
    );
    assert.doesNotMatch(renderCard[0], /aria-disabled=["']true["']/);
  });

  test('edit-meta link in Actions points to content-meta.html?id=', () => {
    assert.match(
      js,
      /content-meta\.html\?id=\$\{idEsc\}/,
      'edit-meta deep-link missing in list module',
    );
  });

  test('editor deep-links carry ?content_id= for all 4 single-content editors', () => {
    for (const sub of ['segments', 'gist', 'tf', 'mcq']) {
      assert.match(
        js,
        new RegExp(`/pages/admin/listening/${sub}\\.html\\?content_id=`),
        `missing ?content_id= pre-bake for ${sub}`,
      );
    }
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
  const js   = read('js', 'admin-listening-content-detail.js');

  test('embeds chrome with active=listening + subsection=content', () => {
    assert.match(html, /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']content["']/);
  });

  test('GET /admin/listening/content/{id} fetched in controller', () => {
    assert.match(js, /\/admin\/listening\/content\/\$\{encodeURIComponent\(id\)\}/);
  });

  test('GET /admin/listening/exercises?content_id= fetched in controller', () => {
    assert.match(
      js,
      /\/admin\/listening\/exercises\?content_id=\$\{encodeURIComponent\(id\)\}/,
    );
  });

  test('renders 4 exercise type rows (dictation / gist / true_false / mcq)', () => {
    // The matrix shape lives in the JS — confirm the EX_TYPES array
    // carries every required exercise_type key.
    for (const k of ['dictation', 'gist', 'true_false', 'mcq']) {
      assert.match(
        js,
        new RegExp(`key:\\s*['"]${k}['"]`),
        `EX_TYPES missing key ${k}`,
      );
    }
  });

  test('"Chưa có" → editor link with ?content_id= pre-baked (create action)', () => {
    // Controller must emit data-action="create" with editor href + content_id.
    assert.match(
      js,
      /data-action=["']create["'][^>]*href=["']\$\{t\.editor\}\?content_id=\$\{idEsc\}/,
    );
  });

  test('Publish button → PATCH /status with target_status=published', () => {
    assert.match(html, /id=["']btn-publish["'][\s\S]*?data-target-status=["']published["']/);
  });

  test('Archive button → PATCH /status with target_status=archived', () => {
    assert.match(html, /id=["']btn-archive["'][\s\S]*?data-target-status=["']archived["']/);
  });

  test('patchStatus calls PATCH /admin/listening/content/{id}/status', () => {
    assert.match(
      js,
      /window\.api\.patch\(\s*`\/admin\/listening\/content\/\$\{encodeURIComponent\(STATE\.contentId\)\}\/status`/,
    );
  });

  test('"Sửa metadata" link points to content-meta.html?id=', () => {
    assert.match(js, /content-meta\.html\?id=\$\{encodeURIComponent\(c\.id\)\}/);
  });
});


// ── Content meta (edit form) page ────────────────────────────────────────────


describe('Sprint 13.1 — content-meta edit form', () => {
  const html = read('pages', 'admin', 'listening', 'content-meta.html');
  const js   = read('js', 'admin-listening-content-meta.js');

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

  test('PATCH /admin/listening/content/{id} called on submit', () => {
    assert.match(
      js,
      /window\.api\.patch\(\s*`\/admin\/listening\/content\/\$\{encodeURIComponent\(STATE\.contentId\)\}`/,
    );
  });

  test('client-side validation blocks bad accent_tag', () => {
    assert.match(
      js,
      /ACCENTS\.has\(body\.accent_tag\)[\s\S]*?accent_tag không hợp lệ/,
    );
  });

  test('client-side validation blocks premium + NC license combo', () => {
    assert.match(
      js,
      /is_premium[\s\S]*?external_license[\s\S]*?NC[\s\S]*?premium/i,
      'premium+NC combo guard missing in meta controller',
    );
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

  test('admin-chrome NAV_GROUPS carries new content + create slugs', () => {
    const chrome = read('js', 'components', 'aver-admin-chrome.js');
    // The listening group must own slugs for content and create — Sprint
    // 13.2 will flip the create slug to a real page; for now it
    // re-routes to the content list.
    assert.match(chrome, /slug:\s*['"]content['"]/);
    assert.match(chrome, /slug:\s*['"]create['"]/);
    // Existing editor slugs MUST stay in place. (The mini-test session-mixer
    // slug was retired when that builder was repurposed away.)
    for (const s of ['segments', 'gist', 'tf', 'mcq']) {
      assert.match(
        chrome,
        new RegExp(`slug:\\s*['"]${s}['"]`),
        `Sprint 13.1 must not retire existing listening sub-slug ${s}`,
      );
    }
  });
});
