/**
 * frontend/tests/admin-listening-upload.test.mjs — Sprint 13.2
 * (DEBT-ADMIN-LISTENING-AUTHORING 2/N).
 *
 * Pins the markup + JS-module contract for the new upload surface:
 *   - /pages/admin/listening/upload.html (single + bulk modes)
 *   - /js/admin-listening-upload.js (drop zone, validation preview,
 *     bulk submit, mode toggle)
 *
 * And the integration touch-points:
 *   - listening landing /pages/admin/listening/index.html flips the
 *     "Tải MP3" card to a live link; the render card stays disabled.
 *
 * No DOM runtime in node:test — structural string assertions only.
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


// ── Page structure — upload.html ───────────────────────────────────────────


describe('Sprint 13.2 — upload page structure', () => {
  const html = read('pages', 'admin', 'listening', 'upload.html');

  test('embeds chrome with active=listening + subsection=create', () => {
    assert.match(html, /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']create["']/);
  });

  test('header copy mentions auto-validate', () => {
    assert.match(html, /Tạo bài Listening — Tải MP3/);
    assert.match(html, /[Aa]uto-validate/);
  });

  test('2-mode toggle present (single + bulk)', () => {
    assert.match(html, /id=["']up-mode-single["']/);
    assert.match(html, /id=["']up-mode-bulk["']/);
    assert.match(html, /data-mode=["']single["']/);
    assert.match(html, /data-mode=["']bulk["']/);
  });

  test('back link returns to listening landing', () => {
    assert.match(html, /href=["']\/pages\/admin\/listening\/index\.html["']/);
  });

  test('single mode has drop zone + file input', () => {
    assert.match(html, /id=["']up-single-dz["']/);
    assert.match(html, /id=["']up-single-file["'][^>]*accept=["']audio\/mpeg,\.mp3["']/);
  });

  test('single mode has 9 form fields (title + 8 metadata)', () => {
    for (const id of [
      'up-s-title', 'up-s-transcript',
      'up-s-accent', 'up-s-cefr', 'up-s-section',
      'up-s-tags', 'up-s-premium',
      'up-s-license', 'up-s-source-url',
    ]) {
      assert.match(html, new RegExp(`id=["']${id}["']`), `missing field ${id}`);
    }
  });

  test('single mode has validate + submit buttons', () => {
    assert.match(html, /id=["']up-s-validate["']/);
    assert.match(html, /id=["']up-s-submit["']/);
  });

  test('bulk mode has multi-file drop zone (multiple attr)', () => {
    assert.match(html, /id=["']up-bulk-dz["']/);
    assert.match(html, /id=["']up-bulk-files["'][^>]*multiple/);
  });

  test('bulk mode has "Áp dụng cho tất cả" button', () => {
    assert.match(html, /id=["']up-bulk-apply-all["']/);
    assert.match(html, /Áp dụng cho tất cả/);
  });

  test('bulk mode has validate + submit buttons', () => {
    assert.match(html, /id=["']up-b-validate["']/);
    assert.match(html, /id=["']up-b-submit["']/);
  });

  test('bulk mode has results table scaffold', () => {
    assert.match(html, /id=["']up-bulk-results["']/);
    assert.match(html, /id=["']up-bulk-results-tbody["']/);
  });

  test('issues containers present for inline error rendering', () => {
    assert.match(html, /id=["']up-single-issues["']/);
    assert.match(html, /id=["']up-bulk-issues["']/);
  });
});


// ── JS controller logic — admin-listening-upload.js ────────────────────────


describe('Sprint 13.2 — upload controller logic', () => {
  const js = read('js', 'admin-listening-upload.js');

  test('mode toggle wires both buttons', () => {
    assert.match(js, /up-mode-single[\s\S]*?addEventListener\(['"]click['"]/);
    assert.match(js, /up-mode-bulk[\s\S]*?addEventListener\(['"]click['"]/);
    assert.match(js, /setMode\(['"]single['"]\)/);
    assert.match(js, /setMode\(['"]bulk['"]\)/);
  });

  test('client-side duration probe uses <audio>.loadedmetadata', () => {
    assert.match(js, /probeDuration/);
    assert.match(js, /['"]loadedmetadata['"]/);
  });

  test('validate preview calls POST /admin/listening/upload/validate (single)', () => {
    assert.match(
      js,
      /window\.api\.upload\(\s*['"]\/admin\/listening\/upload\/validate['"]/,
    );
  });

  test('errors block single submit (submit disabled = !res.ok)', () => {
    assert.match(
      js,
      /up-s-submit['"]\)\.disabled\s*=\s*!res\.ok/,
    );
  });

  test('warnings allow single submit (not also disabled)', () => {
    // The toggle expression must reference res.ok ONLY, not warnings.length.
    assert.doesNotMatch(
      js,
      /up-s-submit['"]\)\.disabled\s*=\s*!res\.ok\s*\|\|\s*res\.warnings/,
    );
  });

  test('single submit POSTs to /admin/listening/upload', () => {
    assert.match(
      js,
      /window\.api\.upload\(\s*['"]\/admin\/listening\/upload['"]/,
    );
  });

  test('single submit success redirects to content-detail.html', () => {
    assert.match(
      js,
      /content-detail\.html\?id=\$\{encodeURIComponent\(res\.content_id\)\}/,
    );
  });

  test('bulk "Áp dụng cho tất cả" copies metadata from first entry', () => {
    assert.match(js, /onBulkApplyAll/);
    // Must read STATE.bulkFiles[0].meta as the base.
    assert.match(js, /STATE\.bulkFiles\[0\]\.meta/);
  });

  test('bulk submit posts JSON manifest + files[] to /upload/bulk', () => {
    assert.match(
      js,
      /window\.api\.upload\(\s*['"]\/admin\/listening\/upload\/bulk['"]/,
    );
    assert.match(js, /fd\.append\(\s*['"]manifest['"]/);
    assert.match(js, /fd\.append\(\s*['"]files['"]/);
  });

  test('bulk validate loops every entry and disables submit on failure', () => {
    assert.match(js, /onBulkValidate/);
    // The loop must call /upload/validate per entry.
    assert.match(
      js,
      /window\.api\.upload\(\s*['"]\/admin\/listening\/upload\/validate['"][\s\S]*?buildBulkValidateFormData/,
    );
    assert.match(js, /up-b-submit['"]\)\.disabled\s*=\s*!allOk/);
  });

  test('bulk hard-cap is 20 files', () => {
    assert.match(js, /BULK_MAX\s*=\s*20/);
  });
});


// ── Integration: listening landing card flip ────────────────────────────────


describe('Sprint 13.2 — listening landing integrates upload entry', () => {
  const html = read('pages', 'admin', 'listening', 'index.html');

  test('"Tải MP3" card is now a live link to upload.html', () => {
    // Match the upload card opening tag, then assert both attributes present.
    const uploadCard = html.match(/<a[^>]*data-create=["']upload["'][^>]*>/);
    assert.ok(uploadCard, 'upload card markup not found');
    assert.match(
      uploadCard[0],
      /href=["']\/pages\/admin\/listening\/upload\.html["']/,
      'upload card must point to /pages/admin/listening/upload.html',
    );
  });

  test('"Tải MP3" card no longer carries aria-disabled', () => {
    // Find the upload card stanza specifically. The render card still
    // carries aria-disabled and that's allowed.
    const uploadCard = html.match(/<a[^>]*data-create=["']upload["'][^>]*>/);
    assert.ok(uploadCard, 'upload card markup not found');
    assert.doesNotMatch(
      uploadCard[0],
      /aria-disabled=["']true["']/,
      'upload card must not be aria-disabled in Sprint 13.2',
    );
  });

  test('"Render ElevenLabs" card is a live link (Sprint 13.3 flip)', () => {
    // Sprint 13.3 flipped the render card from aria-disabled placeholder
    // to a live link into /pages/admin/listening/render.html. The
    // Sprint 13.2 sentinel previously pinned it as still-placeholder;
    // that pin retires here.
    const renderCard = html.match(/<a[^>]*data-create=["']render["'][^>]*>/);
    assert.ok(renderCard, 'render card markup not found');
    assert.doesNotMatch(renderCard[0], /aria-disabled=["']true["']/);
    assert.match(
      renderCard[0],
      /href=["']\/pages\/admin\/listening\/render\.html["']/,
      'render card must link to /pages/admin/listening/render.html (Sprint 13.3)',
    );
  });

  test('chrome NAV_GROUPS create slug exists (Sprint 13.1 baseline still good)', () => {
    const chrome = read('js', 'components', 'aver-admin-chrome.js');
    assert.match(chrome, /slug:\s*['"]create['"]/);
  });
});
