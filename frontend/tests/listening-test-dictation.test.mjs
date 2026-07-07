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

  it('does NOT clip audio to a segment (free scrub of the whole section)', () => {
    // The content-based page sets auto-loop + segment-start/end; the
    // test-linked page must NOT, so the learner scrubs the whole section.
    assert.ok(!/segment-start/.test(HTML), 'must not pin segment-start');
    assert.ok(!/segment-end/.test(HTML), 'must not pin segment-end');
    assert.ok(!/setAttribute\('segment-start'/.test(JS));
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

  it('boots Supabase via window.initSupabase (canonical ref)', () => {
    assert.match(JS, /huwsmtubwulikhlmcirx\.supabase\.co/);
    assert.match(JS, /window\.initSupabase\(/);
  });

  it('escapes user/transcript text before insertion', () => {
    assert.match(JS, /function escapeHtml\(/);
    assert.match(JS, /escapeHtml\(sentence\)/);
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
