/**
 * frontend/tests/vocab-card-flag.test.mjs
 *
 * Pins the per-card "report an error" (flag) control on the vocab card:
 *  • cardHTML renders a flag button + a quick content/audio menu
 *  • picking a reason posts a Vocabulary report to the canonical feedback inbox
 *  • the control is styled with theme-aware va-flag* tokens in vocab-wiki.css
 *
 * Source-string assertions (same approach as vocab-article-reskin.test.mjs):
 * vocabulary.js is a browser IIFE, so we pin the emitted markup + wiring.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const JS = front('js', 'vocabulary.js');
const CSS = front('css', 'vocab-wiki.css');

describe('vocab card — flag / report control', () => {
  test('cardHTML renders the flag control', () => {
    assert.match(JS, /function flagControl\(/);
    assert.match(JS, /\$\{flagControl\(a\)\}/);          // wired into the card
    assert.match(JS, /class="va-flag"/);
    assert.match(JS, /aria-label="Báo lỗi/);
  });

  test('offers content + audio as one-tap reasons', () => {
    assert.match(JS, /data-reason="content"/);
    assert.match(JS, /data-reason="audio"/);
  });

  test('reports through the canonical user-feedback endpoint', () => {
    assert.match(JS, /window\.api\.post\('\/api\/feedback',\s*payload\)/);
    assert.match(JS, /type:\s*'report'/);
    assert.match(JS, /skill:\s*'vocabulary'/);
    assert.match(JS, /vocab_slug:\s*wrap\.getAttribute\('data-slug'\)/);
    assert.match(JS, /vocab_category:\s*wrap\.getAttribute\('data-category'\)/);
    assert.match(JS, /reason === 'audio' \? 'audio_issue' : 'content_issue'/);
    assert.doesNotMatch(JS, /event_name:\s*'vocab_card_flagged'/);
  });

  test('menu toggles + closes; confirmation shown after sending', () => {
    assert.match(JS, /function sendFlag\(/);
    assert.match(JS, /function closeFlagMenus\(/);
    assert.match(JS, /Đã gửi, cảm ơn/);
    assert.match(JS, /aria-expanded/);
  });

  test('shows success only after persistence and exposes a retryable error', () => {
    assert.match(JS, /post\('\/api\/feedback',[\s\S]{0,500}\.then\(/);
    assert.match(JS, /Không gửi được, thử lại/);
    assert.match(JS, /buttons\.forEach\(\(button\) => \{ button\.disabled = false; \}\)/);
  });

  test('flag control is styled, theme-aware, in vocab-wiki.css', () => {
    assert.match(CSS, /\.va-flag\s*\{/);
    assert.match(CSS, /\.va-flag-menu/);
    assert.match(CSS, /\.va-flag-opt/);
    assert.match(CSS, /\.va-flag[\s\S]{0,400}var\(--av-/);   // token-driven, not hardcoded hex
  });

  test('standalone article page inits Supabase before vocabulary.js (flags stay user-attributed)', () => {
    const html = front('pages', 'vocab-article.html');
    assert.match(html, /supabase-js@/);          // CDN present
    assert.match(html, /initSupabase\(/);        // client initialised
    // must appear before vocabulary.js, else api.post sends the flag with no auth
    // header → reports land with user_id = NULL (the bug this guards against).
    const idxInit = html.indexOf('initSupabase(');
    const idxVocab = html.indexOf('vocabulary.js"');   // the <script src> tag, not a comment mention
    assert.ok(idxInit > -1 && idxVocab > idxInit,
      'initSupabase must appear before the vocabulary.js script tag');
  });
});
