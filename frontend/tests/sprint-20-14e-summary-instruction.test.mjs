/**
 * frontend/tests/sprint-20-14e-summary-instruction.test.mjs
 *
 * Sprint 20.14e — two §2A fidelity refinements:
 *
 *   #1 Instruction prominence (§2A.15)
 *      The 20.14a "strict separator" treatment dropped the heavy box
 *      but left the instruction reading too subtle (Andy dogfood).
 *      Lift it via typography (size / weight / spacing) without
 *      reverting to the anti-pattern sunken box.
 *
 *   #2 Summary completion FLOWING block (§2A.10 / §2A.11)
 *      Standards mandate ONE flowing paragraph in `.exam-gap-box` with
 *      inline gaps — not a column of separate sentence cards. The
 *      first Q of a summary_completion run carries
 *      `template.summary_text` containing `{{N}}` markers; the
 *      renderer absorbs Qs 2..N of the run into the same flowing
 *      block, mapping each `{{N}}` to its q_num for grading.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


// ── #1 — Instruction prominence (CSS-only) ────────────────────────────

describe('Sprint 20.14e #1 — instruction prominence (typography lift, no heavy box)', () => {
  const css = read('frontend/css/reading-exam.css');

  test('instruction font is 16px medium-weight (lifted from 14px italic)', () => {
    // The 20.14a rule pinned 14px italic; the 20.14e override raises
    // size to 16px and switches weight to 500 (medium). The italic is
    // explicitly cancelled to `normal`.
    const m = css.match(/\.exam-chrome\s+\.exam-questions__instructions--type\s*\{[\s\S]*?\}/g);
    assert.ok(m && m.length, 'instruction rule not found');
    // Take the LAST occurrence — that's the 20.14e override.
    const rule = m[m.length - 1];
    assert.match(rule, /font-size:\s*16px/);
    assert.match(rule, /font-weight:\s*500/);
    assert.match(rule, /font-style:\s*normal/);
  });

  test('instruction still uses `pre-wrap` so TFNG/YNG 3-line blocks survive', () => {
    // §2A.15 + Sprint 20.13c T1.5 — TFNG/YNG render as 3-line blocks
    // via embedded `\n`. The pre-wrap preservation must not regress.
    const m = css.match(/\.exam-chrome\s+\.exam-questions__instructions--type\s*\{[\s\S]*?\}/g);
    const rule = m[m.length - 1];
    assert.match(rule, /white-space:\s*pre-wrap/);
  });

  test('instruction stays borderless (no anti-pattern sunken box revert)', () => {
    // The 20.14a strict-separator left `border-bottom: 1px solid` only
    // (a thin separator). The 20.14e override keeps that — must NOT
    // re-introduce a `background:` colour, `border-left` accent, or
    // padding-left framing (the §10.3 anti-pattern).
    const m = css.match(/\.exam-chrome\s+\.exam-questions__instructions--type\s*\{[\s\S]*?\}/g);
    const rule = m[m.length - 1];
    assert.match(rule, /background:\s*transparent/);
    assert.match(rule, /border-left:\s*0/);
  });

  test('part-heading lifted to navy-bordered prominence', () => {
    // The "Part N — Questions X–Y" line under the palette is the
    // secondary prominence cue. 20.14e gives it a 2px navy bottom
    // border + medium weight so it reads at a glance.
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-questions__part-heading\s*\{[\s\S]{0,400}border-bottom:\s*2px\s+solid\s+var\(--ielts-navy\)/,
    );
  });
});


// ── #2 — Summary FLOWING block (renderer + CSS + content) ─────────────

describe('Sprint 20.14e #2 — summary_completion flowing block', () => {
  const js = read('frontend/js/reading-exam.js');
  const css = read('frontend/css/reading-exam.css');

  test('renderQuestions detects template.summary_text on the first Q and routes to the flowing renderer', () => {
    // Pin the dispatch flow: type === summary_completion AND first Q's
    // payload.template.summary_text is a string → call the flowing
    // renderer and EARLY RETURN so the per-card path doesn't ALSO fire.
    assert.match(
      js,
      /type\s*===\s*['"]summary_completion['"][\s\S]{0,400}run\[0\]\.payload\.template\.summary_text[\s\S]{0,200}_renderFlowingSummaryBlock\(run\)/,
    );
    assert.match(
      js,
      /_renderFlowingSummaryBlock[\s\S]{0,400}return;\s*\/\/\s*skip the per-Q card path/,
    );
  });

  test('_renderFlowingSummaryBlock helper exists with the documented marker regex', () => {
    assert.match(js, /function\s+_renderFlowingSummaryBlock\s*\(\s*run\s*\)/);
    // Standards-aligned marker: `{{N}}` (1–3 digits).
    assert.match(js, /_SUMMARY_MARKER_RE\s*=\s*\/\\\{\\\{\\s\*\(\\d\{1,3\}\)\\s\*\\\}\\\}\/g/);
  });

  test('flowing renderer builds `.exam-gap-box--summary` with `.exam-summary__prose`', () => {
    assert.match(
      js,
      /_renderFlowingSummaryBlock[\s\S]{0,800}exam-gap-box exam-gap-box--summary/,
    );
    assert.match(
      js,
      /_renderFlowingSummaryBlock[\s\S]{0,1500}exam-summary__prose/,
    );
  });

  test('each {{N}} marker emits a `.exam-summary__gnum` badge + per-q_num input/select', () => {
    // The gap is rendered with the bold navy number badge + an input
    // (no-bank) or select (word-bank). Pin both badges + the
    // `name="q-N"` wiring so grading routes correctly.
    assert.match(js, /exam-summary__gnum/);
    assert.match(js, /input\.name\s*=\s*['"]q-['"]\s*\+\s*qNum/);
    assert.match(js, /sel\.name\s*=\s*['"]q-['"]\s*\+\s*qNum/);
  });

  test('word-bank variant: select carries the labels from first-Q options', () => {
    // The bank lives in run[0].payload.options; the inline select in
    // the flowing block enumerates the labels (label-only, like the
    // §2A.5 / §2A.7 / §2A.8 family). The separate `.exam-word-bank-box`
    // ABOVE the questions is handled by the 20.14b BANK_VARIANTS
    // dispatch which fires BEFORE the flowing block.
    assert.match(
      js,
      /_renderFlowingSummaryBlock[\s\S]{0,3000}wordBank\.forEach[\s\S]{0,400}opt\.value\s*=\s*val/,
    );
  });

  test('per-gap change handler fires onAnswerChanged via _summaryGapChanged', () => {
    // The flowing renderer wires `input` + `change` listeners on the
    // BOX (delegation). Each event resolves data-q → calls
    // `_summaryGapChanged(qNum, value)` which mirrors the existing
    // onAnswerChanged side-effects (SESSION.answers, palette flip,
    // debounce PATCH).
    assert.match(js, /function\s+_summaryGapChanged\s*\(\s*qNum\s*,\s*value\s*\)/);
    assert.match(js, /_summaryGapChanged[\s\S]{0,400}SESSION\.answers\.set\(qNum,\s*value\)/);
    assert.match(js, /_summaryGapChanged[\s\S]{0,800}patchAnswer\(qNum,\s*value\)/);
  });

  test('restoreAnswers handles the flowing block inputs (lookup by [name="q-N"])', () => {
    // The flowing block's gaps live OUTSIDE `.exam-q` cards — restore
    // needs a separate lookup path. Pin the dedicated branch.
    assert.match(
      js,
      /\.exam-gap-box--summary\s+\[name="q-['"]\s*\+\s*qNum/,
    );
  });

  test('CSS ships the `.exam-gap-box--summary` + `.exam-summary__prose` + `__gnum` rules', () => {
    assert.match(css, /\.exam-chrome\s+\.exam-gap-box--summary\s*\{/);
    assert.match(css, /\.exam-chrome\s+\.exam-summary__prose\s*\{[\s\S]{0,400}text-align:\s*justify/);
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-summary__gnum\s*\{[\s\S]{0,400}color:\s*var\(--ielts-navy\)/,
    );
  });

  test('CSS compact width on the inline word-bank select inside the summary', () => {
    // The base `.exam-q__select` is 280px (mockup); inside the flowing
    // summary that would dominate a sentence. The 20.14e override sets
    // `min-width: 60px` (fits "— Select —" + a single letter).
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-q__select--inline\s*\{[\s\S]{0,400}min-width:\s*60px/,
    );
  });
});


// ── #2 — Seed migration (AVR-READ-001 + 002) ──────────────────────────

describe('Sprint 20.14e #2 — seed migration to flowing summary shape', () => {
  test('AVR-READ-001 Q36 carries summary_text + 5 markers ({{36}}..{{40}})', () => {
    const seed = read('backend/content/reading/l3-academic-reading-test-1.md');
    // The Q36 block must include `template:` with `summary_text:`.
    assert.match(seed, /q_num:\s*36\s*\n\s*question_type:\s*summary_completion[\s\S]{0,300}template:\s*\n\s*summary_text:/);
    // All 5 q_num markers present.
    for (const n of [36, 37, 38, 39, 40]) {
      assert.match(seed, new RegExp(`\\{\\{${n}\\}\\}`), `missing marker {{${n}}}`);
    }
    // Qs 37–40 have placeholder prompts (no individual stems).
    assert.match(seed, /q_num:\s*37[\s\S]{0,200}prompt:\s*"\(see summary above\)"/);
  });

  test('AVR-READ-002 Q27 carries summary_text + 6 markers ({{27}}..{{32}}) + options bank', () => {
    const seed = read('backend/content/reading/l3-academic-reading-test-2.md');
    assert.match(seed, /q_num:\s*27\s*\n\s*question_type:\s*summary_completion[\s\S]{0,200}template:\s*\n\s*summary_text:/);
    for (const n of [27, 28, 29, 30, 31, 32]) {
      assert.match(seed, new RegExp(`\\{\\{${n}\\}\\}`), `missing marker {{${n}}}`);
    }
    // The word-bank options remain on Q27 (not duplicated on Q28–32).
    assert.match(seed, /q_num:\s*27[\s\S]{0,1500}options:[\s\S]{0,800}label:\s*A,\s*text:/);
    // Qs 28–32 should NOT carry their own options (absorbed into Q27).
    assert.ok(
      !/q_num:\s*28[\s\S]{0,300}options:/.test(seed),
      'Q28 must not duplicate the word-bank options',
    );
  });
});


// ── #2 — Runtime: marker regex split + q_num routing ──────────────────

describe('Sprint 20.14e #2 (runtime) — gap-marker split semantics', () => {
  const RE = /\{\{\s*(\d{1,3})\s*\}\}/g;

  function splitGaps(template) {
    const out = [];
    let last = 0;
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(template)) !== null) {
      if (m.index > last) out.push({ text: template.slice(last, m.index) });
      out.push({ qNum: parseInt(m[1], 10) });
      last = m.index + m[0].length;
    }
    if (last < template.length) out.push({ text: template.slice(last) });
    return out;
  }

  test('5-marker summary template splits into alternating text + qNum nodes', () => {
    const tpl =
      'During slow-wave sleep, the hippocampus appears to {{36}}\n' +
      'fragments learned earlier. Long-term storage of memories\n' +
      'happens in the {{37}}.';
    const out = splitGaps(tpl);
    assert.equal(out.length, 5); // text, gap, text, gap, text
    assert.equal(out[0].text, 'During slow-wave sleep, the hippocampus appears to ');
    assert.equal(out[1].qNum, 36);
    assert.equal(out[3].qNum, 37);
  });

  test('whitespace inside markers is tolerated ({{ 27 }})', () => {
    const out = splitGaps('foo {{ 27 }} bar');
    assert.equal(out.length, 3);
    assert.equal(out[1].qNum, 27);
  });

  test('no markers → single text chunk', () => {
    const out = splitGaps('plain text with no gaps');
    assert.equal(out.length, 1);
    assert.equal(out[0].text, 'plain text with no gaps');
  });

  test('marker at end of template emits empty trailing slice (skipped)', () => {
    const out = splitGaps('end with {{40}}');
    // Two nodes: text + gap. No trailing text node.
    assert.equal(out.length, 2);
    assert.equal(out[1].qNum, 40);
  });
});
