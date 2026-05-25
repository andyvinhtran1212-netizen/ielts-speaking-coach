/**
 * frontend/tests/sprint-15-3-1-result-extractor.test.mjs — Sprint 15.3.1
 *
 * result.html phoneme accordion parity. Functionally exercises
 * extractWeakWordsFromPayload() (parses the persisted raw Azure payload into the
 * per-word shape the Sprint 15.3 accordion renderer consumes) against the REAL
 * captured fixture + synthetic legacy/empty variants, plus result.html wiring.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRILL = readFileSync(join(__dirname, '..', 'js', 'pronunciation-drilldown.js'), 'utf8');
const RESULT_HTML = readFileSync(join(__dirname, '..', 'pages', 'result.html'), 'utf8');
// Real captured Granularity=Phoneme payload (Sprint 15.0 PF-1).
const FIXTURE = JSON.parse(readFileSync(
  join(__dirname, '..', '..', 'backend', 'tests', 'fixtures', 'azure_phoneme_sample.json'), 'utf8'));
const RAW = FIXTURE.raw_payload;  // {RecognitionStatus, NBest:[{Words:[{Phonemes:[...]}]}]}

function buildPure() {
  const slice = DRILL.slice(DRILL.indexOf('var PHONEME_REF = {'), DRILL.indexOf('function _emitTelemetry'));
  return new Function(slice +
    '\n return { extractWeakWordsFromPayload: extractWeakWordsFromPayload,' +
    ' renderPronunciationAccordion: renderPronunciationAccordion };')();
}
const { extractWeakWordsFromPayload, renderPronunciationAccordion } = buildPure();


describe('Sprint 15.3.1 — extractWeakWordsFromPayload', () => {

  test('post-15.1 raw payload → per-word weakWords (accordion-ready shape)', () => {
    const out = extractWeakWordsFromPayload(RAW);
    assert.strictEqual(out.legacy, false);
    assert.ok(out.weakWords.length > 0);
    const w = out.weakWords[0];
    assert.ok('word' in w && Array.isArray(w.phonemes) && 'word_index' in w);
    assert.ok('symbol' in w.phonemes[0] && 'score' in w.phonemes[0]);
    // SAPI symbols + 0–100 scores (matches practice.js __pronWeakWords shape).
    assert.strictEqual(typeof w.phonemes[0].symbol, 'string');
    assert.strictEqual(typeof w.phonemes[0].score, 'number');
  });

  test('also accepts the payload as a JSON string (JSONB may arrive serialised)', () => {
    const out = extractWeakWordsFromPayload(JSON.stringify(RAW));
    assert.ok(out.weakWords.length > 0 && out.legacy === false);
  });

  test('pre-15.1 (Word granularity, no Phonemes) → legacy:true, no words', () => {
    const stripped = JSON.parse(JSON.stringify(RAW));
    stripped.NBest[0].Words.forEach(function (w) { delete w.Phonemes; });
    const out = extractWeakWordsFromPayload(stripped);
    assert.strictEqual(out.legacy, true);
    assert.deepStrictEqual(out.weakWords, []);
  });

  test('null / empty / malformed payload → empty, not legacy (Pattern #29)', () => {
    assert.deepStrictEqual(extractWeakWordsFromPayload(null), { weakWords: [], legacy: false });
    assert.deepStrictEqual(extractWeakWordsFromPayload({ NBest: [] }), { weakWords: [], legacy: false });
    assert.deepStrictEqual(extractWeakWordsFromPayload('not json'), { weakWords: [], legacy: false });
  });

  test('parity: extracted weakWords feed the Sprint 15.3 accordion renderer', () => {
    const out = extractWeakWordsFromPayload(RAW);
    const html = renderPronunciationAccordion(out.weakWords);
    assert.match(html, /data-drilldown-content/);
    assert.match(html, /data-drilldown-word="/);
  });

});


describe('Sprint 15.3.1 — result.html wiring', () => {

  test('result.html loads the shared drill-down component', () => {
    assert.match(RESULT_HTML, /pronunciation-drilldown\.js/);
  });

  test('_buildPronBlock appends the phoneme drill-down (extractor → renderer)', () => {
    assert.match(RESULT_HTML, /_buildPhonemeDrilldown\(r\)/);
    assert.match(RESULT_HTML, /extractWeakWordsFromPayload\(r\.pronunciation_payload\)/);
    assert.match(RESULT_HTML, /renderPronunciationAccordion\(ex\.weakWords\)/);
  });

  test('legacy session renders a graceful placeholder', () => {
    assert.match(RESULT_HTML, /ex\.legacy/);
    assert.match(RESULT_HTML, /chưa khả dụng cho phiên này/);
    assert.match(RESULT_HTML, /Phân tích phát âm chuyên sâu/);
  });

});
