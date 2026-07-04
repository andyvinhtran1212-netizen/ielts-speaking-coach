/**
 * frontend/tests/listening-dictation.test.mjs
 *
 * Sprint 11.2 — pin the dictation page + JS contract
 * (DEBT-LISTENING-MODULE 2/5).
 *
 * Sentinel-string match against the static page + JS source. Catches:
 *   - chrome integration regressing (must mount <aver-chrome active="listening">)
 *   - the <audio-player> mount + refetch-url wiring being lost
 *   - the diff-render token classes being renamed without updating
 *     the dictation CSS in the page
 *   - the submit endpoint (/api/listening/attempts) being changed
 *     silently
 *   - the canonical Supabase project ref being swapped (per-page
 *     bootstrap MUST match the rest of the app)
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, '..', 'pages', 'listening-dictation.html');
const JS_PATH = join(__dirname, '..', 'js', 'listening-dictation.js');
const HTML = readFileSync(HTML_PATH, 'utf8');
const JS = readFileSync(JS_PATH, 'utf8');


describe('Sprint 11.2 — dictation page contract', () => {

  it('mounts <aver-chrome active="listening">', () => {
    assert.match(
      HTML,
      /<aver-chrome\s+active=["']listening["']\s*>\s*<\/aver-chrome>/,
    );
  });

  it('mounts the <audio-player> component', () => {
    assert.match(HTML, /<audio-player\s+id="player"[^>]*>/);
    // Module is imported via <script type="module">.
    assert.match(HTML, /\/js\/components\/audio-player\.js/);
  });

  it('renders the textarea + submit + reset controls', () => {
    assert.match(HTML, /id="answer"/);
    assert.match(HTML, /id="btn-submit"/);
    assert.match(HTML, /id="btn-reset"/);
    assert.match(HTML, /id="diff-block"/);
    assert.match(HTML, /id="score-pill"/);
  });

  it('declares the 4 diff-token visual classes the JS emits', () => {
    // Sprint 11.0 §6: green / red-underline / red-bold / strike-through.
    for (const cls of ['diff-token--match', 'diff-token--miss',
                       'diff-token--wrong', 'diff-token--extra']) {
      assert.match(HTML, new RegExp(`\\.${cls}\\b`),
        `dictation stylesheet missing .${cls} rule`);
    }
  });

  it('reuses canonical design tokens (no hardcoded brand teal hex)', () => {
    assert.match(HTML, /var\(--av-brand-teal-700\)/);
    // Allow only the explicit error-banner sentinel colours (we don't
    // have token variants for danger backgrounds yet); the rest must
    // be tokens.
    const hex = HTML.match(/#[0-9a-fA-F]{3,6}/g) || [];
    const allowed = new Set(['#0C2340', '#112d52', '#081829', '#0F766E',
                             '#14b8a6', '#0d5f58',
                             '#FEF2F2', '#991B1B', '#FECACA',  // error banner
                             '#B91C1C',                          // diff red
                             '#DC2626']);                        // segment-dot incorrect
    for (const h of hex) {
      assert.ok(allowed.has(h), `unexpected hex literal ${h} in dictation page`);
    }
  });
});


describe('Sprint 11.2 — dictation JS contract', () => {

  it('reads ?content_id from URL', () => {
    assert.match(JS, /URLSearchParams\(\s*window\.location\.search\s*\)/);
    assert.match(JS, /['"]content_id['"]/);
  });

  it('fetches the combined dictation boot endpoint for content + segments', () => {
    assert.match(JS, /\/api\/listening\/dictation\/\$\{encodeURIComponent\(contentId\)\}\/boot/);
    assert.match(JS, /boot\s*&&\s*boot\.content/);
    assert.match(JS, /boot\s*&&\s*boot\.exercises/);
    assert.doesNotMatch(JS, /\/api\/listening\/exercises\?content_id=/);
    // Refetch-url wired through the audio player attribute.
    assert.match(JS, /refetch-url/);
  });

  it('POSTs /api/listening/attempts with mode=dictation', () => {
    assert.match(JS, /\/api\/listening\/attempts/);
    assert.match(JS, /mode:\s*['"]dictation['"]/);
    assert.match(JS, /listen_count/);
  });

  it('tracks listen_count via av-audio-play events', () => {
    assert.match(JS, /av-audio-play/);
    assert.match(JS, /listenCount\s*\+=\s*1/);
  });

  it('renders all 4 diff op kinds (match/miss/wrong/extra)', () => {
    for (const op of ['match', 'miss', 'wrong', 'extra']) {
      assert.match(JS, new RegExp(`['"]${op}['"]`),
        `diff renderer missing op '${op}'`);
    }
  });

  it('escapes user-supplied strings before innerHTML', () => {
    // escapeHtml MUST exist and the diff renderer MUST go through it.
    assert.match(JS, /function escapeHtml/);
    assert.match(JS, /\.replace\(\/&\/g/);
    assert.match(JS, /\.replace\(\/</g, /\.replace\(\/</g);
  });

  it('uses the canonical Supabase project ref', () => {
    // If this ref drifts from vocabulary.html / speaking.html the user
    // gets logged out across pages.
    assert.match(JS, /huwsmtubwulikhlmcirx\.supabase\.co/);
  });

  it('Sprint Perf-2 — no longer performs the content → exercises waterfall', () => {
    assert.doesNotMatch(JS, /window\.api\.get\(\s*`\/api\/listening\/content\//);
    assert.doesNotMatch(JS, /exercise_type=dictation/);
  });

  it('Sprint 11.3 — POSTs attempts with segment_idx + exercise_id', () => {
    assert.match(JS, /segment_idx:\s*SESSION\.segmentIdx/);
    assert.match(JS, /exercise_id:\s*SESSION\.exerciseId/);
  });

  it('Sprint 11.3 — applies segment-start / segment-end to audio player', () => {
    assert.match(JS, /setAttribute\(\s*['"]segment-start['"]/);
    assert.match(JS, /setAttribute\(\s*['"]segment-end['"]/);
  });

  it('Sprint 11.3 — advances on Next button + final segment shows completion', () => {
    assert.match(JS, /advanceSegmentOrComplete/);
    // Final-segment branch — "Xem kết quả" replaces "Câu tiếp theo →".
    assert.match(JS, /Xem kết quả/);
    assert.match(JS, /Câu tiếp theo/);
  });

  it('Sprint 11.3 — completion view computes aggregate score', () => {
    // Aggregate = mean of per-segment scores (the metric the user sees).
    assert.match(JS, /reduce/);
    assert.match(JS, /r\.score/);
  });

  it('Sprint 11.3 — completion tab toggle (results + transcript)', () => {
    assert.match(JS, /tab-results/);
    assert.match(JS, /tab-transcript/);
    // The Vietnamese label lives in HTML (DOM-driven tab markup);
    // here we just confirm the JS handlers reference both panels.
    assert.match(JS, /panel-results/);
    assert.match(JS, /panel-transcript/);
  });
});


describe('Sprint 11.3 — dictation page DOM contract', () => {

  it('renders segment progress counter + dot row', () => {
    assert.match(HTML, /id="progress-counter"/);
    assert.match(HTML, /id="segment-dots"/);
  });

  it('ships Next button + completion surface', () => {
    assert.match(HTML, /id="btn-next"/);
    assert.match(HTML, /id="completion-surface"/);
    assert.match(HTML, /id="completion-total"/);
  });

  it('auto-loop attribute set on the audio player by default', () => {
    // The 11.3 dictation UX restarts the segment on end after 0.5s
    // pause — confirms the page sets auto-loop="true".
    assert.match(HTML, /<audio-player[^>]+auto-loop="true"/);
  });

  it('completion surface ships both tabs (Kết quả + Bản gỡ băng đầy đủ)', () => {
    assert.match(HTML, /id="tab-results"/);
    assert.match(HTML, /id="tab-transcript"/);
    assert.match(HTML, /Bản gỡ băng đầy đủ/);
  });

  it('segment-dot classes for correct/partial/incorrect/current states', () => {
    for (const cls of ['is-correct', 'is-partial', 'is-incorrect', 'is-current']) {
      assert.match(HTML, new RegExp(`segment-dot\\.${cls}`),
        `dictation stylesheet missing .segment-dot.${cls}`);
    }
  });
});
