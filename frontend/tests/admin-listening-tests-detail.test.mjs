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


// ── Sprint 13.5.4 — hard delete + partial unique workflow ─────────────────

describe('Sprint 13.5.4 — tests-detail hard-delete button + controller', () => {
  const html = read('pages', 'admin', 'listening', 'tests-detail.html');
  const js   = read('js', 'admin-listening-tests-detail.js');

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

  test('controller binds the hard-delete button to onHardDelete()', () => {
    assert.match(
      js,
      /getElementById\(['"]td-hard-delete-btn['"]\)\.addEventListener\(['"]click['"],\s*onHardDelete\)/,
    );
  });

  test('onHardDelete requires a window.confirm() AND a window.prompt() match', () => {
    assert.match(js, /async function onHardDelete\(/);
    assert.match(js, /window\.confirm\([\s\S]{0,200}?Xác nhận XOÁ VĨNH VIỄN/);
    assert.match(js, /window\.prompt\(/);
    // The prompt must compare its return value against the short test_id
    // (not against STATE.testId — that's the UUID, not the short name).
    assert.match(js, /userInput\s*!==\s*shortName/);
  });

  test('onHardDelete calls DELETE /admin/listening/tests/{id}/hard', () => {
    assert.match(
      js,
      /window\.api\.delete\(\s*`\/admin\/listening\/tests\/\$\{encodeURIComponent\(STATE\.testId\)\}\/hard`/,
    );
  });

  test('onHardDelete redirects to the tests-list on success', () => {
    const m = /async function onHardDelete\(\)\s*\{([\s\S]+?)\n\}/m.exec(js);
    assert.ok(m, 'onHardDelete body not found');
    assert.match(m[1], /window\.location\.href\s*=\s*['"]\/pages\/admin\/listening\/tests\.html['"]/);
  });

  test('onHardDelete surfaces errors via showError instead of throwing', () => {
    const m = /async function onHardDelete\(\)\s*\{([\s\S]+?)\n\}/m.exec(js);
    assert.ok(m);
    assert.match(m[1], /showError\(/);
    assert.match(m[1], /Hard delete thất bại/);
  });

  test('hard-delete URL is a backtick template literal (no `<` placeholder)', () => {
    // Regression guard cribbed from Sprint 13.5.1.
    const hardCalls = js.match(/['"`][^'"`]*\/hard['"`]/g) || [];
    assert.ok(hardCalls.length > 0, 'expected at least one /hard URL literal');
    for (const c of hardCalls) {
      assert.ok(!c.includes('<'),
        `URL contains a literal placeholder: ${c}`);
      assert.ok(!c.includes('%3C'),
        `URL contains URL-encoded placeholder: ${c}`);
    }
  });

  test('soft-delete onDelete handler is preserved (regression)', () => {
    // Sprint 13.5.4 must not regress the existing archive flow.
    assert.match(js, /async function onDelete\(/);
    assert.match(
      js,
      /window\.api\.delete\(\s*`\/admin\/listening\/tests\/\$\{encodeURIComponent\(STATE\.testId\)\}`\s*,?\s*\)/,
    );
  });

  test('hard-delete bails early when test_id is missing', () => {
    // The handler short-circuits if STATE.test.test_id is absent so the
    // prompt() comparison can't accidentally match an empty string.
    assert.match(js, /Không xác định được test_id/);
  });
});


// ── Sprint 13.5.6 — map image admin panel ─────────────────────────────────

describe('Sprint 13.5.6 — tests-detail map-image panel + controller', () => {
  const html = read('pages', 'admin', 'listening', 'tests-detail.html');
  const js   = read('js', 'admin-listening-tests-detail.js');

  test('declares the "Hình map" panel section + list host', () => {
    assert.match(html, /id="td-map-images"/);
    assert.match(html, /id="td-map-list"/);
    assert.match(html, /Hình map.*Plan-label/i);
  });

  test('render() invokes renderMapImagesPanel() after the other section renderers', () => {
    assert.match(js, /renderMapImagesPanel\(\)/);
  });

  test('panel hides when there are no plan-label exercises', () => {
    assert.match(js, /if \(!plExercises\.length\)\s*\{[\s\S]*?panel\.hidden\s*=\s*true/);
  });

  test('renders a model selector with Nano Banana 2 as the recommended default (Sprint 13.5.9.2)', () => {
    // Sprint 13.5.6 default was imagen-4.0-fast. Sprint 13.5.9.2 flips
    // the recommendation to Gemini 3.1 Flash Image (Nano Banana 2) —
    // Andy 2026-05-21 lock. The Imagen Fast option stays in the list
    // (cheapest tier) but loses the "DEFAULT" badge.
    assert.match(js, /gemini-3\.1-flash-image-preview/);
    assert.match(js, /\$0\.067[\s\S]*?DEFAULT/);
    assert.match(js, /imagen-4\.0-fast-generate-001/);
    assert.match(js, /gemini-2\.5-flash-image/);
  });

  test('shows a Generate button when no image yet + Regenerate/Delete when present', () => {
    assert.match(js, /td-map-gen/);
    assert.match(js, /td-map-regen/);
    assert.match(js, /td-map-delete/);
  });

  test('POSTs to /admin/listening/exercises/{id}/generate-map-image with model in body', () => {
    assert.match(
      js,
      /window\.api\.post\(\s*`\/admin\/listening\/exercises\/\$\{encodeURIComponent\(exerciseId\)\}\/generate-map-image`/,
    );
    // Sprint 13.5.9.1 — the body is now a multi-field object literal
    // ({ model, custom_prompt_override }) instead of the old `{ model }`
    // shorthand. Pin the `model:` key explicitly.
    assert.match(js, /model,\s*\n/);
  });

  test('DELETE clears the existing image before regenerate (cost guardrail confirm)', () => {
    assert.match(js, /Generate lại sẽ xoá hình hiện tại/);
    assert.match(
      js,
      /window\.api\.delete\(\s*`\/admin\/listening\/exercises\/\$\{encodeURIComponent\(exerciseId\)\}\/map-image`/,
    );
  });

  test('GET signed-url is called for each card already carrying an image', () => {
    assert.match(js, /function refreshMapImage\(/);
    assert.match(
      js,
      /window\.api\.get\(\s*`\/admin\/listening\/exercises\/\$\{encodeURIComponent\(exerciseId\)\}\/map-image\/signed-url`/,
    );
  });

  test('inflight status text updates the per-card .td-map-status element', () => {
    assert.match(js, /function setMapStatus\(/);
    assert.match(js, /Đang generate \(10-30s\)/);
  });

  test('after a successful generate the page re-fetches and re-renders', () => {
    // Sprint 13.5.6: each success path closes with fetchTest()+render()
    // so the panel re-picks the new payload metadata.
    assert.match(js, /await fetchTest\(\)/);
    assert.match(js, /render\(\)/);
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


// ── Sprint 13.5.9 — custom AI prompt source indicator on admin map panel ──

describe('Sprint 13.5.9 — admin map panel surfaces custom prompt source', () => {
  const js = read('js', 'admin-listening-tests-detail.js');

  test('panel reads map_image_custom_prompt off the exercise summary', () => {
    // Sprint 13.5.9 backend extends plan_label_exercises rows with
    // ``map_image_custom_prompt`` + ``map_image_prompt_source`` —
    // the renderer must consume both so the indicator + preview
    // render off the same source of truth.
    assert.match(js, /ex\.map_image_custom_prompt/);
    assert.match(js, /ex\.map_image_prompt_source/);
  });

  test('renders the custom-prompt indicator pill when a curated prompt exists', () => {
    // The pill carries data-source="custom" + the Vietnamese label
    // "Custom prompt từ markdown" so end-to-end tests can target it
    // by selector and Andy can see the source at a glance.
    assert.match(js, /td-prompt-source-custom/);
    assert.match(js, /data-source="custom"/);
    assert.match(js, /Custom prompt từ markdown/);
  });

  test('renders the template-prompt indicator pill when no curated prompt exists', () => {
    assert.match(js, /td-prompt-source-template/);
    assert.match(js, /data-source="template"/);
    assert.match(js, /Template prompt/);
    // The fallback copy must mention the missing <details> block so
    // Andy knows where to add it.
    assert.match(js, /details/);
  });

  test('curated prompt body is rendered inside a collapsible <details><textarea> (Sprint 13.5.9.1)', () => {
    // Sprint 13.5.9 wrapped the body in a read-only <pre>. Sprint
    // 13.5.9.1 swapped it for an editable <textarea> inside the same
    // <details> shell so admin can review + edit before generating.
    assert.match(js, /<details class="td-prompt-preview"/);
    assert.match(js, /<textarea class="td-prompt-editable"/);
    // The preview surfaces the char count so Andy can sanity-check
    // that the parser caught the full body.
    assert.match(js, /\$\{customPrompt\.length\}\s*chars/);
  });

  test('preview block is omitted when there is no custom prompt', () => {
    // The renderer must only emit the preview when `hasCustom` is
    // truthy; the empty-string template branch shouldn't render an
    // empty <details>. Sprint 13.5.9.1 renamed `promptPreview` →
    // `promptReview` (now contains both the textarea + edit indicator).
    assert.match(js, /const promptReview = hasCustom\s*\?\s*`<div class="td-prompt-review"/);
    assert.match(js, /:\s*'';/);
  });

  test('shows the "current image source" sub-label only when an image exists', () => {
    // For freshly generated images we want to tell Andy whether the
    // existing PNG was made from the curated prompt or the template.
    // The sentinel pins the conditional: `has && lastSource` gates
    // the sub-label.
    assert.match(js, /has\s*&&\s*lastSource/);
    assert.match(js, /Hình hiện tại generate từ/);
  });

  test('source indicator + preview live in their own .td-prompt-source-row block', () => {
    // Keep the new chrome scoped so future stylesheet work can target
    // the row without colliding with the existing actions row.
    assert.match(js, /class="td-prompt-source-row"/);
  });

  test('renderer escapes the curated prompt body before rendering (defensive)', () => {
    // The curated prompt comes from author-controlled markdown so XSS
    // is low-risk, but the existing panel uses escapeHtml() on every
    // user-controlled string — the new slot must follow suit.
    assert.match(js, /escapeHtml\(customPrompt\)/);
  });

  test('hasCustom mirror tracks the trimmed prompt (empty string → template)', () => {
    // A `<details>` block with a whitespace-only body must fall back
    // to the template indicator, mirroring the backend's
    // ``has_custom = bool(custom_prompt and custom_prompt.strip())``
    // contract.
    assert.match(js, /const customPrompt = \(ex\.map_image_custom_prompt \|\| ''\)\.trim\(\);/);
    assert.match(js, /const hasCustom = Boolean\(customPrompt\)/);
  });

  test('existing generate / regenerate / delete flow remains wired up (regression)', () => {
    // Sprint 13.5.9 only adds the source indicator. The existing
    // CTAs must keep working — pin their handlers so a future refactor
    // can't quietly delete them.
    assert.match(js, /\.td-map-gen/);
    assert.match(js, /\.td-map-regen/);
    assert.match(js, /\.td-map-delete/);
    assert.match(js, /\/generate-map-image/);
  });
});


// ── Sprint 13.5.9.1 — review / edit / override workflow ──────────────────

describe('Sprint 13.5.9.1 — admin reviews and optionally edits the prompt', () => {
  const js = read('js', 'admin-listening-tests-detail.js');

  test('replaces the read-only <pre> preview with an editable <textarea>', () => {
    assert.match(js, /<textarea class="td-prompt-editable"/);
    assert.ok(!/class="td-prompt-content"/.test(js),
      'read-only td-prompt-content <pre> must be removed');
  });

  test('textarea stores the parser-extracted prompt in a data-original attribute', () => {
    assert.match(js, /data-original="\$\{escapeHtml\(customPrompt\)\}"/);
  });

  test('renders a "↺ Reset về prompt gốc" button next to the textarea', () => {
    assert.match(js, /class="td-btn td-prompt-reset"/);
    assert.match(js, /Reset về prompt gốc/);
  });

  test('renders the "Prompt đã được edit" indicator span (hidden by default)', () => {
    assert.match(js, /class="td-prompt-edit-indicator"/);
    assert.match(js, /Prompt đã được edit/);
    assert.match(js,
      /class="td-prompt-edit-indicator"[\s\S]*?data-exercise-id="\$\{escapeHtml\(ex\.id\)\}"\s*\n\s*hidden/);
  });

  test('input handler toggles the edit indicator based on textarea diff', () => {
    assert.match(js, /function updatePromptEditIndicator\(textarea\)/);
    assert.match(js, /textarea\.getAttribute\(['"]data-original['"]\)/);
    assert.match(js, /indicator\.hidden\s*=\s*\(textarea\.value\s*===\s*original\)/);
  });

  test('reset button restores the textarea to the data-original value', () => {
    assert.match(js, /\.td-prompt-reset/);
    assert.match(js, /ta\.value = ta\.getAttribute\(['"]data-original['"]\)/);
    assert.match(js, /updatePromptEditIndicator\(ta\)/);
  });

  test('readCustomPromptOverride reads the textarea value (not data-original)', () => {
    assert.match(js, /function readCustomPromptOverride\(exerciseId\)/);
    assert.match(js, /ta\.value/);
    assert.match(js, /return current && current\.trim\(\) \? current : null/);
  });

  test('generate POST forwards custom_prompt_override in the body', () => {
    assert.match(js,
      /window\.api\.post\([\s\S]+?\/generate-map-image[\s\S]+?custom_prompt_override:\s*customPromptOverride/);
  });

  test('generate flow shows a confirmation dialog before the POST', () => {
    // Sprint 13.5.9.2 — confirm copy now interpolates a per-model
    // cost (was a fixed "Cost ~$0.02-0.04"). The new message shows:
    //   "Generate hình map với <sourceLine>?
    //    Model: <model>
    //    Cost ước tính: ~$<cost>"
    assert.match(js, /window\.confirm\(/);
    assert.match(js, /custom prompt \(\$\{promptChars\}\s*chars\)/);
    // Cost line reads from the per-model lookup, formatted to 3 dp.
    assert.match(js, /Cost ước tính:\s*~\$\$\{cost\.toFixed\(3\)\}/);
  });

  test('status line surfaces the prompt source returned by the API', () => {
    assert.match(js, /res\.map_image_prompt_source/);
    assert.match(js, /source=\$\{res\.map_image_prompt_source\}/);
  });

  test('curated prompt char count surfaces inside the <details> summary', () => {
    assert.match(js,
      /<summary>Review prompt sẽ gửi tới API \(\$\{customPrompt\.length\}\s*chars\)<\/summary>/);
  });

  test('handlers attach for both the textarea input and the reset button', () => {
    assert.match(js, /\.td-prompt-editable[\s\S]+?addEventListener\(['"]input['"]/);
    assert.match(js, /\.td-prompt-reset[\s\S]+?addEventListener\(['"]click['"]/);
  });

  test('confirmation dialog differentiates curated vs template messages', () => {
    // Sprint 13.5.9.2 — the curated / template split now lives in a
    // ``sourceLine`` ternary, not the confirm string itself. Pin the
    // ternary structure so future refactors can't drop either branch.
    assert.match(js, /custom prompt \(\$\{promptChars\}\s*chars\)/);
    assert.match(js, /template prompt \(no <details> block trong markdown\)/);
    assert.match(js, /Generate hình map với \$\{sourceLine\}/);
  });

  test('the indicator span is exercise-id-scoped (no cross-wiring on multi-card pages)', () => {
    assert.match(js, /textarea\.td-prompt-editable\[data-exercise-id="\$\{exerciseId\}"\]/);
    assert.match(js, /\.td-prompt-edit-indicator\[data-exercise-id="\$\{exerciseId\}"\]/);
  });

  test('preview block is omitted entirely when no curated prompt exists', () => {
    assert.match(js, /const promptReview = hasCustom\s*\?\s*`<div class="td-prompt-review"/);
    assert.match(js, /:\s*'';/);
  });
});


// ── Sprint 13.5.9.2 — Gemini 3.x migration (Nano Banana 2 default) ───────

describe('Sprint 13.5.9.2 — admin model selector + cost preview', () => {
  const js = read('js', 'admin-listening-tests-detail.js');

  test('model dropdown lists all six Sprint 13.5.9.2 supported models', () => {
    // Each option must appear once in the rendered <select>. Pin the
    // exact model IDs so a future refactor can't quietly drop the new
    // Gemini 3.x family or add a 7th option without an admin label.
    const expected = [
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
      'imagen-4.0-ultra-generate-001',
      'imagen-4.0-generate-001',
      'imagen-4.0-fast-generate-001',
      'gemini-2.5-flash-image',
    ];
    for (const id of expected) {
      const re = new RegExp(`<option value="${id.replace(/\./g, '\\.')}"`);
      assert.match(js, re, `missing option for ${id}`);
    }
  });

  test('default selector falls back to Nano Banana 2 (gemini-3.1-flash-image-preview)', () => {
    // When the exercise has no map_image_model yet (fresh row), the
    // selector default is the cluster default. Sprint 13.5.6 used
    // imagen-4.0-fast-generate-001; Sprint 13.5.9.2 flips this to
    // Andy's locked Gemini 3.x default.
    assert.match(js,
      /const model = ex\.map_image_model \|\| ['"]gemini-3\.1-flash-image-preview['"]/);
    // The old default is gone — pin the absence so a regression
    // doesn't quietly resurface.
    assert.ok(
      !/const model = ex\.map_image_model \|\| ['"]imagen-4\.0-fast-generate-001['"]/.test(js),
      'old imagen-4.0-fast default must be removed',
    );
  });

  test('legacy 2.5 Flash option carries an explicit deprecation marker', () => {
    // Andy needs to see "⚠️ deprecated 2026-10-02" inline so the
    // legacy pick isn't a silent footgun. The shutdown date appears
    // verbatim so a date-shift on the Google side reflects through
    // the same edit.
    assert.match(js, /Gemini 2\.5 Flash Image \(Nano Banana\)[\s\S]+?deprecated 2026-10-02/);
  });

  test('per-model pricing table mirrors the backend SUPPORTED_MODELS registry', () => {
    // The frontend keeps its own price table for the confirmation
    // dialog. Pin every model+price so a backend price change can't
    // silently desync the UI quote.
    assert.match(js, /'gemini-3\.1-flash-image-preview':\s*0\.067/);
    assert.match(js, /'gemini-3-pro-image-preview':\s*0\.134/);
    assert.match(js, /'imagen-4\.0-ultra-generate-001':\s*0\.06/);
    assert.match(js, /'imagen-4\.0-generate-001':\s*0\.04/);
    assert.match(js, /'imagen-4\.0-fast-generate-001':\s*0\.02/);
    assert.match(js, /'gemini-2\.5-flash-image':\s*0\.039/);
  });

  test('confirm copy quotes the per-model cost via MAP_IMAGE_MODEL_PRICING', () => {
    // The lookup must read from the new const map, and the cost must
    // surface in the confirm message at 3-dp precision. Also pin that
    // a deprecated pick triggers the inline warning string.
    assert.match(js, /const cost = MAP_IMAGE_MODEL_PRICING\[model\]/);
    assert.match(js, /Cost ước tính:\s*~\$\$\{cost\.toFixed\(3\)\}/);
    assert.match(js, /MAP_IMAGE_DEPRECATED_MODELS\.has\(model\)/);
    assert.match(js, /deprecated 2026-10-02/);
  });
});


// ── Sprint 13.5.9.3 — manual upload escape hatch (admin panel) ───────────

describe('Sprint 13.5.9.3 — manual map-image upload UI', () => {
  const js = read('js', 'admin-listening-tests-detail.js');

  test('renders a tab nav with API-generate (default) + manual-upload tabs', () => {
    // Two tabs per card. The API one is the default ``is-active``;
    // pinning the active class so a refactor can't quietly flip the
    // default tab and break Andy's muscle memory.
    assert.match(js, /class="td-map-tab is-active"[\s\S]+?data-tab="api-generate"/);
    assert.match(js, /class="td-map-tab"[\s\S]+?data-tab="manual-upload"/);
    assert.match(js, /aria-selected="true"/);
    // The labels include Andy's emoji shorthand so the tabs are
    // scannable in Vietnamese without translation.
    assert.match(js, /🎨 Generate via API/);
    assert.match(js, /📤 Upload ảnh có sẵn/);
  });

  test('tab panes carry data-tab-pane="api-generate" + "manual-upload"', () => {
    // The visibility toggle reads ``data-tab-pane`` on each pane, so
    // pin both pane markers. Manual-upload pane starts hidden.
    assert.match(js,
      /<div class="td-map-tab-pane" data-tab-pane="api-generate"/);
    assert.match(js,
      /<div class="td-map-tab-pane" data-tab-pane="manual-upload"[\s\S]+?hidden/);
  });

  test('dropzone accepts only PNG / JPG / WebP via the file input accept attribute', () => {
    // ``accept="…"`` is a soft hint to the file picker but matches
    // the server's hard guard so admin doesn't even see GIFs etc.
    assert.match(js,
      /<input type="file" class="td-map-file-input"[\s\S]+?accept="image\/png,image\/jpeg,image\/webp"/);
  });

  test('client-side validator rejects unsupported types + oversized files', () => {
    // Pin both branches of the validator so a future refactor can't
    // silently drop one. The 5 MB cap mirrors the backend constant.
    assert.match(js, /MAP_IMAGE_MANUAL_UPLOAD_MAX_BYTES = 5 \* 1024 \* 1024/);
    assert.match(js, /new Set\(\[\s*'image\/png',\s*'image\/jpeg',\s*'image\/webp'/);
    assert.match(js, /function _validateManualUploadFile\(file\)/);
    assert.match(js, /file\.size > MAP_IMAGE_MANUAL_UPLOAD_MAX_BYTES/);
    assert.match(js, /file\.size < 100/);
  });

  test('dropzone wires both click-to-select and drag-and-drop handlers', () => {
    // Click flow: dropzone click → fileInput.click(). Drop flow:
    // dragover prevents default + flips dragover class; drop reads
    // dataTransfer.files. Pin both so the keyboard path doesn't
    // regress (file input gets focus + Enter).
    assert.match(js, /fileInput\.click\(\)/);
    assert.match(js, /zone\.addEventListener\(['"]dragover['"]/);
    assert.match(js, /zone\.addEventListener\(['"]drop['"]/);
    assert.match(js, /e\.dataTransfer\.files\s*&&\s*e\.dataTransfer\.files\[0\]/);
  });

  test('selected file renders a preview img + filename + filesize', () => {
    // Preview wrap starts hidden and flips visible once a valid file
    // is picked. FileReader.readAsDataURL feeds the <img> src.
    assert.match(js, /reader\.readAsDataURL\(file\)/);
    assert.match(js, /td-map-upload-preview-img/);
    assert.match(js, /td-map-upload-filename/);
    assert.match(js, /td-map-upload-filesize/);
    assert.match(js, /previewWrap\.hidden = false/);
  });

  test('cancel button clears the selection map + hides the preview', () => {
    assert.match(js, /function cancelManualUpload\(exerciseId\)/);
    assert.match(js, /_manualUploadSelections\.delete\(exerciseId\)/);
    assert.match(js, /previewWrap\.hidden = true/);
    assert.match(js, /fileInput\.value = ''/);
  });

  test('confirm shows a $0-cost dialog before sending the upload', () => {
    // Andy 2026-05-21 lock: the manual flow must spell out the
    // $0 cost so it's clearly the no-API-call escape hatch.
    assert.match(js, /window\.confirm\(/);
    assert.match(js, /Cost: \$0 \(no API call\)/);
  });

  test('confirm posts the file via window.api.upload to /upload-map-image', () => {
    // Multipart upload via the api.js helper that sets the right
    // Content-Type. The endpoint URL pin catches a typo of the new
    // route. FormData carries the file under "image_file" — that's
    // the FastAPI param name on the backend.
    assert.match(js, /formData\.append\(['"]image_file['"],\s*file\)/);
    assert.match(js,
      /window\.api\.upload\(\s*`\/admin\/listening\/exercises\/\$\{encodeURIComponent\(exerciseId\)\}\/upload-map-image`/);
  });

  test('after a successful upload the panel re-fetches and re-renders', () => {
    // Same pattern as Sprint 13.5.6's onGenerateMapImage: fetchTest()
    // + render() so the source badge flips to "Manual upload" without
    // a manual refresh.
    const fn = /async function onConfirmManualUpload\([\s\S]+?\n\}/.exec(js);
    assert.ok(fn, 'onConfirmManualUpload() not found');
    assert.match(fn[0], /await fetchTest\(\)/);
    assert.match(fn[0], /render\(\)/);
  });

  test('header badge differentiates manual_upload vs api_generation visually', () => {
    // The card header chip reads ex.map_image_source first (Sprint
    // 13.5.9.3 backend projection), falling back to api_generation
    // when only the legacy model field is set. Pin both branches.
    assert.match(js, /ex\.map_image_source/);
    assert.match(js, /td-map-source-badge[\s\S]+?data-source="manual_upload"/);
    assert.match(js, /td-map-source-badge[\s\S]+?data-source="api_generation"/);
    assert.match(js, /📤 Manual upload/);
    assert.match(js, /🎨 API:/);
  });
});
