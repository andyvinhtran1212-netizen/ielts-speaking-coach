/**
 * frontend/tests/speaking-length-gate.test.mjs — Sprint 14.2.
 *
 * Source-regex sentinels for the audio-playback + per-Q length-gate
 * feature. Pins the surface contract between:
 *
 *   - backend/services/audio_validation.py — owns the cap table
 *     and the HTTP 422 detail shape
 *   - frontend/js/practice.js — mirrors the cap table for the
 *     pre-submit hint and dispatches on detail.code === 'audio_too_short'
 *   - frontend/js/api.js — surfaces the structured detail body
 *     via error.detail on thrown errors
 *   - frontend/pages/practice.html — hosts <audio id="rec-playback">,
 *     #rec-length-hint, and #rec-submit-btn that the JS targets
 *
 * Vanilla static HTML — no headless browser in CI, so all assertions
 * are source-level. Same approach as Sprint 14.1.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function readFront(...parts) {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}
function readBack(...parts) {
  return readFileSync(join(__dirname, '..', '..', 'backend', ...parts), 'utf8');
}

const PRACTICE_JS   = readFront('js', 'practice.js');
const API_JS        = readFront('js', 'api.js');
const PRACTICE_HTML = readFront('pages', 'practice.html');
const AUDIO_VAL_PY  = readBack('services', 'audio_validation.py');
const GRADING_PY    = readBack('routers', 'grading.py');


// ── Cap-table parity: frontend mirrors backend ────────────────────────────


describe('Sprint 14.2 — cap-table parity between practice.js and audio_validation.py', () => {

  test('practice.js declares MIN_RECORD_SEC = { 1:15, 2:80, 3:25 }', () => {
    // Pin the exact object literal so any drift forces an explicit
    // re-read of audio_validation.MIN_DURATION_BY_PART.
    assert.match(
      PRACTICE_JS,
      /var\s+MIN_RECORD_SEC\s*=\s*\{\s*1\s*:\s*15\s*,\s*2\s*:\s*80\s*,\s*3\s*:\s*25\s*\}/,
      'practice.js MIN_RECORD_SEC must match backend cap table',
    );
  });

  test('audio_validation.py declares MIN_DURATION_BY_PART = { 1:15, 2:80, 3:25 }', () => {
    // Strip whitespace + newlines for a robust match against the dict.
    // Trailing comma in the source is canonical PEP 8, so the pattern
    // tolerates it explicitly.
    const compact = AUDIO_VAL_PY.replace(/\s+/g, '');
    assert.match(
      compact,
      /MIN_DURATION_BY_PART(?::dict\[int,int\])?=\{1:15,2:80,3:25,?\}/,
      'backend MIN_DURATION_BY_PART must equal {1:15, 2:80, 3:25}',
    );
  });

  test('practice.js carries a comment naming the backend file as source of truth', () => {
    // If the cap table diverges, future-you needs to know where to
    // look. Anchor a discoverability comment.
    assert.match(
      PRACTICE_JS,
      /backend\/services\/audio_validation\.py/,
      'practice.js must point at the canonical cap-table file',
    );
  });

});


// ── HTML: playback widget + length hint + submit-btn id are present ───────


describe('Sprint 14.2 — practice.html exposes the playback widget contract', () => {

  test('#rec-playback <audio controls preload="metadata"> exists', () => {
    // The <audio> element is what the JS targets via getElementById.
    // Pin the id, the controls attribute, and the preload mode so a
    // stylistic cleanup cannot silently remove them.
    assert.match(PRACTICE_HTML, /<audio[^>]*id="rec-playback"[^>]*>/);
    assert.match(PRACTICE_HTML, /id="rec-playback"[\s\S]*?controls/);
    assert.match(PRACTICE_HTML, /id="rec-playback"[\s\S]*?preload="metadata"/);
  });

  test('#rec-length-hint <p> exists inside the recorded sub-state', () => {
    assert.match(PRACTICE_HTML, /<p[^>]*id="rec-length-hint"[^>]*>/);
  });

  test('#rec-submit-btn id is wired (so the gate can disable submit)', () => {
    // Before Sprint 14.2 the submit button had no id; the gate needs
    // one to drive the disabled state.
    assert.match(PRACTICE_HTML, /id="rec-submit-btn"/);
    // Must still be invoked via submitRecording() — pin the wire-up
    // so a rename of submitRecording elsewhere catches both sites.
    assert.match(
      PRACTICE_HTML,
      /id="rec-submit-btn"[\s\S]{0,400}onclick="PracticeApp\.submitRecording\(\)"/,
    );
  });

  test('playback widget sits after the recorded sub-state opens, before any later sub-state', () => {
    // The playback must only render after recording stops. Use source
    // order rather than block extraction (HTML has too many nested
    // <div>s for a simple regex match).
    const recordingIdx = PRACTICE_HTML.indexOf('id="rec-recording"');
    const recordedIdx  = PRACTICE_HTML.indexOf('id="rec-recorded"');
    const playbackIdx  = PRACTICE_HTML.indexOf('id="rec-playback"');
    const hintIdx      = PRACTICE_HTML.indexOf('id="rec-length-hint"');
    assert.ok(recordingIdx > 0, '#rec-recording must exist');
    assert.ok(recordedIdx > recordingIdx,
      '#rec-recorded must come AFTER #rec-recording in source');
    assert.ok(playbackIdx > recordedIdx,
      '#rec-playback must come AFTER #rec-recorded opens (not in the live recording UI)');
    assert.ok(hintIdx > recordedIdx,
      '#rec-length-hint must come AFTER #rec-recorded opens');
  });

});


// ── JS: 422 audio_too_short dispatch + helpers wired ──────────────────────


describe('Sprint 14.2 — practice.js dispatches on backend audio_too_short detail', () => {

  test('practice.js branches on detail.code === "audio_too_short"', () => {
    // Pin the exact string the backend ships in to_detail() so a
    // rename on either side is caught by both this test and the
    // backend test_to_detail_shape_pinned.
    assert.match(
      PRACTICE_JS,
      /detail\.code\s*===\s*['"]audio_too_short['"]/,
    );
  });

  test('practice.js defines _handleAudioTooShort + uses showState("recording")', () => {
    assert.match(PRACTICE_JS, /function\s+_handleAudioTooShort\s*\(\s*detail\s*\)/);
    // P1/P3 path returns to the recording state with the recorded sub-state.
    // Larger window (2400 chars) to absorb the Part 2 branch + comments.
    assert.match(PRACTICE_JS, /_handleAudioTooShort[\s\S]{0,2400}showState\(['"]recording['"]\)/);
    assert.match(PRACTICE_JS, /_handleAudioTooShort[\s\S]{0,2400}_showRecSub\(['"]recorded['"]\)/);
  });

  test('practice.js defines _renderRecordedPlayback + _renderRecordedLengthHint', () => {
    assert.match(PRACTICE_JS, /function\s+_renderRecordedPlayback\s*\(\s*\)/);
    assert.match(PRACTICE_JS, /function\s+_renderRecordedLengthHint\s*\(\s*\)/);
    // Length hint must read both _elapsedSecs and MIN_RECORD_SEC[part].
    assert.match(
      PRACTICE_JS,
      /_renderRecordedLengthHint[\s\S]{0,600}MIN_RECORD_SEC\[/,
    );
    assert.match(
      PRACTICE_JS,
      /_renderRecordedLengthHint[\s\S]{0,600}_elapsedSecs/,
    );
  });

  test('_recorder.onstop invokes the playback + hint helpers (no orphan helper)', () => {
    // If the helpers exist but are never called, the playback widget
    // never appears. Pin the call site.
    assert.match(
      PRACTICE_JS,
      /_recorder\.onstop\s*=\s*function\s*\(\)\s*\{[\s\S]{0,800}_renderRecordedPlayback\(\)/,
    );
    assert.match(
      PRACTICE_JS,
      /_recorder\.onstop\s*=\s*function\s*\(\)\s*\{[\s\S]{0,800}_renderRecordedLengthHint\(\)/,
    );
  });

  test('_resetRecorder tears down the playback URL (no blob leak)', () => {
    // The blob URL must be revoked on re-record. Pin _teardownRecordedPlayback
    // is invoked inside _resetRecorder.
    assert.match(
      PRACTICE_JS,
      /function\s+_resetRecorder\s*\(\)\s*\{[\s\S]{0,1200}_teardownRecordedPlayback\(\)/,
    );
    // And the teardown actually revokes the URL.
    assert.match(
      PRACTICE_JS,
      /function\s+_teardownRecordedPlayback[\s\S]{0,800}URL\.revokeObjectURL\(_recordedPlaybackUrl\)/,
    );
  });

});


// ── api.js: error.detail surfaced for structured 422 bodies ──────────────


describe('Sprint 14.2 — api.js attaches error.detail to thrown errors', () => {

  test('api.js sets thrown.detail = detail || null on non-2xx responses', () => {
    // Previously only error.message survived (e.g. "HTTP 422"). The
    // gate needs the full detail body so the frontend can render the
    // exact threshold the user missed.
    assert.match(API_JS, /thrown\.detail\s*=\s*detail\s*\|\|\s*null/);
    assert.match(API_JS, /thrown\.status\s*=\s*response\.status/);
  });

  test('api.js coerces object-typed detail to a readable message', () => {
    // FastAPI ships {detail: {code: ..., message: ...}} for our 422.
    // The legacy code path did `err.detail || 'HTTP ...'` which would
    // stringify the object as "[object Object]" in the thrown message.
    // Pin the object-aware coercion.
    assert.match(API_JS, /typeof\s+detail\s*===\s*['"]object['"]/);
    assert.match(API_JS, /detail\.message\s*\|\|\s*['"]HTTP\s/);
  });

});


// ── Backend wire-in: grading.py invokes validate_audio_duration ───────────


describe('Sprint 14.2 — backend grading.py wires the validator', () => {

  test('grading.py imports + invokes validate_audio_duration', () => {
    assert.match(
      GRADING_PY,
      /from\s+services\.audio_validation\s+import\s+AudioTooShortError\s*,\s*validate_audio_duration/,
    );
    assert.match(GRADING_PY, /validate_audio_duration\(duration_sec\s*,\s*part\)/);
  });

  test('grading.py surfaces AudioTooShortError as HTTP 422 with structured detail', () => {
    // Match across the full try/except for AudioTooShortError so a
    // formatting tweak (line breaks etc) doesn't break the pin.
    assert.match(
      GRADING_PY,
      /except\s+AudioTooShortError[\s\S]{0,400}HTTPException\(\s*status_code=422\s*,\s*detail=[a-z_]+\.to_detail\(\)\s*\)/,
    );
  });

});
