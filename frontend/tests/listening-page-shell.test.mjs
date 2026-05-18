/**
 * frontend/tests/listening-page-shell.test.mjs
 *
 * Sprint 11.5 cluster closure — pin the Listening landing shell.
 *
 * Sprint 11.0 §6 wireframes specify 5 modes. Sprint 11.5 closes
 * DEBT-LISTENING-MODULE by promoting MCQ + Mini Test alongside the
 * dictation/gist/T-F trio already shipped in 11.2-11.4.
 *
 * Sentinel-string match against the static page source. Catches:
 *   - mode-card roster drift (a sprint that adds a 6th mode without
 *     updating the test)
 *   - any LIVE card regressing back to "Coming soon"
 *   - browse / analytics utility links going missing
 *   - chrome integration regressing — listening.html MUST mount the
 *     canonical <aver-chrome active="listening"> Web Component
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, '..', 'pages', 'listening.html');
const HTML = readFileSync(HTML_PATH, 'utf8');


describe('Sprint 11.1 — listening.html landing shell contract', () => {

  it('mounts the canonical <aver-chrome active="listening"> Web Component', () => {
    // Chrome integration is the headline of Sprint 11.1 (proof the
    // 5th skill slot wires in). Listening must be the active tab.
    assert.match(
      HTML,
      /<aver-chrome\s+active=["']listening["']\s*>\s*<\/aver-chrome>/,
      'listening.html must declare <aver-chrome active="listening">',
    );
  });

  it('ships exactly 5 mode-cards (dictation, gist, true-false, mcq, mini-test)', () => {
    // Pin the roster — a sprint adding a 6th mode without updating
    // this list trips here.
    const modes = ['dictation', 'gist', 'true-false', 'mcq', 'mini-test'];
    for (const mode of modes) {
      const re = new RegExp(`data-mode=["']${mode}["']`);
      assert.match(HTML, re, `mode-card with data-mode="${mode}" missing`);
    }
    // Count: exactly 5 mode-card data-mode attrs total.
    const matches = HTML.match(/data-mode=["'][^"']+["']/g) || [];
    assert.equal(
      matches.length, 5,
      `expected exactly 5 mode-card data-mode attrs; got ${matches.length}: ${matches}`,
    );
  });

  it('all 5 mode cards are LIVE (Sprint 11.5 cluster closure)', () => {
    // Sprint 11.5 promotes mcq + mini-test, completing the 5-mode roster.
    // Every card must link to its own dedicated page.
    assert.match(
      HTML,
      /<a[^>]*href="\/pages\/listening-dictation\.html"[^>]*class="mode-card"[^>]*data-mode="dictation"/,
      'dictation mode-card must be active',
    );
    assert.match(
      HTML,
      /<a[^>]*href="\/pages\/listening-gist\.html"[^>]*class="mode-card"[^>]*data-mode="gist"/,
      'gist mode-card must be active',
    );
    assert.match(
      HTML,
      /<a[^>]*href="\/pages\/listening-tf\.html"[^>]*class="mode-card"[^>]*data-mode="true-false"/,
      'true-false mode-card must be active',
    );
    assert.match(
      HTML,
      /<a[^>]*href="\/pages\/listening-mcq\.html"[^>]*class="mode-card"[^>]*data-mode="mcq"/,
      'mcq mode-card must be active (Sprint 11.5)',
    );
    assert.match(
      HTML,
      /<a[^>]*href="\/pages\/listening-mini-test\.html"[^>]*class="mode-card"[^>]*data-mode="mini-test"/,
      'mini-test mode-card must be active (Sprint 11.5)',
    );
    // Negative pin — no card regresses to disabled.
    for (const mode of ['dictation', 'gist', 'true-false', 'mcq', 'mini-test']) {
      assert.doesNotMatch(
        HTML,
        new RegExp(`<a[^>]*class="mode-card disabled"[^>]*data-mode="${mode}"`),
        `${mode} card regressed to disabled`,
      );
    }
  });

  it('no disabled mode-cards remain in Sprint 11.5 (cluster closure)', () => {
    const cardMatches = HTML.match(/<a[^>]*class="mode-card disabled"[^>]*>/g) || [];
    assert.equal(
      cardMatches.length, 0,
      `Sprint 11.5 closes the cluster — expected 0 disabled mode-cards; got ${cardMatches.length}`,
    );
    const tagMatches = HTML.match(/<span class="lock-tag">Coming soon<\/span>/g) || [];
    assert.equal(
      tagMatches.length, 0,
      `Sprint 11.5 — expected 0 "Coming soon" lock-tags; got ${tagMatches.length}`,
    );
  });

  it('utility links — Kho bài nghe (browse) + Thống kê (analytics)', () => {
    // Sprint 11.5 wires browse + analytics next to the mode card grid.
    assert.match(
      HTML,
      /href="\/pages\/listening-browse\.html"/,
      'landing must link to /pages/listening-browse.html',
    );
    assert.match(
      HTML,
      /href="\/pages\/listening-analytics\.html"/,
      'landing must link to /pages/listening-analytics.html',
    );
  });

  it('reuses the canonical design tokens (no new CSS bucket for the shell)', () => {
    // Sprint 11.0 §1C decision — Listening shell rides the
    // vocabulary.css + components.css primitives. A future PR that
    // forks a Listening-specific stylesheet for the SHELL (not
    // legitimate per-mode pages) trips here. (Sprint 11.2+ may add
    // listening-dictation.css etc. for per-mode chrome.)
    assert.match(HTML, /href=["']\/css\/aver-design\/tokens\.css["']/);
    assert.match(HTML, /href=["']\/css\/aver-design\/components\.css["']/);
    assert.match(HTML, /href=["']\/css\/vocabulary\.css["']/,
      'Sprint 11.1 shell reuses vocabulary.css mode-card + stats-strip primitives');
  });
});
