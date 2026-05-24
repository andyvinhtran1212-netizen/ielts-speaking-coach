/**
 * frontend/tests/sprint-14-8-1-signal-persistence.test.mjs — Sprint 14.8.1
 *
 * Codex audit F1 (P0): the off-topic / length / grammar signals were returned
 * by the grade endpoint but never persisted, so they vanished when result.html
 * re-read responses.feedback on reload. 14.8.1 persists them (grading.py) and
 * renders them on the result page from the persisted feedback.
 *
 * These sentinels (a) functionally exercise the ported render helpers and
 * (b) source-scan the accordion wiring. No jsdom / live DB — consistent with
 * the repo's zero-dependency node:test gate (Andy decision 2026-05-24).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULT_HTML = readFileSync(join(__dirname, '..', 'pages', 'result.html'), 'utf8');

const DEPS = `
  function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var _GRAMMAR_CAT_LABELS = { tense: 'Thì động từ', grammar: 'Ngữ pháp', other: 'Khác' };
`;

function evalFn(name) {
  const re = new RegExp('\\n    function\\s+' + name + '\\s*\\([\\s\\S]*?\\n    \\}');
  const m = RESULT_HTML.match(re);
  if (!m) throw new Error('cannot extract ' + name + ' from result.html');
  return new Function(DEPS + '\n' + m[0] + '\n    return ' + name + ';')();
}

const _persistedWarningsBlock       = evalFn('_persistedWarningsBlock');
const _persistedGrammarBlock        = evalFn('_persistedGrammarBlock');
const _persistedTranscriptHighlights = evalFn('_persistedTranscriptHighlights');


// ── 1) Warnings banner (off-topic + length) ───────────────────────────────────

describe('Sprint 14.8.1 — _persistedWarningsBlock', () => {

  test('renders off-topic banner when verdict flags off-topic', () => {
    const html = _persistedWarningsBlock({ off_topic_verdict: { is_on_topic: false, reasoning: 'Nói lạc đề.' } });
    assert.match(html, /ds-warning-banner/);
    assert.match(html, /chưa bám sát đề/);
    assert.match(html, /Nói lạc đề\./);
  });

  test('no off-topic banner when on-topic (is_on_topic true)', () => {
    assert.strictEqual(_persistedWarningsBlock({ off_topic_verdict: { is_on_topic: true } }), '');
  });

  test('renders length banner with duration + threshold numbers', () => {
    const html = _persistedWarningsBlock({ length_warning: true, audio_duration_seconds: 18.5, length_soft_threshold: 30 });
    assert.match(html, /18\.5/);
    assert.match(html, /30s/);
  });

  test('null/empty feedback → empty string (backward compat L10)', () => {
    assert.strictEqual(_persistedWarningsBlock(null), '');
    assert.strictEqual(_persistedWarningsBlock({ overall_band: 6.0 }), '');
  });

});


// ── 2) Grammar block ──────────────────────────────────────────────────────────

describe('Sprint 14.8.1 — _persistedGrammarBlock', () => {

  test('renders grammar errors grouped under ds-grammar-section', () => {
    const html = _persistedGrammarBlock({
      errors: [{ category: 'tense', original_text: 'I goed', suggestion: 'I went', explanation_vn: 'Quá khứ của go.' }],
      total_count: 1, displayed_count: 1,
    });
    assert.match(html, /ds-grammar-section/);
    assert.match(html, /I goed/);
    assert.match(html, /I went/);
  });

  test('shows "+N lỗi khác" when total exceeds displayed', () => {
    const html = _persistedGrammarBlock({ errors: [{ category: 'tense', original_text: 'a', suggestion: 'b' }], total_count: 4, displayed_count: 1 });
    assert.match(html, /\+3 lỗi khác/);
  });

  test('empty / null grammar_check → empty string', () => {
    assert.strictEqual(_persistedGrammarBlock(null), '');
    assert.strictEqual(_persistedGrammarBlock({ errors: [] }), '');
  });

});


// ── 3) Transcript highlights ───────────────────────────────────────────────────

describe('Sprint 14.8.1 — _persistedTranscriptHighlights', () => {

  test('wraps error spans in <mark> by offset', () => {
    const html = _persistedTranscriptHighlights('I goed to school', {
      errors: [{ transcript_offset_start: 2, transcript_offset_end: 6, suggestion: 'went', explanation_vn: 'x' }],
    });
    assert.match(html, /<mark class="ds-grammar-highlight"[^>]*>goed<\/mark>/);
    assert.match(html, /^I /);  // text before the span preserved
  });

  test('no grammar_check → plain escaped text (backward compat)', () => {
    assert.strictEqual(_persistedTranscriptHighlights('a < b & c', null), 'a &lt; b &amp; c');
  });

  test('drops out-of-range / malformed spans defensively', () => {
    const html = _persistedTranscriptHighlights('short', { errors: [{ transcript_offset_start: 0, transcript_offset_end: 999 }] });
    assert.doesNotMatch(html, /<mark/);
  });

});


// ── 4) result.html accordion wiring + Pattern #26 ──────────────────────────────

describe('Sprint 14.8.1 — result.html wiring', () => {

  test('accordion body renders persisted warnings + grammar; transcript uses highlights', () => {
    assert.match(RESULT_HTML, /bodyHtml\s*\+=\s*_persistedWarningsBlock\(fb\)/);
    assert.match(RESULT_HTML, /bodyHtml\s*\+=\s*_persistedGrammarBlock\(fb && fb\.grammar_check\)/);
    assert.match(RESULT_HTML, /_persistedTranscriptHighlights\(r\.transcript,\s*fb && fb\.grammar_check\)/);
  });

  test('ported helpers reach colour via ds-* classes, no inline white text (Pattern #26)', () => {
    for (const name of ['_persistedWarningsBlock', '_persistedGrammarBlock', '_persistedTranscriptHighlights']) {
      const re = new RegExp('\\n    function\\s+' + name + '\\s*\\([\\s\\S]*?\\n    \\}');
      const body = RESULT_HTML.match(re)[0];
      assert.doesNotMatch(body, /color:\s*rgba\(\s*255\s*,\s*255\s*,\s*255/, name + ' must not bake inline white text');
    }
  });

});
