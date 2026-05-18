/**
 * frontend/tests/listening-page-shell.test.mjs
 *
 * Sprint 11.1 + 11.2 — pin the Listening landing shell.
 *
 * Sprint 11.0 §6 wireframes specify 5 modes. Sprint 11.2 flips
 * dictation LIVE (Andy Q6 lock) — its card has no `disabled` class
 * and routes to /pages/listening-dictation.html. The other 4 modes
 * stay "Coming soon" until Sprint 11.3 / 11.4.
 *
 * Sentinel-string match against the static page source — same pattern
 * as vocabulary-redesign.test.mjs + pending-vocab.test.mjs. Catches:
 *   - mode-card roster drift (a sprint that adds a 6th mode without
 *     updating the test)
 *   - the dictation card regressing back to "Coming soon"
 *   - the click-interception script being lost in a refactor (would
 *     produce broken anchor links to nowhere)
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

  it('3 LIVE cards — dictation, gist, true-false (Sprint 11.4)', () => {
    // Sprint 11.2 promoted dictation. Sprint 11.4 promotes gist + tf.
    // Each lives on its own dedicated page.
    assert.match(
      HTML,
      /<a[^>]*href="\/pages\/listening-dictation\.html"[^>]*class="mode-card"[^>]*data-mode="dictation"/,
      'dictation mode-card must be active',
    );
    assert.match(
      HTML,
      /<a[^>]*href="\/pages\/listening-gist\.html"[^>]*class="mode-card"[^>]*data-mode="gist"/,
      'gist mode-card must be active (Sprint 11.4)',
    );
    assert.match(
      HTML,
      /<a[^>]*href="\/pages\/listening-tf\.html"[^>]*class="mode-card"[^>]*data-mode="true-false"/,
      'true-false mode-card must be active (Sprint 11.4)',
    );
    // Negative pin — none of the 3 LIVE cards may regress to disabled.
    for (const mode of ['dictation', 'gist', 'true-false']) {
      assert.doesNotMatch(
        HTML,
        new RegExp(`<a[^>]*class="mode-card disabled"[^>]*data-mode="${mode}"`),
        `${mode} card regressed to disabled`,
      );
    }
  });

  it('the 2 deferred modes still carry `disabled` + "Coming soon"', () => {
    // mcq + mini-test stay "Coming soon" until Sprint 11.5.
    const cardMatches = HTML.match(/<a[^>]*class="mode-card disabled"[^>]*>/g) || [];
    assert.equal(
      cardMatches.length, 2,
      `expected 2 disabled mode-cards (mcq, mini-test); got ${cardMatches.length}`,
    );
    const tagMatches = HTML.match(/<span class="lock-tag">Coming soon<\/span>/g) || [];
    assert.equal(
      tagMatches.length, 2,
      `expected 2 "Coming soon" lock-tags; got ${tagMatches.length}`,
    );
  });

  it('mode-card click is intercepted so users see no broken state', () => {
    // The inline script preventDefaults clicks on .mode-card.disabled.
    // Sprint 11.2 will replace this with active hash routing.
    assert.match(
      HTML,
      /document\.querySelectorAll\(['"]\.mode-card\.disabled['"]\)/,
      'inline script must select disabled mode-cards by .mode-card.disabled',
    );
    // preventDefault sits a few chars after the addEventListener('click', ...)
    // — match across newlines via [\s\S] greedy with a bounded window.
    assert.ok(
      /addEventListener\(['"]click['"][\s\S]{0,200}preventDefault/.test(HTML),
      'inline script must preventDefault the disabled-card clicks',
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
