/**
 * frontend/tests/audio-player.test.mjs
 *
 * Sprint 11.2 — pin the <audio-player> web component contract
 * (DEBT-LISTENING-MODULE foundation 2/5).
 *
 * Sentinel-string match against the source — same pattern as
 * listening-page-shell.test.mjs + chrome-unification-canonical.test.mjs.
 * Avoids needing a DOM. Catches:
 *   - the custom-element registration being lost in a refactor
 *   - the play / pause / scrub / time / speed / replay-5s controls
 *     being accidentally removed
 *   - the signed-URL refetch logic being dropped (silent breakage
 *     after the 1h TTL expires)
 *   - the bubbling+composed event names being renamed without
 *     updating dictation page listeners
 *   - the design tokens being replaced with hardcoded colors (Sprint
 *     11.0 §1C — no new CSS bucket; component uses canonical tokens)
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, '..', 'js', 'components', 'audio-player.js');
const SRC = readFileSync(SRC_PATH, 'utf8');


describe('Sprint 11.2 — <audio-player> contract', () => {

  it('registers the custom element `audio-player`', () => {
    assert.match(SRC, /customElements\.define\(\s*['"]audio-player['"]/);
    // Guarded against double-define (vital because the dictation page
    // imports the module via <script type="module"> on every nav).
    assert.match(SRC, /customElements\.get\(\s*['"]audio-player['"]/);
  });

  it('observes src, duration-hint, refetch-url attributes for reactive updates', () => {
    const m = SRC.match(/observedAttributes[^[]*\[([^\]]+)\]/);
    assert.ok(m, 'observedAttributes getter missing');
    const list = m[1];
    for (const attr of ['src', 'duration-hint', 'refetch-url']) {
      assert.match(list, new RegExp(`['"]${attr}['"]`), `observedAttributes missing ${attr}`);
    }
  });

  it('ships play / pause / scrub / time controls + 3 speed presets', () => {
    // Primary play button + replay-5s button by id.
    assert.match(SRC, /id="btn-play"/);
    assert.match(SRC, /id="btn-replay"/);
    // Scrub range input + time readout.
    assert.match(SRC, /id="scrub"[^>]*type="range"/);
    assert.match(SRC, /id="time"/);
    // 3 speed presets covering Sprint 11.0 §6 dictation requirement.
    for (const speed of ['0.75', '1', '1.25']) {
      assert.match(SRC, new RegExp(`data-speed="${speed}"`), `speed ${speed}x button missing`);
    }
  });

  it('replay-5s rewinds exactly 5 seconds', () => {
    // Hard-coded constant to keep dictation UX behaviour pinned —
    // a sprint that changes this to 3s or 10s trips here and forces
    // an explicit UX decision.
    assert.match(SRC, /currentTime[^;]*-\s*5/);
  });

  it('emits av-audio-* events with bubbles + composed', () => {
    // bubbles + composed = events cross the shadow boundary so the
    // page-level dictation JS receives them.
    assert.match(SRC, /bubbles:\s*true,\s*composed:\s*true/);
    for (const ev of ['av-audio-play', 'av-audio-pause', 'av-audio-ended', 'av-audio-error']) {
      assert.match(SRC, new RegExp(`['"]${ev}['"]`), `missing event ${ev}`);
    }
  });

  it('refetches signed URL once on error when refetch-url attribute is present', () => {
    // First-error retry sentinel — Supabase signed URLs have a 1h TTL,
    // so we MUST attempt a single transparent refresh before surfacing
    // av-audio-error to the page. The retry-once latch (_refetched)
    // prevents an infinite loop if the refresh itself returns a bad URL.
    assert.match(SRC, /refetch-url/);
    assert.match(SRC, /_refetched\s*=\s*true/);
    assert.match(SRC, /_refreshSignedUrl/);
    // The payload must accept either audio_signed_url (router shape) or
    // signed_url / signedURL (Supabase SDK shape variants).
    assert.match(SRC, /audio_signed_url/);
  });

  it('reuses canonical design tokens — no hardcoded brand hex', () => {
    // Sprint 11.0 §1C: component rides existing token palette. A future
    // PR that inlines #0F766E (or any hex) into the component CSS
    // trips here.
    assert.match(SRC, /var\(--av-brand-teal-700\)/);
    assert.match(SRC, /var\(--av-font-mono\)/);
    // Negative pin — no raw teal hex.
    assert.doesNotMatch(SRC, /#0F766E/i);
    assert.doesNotMatch(SRC, /#14B8A6/i);
  });

  it('exposes play() / pause() / reset() public methods', () => {
    assert.match(SRC, /^\s*play\s*\(\s*\)\s*\{/m);
    assert.match(SRC, /^\s*pause\s*\(\s*\)\s*\{/m);
    assert.match(SRC, /^\s*reset\s*\(\s*\)\s*\{/m);
  });
});
