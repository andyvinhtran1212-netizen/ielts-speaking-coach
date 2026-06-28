/**
 * frontend/tests/home-stats-loading.test.mjs
 *
 * Home page stats must NOT show a literal `0` before data loads (users read it
 * as a real value). They paint a blinking `…` (class is-loading) until the real
 * number arrives, then the class is dropped:
 *   • loading  → `…`, blinking (home.css)
 *   • success  → real value (or genuine 0 for stats with no data)
 *   • error    → `—` (unavailable) — never a misleading 0, never blinking forever
 *
 * Source-string assertions (same pattern as home-redesign.test.mjs).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const HTML = front('pages', 'home.html');
const CSS = front('css', 'home.css');
const JS = front('js', 'home.js');

describe('home stats — loading placeholder (not a misleading 0)', () => {
  test('hero + card stat spans paint a loading "…", not a literal 0', () => {
    // every value-num / js-val placeholder carries is-loading + the ellipsis
    assert.match(HTML, /class="value-num is-loading">…</);
    assert.match(HTML, /class="js-val is-loading">…</);
    // and none of them ship a hard-coded 0 anymore
    assert.doesNotMatch(HTML, /class="value-num"[^>]*>0</);
    assert.doesNotMatch(HTML, /class="js-val"[^>]*>0</);
  });

  test('home.css blinks the placeholder + respects reduced-motion', () => {
    assert.match(CSS, /@keyframes av-stat-loading-blink/);
    assert.match(CSS, /\.value-num\.is-loading[\s\S]{0,160}animation:\s*av-stat-loading-blink/);
    assert.match(CSS, /prefers-reduced-motion: reduce[\s\S]{0,200}is-loading[\s\S]{0,80}animation:\s*none/);
  });

  test('home.js stops the blink when a real value is written', () => {
    // setStat writes the value AND removes the loading class
    assert.match(JS, /function setStat\([\s\S]{0,160}classList\.remove\('is-loading'\)/);
    // hero + card stats go through setStat
    assert.match(JS, /setStat\(streakEl\.querySelector\('\.value-num'\), streak\)/);
    assert.match(JS, /setStat\(jsVal, m\.primary\.value\)/);
  });

  test('home.js never leaves a stat blinking: success → 0, error → —', () => {
    assert.match(JS, /function clearStatLoading\(/);
    assert.match(JS, /clearStatLoading\('0'\)/);    // success sweep (genuine zero)
    assert.match(JS, /clearStatLoading\('—'\)/);    // error path (unavailable)
  });
});
