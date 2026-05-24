/**
 * frontend/tests/sprint-14-5-1-result-completeness.test.mjs — Sprint 14.5.1
 *
 * Andy's production session aacf39f6 was a PRACTICE session. Practice mode is
 * coaching-format by design (grammar/vocabulary issues + corrections + sample
 * answer) and produces NO per-criterion bands — so result.html showed four
 * empty criterion cards, an empty "Cần cải thiện" card, and no takeaway.
 *
 * Option B (Andy 2026-05-24): adapt the result page to the coaching data
 * practice ALREADY generates instead of adding per-criterion scoring to
 * practice (no backend/prompt/provider change). For practice sessions:
 *   - hide the empty criterion grid,
 *   - fill the "Cần cải thiện" card with aggregated grammar + vocabulary issues,
 *   - show a derived "Trọng tâm luyện tập" takeaway.
 *
 * Test mode is unchanged (still shows the criterion grid + improvements).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULT_HTML = readFileSync(join(__dirname, '..', 'pages', 'result.html'), 'utf8');

// Extract a 4-space-indented function from the inline result.html script and
// eval it with a minimal parseFeedback dependency, so the pure aggregation
// logic can be exercised directly (not just source-scanned).
function evalFn(name) {
  const re = new RegExp('\\n    function\\s+' + name + '\\s*\\([\\s\\S]*?\\n    \\}');
  const m = RESULT_HTML.match(re);
  if (!m) throw new Error('cannot extract ' + name + ' from result.html');
  const factory = new Function(
    'function parseFeedback(raw){ if(!raw) return null; if(typeof raw==="object") return raw; try{return JSON.parse(raw);}catch(e){return null;} }\n'
    + m[0] + '\n    return ' + name + ';',
  );
  return factory();
}

const aggregateWeaknesses   = evalFn('aggregateWeaknesses');
const buildPracticeTakeaway = evalFn('buildPracticeTakeaway');


// ── 1) aggregateWeaknesses — merges grammar + vocab, dedups, caps at 5 ────────

describe('Sprint 14.5.1 — aggregateWeaknesses', () => {

  test('merges grammar_issues + vocabulary_issues across responses, deduped', () => {
    const responses = [
      { feedback: { grammar_issues: ['G1', 'G2'], vocabulary_issues: ['V1'] } },
      { feedback: { grammar_issues: ['G2', 'G3'], vocabulary_issues: ['V1', 'V2'] } },
    ];
    assert.deepStrictEqual(aggregateWeaknesses(responses), ['G1', 'G2', 'V1', 'G3', 'V2']);
  });

  test('caps the list at 5 items', () => {
    const responses = [{ feedback: { grammar_issues: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } }];
    assert.strictEqual(aggregateWeaknesses(responses).length, 5);
  });

  test('returns empty array when there are no issues', () => {
    assert.deepStrictEqual(aggregateWeaknesses([{ feedback: { strengths: ['x'] } }]), []);
  });

  test('tolerates string-JSON feedback and missing fields', () => {
    const responses = [{ feedback: JSON.stringify({ grammar_issues: ['G1'] }) }, { feedback: null }];
    assert.deepStrictEqual(aggregateWeaknesses(responses), ['G1']);
  });

});


// ── 2) buildPracticeTakeaway — deterministic, dominant-category aware ──────────

describe('Sprint 14.5.1 — buildPracticeTakeaway', () => {

  test('returns empty string when there are no issues', () => {
    assert.strictEqual(buildPracticeTakeaway([{ feedback: { strengths: ['x'] } }]), '');
  });

  test('grammar-dominant → grammar focus', () => {
    const t = buildPracticeTakeaway([{ feedback: { grammar_issues: ['a', 'b', 'c'], vocabulary_issues: ['x'] } }]);
    assert.match(t, /ngữ pháp/);
  });

  test('vocab-dominant → vocabulary focus', () => {
    const t = buildPracticeTakeaway([{ feedback: { grammar_issues: ['a'], vocabulary_issues: ['x', 'y', 'z'] } }]);
    assert.match(t, /từ vựng/);
  });

  test('references the sample answer when present', () => {
    const t = buildPracticeTakeaway([{ feedback: { grammar_issues: ['a'], sample_answer: 'A model answer.' } }]);
    assert.match(t, /câu trả lời mẫu/);
  });

  test('takeaway stays within 50 words', () => {
    const t = buildPracticeTakeaway([{ feedback: { grammar_issues: ['a'], vocabulary_issues: ['x'], sample_answer: 'm' } }]);
    assert.ok(t.split(/\s+/).length <= 50);
  });

});


// ── 3) result.html wiring — practice path vs test path ────────────────────────

describe('Sprint 14.5.1 — result.html wiring', () => {

  test('criterion grid is targetable by id', () => {
    assert.match(RESULT_HTML, /id="criterion-grid"/);
  });

  test('practice branch hides the criterion grid', () => {
    assert.match(
      RESULT_HTML,
      /isPracticeSession\s*\)\s*\{[\s\S]*?getElementById\('criterion-grid'\)[\s\S]*?display\s*=\s*'none'/,
    );
  });

  test('practice branch fills the improvements card with aggregated weaknesses', () => {
    assert.match(
      RESULT_HTML,
      /isPracticeSession\s*\)\s*\{[\s\S]*?renderList\('improvements-list',\s*aggregateWeaknesses\(responses\)/,
    );
  });

  test('takeaway card markup + label present', () => {
    assert.match(RESULT_HTML, /id="practice-takeaway"/);
    assert.match(RESULT_HTML, /id="practice-takeaway-text"/);
    assert.match(RESULT_HTML, /Trọng tâm luyện tập/);
  });

  test('test mode is unchanged — else branch still renders lists.improvements', () => {
    assert.match(RESULT_HTML, /\}\s*else\s*\{[\s\S]*?renderList\('improvements-list',\s*lists\.improvements/);
  });

  test('takeaway text uses a theme token, no inline white literal (Pattern #26)', () => {
    assert.match(RESULT_HTML, /id="practice-takeaway-text"[^>]*color:var\(--av-text-secondary\)/);
    // The new takeaway block must not bake an inline white text colour.
    const block = RESULT_HTML.match(/id="practice-takeaway"[\s\S]{0,400}<\/div>/)[0];
    assert.doesNotMatch(block, /color:\s*rgba\(\s*255\s*,\s*255\s*,\s*255/);
  });

});
