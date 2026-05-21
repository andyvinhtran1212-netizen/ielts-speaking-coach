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


// ── Sprint 13.4.3.1 — mode toggle selection-driven render hotfix ───────────


describe('Sprint 13.4.3.1 — mode toggle renders upload UI immediately', () => {
  const js = read('js', 'admin-listening-tests-detail.js');

  test('onModeChange mutates STATE.test.audio_assembly_mode locally first', () => {
    // The hotfix sets the local state before any await so renderModeUI
    // fires synchronously with the user's selection — no chicken-and-egg.
    assert.match(
      js,
      /STATE\.test\.audio_assembly_mode\s*=\s*mode[\s\S]{0,200}?renderModeUI\(mode\)/,
    );
  });

  test('onModeChange calls renderModeUI before awaiting the PATCH', () => {
    // Find the function body and pin: renderModeUI must appear before
    // the `await window.api.patch` line.
    const fnMatch = js.match(/async function onModeChange[\s\S]+?^}/m);
    assert.ok(fnMatch, 'onModeChange function not found');
    const fn = fnMatch[0];
    const renderIdx = fn.indexOf('renderModeUI(mode)');
    const patchIdx  = fn.indexOf('window.api.patch');
    assert.ok(renderIdx >= 0 && patchIdx >= 0, 'expected both calls in onModeChange');
    assert.ok(
      renderIdx < patchIdx,
      'renderModeUI must run before the PATCH so upload UI appears even on backend failure',
    );
  });

  test('PATCH failure surfaces non-blocking copy (UI vẫn dùng được)', () => {
    // Hotfix swapped the "rollback selector + error banner" path for a
    // softer message that keeps the upload UI usable.
    assert.match(js, /UI vẫn dùng được|sẽ thử lại khi upload/);
  });

  test('publish-gate re-renders after every mode selection', () => {
    const fn = js.match(/async function onModeChange[\s\S]+?^}/m)[0];
    assert.match(fn, /renderPublishGate\(\)/);
  });

  test('selector no longer auto-rolls-back on PATCH failure', () => {
    // The original Sprint 13.4.3 controller reset the selector to the
    // previous persisted mode whenever the PATCH 422'd — that's the UX
    // bug the hotfix removes (it swallowed the user's selection).
    assert.doesNotMatch(
      js,
      /document\.getElementById\(['"]td-mode['"]\)\.value\s*=\s*\(STATE\.test/,
    );
  });
});


describe('Sprint 13.4.3.1 — backend mode toggle is soft', () => {
  // Sentinel that the docstring + behaviour pivot is reflected in
  // services/listening_audio.py + the router. We pin via the router
  // source because that's the authoritative behaviour change.
  const py = read('..', 'backend', 'routers', 'listening.py');

  test('admin_patch_test_audio_mode docstring marks the toggle soft', () => {
    assert.match(py, /Sprint 13\.4\.3\.1 — soft validation/);
  });

  test('no precondition check for full_audio_storage_path in mode PATCH', () => {
    // The old strict block raised a 422 with the literal "yêu cầu
    // full_audio_storage_path" string. Hotfix removes it from this
    // endpoint (the publish gate keeps the same message at PATCH /status).
    const fn = py.match(
      /async def admin_patch_test_audio_mode[\s\S]+?return\s*\{[^}]+\}/,
    );
    assert.ok(fn, 'admin_patch_test_audio_mode body not found');
    assert.doesNotMatch(
      fn[0],
      /yêu cầu full_audio_storage_path/,
    );
  });

  test('no precondition check for all-4-sections in mode PATCH', () => {
    const fn = py.match(
      /async def admin_patch_test_audio_mode[\s\S]+?return\s*\{[^}]+\}/,
    )[0];
    assert.doesNotMatch(fn, /yêu cầu đủ 4 sections/);
  });

  test('mode PATCH still 404s when test row missing', () => {
    // Soft toggle keeps the existence check (via _fetch_test_or_404).
    const fn = py.match(
      /async def admin_patch_test_audio_mode[\s\S]+?return\s*\{[^}]+\}/,
    )[0];
    assert.match(fn, /_fetch_test_or_404/);
  });

  test('publish gate at PATCH /status still hard-blocks parts_only', () => {
    // Hard enforcement moved entirely to the publish endpoint.
    assert.match(py, /listening_audio\.can_publish/);
  });
});


