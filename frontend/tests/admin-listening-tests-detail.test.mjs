/**
 * frontend/tests/admin-listening-tests-detail.test.mjs — Sprint 13.4.3.
 *
 * Pins the markup + controller contract for the per-test admin surface:
 *   - /pages/admin/listening/tests-detail.html
 *   - /js/admin-listening-tests-detail.js (retired in LEGACYJS-0075 W1; its
 *     controller pins moved to admin-listening-test-detail-next-behavior)
 *
 * And the cross-page integration:
 *   - tests-list row "Mở test" link → tests-detail.html?id=
 *   - convert results panel primary CTA → tests-detail.html?id=
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readListeningRouterSource } from './fixtures/listening-router-source.mjs';
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



// ── Cross-page integration ─────────────────────────────────────────────────



// (Convert flow retired 2026-07-17 — usage audit; the "convert results CTA"
// suite that pinned admin-listening-convert.js went with it.)


// ── Sprint 13.4.3.1 — mode toggle selection-driven render hotfix ───────────



describe('Sprint 13.4.3.1 — backend mode toggle is soft', () => {
  // Sentinel that the docstring + behaviour pivot is reflected in
  // services/listening_audio.py + the router. We pin via the router
  // source because that's the authoritative behaviour change.
  const py = readListeningRouterSource();

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



describe('Sprint 13.4.3.2 — audio preview players render', () => {
  const html = read('pages', 'admin', 'listening', 'tests-detail.html');

  test('html has preview slot for full + assembled audio', () => {
    assert.match(html, /id=["']td-full-preview["']/);
    assert.match(html, /id=["']td-assembled-preview["']/);
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


// ── Sprint 13.5.4 — hard delete + partial unique workflow ─────────────────

describe('Sprint 13.5.4 — tests-detail hard-delete button + controller', () => {
  const html = read('pages', 'admin', 'listening', 'tests-detail.html');

  test('Vùng nguy hiểm renders BOTH archive and hard-delete buttons', () => {
    assert.match(html, /id=["']td-delete-btn["']/);
    assert.match(html, /id=["']td-hard-delete-btn["']/);
  });

  test('archive copy explains soft-delete keeps history (preserves attempts)', () => {
    assert.match(html, /Archive\s*\(xoá mềm\)/i);
    assert.match(html, /Giữ data \+ audio \+ history attempt/);
  });

  test('hard-delete copy warns the action is irreversible', () => {
    assert.match(html, /Xoá vĩnh viễn/);
    assert.match(html, /Không\s*thể recover/i);
  });

});


// ── Sprint 13.5.6 — map image admin panel ─────────────────────────────────

describe('Sprint 13.5.6 — tests-detail map-image panel + controller', () => {
  const html = read('pages', 'admin', 'listening', 'tests-detail.html');

  test('declares the "Hình map" panel section + list host', () => {
    assert.match(html, /id="td-map-images"/);
    assert.match(html, /id="td-map-list"/);
    assert.match(html, /Hình map.*Plan-label/i);
  });

});


// ── Sprint 13.5.6 — student renderer extension ────────────────────────────

describe('Sprint 13.5.6 — student plan-label renderer accepts map image', () => {
  const playerJs = read('js', 'listening-test-player.js');
  const css      = read('css', 'ielts-test-paper.css');

  test('renderPlanLabel reads payload.map_image_url (not metadata.map_image_url)', () => {
    assert.match(playerJs, /payload\.map_image_url/);
  });

  test('renderPlanLabel emits an <img class="ielts-map-rendered"> when URL present', () => {
    assert.match(playerJs, /class="ielts-plan-image"/);
    assert.match(playerJs, /class="ielts-map-rendered"/);
    assert.match(playerJs, /alt="Floor plan map"/);
  });

  test('renderPlanLabel falls back to .ielts-plan-no-image notice when no map_image_url (Sprint 13.5.8)', () => {
    // Sprint 13.5.8 — the no-image branch used to render an empty
    // string + description text. It now emits a yellow notice block
    // that tells the admin to generate a map.
    // Skill drills (2026-07): the visualBlock ternary now tries an inline
    // payload.map_svg FIRST, then the map_image_url PNG, then this fallback —
    // so the no-image notice must still trail the mapImage branch.
    assert.match(playerJs, /const visualBlock = mapSvg[\s\S]*?mapImage[\s\S]*?class="ielts-plan-no-image"/);
  });

  test('renderPlanLabel suppresses map_description from the student view (Sprint 13.5.8)', () => {
    // Sprint 13.5.6 wired this in as an admin-only-with-fallback
    // legend. Sprint 13.5.8 removed it because real Cambridge plan-
    // label tasks present a visual map only — leaking the textual
    // description gives the answer key away.
    const fn = /function\s+renderPlanLabel\([\s\S]+?\n\}\s*\n/.exec(playerJs);
    assert.ok(fn, 'renderPlanLabel() not found');
    const code = fn[0].replace(/\/\/[^\n]*/g, '');
    assert.ok(!/meta\.map_description/.test(code),
      'student renderer must not access meta.map_description');
    assert.ok(!/payload\.map_description/.test(code),
      'student renderer must not access payload.map_description');
  });

  test('CSS clamps the rendered map image so it stays inside the test paper column', () => {
    assert.match(css, /\.ielts-map-rendered[\s\S]+?max-width:\s*100%/);
    assert.match(css, /\.ielts-map-rendered[\s\S]+?max-height:\s*480px/);
  });
});



// ── Sprint 13.5.9.3 — manual upload escape hatch (admin panel) ───────────
