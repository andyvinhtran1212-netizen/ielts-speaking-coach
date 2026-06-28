/**
 * frontend/tests/vocab-card-flag.test.mjs
 *
 * Pins the per-card "report an error" (flag) control on the vocab card:
 *  • cardHTML renders a flag button + a quick content/audio menu
 *  • picking a reason fires a `vocab_card_flagged` analytics event, reusing
 *    POST /api/analytics/events (no new backend table)
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

  test('reports via the analytics events endpoint (no new table)', () => {
    assert.match(JS, /event_name:\s*'vocab_card_flagged'/);
    assert.match(JS, /\/api\/analytics\/events/);
    assert.match(JS, /headword:\s*wrap\.getAttribute\('data-headword'\)/);
    assert.match(JS, /reason:\s*reason/);
  });

  test('menu toggles + closes; confirmation shown after sending', () => {
    assert.match(JS, /function sendFlag\(/);
    assert.match(JS, /function closeFlagMenus\(/);
    assert.match(JS, /Đã gửi, cảm ơn/);
    assert.match(JS, /aria-expanded/);
  });

  test('report is fire-and-forget (never blocks the UI)', () => {
    assert.match(JS, /vocab_card_flagged[\s\S]{0,500}\.catch\(/);
  });

  test('flag control is styled, theme-aware, in vocab-wiki.css', () => {
    assert.match(CSS, /\.va-flag\s*\{/);
    assert.match(CSS, /\.va-flag-menu/);
    assert.match(CSS, /\.va-flag-opt/);
    assert.match(CSS, /\.va-flag[\s\S]{0,400}var\(--av-/);   // token-driven, not hardcoded hex
  });
});