// ── Sprint 13.4.3.2 — drag/drop + audio preview + layout overflow fix ──────


describe('Sprint 13.4.3.2 — drop-zone handlers wired (drag-and-drop)', () => {
  const js = read('js', 'admin-listening-tests-detail.js');

  test('attachDropZoneHandlers factory defined', () => {
    assert.match(js, /function\s+attachDropZoneHandlers\s*\(\s*zoneEl\s*,\s*onFile\s*\)/);
  });

  test('binds all 4 dnd events with preventDefault', () => {
    assert.match(js, /\['dragenter',\s*'dragover'\][\s\S]{0,200}?preventDefault/);
    assert.match(js, /\['dragleave',\s*'drop'\][\s\S]{0,200}?preventDefault/);
  });

  test('drop branch extracts file from dataTransfer + .mp3 guard', () => {
    assert.match(js, /e\.dataTransfer\s*&&\s*e\.dataTransfer\.files/);
    assert.match(js, /Chỉ chấp nhận file \.mp3/);
  });

  test('init() wires dnd on the full-audio zone', () => {
    assert.match(
      js,
      /attachDropZoneHandlers\(\s*\n?\s*document\.getElementById\(['"]td-zone-full['"]\),/,
    );
  });

  test('renderPartsGrid() wires dnd per card (grid rebuilds on render)', () => {
    const fn = js.match(/function renderPartsGrid[\s\S]+?^}/m);
    assert.ok(fn, 'renderPartsGrid not found');
    assert.match(fn[0], /attachDropZoneHandlers\(card,/);
  });
});


describe('Sprint 13.4.3.2 — audio preview players render', () => {
  const html = read('pages', 'admin', 'listening', 'tests-detail.html');
  const js   = read('js', 'admin-listening-tests-detail.js');

  test('html has preview slot for full + assembled audio', () => {
    assert.match(html, /id=["']td-full-preview["']/);
    assert.match(html, /id=["']td-assembled-preview["']/);
  });

  test('fetchTest pulls signed-url bundle from /audio/signed-urls', () => {
    assert.match(
      js,
      /window\.api\.get\(\s*`?\/admin\/listening\/tests\/\$\{[^}]+\}\/audio\/signed-urls/,
    );
  });

  test('renderFullAudio emits <audio controls> when signed URL available', () => {
    assert.match(js, /<audio controls[\s\S]{0,200}?src=["']?\$\{escapeHtml\(signed\.signed_url\)\}/);
  });

  test('renderPartsGrid embeds per-section <audio controls>', () => {
    const fn = js.match(/function renderPartsGrid[\s\S]+?^}/m)[0];
    assert.match(fn, /<audio controls/);
    assert.match(fn, /signed\.signed_url/);
  });

  test('renderAssembledPreview function exists + emits <audio>', () => {
    assert.match(js, /function\s+renderAssembledPreview\s*\(\)/);
    const fn = js.match(/function renderAssembledPreview[\s\S]+?^}/m)[0];
    assert.match(fn, /<audio controls/);
  });

  test('"Tải lại audio" button re-triggers the file picker', () => {
    assert.match(js, /Tải lại audio/);
    assert.match(js, /td-file-full['"]\)\.click\(\)/);
  });
});


describe('Sprint 13.4.3.2 — section card grid no longer overflows', () => {
  const html = read('pages', 'admin', 'listening', 'tests-detail.html');

  test('parts grid wrapper sets min-width:0', () => {
    assert.match(html, /\.td-parts-grid[\s\S]{0,300}?min-width:\s*0/);
  });

  test('grid children also min-width:0 (override default auto)', () => {
    assert.match(html, /\.td-parts-grid\s*>\s*\*\s*\{\s*min-width:\s*0/);
  });

  test('long file-meta + section-meta text wraps inside cards', () => {
    assert.match(
      html,
      /word-break:\s*break-word[\s\S]{0,150}?overflow-wrap:\s*anywhere/,
    );
  });

  test('mobile media query stacks cards below 768px', () => {
    assert.match(
      html,
      /@media\s*\(\s*max-width:\s*768px\s*\)\s*\{\s*\.td-parts-grid\s*\{\s*grid-template-columns:\s*1fr/,
    );
  });

  test('audio player CSS keeps controls at full card width', () => {
    assert.match(html, /\.td-audio-player\s*\{\s*width:\s*100%/);
  });
});
