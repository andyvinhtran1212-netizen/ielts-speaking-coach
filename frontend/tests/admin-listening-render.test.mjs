/**
 * frontend/tests/admin-listening-render.test.mjs — Sprint 13.3
 * (DEBT-ADMIN-LISTENING-AUTHORING 3/N).
 *
 * Pins the markup + JS-module contract for the new ElevenLabs render
 * surface:
 *   - /pages/admin/listening/render.html (single-step flow)
 *   - /js/admin-listening-render.js (FF gate, voice/model picker,
 *     debounced cost preview, validate-then-submit)
 *
 * And the integration touch-points:
 *   - listening landing /pages/admin/listening/index.html flips the
 *     "Render ElevenLabs" card to a live link;
 *   - content-detail.html surfaces a post-render banner driven by
 *     ?just_rendered=true.
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


// ── Render page structure ───────────────────────────────────────────────────


describe('Sprint 13.3 — render page structure', () => {
  const html = read('pages', 'admin', 'listening', 'render.html');

  test('embeds chrome with active=listening + subsection=create', () => {
    assert.match(
      html,
      /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']create["']/,
    );
  });

  test('back link returns to listening landing', () => {
    assert.match(html, /href=["']\/pages\/admin\/listening\/index\.html["']/);
  });

  test('503 banner scaffold present (rendered when FF off)', () => {
    assert.match(html, /id=["']rn-503-banner["']/);
    assert.match(html, /id=["']rn-503-message["']/);
  });

  test('script textarea + character / word stat counters', () => {
    assert.match(html, /id=["']rn-script["']/);
    assert.match(html, /id=["']rn-script-chars["']/);
    assert.match(html, /id=["']rn-script-words["']/);
  });

  test('cost preview pills present (credits + usd + render seconds)', () => {
    for (const id of ['rn-cost-credits', 'rn-cost-usd', 'rn-cost-secs']) {
      assert.match(html, new RegExp(`id=["']${id}["']`),
        `missing cost-preview pill ${id}`);
    }
  });

  test('voice picker carries Sarah + Alice locked IDs', () => {
    assert.match(html, /data-voice-id=["']EXAVITQu4vr4xnSDxMaL["']/);  // Sarah
    assert.match(html, /data-voice-id=["']Xb7hH8MSUJpSbSDYk0k2["']/);  // Alice
    assert.match(html, /Sarah/);
    assert.match(html, /Alice/);
  });

  test('model picker offers both ElevenLabs models', () => {
    assert.match(html, /data-model=["']eleven_multilingual_v2["']/);
    assert.match(html, /data-model=["']eleven_flash_v2_5["']/);
  });

  test('metadata fields (title + accent + cefr + section + tags + premium)', () => {
    for (const id of ['rn-title', 'rn-accent', 'rn-cefr', 'rn-section',
                      'rn-tags', 'rn-premium']) {
      assert.match(html, new RegExp(`id=["']${id}["']`),
        `missing metadata field ${id}`);
    }
  });

  test('validate + submit buttons + countdown surface present', () => {
    assert.match(html, /id=["']rn-validate["']/);
    assert.match(html, /id=["']rn-submit["']/);
    assert.match(html, /id=["']rn-countdown["']/);
  });

  test('issues container renders inline errors + warnings', () => {
    assert.match(html, /id=["']rn-issues["']/);
  });

  test('form section is hidden by default — revealed after FF check', () => {
    assert.match(html, /id=["']rn-form["']\s+hidden/);
  });
});


// ── Render controller logic ─────────────────────────────────────────────────


describe('Sprint 13.3 — render controller logic', () => {
  const js = read('js', 'admin-listening-render.js');

  test('FF check calls GET /admin/listening/render/feature-flag on mount', () => {
    assert.match(
      js,
      /window\.api\.get\(\s*['"]\/admin\/listening\/render\/feature-flag['"]/,
    );
  });

  test('503 banner shown when FF endpoint says enabled=false', () => {
    assert.match(
      js,
      /res\.enabled[\s\S]*?rn-503-banner/,
      'FF disabled path must toggle rn-503-banner visibility',
    );
  });

  test('FF check fails open on network/server error (admin convenience)', () => {
    assert.match(
      js,
      /catch[\s\S]*?STATE\.ffEnabled\s*=\s*true/,
      'FF endpoint failure must default to enabled (server-side gate still blocks)',
    );
  });

  test('cost preview debounce uses setTimeout (500ms)', () => {
    assert.match(js, /DEBOUNCE_MS\s*=\s*500/);
    assert.match(js, /setTimeout\(refreshCostPreview/);
  });

  test('script input change triggers debounced preview', () => {
    assert.match(
      js,
      /rn-script['"]\)\.addEventListener\(['"]input['"][\s\S]*?scheduleCostPreview\(\)/,
    );
  });

  test('voice pick auto-syncs accent dropdown', () => {
    assert.match(js, /VOICE_TO_ACCENT/);
    assert.match(
      js,
      /VOICE_TO_ACCENT\[voiceId\][\s\S]*?rn-accent['"]\)\.value\s*=\s*accent/,
    );
  });

  test('Sarah maps to us_general, Alice maps to uk_rp', () => {
    assert.match(js, /['"]EXAVITQu4vr4xnSDxMaL['"]\s*:\s*['"]us_general['"]/);
    assert.match(js, /['"]Xb7hH8MSUJpSbSDYk0k2['"]\s*:\s*['"]uk_rp['"]/);
  });

  test('validate button POSTs to /admin/listening/render/validate', () => {
    assert.match(
      js,
      /window\.api\.post\(\s*['"]\/admin\/listening\/render\/validate['"]/,
    );
  });

  test('errors block submit (button disabled = !res.ok)', () => {
    assert.match(
      js,
      /rn-submit['"]\)\.disabled\s*=\s*!res\.ok/,
    );
  });

  test('submit POSTs to /admin/listening/render', () => {
    assert.match(
      js,
      /window\.api\.post\(\s*['"]\/admin\/listening\/render['"]/,
    );
  });

  test('successful render redirects to content-detail with just_rendered=true', () => {
    assert.match(
      js,
      /content-detail\.html\?id=\$\{encodeURIComponent\(contentId\)\}&just_rendered=true/,
    );
  });

  test('countdown starts after submit using estimated_render_seconds', () => {
    assert.match(js, /startCountdown\(res\.estimated_render_seconds/);
  });
});


// ── Listening landing flips render card to live link ────────────────────────


describe('Sprint 13.3 — listening landing integrates render entry', () => {
  const html = read('pages', 'admin', 'listening', 'index.html');

  test('"Render ElevenLabs" card is now a live link to render.html', () => {
    const renderCard = html.match(/<a[^>]*data-create=["']render["'][^>]*>/);
    assert.ok(renderCard, 'render card markup not found');
    assert.match(
      renderCard[0],
      /href=["']\/pages\/admin\/listening\/render\.html["']/,
      'render card must point to /pages/admin/listening/render.html',
    );
    assert.doesNotMatch(
      renderCard[0],
      /aria-disabled=["']true["']/,
      'render card must not be aria-disabled in Sprint 13.3',
    );
  });

  test('both create cards (upload + render) now live', () => {
    const uploadCard = html.match(/<a[^>]*data-create=["']upload["'][^>]*>/);
    const renderCard = html.match(/<a[^>]*data-create=["']render["'][^>]*>/);
    assert.ok(uploadCard && renderCard, 'both create cards must exist');
    assert.doesNotMatch(uploadCard[0], /aria-disabled=["']true["']/);
    assert.doesNotMatch(renderCard[0], /aria-disabled=["']true["']/);
  });
});


// ── Content-detail post-render banner ───────────────────────────────────────


describe('Sprint 13.3 — content-detail post-render banner', () => {
  const html = read('pages', 'admin', 'listening', 'content-detail.html');
  const js   = read('js', 'admin-listening-content-detail.js');

  test('content-detail.html carries the just-rendered banner scaffold', () => {
    assert.match(html, /id=["']just-rendered-banner["']/);
    assert.match(html, /id=["']just-rendered-message["']/);
  });

  test('controller reads ?just_rendered=true from URL', () => {
    // The check is split across lines in the controller: parse the
    // query string, then compare. Pin the two key tokens independently.
    assert.match(js, /URLSearchParams\(window\.location\.search\)/);
    assert.match(
      js,
      /sp\.get\(['"]just_rendered['"]\)\s*===\s*['"]true['"]/,
    );
  });

  test('controller starts polling when row missing audio_storage_path', () => {
    // Sprint 13.3.1 renamed startJustRenderedPolling →
    // startRenderingPolling and centralized detection in
    // isPlaceholderRendering.
    assert.match(js, /startRenderingPolling/);
    assert.match(js, /isPlaceholderRendering/);
    assert.match(js, /audio_storage_path/);
  });

  test('polling auto-dismisses banner once audio lands', () => {
    // Sprint 13.3.1: setTimeout-based backoff (no clearInterval); the
    // banner dismiss happens in the success branch of the tick callback.
    assert.match(
      js,
      /audio_storage_path[\s\S]*?hideRenderingBanner/,
    );
  });
});


// ── Sprint 13.3.1 — race-condition hotfix sentinels ─────────────────────────


describe('Sprint 13.3.1 — placeholder row + backoff polling + failed banner', () => {
  const js = read('js', 'admin-listening-content-detail.js');

  test('isPlaceholderRendering helper centralizes the rendering sentinel', () => {
    // The check is `source_type === 'ai_elevenlabs' && audio_storage_path == null`.
    assert.match(js, /function\s+isPlaceholderRendering\(/);
    assert.match(js, /ai_elevenlabs/);
    assert.match(js, /audio_storage_path\s*===\s*null/);
  });

  test('isFailedRender detects status=archived + placeholder shape', () => {
    assert.match(js, /function\s+isFailedRender\(/);
    assert.match(js, /content\.status\s*===\s*['"]archived['"]/);
  });

  test('failed render renders red banner (not yellow rendering banner)', () => {
    assert.match(js, /showFailedRenderBanner/);
    // Red banner uses the FEF2F2 background; yellow uses FEF3C7.
    assert.match(js, /#FEF2F2/);
    assert.match(js, /#FEF3C7/);
  });

  test('backoff schedule is [5, 10, 15, 15, 15] (= 60s total)', () => {
    assert.match(
      js,
      /_RENDER_POLL_BACKOFF_S\s*=\s*\[\s*5\s*,\s*10\s*,\s*15\s*,\s*15\s*,\s*15\s*\]/,
    );
  });

  test('polling uses setTimeout with backoff (not constant setInterval)', () => {
    assert.match(js, /setTimeout/);
    // The Sprint 13.3 constant setInterval-based poller retired.
    assert.doesNotMatch(js, /setInterval\(\s*async\s*\(\)\s*=>/);
  });

  test('render endpoint response carries content_id (matches placeholder id)', () => {
    // Backend response shape is consumed by render.html JS — verify the
    // render controller still uses res.content_id to redirect.
    const renderJs = read('js', 'admin-listening-render.js');
    assert.match(renderJs, /res\.content_id/);
  });

  test('placeholder detection independent of ?just_rendered=true URL param', () => {
    // Sprint 13.3.1 commission: the placeholder sentinel must work
    // regardless of arrival path. maybeStartRenderingFlow reads the
    // content row directly, not the URL.
    assert.match(js, /maybeStartRenderingFlow/);
    assert.match(
      js,
      /maybeStartRenderingFlow\(\)[\s\S]{0,500}?isFailedRender/,
      'maybeStartRenderingFlow must branch on isFailedRender first',
    );
  });
});
