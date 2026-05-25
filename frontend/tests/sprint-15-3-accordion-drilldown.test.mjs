/**
 * frontend/tests/sprint-15-3-accordion-drilldown.test.mjs — Sprint 15.3
 *
 * Phoneme drill-down ACCORDION (replaces the 15.1.2 modal). Functionally
 * exercises the pure renderer + smart-default + SAPI lookup (extract-and-eval —
 * the IIFE's document listeners aren't evaluated), plus source-scan compliance
 * (Pattern #25/#26), no-modal-remnants, and practice.js wiring. No jsdom.
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

// Pure slice: PHONEME_REF + _esc + _tier + smartDefaultOpen + _phonemeRows +
// renderPronunciationAccordion (everything before _emitTelemetry — no window/doc).
function buildPure() {
  const slice = DRILL.slice(DRILL.indexOf('var PHONEME_REF = {'), DRILL.indexOf('function _emitTelemetry'));
  return new Function(
    slice + '\n return { renderPronunciationAccordion: renderPronunciationAccordion,' +
    ' smartDefaultOpen: smartDefaultOpen, PHONEME_REF: PHONEME_REF };'
  )();
}
const { renderPronunciationAccordion, smartDefaultOpen, PHONEME_REF } = buildPure();


describe('Sprint 15.3 — smart default expansion (PF-4)', () => {
  test('expands a single weak word, collapses 2+', () => {
    assert.strictEqual(smartDefaultOpen(0), true);
    assert.strictEqual(smartDefaultOpen(1), true);
    assert.strictEqual(smartDefaultOpen(2), false);
    assert.strictEqual(smartDefaultOpen(5), false);
  });
});

describe('Sprint 15.3 — renderPronunciationAccordion', () => {
  test('renders a native <details> per weak word with word + count', () => {
    const html = renderPronunciationAccordion([
      { word: 'fish', phonemes: [{ symbol: 'f', score: 38 }, { symbol: 'ih', score: 100 }] },
      { word: 'this', phonemes: [{ symbol: 'dh', score: 41 }] },
    ]);
    assert.match(html, /data-drilldown-content/);
    assert.match(html, /<details class="ds-accordion__item" data-drilldown-word="fish"/);
    assert.match(html, /<details class="ds-accordion__item" data-drilldown-word="this"/);
    assert.match(html, /âm cần luyện/);
    // 2 words → collapsed (no open attribute on the details)
    assert.doesNotMatch(html, /data-drilldown-word="[^"]*" open/);
  });

  test('single weak word → expanded by default (smart)', () => {
    const html = renderPronunciationAccordion([{ word: 'fish', phonemes: [{ symbol: 'f', score: 38 }] }]);
    assert.match(html, /data-drilldown-word="fish" open/);
  });

  test('renders IPA + examples + VN tip for known phonemes', () => {
    const html = renderPronunciationAccordion([{ word: 'sit', phonemes: [{ symbol: 'ih', score: 40 }] }]);
    assert.match(html, /ɪ/);
    assert.match(html, /sit|bit|ship/);
    assert.match(html, /ds-phoneme__tip/);
  });

  test('graceful fallback for unknown phoneme (Pattern #29)', () => {
    const html = renderPronunciationAccordion([{ word: 'x', phonemes: [{ symbol: 'zzz', score: 30 }] }]);
    assert.match(html, />zzz/);
    assert.match(html, /đang được cập nhật/);
  });

  test('empty input → empty string', () => {
    assert.strictEqual(renderPronunciationAccordion([]), '');
  });
});

describe('Sprint 15.3 — SAPI lookup preserved', () => {
  test('keyed on SAPI (not IPA), every entry has ipa + >=2 examples + VN tip', () => {
    assert.ok(PHONEME_REF.ih && PHONEME_REF.ay && PHONEME_REF.th && !PHONEME_REF['ɪ']);
    assert.ok(Object.keys(PHONEME_REF).length >= 35);
    for (const s of Object.keys(PHONEME_REF)) {
      const e = PHONEME_REF[s];
      assert.ok(e.ipa && Array.isArray(e.examples) && e.examples.length >= 2 && e.tip_vn);
    }
  });
});

describe('Sprint 15.3 — token discipline + no modal remnants', () => {
  test('drill-down JS bakes no inline colour / hex / rgb', () => {
    assert.doesNotMatch(DRILL, /style\s*=\s*["'][^"']*(?:color|background)\s*:/i);
    assert.doesNotMatch(DRILL, /#[0-9a-fA-F]{3,6}\b/);
    assert.doesNotMatch(DRILL, /rgba?\(/);
  });

  test('.ds-accordion CSS uses only tokens (no hex/rgb)', () => {
    const block = DS_CSS.match(/\.ds-accordion\s*\{[\s\S]*?\.ds-accordion__item--highlight[^}]*\}/);
    assert.ok(block, '.ds-accordion block not found');
    assert.doesNotMatch(block[0], /#[0-9a-fA-F]{3,6}\b/);
    assert.doesNotMatch(block[0], /rgba?\(/);
  });

  test('the 15.1.2 modal is fully removed (JS + CSS)', () => {
    assert.doesNotMatch(DRILL, /showModal|createElement\(\s*['"]dialog['"]\s*\)|ds-modal-backdrop/);
    assert.doesNotMatch(DS_CSS, /\.ds-modal\b/);
  });
});

describe('Sprint 15.3 — practice.js wiring', () => {
  test('practice.js renders the accordion + keeps the weak-word badge trigger', () => {
    assert.match(PRACTICE, /renderPronunciationAccordion\(window\.__pronWeakWords\)/);
    assert.match(PRACTICE, /class="ds-pron-weak-word"\s+data-pron-idx="/);
    assert.match(PRACTICE, /window\.__pronWeakWords\s*=/);
  });
});
