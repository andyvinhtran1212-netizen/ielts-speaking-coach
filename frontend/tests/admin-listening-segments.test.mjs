/**
 * frontend/tests/admin-listening-segments.test.mjs
 *
 * Sprint 11.3 — pin admin segment editor (DEBT-LISTENING-MODULE 3/5).
 *
 * Sentinel-style match against the static page + JS source. The editor
 * is admin-only + behind require_admin() server-side, so this test
 * doesn't exercise a DOM — it pins the structural contract:
 *
 *   - audio player mount + mm:ss.s timestamp inputs
 *   - "Parse lines" → "Đánh dấu" mark-start / mark-end workflow
 *   - POST /admin/listening/exercises payload shape (content_id,
 *     exercise_type, segments, status)
 *   - GET /admin/listening/exercises seeds the editor on re-edit
 *   - inline highlighting on invalid rows (.has-error)
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, '..', 'pages', 'admin/listening/segments.html');
const HTML = readFileSync(HTML_PATH, 'utf8');

// LEGACYJS-0075 W1: public/js/admin-listening-segments.js is retired. Its JS
// contract and helper unit cases now live against the native model in
// admin-listening-segments-next-behavior.test.mjs (ported cases) and
// verify-admin-listening-segments-flow.mjs; only the archived page fixture
// contract stays here.


describe('Sprint 11.3 — admin segment editor page contract', () => {

  it('mounts <audio-player> for time scrubbing', () => {
    assert.match(HTML, /<audio-player[^>]*id="player"/);
    assert.match(HTML, /\/js\/components\/audio-player\.js/);
  });

  it('ships textarea + Phân tách button + segments list', () => {
    assert.match(HTML, /id="transcript-input"/);
    assert.match(HTML, /id="btn-parse"/);
    assert.match(HTML, /id="segments-list"/);
  });

  it('ships save + publish buttons', () => {
    assert.match(HTML, /id="btn-save"/);
    assert.match(HTML, /id="btn-publish"/);
  });

  it('styles segments-list rows with has-error class for invalid rows', () => {
    assert.match(HTML, /segments-list li\.has-error/);
    // Bad rows must be visually distinct (color OR border).
    assert.match(HTML, /\.has-error\s*\{[^}]*border-color/);
  });
});



/* ─────────────────────────────────────────────────────────────────
 * Sprint 11.3.1 — parser + auto-timestamp helpers (unit-tested).
 *
 * The Sprint 11.3 segment editor parser left timestamps at 0.0 → save
 * blocked by backend constraint (#65a). The parser also split on \n
 * boundaries only, producing paragraph-level chunks instead of
 * sentence-level (#65b). These tests pin the corrected behavior:
 * sentence-boundary splitting + char-proportional timestamp allocation.
 * ───────────────────────────────────────────────────────────────── */



/* ─────────────────────────────────────────────────────────────────
 * Sprint 11.4 — alignment-driven timestamp helper.
 * ───────────────────────────────────────────────────────────────── */

