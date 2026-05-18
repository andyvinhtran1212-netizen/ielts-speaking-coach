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
const HTML_PATH = join(__dirname, '..', 'pages', 'admin-listening-segments.html');
const JS_PATH = join(__dirname, '..', 'js', 'admin-listening-segments.js');
const HTML = readFileSync(HTML_PATH, 'utf8');
const JS = readFileSync(JS_PATH, 'utf8');


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


describe('Sprint 11.3 — admin segment editor JS contract', () => {

  it('reads ?content_id from URL', () => {
    assert.match(JS, /URLSearchParams\(\s*window\.location\.search\s*\)/);
    assert.match(JS, /['"]content_id['"]/);
  });

  it('fetches /admin/listening/content/{id} (admin endpoint — drafts visible)', () => {
    assert.match(JS, /\/admin\/listening\/content\//);
  });

  it('seeds existing segments via GET /admin/listening/exercises', () => {
    assert.match(JS, /\/admin\/listening\/exercises\?content_id=/);
    assert.match(JS, /exercise_type=dictation/);
  });

  it('POSTs to /admin/listening/exercises with the right shape', () => {
    assert.match(JS, /api\.post\(\s*['"]\/admin\/listening\/exercises['"]/);
    assert.match(JS, /content_id:\s*STATE\.contentId/);
    assert.match(JS, /exercise_type:\s*['"]dictation['"]/);
    assert.match(JS, /segments,/);
  });

  it('parses mm:ss.s timestamps + formats back to mm:ss.s', () => {
    assert.match(JS, /function parseTime/);
    assert.match(JS, /function fmtTime/);
    // The Vietnamese mm:ss.s convention requires colon-split for "m:s.s"
    // formats — verify the split is present.
    assert.match(JS, /split\(['"]:['"]\)/);
  });

  it('mark-start / mark-end captures audio.currentTime', () => {
    assert.match(JS, /mark-start/);
    assert.match(JS, /mark-end/);
    // Sprint 11.3 — until <audio-player> exposes a public getCurrentTime(),
    // the editor probes the internal _audio element. A future sprint
    // that adds the public method must update this pin.
    assert.match(JS, /_lastAudioTime/);
  });

  it('saves draft vs published as separate buttons', () => {
    assert.match(JS, /save\(['"]draft['"]\)/);
    assert.match(JS, /save\(['"]published['"]\)/);
  });

  it('uses the canonical Supabase project ref', () => {
    assert.match(JS, /nqhrtqspznepmveyurzm\.supabase\.co/);
  });

  it('escapes admin-controlled strings before innerHTML', () => {
    assert.match(JS, /function escapeHtml/);
    assert.match(JS, /\.replace\(\/&\/g/);
  });
});
