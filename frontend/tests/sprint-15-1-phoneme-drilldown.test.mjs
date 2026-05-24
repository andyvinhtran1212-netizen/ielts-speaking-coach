/**
 * frontend/tests/sprint-15-1-phoneme-drilldown.test.mjs — Sprint 15.1
 *
 * Per-phoneme drill-down modal. Functionally exercises the pure renderer +
 * SAPI lookup table (extract-and-eval — the IIFE's document/window listeners
 * are not evaluated), plus source-scan compliance (Pattern #25/#26, wiring).
 * No jsdom — consistent with the zero-dependency node:test gate.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const DRILL = front('js', 'pronunciation-drilldown.js');
const DS_CSS = front('css', 'ds.css');
const PRACTICE = front('js', 'practice.js');
const PRACTICE_HTML = front('pages', 'practice.html');

// Extract the pure pieces (PHONEME_REF + _esc + _tier + renderPhonemeDrilldown)
// and eval them in isolation — they don't touch document/window.
function buildPure() {
  const ref    = DRILL.match(/var PHONEME_REF = \{[\s\S]*?\n  \};/)[0];
  const esc    = DRILL.match(/function _esc\([\s\S]*?\n  \}/)[0];
  const tier   = DRILL.match(/function _tier\([\s\S]*?\n  \}/)[0];
  const render = DRILL.match(/function renderPhonemeDrilldown\([\s\S]*?\n  \}/)[0];
  return new Function(
    ref + '\n' + esc + '\n' + tier + '\n' + render +
    '\n return { renderPhonemeDrilldown: renderPhonemeDrilldown, PHONEME_REF: PHONEME_REF };'
  )();
}
const { renderPhonemeDrilldown, PHONEME_REF } = buildPure();


// ── 1) SAPI lookup table integrity ─────────────────────────────────────────────

describe('Sprint 15.1 — PHONEME_REF (SAPI lookup)', () => {

  test('keyed on SAPI symbols (verified PF-1), not IPA', () => {
    for (const k of ['ih', 'iy', 'ay', 'th', 'ng', 'er']) {
      assert.ok(PHONEME_REF[k], 'missing SAPI key ' + k);
    }
    // No IPA-glyph keys.
    assert.ok(!PHONEME_REF['ɪ'] && !PHONEME_REF['ŋ']);
  });

  test('every entry has ipa + >=2 examples + a VN tip', () => {
    const syms = Object.keys(PHONEME_REF);
    assert.ok(syms.length >= 35, 'expected ~en-US phone set, got ' + syms.length);
    for (const s of syms) {
      const e = PHONEME_REF[s];
      assert.ok(e.ipa, s + ' missing ipa');
      assert.ok(Array.isArray(e.examples) && e.examples.length >= 2, s + ' needs >=2 examples');
      assert.ok(e.tip_vn && e.tip_vn.length > 0, s + ' missing tip_vn');
    }
  });

  test('covers the symbols in the captured fixture', () => {
    // Distinct symbols observed in the PF-1 capture.
    for (const s of ['aa','ax','ay','ch','dh','ih','iy','jh','ng','oy','uh']) {
      assert.ok(PHONEME_REF[s], 'fixture symbol ' + s + ' not in lookup');
    }
  });

});


// ── 2) renderPhonemeDrilldown (pure) ───────────────────────────────────────────

describe('Sprint 15.1 — renderPhonemeDrilldown', () => {

  test('renders a row per phoneme, sorted ascending by score', () => {
    const html = renderPhonemeDrilldown('really', [
      { symbol: 'iy', score: 0 }, { symbol: 'r', score: 16 }, { symbol: 'l', score: 4 },
    ]);
    assert.match(html, /really/);
    // weakest first: iy (0) before l (4) before r (16)
    assert.ok(html.indexOf('>iy') < html.indexOf('>l') && html.indexOf('>l') < html.indexOf('>r'));
    assert.match(html, /ds-phoneme__bar-fill--low/);  // score 0 → low tier
  });

  test('shows IPA + examples + VN tip for known phonemes', () => {
    const html = renderPhonemeDrilldown('sit', [{ symbol: 'ih', score: 40 }]);
    assert.match(html, /ɪ/);          // ipa
    assert.match(html, /sit|bit|ship/); // example
    assert.match(html, /ds-phoneme__tip/);
  });

  test('graceful for a phoneme missing from the lookup (Pattern #29)', () => {
    const html = renderPhonemeDrilldown('x', [{ symbol: 'zzz', score: 30 }]);
    assert.match(html, />zzz/);
    assert.match(html, /Chưa có gợi ý/);  // tip-unavailable fallback
  });

  test('escapes the word + has a close button', () => {
    const html = renderPhonemeDrilldown('<b>hi</b>', []);
    assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
    assert.match(html, /data-pron-close/);
  });

});


// ── 3) Pattern #25/#26 — token-only modal, no inline colour ────────────────────

describe('Sprint 15.1 — token discipline', () => {

  test('drill-down JS bakes no inline colour / hex / rgb', () => {
    assert.doesNotMatch(DRILL, /style\s*=\s*["'][^"']*(?:color|background)\s*:/i,
      'no inline color/background in the renderer');
    assert.doesNotMatch(DRILL, /#[0-9a-fA-F]{3,6}\b/, 'no hex colour literals');
    assert.doesNotMatch(DRILL, /rgba?\(/, 'no rgb literals');
  });

  test('.ds-modal CSS block uses only tokens (no hex/rgb)', () => {
    const block = DS_CSS.match(/\.ds-modal-backdrop\s*\{[\s\S]*?\.ds-pron-weak-word:focus-visible[^}]*\}/);
    assert.ok(block, '.ds-modal block not found');
    assert.doesNotMatch(block[0], /#[0-9a-fA-F]{3,6}\b/, 'modal CSS must not bake hex');
    assert.doesNotMatch(block[0], /rgba?\(/, 'modal CSS must not bake rgb — use --av/--ds tokens');
    assert.match(block[0], /var\(--av-surface-overlay\)/);  // theme-aware backdrop
  });

});


// ── 4) wiring (Pattern #34) ─────────────────────────────────────────────────────

describe('Sprint 15.1 — wiring', () => {

  test('practice.js exposes the weak-word registry + clickable badge', () => {
    assert.match(PRACTICE, /window\.__pronWeakWords\s*=/);
    assert.match(PRACTICE, /class="ds-pron-weak-word"\s+data-pron-idx="/);
    assert.match(PRACTICE, /phonemes:\s*w\.phonemes\s*\|\|\s*\[\]/);
  });

  test('drill-down reads the registry by index (no hardcoded data)', () => {
    assert.match(DRILL, /window\.__pronWeakWords/);
    assert.match(DRILL, /data-pron-idx/);
  });

  test('telemetry emits pronunciation_drilldown_view via /api/analytics/events', () => {
    assert.match(DRILL, /pronunciation_drilldown_view/);
    assert.match(DRILL, /\/api\/analytics\/events/);
  });

  test('practice.html loads the drill-down script', () => {
    assert.match(PRACTICE_HTML, /pronunciation-drilldown\.js/);
  });

});
