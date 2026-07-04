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
const JS_PATH = join(__dirname, '..', 'js', 'admin-listening-segments.js');
const HTML = readFileSync(HTML_PATH, 'utf8');
const JS = readFileSync(JS_PATH, 'utf8');

// Sprint 11.3.1 — import the exported helpers so the parser + auto-
// timestamp generator can be unit-tested directly (vs only sentinel
// regex matched against the source). The module bootstraps Supabase
// on import, which is a no-op when window is undefined.
const helpersUrl = new URL('../js/admin-listening-segments.js', import.meta.url).href;
const {
  splitIntoSentences,
  assignProportionalTimestamps,
  assignAlignmentTimestamps,
} = await import(helpersUrl);


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
    assert.match(JS, /huwsmtubwulikhlmcirx\.supabase\.co/);
  });

  it('escapes admin-controlled strings before innerHTML', () => {
    assert.match(JS, /function escapeHtml/);
    assert.match(JS, /\.replace\(\/&\/g/);
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

describe('Sprint 11.3.1 — splitIntoSentences', () => {

  it('returns empty array for empty / nullish input', () => {
    assert.deepEqual(splitIntoSentences(''), []);
    assert.deepEqual(splitIntoSentences(null), []);
    assert.deepEqual(splitIntoSentences(undefined), []);
  });

  it('splits on sentence-ending punctuation followed by capital', () => {
    const out = splitIntoSentences(
      'Hello world. This is a test. Final sentence.',
    );
    assert.equal(out.length, 3);
    assert.equal(out[0], 'Hello world.');
    assert.equal(out[1], 'This is a test.');
    assert.equal(out[2], 'Final sentence.');
  });

  it('respects explicit newlines as boundaries too', () => {
    // DailyDictation paste convention — one sentence per line, no
    // trailing period. Each line becomes a segment without needing
    // sentence-end punctuation.
    const out = splitIntoSentences(
      'first line\nsecond line\nthird line',
    );
    assert.equal(out.length, 3);
  });

  it('handles question marks and exclamation marks', () => {
    const out = splitIntoSentences(
      'What is this? It is a test! Got it.',
    );
    assert.equal(out.length, 3);
  });

  it('does NOT split mid-abbreviation (no capital after period)', () => {
    // "etc." or "e.g." don't get a capital next → no false split.
    // (Common abbreviations like "Mr." DO get a capital next — accepted
    // as a known false-split rate; IELTS prose has few such cases.)
    const out = splitIntoSentences(
      'Many use cases include reading, listening, etc. but not all.',
    );
    assert.equal(out.length, 1);
  });

  it('Sprint 11.3 smoke content — 244 chars → 3 sentences', () => {
    // The actual smoke content used in PR #213 audition.
    const smoke =
      'Hello, this is a smoke test sample. '
      + 'It is generated by ElevenLabs. '
      + 'The voice belongs to Sarah, a US female voice.';
    const out = splitIntoSentences(smoke);
    assert.equal(out.length, 3);
  });

  it('coastal-erosion-style lecture splits to ~47 sentences', () => {
    // Synthetic IELTS-style lecture: 47 sentences with normal full-stop
    // punctuation. Sprint 11.3 parser would have produced 1 segment
    // (no newlines) — Sprint 11.3.1 produces ~47.
    const sentences = [];
    for (let i = 0; i < 47; i += 1) {
      sentences.push(`Coastal erosion is a serious issue number ${i + 1}.`);
    }
    const lecture = sentences.join(' ');
    const out = splitIntoSentences(lecture);
    // Allow some slack — if a future regex tweak miscounts by 1-2 on
    // the boundary this should still pass.
    assert.ok(out.length >= 45 && out.length <= 48,
      `expected 45-48 sentences, got ${out.length}`);
  });

  it('drops empty strings even when newlines run together', () => {
    const out = splitIntoSentences('first\n\n\nsecond\n\n\nthird');
    assert.equal(out.length, 3);
  });

  it('trims surrounding whitespace per segment', () => {
    const out = splitIntoSentences('  Hello.   World.  ');
    assert.equal(out.length, 2);
    assert.equal(out[0], 'Hello.');
    assert.equal(out[1], 'World.');
  });
});


describe('Sprint 11.3.1 — assignProportionalTimestamps', () => {

  it('returns empty array for empty input', () => {
    assert.deepEqual(assignProportionalTimestamps([], 60), []);
  });

  it('first segment always starts at 0', () => {
    const out = assignProportionalTimestamps(
      ['One.', 'Two.', 'Three.'], 30,
    );
    assert.equal(out[0].start_sec, 0);
  });

  it('last segment ends EXACTLY at content_duration (no float drift)', () => {
    // The whole point of the algorithm: even with three uneven segments
    // and float division, the last end_sec is clamped to content_duration.
    const out = assignProportionalTimestamps(
      ['One.', 'Twoooooo.', 'Three short.'], 47.0,
    );
    const last = out[out.length - 1];
    assert.equal(last.end_sec, 47.0);
  });

  it('no overlap, no gap — segments[i].end_sec === segments[i+1].start_sec', () => {
    const out = assignProportionalTimestamps(
      ['First.', 'Second.', 'Third.', 'Fourth.'], 60,
    );
    for (let i = 0; i < out.length - 1; i += 1) {
      assert.equal(out[i].end_sec, out[i + 1].start_sec,
        `gap or overlap between segment ${i} and ${i + 1}`);
    }
  });

  it('every segment satisfies end_sec > start_sec', () => {
    const out = assignProportionalTimestamps(
      ['a', 'b', 'c', 'd', 'e'], 10,
    );
    for (const s of out) assert.ok(s.end_sec > s.start_sec);
  });

  it('proportional allocation — longer text gets more time', () => {
    const out = assignProportionalTimestamps(
      ['short', 'this is a much longer sentence than the first one'], 60,
    );
    const dur0 = out[0].end_sec - out[0].start_sec;
    const dur1 = out[1].end_sec - out[1].start_sec;
    assert.ok(dur1 > dur0, 'longer sentence must get longer duration');
  });

  it('contentDuration <= 0 or NaN → null timestamps + admin marks manually', () => {
    const out = assignProportionalTimestamps(['a', 'b'], 0);
    for (const s of out) {
      assert.equal(s.start_sec, null);
      assert.equal(s.end_sec, null);
    }
  });

  it('Sprint 11.3 backend constraint — no segment violates end_sec > 0 for non-empty content', () => {
    // Sprint 11.3 bug #65a — parser left both start/end at 0 → backend
    // 422'd on `end_sec > start_sec`. This pin guarantees the
    // generator NEVER produces (0, 0) when content_duration > 0.
    const out = assignProportionalTimestamps(
      ['a', 'b', 'c'], 30,
    );
    for (const s of out) {
      assert.ok(s.end_sec > 0, 'segment end_sec must be > 0');
      assert.ok(s.end_sec > s.start_sec, 'end_sec > start_sec required');
    }
  });

  it('coastal-erosion synthesis — 47 segments evenly split over 270s', () => {
    // 4.5 minutes = 270 seconds, 47 even-length sentences → ~5.7s each.
    const sentences = Array.from({ length: 47 }, (_, i) =>
      `Coastal erosion sentence number ${i + 1}.`);
    const out = assignProportionalTimestamps(sentences, 270);
    assert.equal(out.length, 47);
    assert.equal(out[0].start_sec, 0);
    assert.equal(out[46].end_sec, 270);
    // All adjacent pairs are contiguous.
    for (let i = 0; i < 46; i += 1) {
      assert.equal(out[i].end_sec, out[i + 1].start_sec);
    }
  });
});


/* ─────────────────────────────────────────────────────────────────
 * Sprint 11.4 — alignment-driven timestamp helper.
 * ───────────────────────────────────────────────────────────────── */

describe('Sprint 11.4 — assignAlignmentTimestamps', () => {

  function _alignmentFor(text, secondsPerChar = 0.05) {
    const chars = text.split('');
    const starts = chars.map((_, i) => Math.round(i * secondsPerChar * 100) / 100);
    const ends = chars.map((_, i) => Math.round((i + 1) * secondsPerChar * 100) / 100);
    return {
      characters: chars,
      character_start_times_seconds: starts,
      character_end_times_seconds: ends,
    };
  }

  it('returns null when alignment is missing or malformed', () => {
    assert.equal(assignAlignmentTimestamps(['Hello.'], null), null);
    assert.equal(assignAlignmentTimestamps(['Hello.'], {}), null);
    assert.equal(assignAlignmentTimestamps(['Hello.'],
      { characters: ['a'], character_start_times_seconds: [0] }), null);
  });

  it('returns null on empty sentence list', () => {
    assert.equal(assignAlignmentTimestamps([], _alignmentFor('Hello.')), null);
  });

  it('locates 2 sentences precisely in the rebuilt transcript', () => {
    const transcript = 'Hello world. Goodbye now.';
    const alignment = _alignmentFor(transcript);
    const out = assignAlignmentTimestamps(
      ['Hello world.', 'Goodbye now.'], alignment,
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].start_sec, 0);
    // "Goodbye now." starts at index 13 → start_sec = 13*0.05 = 0.65
    assert.equal(out[1].start_sec, 0.65);
    // Smoothing pass chains sentence-0.end_sec forward to meet
    // sentence-1.start_sec (was originally 0.60 for the 12-char
    // "Hello world.", stretched to 0.65 to close the space-gap).
    assert.equal(out[0].end_sec, 0.65);
  });

  it('falls through (returns null) when a sentence is not in the alignment', () => {
    const alignment = _alignmentFor('Only this text.');
    const out = assignAlignmentTimestamps(
      ['Not present at all.'], alignment,
    );
    assert.equal(out, null);
  });

  it('chains end_sec to next start_sec — no gaps in the output', () => {
    const alignment = _alignmentFor('A. B. C.');
    const out = assignAlignmentTimestamps(['A.', 'B.', 'C.'], alignment);
    assert.equal(out.length, 3);
    for (let i = 0; i < out.length - 1; i += 1) {
      assert.ok(out[i].end_sec >= out[i + 1].start_sec - 0.001
                || out[i].end_sec === out[i + 1].start_sec,
        `gap between segment ${i} and ${i + 1}`);
    }
  });
});


describe('Sprint 11.4 — admin segment editor source pins', () => {

  it('parseFromTextarea prefers alignment when content.alignment_data set', () => {
    // Sentinel against the source string so a refactor that
    // accidentally drops the alignment branch trips here.
    assert.match(JS, /STATE\.content\?\.alignment_data/);
    assert.match(JS, /assignAlignmentTimestamps/);
  });

  it('shows AI-precision banner emoji ✨ when alignment used', () => {
    assert.match(JS, /✨/);
  });

  it('shows char-proportional fallback emoji 📐 when alignment absent', () => {
    assert.match(JS, /📐/);
  });
});
