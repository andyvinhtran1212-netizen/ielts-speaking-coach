/**
 * frontend/tests/design-fix-3-user-tokens.test.mjs — Design-Fix Sprint 3 (B5).
 *
 * Sentinels for the user-facing semantic-colour + font-token cleanup
 * (design-consistency audit rows 19,20,28 + the --av-critical bug class).
 *
 * Contract pinned here:
 *   • Listening MCQ/TF correct/incorrect rows + error banners use theme-aware
 *     --av-success / --av-error (+ -soft) tokens, not hardcoded red/green hex.
 *   • Listening browse/analytics error banners use --av-error tokens.
 *   • My Vocabulary mono runs use var(--av-font-mono), not a literal stack.
 *   • Reading admin error text uses --av-error (the non-existent --av-critical
 *     token — which silently fell back to hardcoded red — is gone).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
// strip CSS/HTML comments so explanatory notes don't trip raw-hex / token checks
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

let mcq, tf, browse, analytics, myVocab, adminReading, tokens;
before(() => {
  mcq          = read('frontend/pages/listening-mcq.html');
  tf           = read('frontend/pages/listening-tf.html');
  browse       = read('frontend/pages/listening-browse.html');
  analytics    = read('frontend/pages/listening-analytics.html');
  myVocab      = read('frontend/css/my-vocabulary.css');
  adminReading = read('frontend/css/admin-reading.css');
  tokens       = read('frontend/css/aver-design/tokens.css');
});


describe('Listening MCQ/TF — correct/incorrect use semantic tokens (audit row 19)', () => {
  test('correct rows use --av-success, incorrect use --av-error (both pages)', () => {
    for (const [name, html] of [['mcq', mcq], ['tf', tf]]) {
      assert.match(html, /is-correct[^}]*background:\s*var\(--av-success-soft\)/, `${name} correct bg token`);
      assert.match(html, /is-correct[^}]*border-color:\s*var\(--av-success\)/, `${name} correct border token`);
      assert.match(html, /is-incorrect[^}]*background:\s*var\(--av-error-soft\)/, `${name} incorrect bg token`);
      assert.match(html, /is-incorrect[^}]*border-color:\s*var\(--av-error\)/, `${name} incorrect border token`);
    }
  });

  test('no hardcoded correct/incorrect hex survives (#ECFDF5/#B91C1C/#FEF2F2)', () => {
    for (const [name, html] of [['mcq', mcq], ['tf', tf]]) {
      const code = strip(html);
      for (const hex of ['#ECFDF5', '#B91C1C', '#FEF2F2', '#991B1B', '#FECACA']) {
        assert.ok(!code.includes(hex), `${name} still hardcodes ${hex}`);
      }
    }
  });
});


describe('Listening error banners use --av-error tokens (audit rows 19,20)', () => {
  test('mcq/tf/browse/analytics error banners token-driven', () => {
    for (const [name, html] of [['mcq', mcq], ['tf', tf], ['browse', browse], ['analytics', analytics]]) {
      assert.match(html, /\.error-banner[\s\S]*?background:\s*var\(--av-error-soft\)/, `${name} banner bg token`);
      assert.match(html, /\.error-banner[\s\S]*?color:\s*var\(--av-error\)/, `${name} banner color token`);
    }
  });
});


describe('My Vocabulary mono uses --av-font-mono (audit row 28)', () => {
  test('no literal JetBrains stack; token used', () => {
    assert.ok(!/'JetBrains Mono'/.test(strip(myVocab)), 'literal JetBrains Mono stack must be gone');
    assert.match(myVocab, /\.mv-stat__val[^}]*font-family:\s*var\(--av-font-mono\)/);
    assert.match(myVocab, /\.mv-preview-ipa[\s\S]*?font-family:\s*var\(--av-font-mono\)/);
  });
});


describe('Reading admin error text — --av-critical bug fixed', () => {
  test('--av-critical is gone (it was never a real token); --av-error used', () => {
    assert.ok(!/--av-critical/.test(strip(adminReading)),
      'the non-existent --av-critical token must be gone from live rules');
    assert.match(adminReading, /\.ar-preview-error\s*\{\s*color:\s*var\(--av-error\)/);
    assert.match(adminReading, /\.ar-diagram-status\.is-error\s*\{\s*color:\s*var\(--av-error\)/);
  });

  test('sanity: --av-error exists but --av-critical does not (tokens.css)', () => {
    assert.match(tokens, /--av-error:/);
    assert.ok(!/--av-critical/.test(tokens), '--av-critical was never defined');
  });
});
