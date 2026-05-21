/**
 * frontend/tests/admin-listening-tests-detail.test.mjs — Sprint 13.4.3.
 *
 * Pins the markup + controller contract for the per-test admin surface:
 *   - /pages/admin/listening/tests-detail.html
 *   - /js/admin-listening-tests-detail.js
 *
 * And the cross-page integration:
 *   - tests-list row "Mở test" link → tests-detail.html?id=
 *   - convert results panel primary CTA → tests-detail.html?id=
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


// ── Page structure ─────────────────────────────────────────────────────────


describe('Sprint 13.4.3 — tests-detail page structure', () => {
  const html = read('pages', 'admin', 'listening', 'tests-detail.html');

  test('embeds chrome with active=listening + subsection=tests', () => {
    assert.match(
      html,
      /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']tests["']/,
    );
  });

  test('back link returns to tests list', () => {
    assert.match(html, /href=["']\/pages\/admin\/listening\/tests\.html["']/);
  });

  test('metadata block carries 7 pills (test_id / version / band / accent / words / sections / created)', () => {
    for (const id of ['td-meta-test-id', 'td-meta-version', 'td-meta-band',
                      'td-meta-accents', 'td-meta-words', 'td-meta-sections',
                      'td-meta-created']) {
      assert.match(html, new RegExp(`id=["']${id}["']`), `missing metadata pill ${id}`);
    }
  });

  test('mode selector exposes all three modes', () => {
    assert.match(html, /id=["']td-mode["']/);
    for (const m of ['full_premixed', 'parts_auto_assembled', 'parts_only']) {
      assert.match(html, new RegExp(`<option value=["']${m}["']`),
        `missing mode option ${m}`);
    }
  });

  test('full audio dropzone present + hidden initially (mode-gated)', () => {
    assert.match(html, /id=["']td-audio-full["'][^>]*hidden/);
    assert.match(html, /id=["']td-zone-full["']/);
    assert.match(html, /id=["']td-file-full["'][^>]*accept=["'][^"']*\.mp3/);
  });

  test('parts grid + assemble button + cost preview scaffold present', () => {
    assert.match(html, /id=["']td-audio-parts["']/);
    assert.match(html, /id=["']td-parts-grid["']/);
    assert.match(html, /id=["']td-assemble-row["']/);
    assert.match(html, /id=["']td-assemble["']/);
    assert.match(html, /ElevenLabs credits/);
  });

  test('cue points table scaffold present', () => {
    assert.match(html, /id=["']td-cue-wrap["']/);
    assert.match(html, /id=["']td-cue-tbody["']/);
    for (const col of ['Type', 'Section', 'Time']) {
      assert.match(html, new RegExp(`<th>${col}`));
    }
  });

  test('publish controls + delete section present', () => {
    assert.match(html, /id=["']td-publish-btn["'][^>]*disabled/);
    assert.match(html, /id=["']td-draft-btn["']/);
    assert.match(html, /id=["']td-archive-btn["']/);
    assert.match(html, /id=["']td-delete-btn["']/);
  });

  test('sections list scaffold renders 4 cards via JS', () => {
    assert.match(html, /id=["']td-sections-list["']/);
  });
});


// ── Controller logic ───────────────────────────────────────────────────────


describe('Sprint 13.4.3 — tests-detail controller logic', () => {
  const js = read('js', 'admin-listening-tests-detail.js');

  test('bootstrap Supabase IIFE so first GET carries auth', () => {
    assert.match(js, /function\s+bootstrapSupabase\s*\(\)/);
    assert.match(js, /window\.initSupabase\(SUPABASE_URL,\s*SUPABASE_ANON\)/);
  });

  test('reads test id from ?id= query param', () => {
    assert.match(js, /URLSearchParams\(window\.location\.search\)/);
    assert.match(js, /params\.get\(['"]id['"]\)/);
  });

  test('GETs /admin/listening/tests/{id} on mount', () => {
    assert.match(
      js,
      /window\.api\.get\(\s*`\/admin\/listening\/tests\/\$\{encodeURIComponent\(STATE\.testId\)\}/,
    );
  });

  test('mode change PATCHes /audio/mode', () => {
    assert.match(
      js,
      /window\.api\.patch\(\s*`\/admin\/listening\/tests\/\$\{[^}]+\}\/audio\/mode/,
    );
  });

  test('full audio upload POSTs multipart to /audio/full', () => {
    assert.match(
      js,
      /window\.api\.upload\(\s*`\/admin\/listening\/tests\/\$\{[^}]+\}\/audio\/full/,
    );
  });

  test('part audio upload POSTs multipart to /audio/section/{N}', () => {
    assert.match(
      js,
      /window\.api\.upload\(\s*`\/admin\/listening\/tests\/\$\{[^}]+\}\/audio\/section\/\$\{sectionNum\}/,
    );
  });

  test('assemble button POSTs to /audio/assemble', () => {
    assert.match(
      js,
      /window\.api\.post\(\s*`\/admin\/listening\/tests\/\$\{[^}]+\}\/audio\/assemble/,
    );
  });

  test('assemble button only enabled when 4 parts ready', () => {
    assert.match(js, /ready\s*<\s*4/);
    assert.match(js, /refreshAssembleButton/);
  });

  test('client-side publish gate mirrors server can_publish rules', () => {
    // `mode` is the local alias for t.audio_assembly_mode inside the
    // canPublishClient helper. Pin both branches by mode value + the
    // two audio-path fields the server gates on.
    assert.match(js, /mode\s*===\s*['"]full_premixed['"]/);
    assert.match(js, /mode\s*===\s*['"]parts_auto_assembled['"]/);
    assert.match(js, /full_audio_storage_path/);
    assert.match(js, /assembled_audio_storage_path/);
  });

  test('parts_only mode disables publish with clear reason', () => {
    assert.match(js, /parts_only/);
    assert.match(js, /không support full test/);
  });

  test('status transitions PATCH /tests/{id}/status', () => {
    assert.match(
      js,
      /window\.api\.patch\(\s*`\/admin\/listening\/tests\/\$\{[^}]+\}\/status/,
    );
  });

  test('delete confirmation prompts before DELETE', () => {
    assert.match(js, /window\.confirm/);
    assert.match(
      js,
      /window\.api\.delete\(\s*`\/admin\/listening\/tests\/\$\{[^}]+\}/,
    );
  });

  test('cue points table populated from STATE.test.cue_points', () => {
    assert.match(js, /cue_points/);
    assert.match(js, /td-cue-tbody/);
  });
});


// ── Cross-page integration ─────────────────────────────────────────────────


describe('Sprint 13.4.3 — tests-list row links to tests-detail', () => {
  const js = read('js', 'admin-listening-tests-list.js');

  test('row action "Mở test" links to tests-detail.html?id=', () => {
    assert.match(
      js,
      /\/pages\/admin\/listening\/tests-detail\.html\?id=\$\{encodeURIComponent\(t\.id\)\}/,
    );
  });

  test('no leftover "sắp ra mắt" placeholder', () => {
    assert.doesNotMatch(js, /sắp ra mắt/);
  });
});


describe('Sprint 13.4.3 — convert results CTA lands on tests-detail', () => {
  const js = read('js', 'admin-listening-convert.js');

  test('post-commit primary link goes to tests-detail.html?id=', () => {
    assert.match(
      js,
      /\/pages\/admin\/listening\/tests-detail\.html\?id=\$\{encodeURIComponent\(result\.test_id\)\}/,
    );
  });
});
