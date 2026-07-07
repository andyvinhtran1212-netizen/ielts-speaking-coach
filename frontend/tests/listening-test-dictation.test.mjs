/**
 * frontend/tests/listening-test-dictation.test.mjs
 *
 * Pin the test-linked dictation page + controller, and the entry-point
 * buttons that launch it (test cards + listening result panel).
 *
 * Sentinel-string match against static source. Catches:
 *   - the dictation page losing chrome / <audio-player> / states
 *   - the boot + grade endpoints being renamed silently
 *   - the section-picker or sentence loop being dropped
 *   - the "Chép chính tả" entry buttons regressing on the 3 test lists
 *     and the listening result panel
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const HTML = read('pages', 'listening-test-dictation.html');
const JS = read('js', 'listening-test-dictation.js');


describe('test-linked dictation — page contract', () => {

  it('mounts <aver-chrome active="listening"> + <audio-player>', () => {
    assert.match(HTML, /<aver-chrome\s+active=["']listening["']\s*>\s*<\/aver-chrome>/);
    assert.match(HTML, /<audio-player\s+id="player"[^>]*>/);
    assert.match(HTML, /\/js\/components\/audio-player\.js/);
  });

  it('auto-clips per sentence when the section carries timing, else free-scrubs', () => {
    // Timed sections (metadata.dictation_segments backfilled from
    // timings.json) → set segment-start/end + auto-loop so each sentence
    // plays its exact window (skipping the intro). No timing → remove the
    // attrs → free scrub the whole section.
    assert.match(JS, /function applySentenceAudio\(/);
    assert.match(JS, /setAttribute\('segment-start'/);
    assert.match(JS, /setAttribute\('segment-end'/);
    assert.match(JS, /setAttribute\('auto-loop'/);
    assert.match(JS, /removeAttribute\('segment-start'/);
    // The window comes from the per-sentence timings array.
    assert.match(JS, /section\.timings\[SESSION\.sentenceIdx\]/);
    // The static HTML must NOT hard-pin a segment (it's set dynamically).
    assert.ok(!/segment-start=/.test(HTML), 'HTML must not hard-pin segment-start');
  });

  it('declares loading / empty / error / picker / surface / completion states', () => {
    assert.match(HTML, /id="state-loading"/);
    assert.match(HTML, /id="state-empty"/);
    assert.match(HTML, /id="state-error"/);
    assert.match(HTML, /id="section-picker-surface"/);
    assert.match(HTML, /id="dictation-surface"/);
    assert.match(HTML, /id="completion-surface"/);
  });

  it('renders the textarea + submit + next + diff block', () => {
    assert.match(HTML, /id="answer"/);
    assert.match(HTML, /id="btn-submit"/);
    assert.match(HTML, /id="btn-next"/);
    assert.match(HTML, /id="diff-block"/);
    // Diff token classes must match what renderDiffToken emits.
    assert.match(HTML, /diff-token--match/);
    assert.match(HTML, /diff-token--miss/);
    assert.match(HTML, /diff-token--wrong/);
    assert.match(HTML, /diff-token--extra/);
  });

  it('uses only design tokens (no raw hex literals)', () => {
    const hex = HTML.match(/#[0-9a-fA-F]{3,6}/g) || [];
    assert.equal(hex.length, 0, `unexpected hex literals: ${hex.join(', ')}`);
  });
});


describe('test-linked dictation — JS contract', () => {

  it('boots via GET /api/listening/tests/{id}/dictation with test_id param', () => {
    assert.match(JS, /\/api\/listening\/tests\/\$\{encodeURIComponent\(testId\)\}\/dictation/);
    assert.match(JS, /sp\.get\('test_id'\)/);
  });

  it('grades via POST /api/listening/tests/dictation/grade', () => {
    assert.match(JS, /window\.api\.post\('\/api\/listening\/tests\/dictation\/grade'/);
    assert.match(JS, /section_num:/);
    assert.match(JS, /sentence_idx:/);
    assert.match(JS, /user_transcript:/);
  });

  it('auto-starts a single section but shows a picker for multi-section tests', () => {
    assert.match(JS, /sections\.length === 1/);
    assert.match(JS, /renderSectionPicker\(\)/);
    assert.match(JS, /section-chip/);
  });

  it('empty transcript → empty state (no broken loop)', () => {
    assert.match(JS, /sentences\) && s\.sentences\.length > 0/);
    assert.match(JS, /chưa có bản gỡ băng/i);
  });

  it('per-sentence errors stay inline (do NOT hide the dictation surface)', () => {
    // #inline-error lives inside the surface; showInlineError must not
    // flip global state, so an empty answer / grade failure keeps the
    // textarea + buttons visible for the learner to fix.
    assert.match(HTML, /id="inline-error"/);
    assert.match(JS, /function showInlineError\(/);
    // showInlineError must not call showState (that would hide the surface).
    const m = /function showInlineError\([\s\S]+?\n\}/m.exec(JS);
    assert.ok(m, 'showInlineError body not found');
    assert.ok(!/showState\(/.test(m[0]), 'showInlineError must not switch global state');
    // The empty-answer + grade-failure paths use the inline error, not showError.
    assert.match(JS, /showInlineError\('Hãy gõ câu trả lời/);
    assert.match(JS, /showInlineError\('Không chấm được câu trả lời/);
  });

  it('boots Supabase via window.initSupabase (canonical ref)', () => {
    assert.match(JS, /huwsmtubwulikhlmcirx\.supabase\.co/);
    assert.match(JS, /window\.initSupabase\(/);
  });

  it('escapes user/transcript text before insertion', () => {
    assert.match(JS, /function escapeHtml\(/);
    assert.match(JS, /escapeHtml\(sentence\)/);
  });
});


describe('grading UX — filler leniency + proper-noun hints + redesign', () => {

  it('renders proper-noun hints for the current sentence', () => {
    assert.match(HTML, /id="sentence-hint"/);
    assert.match(JS, /function renderSentenceHint\(/);
    assert.match(JS, /section\.hints\[SESSION\.sentenceIdx\]/);
    assert.match(JS, /hint-name/);
  });

  it('renders forgiven fillers softly + shows a legend', () => {
    // op.filler tokens render with the --filler class, not as an error.
    assert.match(JS, /if \(op\.filler\)/);
    assert.match(JS, /diff-token--filler/);
    assert.match(HTML, /\.diff-token--filler\s*\{/);
    // The legend only appears when a filler is actually present.
    assert.match(HTML, /id="diff-legend"/);
    assert.match(JS, /diff-legend'\)\.hidden\s*=\s*!diff\.some\(\(d\) => d\.filler\)/);
  });

  it('uses the calm workspace card + token-only styling (no hex, no space-5)', () => {
    assert.match(HTML, /class="dict-card"/);
    assert.match(HTML, /\.dict-card\s*\{/);
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(HTML), 'no hex literals allowed');
    assert.ok(!/var\(--av-space-5\b/.test(HTML), 'the spacing scale skips 5');
    // Respects reduced motion.
    assert.match(HTML, /@media \(prefers-reduced-motion: reduce\)/);
  });
});


describe('entry points — "Chép chính tả" buttons', () => {

  const DICT_HREF =
    /listening-test-dictation\.html\?test_id=\$\{encodeURIComponent\(t\.id\)\}/;

  it('full-test list card adds a dictation button', () => {
    assert.match(read('js', 'listening-tests-list.js'), DICT_HREF);
  });

  it('mini-test list card adds a dictation button', () => {
    assert.match(read('js', 'listening-mini-test.js'), DICT_HREF);
  });

  it('skill-drill card adds a dictation button (whole-card link preserved)', () => {
    const drills = read('js', 'listening-skills.js');
    assert.match(drills, DICT_HREF);
    // The main drill link still points at the player (regression guard).
    assert.match(drills, /listening-test\.html\?id=\$\{encodeURIComponent\(t\.id\)\}/);
  });

  it('listening result panel links dictation to the finished test', () => {
    assert.match(read('pages', 'listening-test.html'), /id="res-dictation"/);
    assert.match(
      read('js', 'listening-test-player.js'),
      /listening-test-dictation\.html\?test_id=' \+ encodeURIComponent\(STATE\.testId\)/,
    );
  });
});
