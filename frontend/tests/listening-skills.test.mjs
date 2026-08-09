/**
 * frontend/tests/listening-skills.test.mjs
 *
 * Pin the Listening "Luyện kĩ năng" (Skills Practice) page + controller.
 * Sentinel-string match against static page + JS source — same approach as
 * listening-tests-list.test.mjs. Catches:
 *   - chrome active="listening" regressing
 *   - the drill list endpoint (?test_type=drill) being changed
 *   - the per-drill CTA href (must reuse listening-test.html?id=)
 *   - the 11-type catalogue / grouping contract
 *   - the "Sắp có" (coming-soon) affordance disappearing
 *   - the nav card on listening.html regressing
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'pages', 'listening-skills.html'), 'utf8');
const JS   = readFileSync(join(__dirname, '..', 'js', 'listening-skills.js'), 'utf8');
const LISTENING_HTML = readFileSync(join(__dirname, '..', 'pages', 'listening.html'), 'utf8');


describe('Skills Practice — page contract', () => {
  it('mounts <aver-chrome active="listening">', () => {
    assert.match(HTML, /<aver-chrome\s+active=["']listening["']\s*>\s*<\/aver-chrome>/);
  });

  it('declares loading + empty + error + groups states', () => {
    assert.match(HTML, /id="state-loading"/);
    assert.match(HTML, /id="state-empty"/);
    assert.match(HTML, /id="state-error"/);
    assert.match(HTML, /id="ls-groups"/);
    assert.match(HTML, /id="ls-library"/);
    assert.match(HTML, /id="ls-skill-nav"/);
    assert.match(HTML, /id="ls-summary"/);
  });

  it('loads the skills controller module', () => {
    assert.match(HTML, /\/js\/listening-skills\.js/);
  });

  it('back-link points at /pages/listening.html', () => {
    assert.match(HTML, /href=["']\/listening["']/);
  });

  it('uses canonical design tokens (no raw hex literals)', () => {
    const hex = HTML.match(/#[0-9a-fA-F]{3,6}/g) || [];
    assert.equal(hex.length, 0, `unexpected hex literals: ${hex.join(', ')}`);
  });
});


describe('Skills Practice — controller contract', () => {
  it('boots Supabase via the canonical project ref', () => {
    assert.match(JS, /huwsmtubwulikhlmcirx\.supabase\.co/);
    assert.match(JS, /window\.initSupabase\(/);
  });

  it('fetches drills via ?test_type=drill', () => {
    assert.match(JS, /test_type=drill/);
  });

  it('each drill reuses the mini-test player (listening-test.html?id=)', () => {
    assert.match(JS, /listening-test\.html\?id=\$\{encodeURIComponent\(t\.id\)\}/);
  });

  it('defines the full 11-type catalogue keyed on metadata.drill_type', () => {
    for (const key of ['form', 'note', 'table', 'flowchart', 'sentence', 'summary',
      'short_answer', 'mcq', 'mcq_multi', 'matching', 'map']) {
      assert.ok(JS.includes(`'${key}'`), `SKILLS missing type ${key}`);
    }
  });

  it('groups drills by drill_type and shows a "Sắp có" affordance when empty', () => {
    assert.match(JS, /d\.drill_type/);
    assert.match(JS, /Sắp có/);
  });

  it('pages the list endpoint (limit cap 100) to gather all drills', () => {
    assert.match(JS, /offset=\$\{offset\}/);
  });

  it('renders one selected skill with accessible status filters', () => {
    assert.match(JS, /ACTIVE_SKILL/);
    assert.match(JS, /data-skill=/);
    assert.match(JS, /ACTIVE_STATUS/);
    assert.match(HTML, /data-status-filter="new"/);
    assert.match(HTML, /data-status-filter="done"/);
  });

  it('bases completion on submitted attempts, not total attempts', () => {
    assert.match(JS, /function hasSubmittedAttempt\(t\)/);
    assert.match(JS, /t\.user_submitted_attempt_count/);
    assert.doesNotMatch(JS, /const attempted = \(t\.user_attempt_count/);
  });

  it('uses labelled drill actions and removes the emoji-only dictation control', () => {
    assert.match(JS, />Chép chính tả<\/a>/);
    assert.doesNotMatch(JS, /aria-label="Chép chính tả">✍️/);
    assert.match(JS, /displayDrillTitle\(t\)/);
  });
});


describe('Skills Practice — nav card on listening.html', () => {
  it('adds a mode-card linking to listening-skills.html', () => {
    assert.match(LISTENING_HTML, /href=["']\/listening\/skills["']/);
    assert.match(LISTENING_HTML, /Luyện kĩ năng/);
  });
});
