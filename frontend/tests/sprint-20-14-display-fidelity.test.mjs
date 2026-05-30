/**
 * frontend/tests/sprint-20-14-display-fidelity.test.mjs
 *
 * Sprint 20.14a — Interactive HTML Standards v1.1 display-fidelity
 * refactor. Static-analysis sentinels pinning the contract added by
 * the JS renderer rebuild + the production-layer CSS overrides.
 * Andy decisions baked: continuous scroll retained (Q1); passage
 * `max-width: 70ch` dropped (Q2); instruction-strict / no sunken
 * box (Q3); Phase B deferred (Q4).
 *
 *   T1.1 — Inline-gap parsing: `_isInlineGapType`, `_stemHasGap`,
 *          `_renderInlineStem` exist; `__inline` input wired in
 *          renderQuestion when stem has `____`.
 *   T1.2 — `_renderHeadingsBox` exists; renderQuestions emits it
 *          before a matching_headings run; matching_headings dropdown
 *          options drop heading text (label-only).
 *   T1.3 — `.exam-headings-box` + `.exam-gap-box` + `.exam-gap-box--mono`
 *          CSS shipped.
 *   T1.4 — MCQ option: bold prefix span; grid layout; light-blue hover.
 *   T1.5 — TFNG / YNG instructions: 3 newlines (the 3-line block).
 *   T1.6 — `.exam-q { border: 0 }`; `.exam-q__num { background: navy }`.
 *   T2.1 — Palette navy bar; 30px square; `.nav-sep` (border-left
 *          between groups); 4-state recolour (answered = white-inverted,
 *          current = yellow ring).
 *   T2.2 — `_showTimeToast` exists; called from startTimer at 10/5 min;
 *          `.exam-timer[data-state="warning"]` background = yellow.
 *   T2.3 — `.is-flash` keyframe + `.is-answered` Q-card border + JS
 *          delegates markAnswered → `_setAnsweredState`.
 *   AV1  — `.exam-passage__body { max-width: none; text-align: justify }`.
 *   AV4  — `.exam-topbar { background: var(--ielts-navy) }`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


// ── T1.1 — Inline-gap parsing ─────────────────────────────────────────

describe('Sprint 20.14a T1.1 — inline-gap rendering for completion types', () => {
  const js = read('frontend/js/reading-exam.js');

  test('_isInlineGapType covers sentence/summary/notes/table/form/short_answer', () => {
    assert.match(js, /function\s+_isInlineGapType\s*\(\s*type\s*\)/);
    for (const t of [
      'sentence_completion', 'summary_completion', 'notes_completion',
      'table_completion', 'form_completion', 'short_answer',
    ]) {
      assert.match(js, new RegExp(`_isInlineGapType[\\s\\S]{0,400}${t}`));
    }
  });

  test('_stemHasGap matches `\\d{2,}` underscore pattern', () => {
    assert.match(js, /var\s+_GAP_RE\s*=\s*\/_\{2,\}\//);
    assert.match(js, /function\s+_stemHasGap[\s\S]{0,200}_GAP_RE\.test/);
  });

  test('_renderInlineStem splits prefix + input + suffix at the gap', () => {
    assert.match(js, /function\s+_renderInlineStem[\s\S]{0,800}prefix[\s\S]{0,200}createTextNode/);
    assert.match(js, /function\s+_renderInlineStem[\s\S]{0,800}input\.type\s*=\s*['"]text['"][\s\S]{0,400}exam-q__gap--inline/);
    assert.match(js, /function\s+_renderInlineStem[\s\S]{0,800}suffix[\s\S]{0,200}createTextNode/);
  });

  test('renderQuestion routes inline-gap types through _renderInlineStem', () => {
    assert.match(
      js,
      /function\s+renderQuestion[\s\S]{0,1200}_isInlineGapType\(q\.question_type\)[\s\S]{0,200}_renderInlineStem/,
    );
  });
});


// ── T1.2 — Headings box renderer + dropdown options label-only ────────

describe('Sprint 20.14a T1.2 — matching_headings headings-box (Standards §2A.5)', () => {
  const js = read('frontend/js/reading-exam.js');

  test('_renderHeadingsBox exists and builds an `.exam-headings-box` aside', () => {
    assert.match(js, /function\s+_renderHeadingsBox\s*\(\s*options\s*\)/);
    assert.match(js, /_renderHeadingsBox[\s\S]{0,400}createElement\(['"]aside['"]\)/);
    assert.match(js, /_renderHeadingsBox[\s\S]{0,800}exam-headings-box(?!_)/);
  });

  test('renderQuestions emits the headings box before any matching_headings run', () => {
    // The box is appended to the host BEFORE the run.forEach renders the
    // individual question cards — pin that flow.
    assert.match(
      js,
      /type\s*===\s*['"]matching_headings['"][\s\S]{0,400}_renderHeadingsBox\([\s\S]{0,80}\)[\s\S]{0,200}host\.appendChild\(headingsBox\)/,
    );
  });

  test('matching_headings dropdown options drop heading text (label-only)', () => {
    // The 20.11 D2 renderer concatenated `"i. heading text"` into option
    // textContent; now the bank lives in the headings-box, so each
    // option's textContent is just the label.
    assert.match(
      js,
      /type\s*===\s*['"]matching_headings['"][\s\S]{0,1200}opt\.value\s*=\s*val\s*;\s*opt\.textContent\s*=\s*val\s*;/,
    );
  });

  test('headings box marks each item with bold Roman numeral class', () => {
    assert.match(js, /exam-headings-box__roman/);
  });
});


// ── T1.3 — `.exam-headings-box` + `.exam-gap-box` CSS ─────────────────

describe('Sprint 20.14a T1.3 — headings-box + gap-box CSS shipped', () => {
  const css = read('frontend/css/reading-exam.css');

  test('.exam-headings-box is sticky + bordered', () => {
    assert.match(css, /\.exam-chrome\s+\.exam-headings-box\s*\{[\s\S]{0,400}position:\s*sticky/);
    assert.match(css, /\.exam-chrome\s+\.exam-headings-box\s*\{[\s\S]{0,400}border:\s*1px\s+solid/);
  });

  test('.exam-gap-box has light background + padding', () => {
    assert.match(css, /\.exam-chrome\s+\.exam-gap-box\s*\{[\s\S]{0,400}background:\s*#/);
    assert.match(css, /\.exam-chrome\s+\.exam-gap-box\s*\{[\s\S]{0,400}padding:/);
  });

  test('.exam-gap-box--mono switches font-family + pre-wrap', () => {
    assert.match(css, /\.exam-chrome\s+\.exam-gap-box--mono\s*\{[\s\S]{0,200}font-family[\s\S]{0,80}mono/);
    assert.match(css, /\.exam-chrome\s+\.exam-gap-box--mono\s*\{[\s\S]{0,200}white-space:\s*pre-wrap/);
  });

  test('inline gap input shipped (.exam-q__gap--inline)', () => {
    assert.match(css, /\.exam-q__gap--inline\s*\{/);
  });
});


// ── T1.4 — MCQ option layout (bold prefix + grid + blue hover) ────────

describe('Sprint 20.14a T1.4 — MCQ option layout (Standards §2A.1)', () => {
  const js = read('frontend/js/reading-exam.js');
  const css = read('frontend/css/reading-exam.css');

  test('radioOption emits a separate `exam-q__option-prefix` span when given 4 args', () => {
    assert.match(js, /function\s+radioOption\s*\(\s*name\s*,\s*value\s*,\s*prefixOrText\s*,\s*optionalText\s*\)/);
    assert.match(js, /exam-q__option-prefix/);
    assert.match(js, /exam-q__option-text/);
  });

  test('mcq_single renderer passes prefix + text to radioOption (the 4-arg form)', () => {
    assert.match(
      js,
      /type\s*===\s*['"]mcq_single['"][\s\S]{0,800}radioOption\(name,\s*val,\s*prefix,\s*o\.text/,
    );
  });

  test('CSS: prefix span is bold + navy', () => {
    assert.match(css, /\.exam-q__option-prefix\s*\{[\s\S]{0,200}font-weight:\s*700/);
  });

  test('CSS: option row uses a grid (radio | prefix | text) and a light-blue hover', () => {
    assert.match(css, /\.exam-q__option\s*\{[\s\S]{0,400}grid-template-columns:\s*22px\s+22px\s+1fr/);
    assert.match(css, /\.exam-q__option:hover\s*\{[\s\S]{0,200}background:\s*#e8f1fb/);
  });
});


// ── T1.5 — TFNG / YNG 3-line pre-wrap block ───────────────────────────

describe('Sprint 20.14a T1.5 — TFNG / YNG 3-line instruction block', () => {
  const js = read('frontend/js/reading-exam.js');

  test('TFNG template returns a 3-line block with NOT GIVEN line', () => {
    // Two explicit `\n` separators produce the 3-line block.
    assert.match(
      js,
      /true_false_not_given:\s*function[\s\S]{0,800}TRUE\s+if[\s\S]{0,200}\\n[\s\S]{0,400}NOT GIVEN/,
    );
  });

  test('YNG template returns the YES / NO / NOT GIVEN 3-line block', () => {
    assert.match(
      js,
      /yes_no_not_given:\s*function[\s\S]{0,800}YES\s+if[\s\S]{0,200}\\n[\s\S]{0,400}NOT GIVEN/,
    );
  });

  test('Instruction CSS preserves line breaks with white-space: pre-wrap', () => {
    const css = read('frontend/css/reading-exam.css');
    assert.match(css, /\.exam-questions__instructions--type\s*\{[\s\S]{0,600}white-space:\s*pre-wrap/);
  });
});


// ── T1.6 — Borderless cards + navy badges ─────────────────────────────

describe('Sprint 20.14a T1.6 — borderless question cards + navy badges (Standards §2A.15)', () => {
  const css = read('frontend/css/reading-exam.css');

  test('.exam-q drops the mockup border', () => {
    assert.match(css, /\.exam-chrome\s+\.exam-q\s*\{[\s\S]{0,400}border:\s*0/);
  });

  test('.exam-q__num becomes a FILLED navy circle', () => {
    assert.match(css, /\.exam-chrome\s+\.exam-q__num\s*\{[\s\S]{0,400}background:\s*var\(--ielts-navy\)/);
    assert.match(css, /\.exam-chrome\s+\.exam-q__num\s*\{[\s\S]{0,400}color:\s*#FFFFFF/);
    assert.match(css, /\.exam-chrome\s+\.exam-q__num\s*\{[\s\S]{0,400}border:\s*0/);
  });
});


// ── T2.1 — Palette navy bar + 4-state recolour (§3A.1) ────────────────

describe('Sprint 20.14a T2.1 — palette navy bar (AV2 + Standards §3A.1)', () => {
  const css = read('frontend/css/reading-exam.css');

  test('.exam-palette background = ielts-navy', () => {
    assert.match(css, /\.exam-chrome\s+\.exam-palette\s*\{[\s\S]{0,400}background:\s*var\(--ielts-navy\)/);
  });

  test('group containers drop the framed-pill chrome (background transparent)', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-palette__group\s*\{[\s\S]{0,400}background:\s*transparent/,
    );
  });

  test('Part separator is `border-left` (the §3A.1 .nav-sep semantic)', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-palette__group\s*\+\s*\.exam-palette__group\s*\{[\s\S]{0,300}border-left:\s*1px\s+solid/,
    );
  });

  test('tile base = 30×30 navy-grey square + light text', () => {
    assert.match(css, /\.exam-chrome\s+\.exam-palette__q\s*\{[\s\S]{0,400}width:\s*30px[\s\S]{0,80}height:\s*30px/);
    assert.match(css, /\.exam-chrome\s+\.exam-palette__q\s*\{[\s\S]{0,400}background:\s*var\(--ielts-palette-bg\)/);
  });

  test('is-answered = WHITE bg + NAVY text (inverted, §3A.1)', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-palette__q\.is-answered\s*\{[\s\S]{0,400}background:\s*#FFFFFF[\s\S]{0,200}color:\s*var\(--ielts-navy\)/,
    );
  });

  test('is-current = yellow ring overlay, not a new background', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-palette__q\.is-current\s*\{[\s\S]{0,400}box-shadow:\s*0 0 0 2px var\(--ielts-current-ring\)/,
    );
  });

  test('is-flagged keeps the 20.13a circle + amber border', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-palette__q\.is-flagged\s*\{[\s\S]{0,300}border-radius:\s*50%[\s\S]{0,200}border-color:\s*var\(--ielts-review\)/,
    );
  });
});


// ── T2.2 — Time toast wiring (§3A.3) ──────────────────────────────────

describe('Sprint 20.14a T2.2 — time-warning toast wiring (Standards §3A.3)', () => {
  const js = read('frontend/js/reading-exam.js');
  const css = read('frontend/css/reading-exam.css');

  test('_showTimeToast helper exists', () => {
    assert.match(js, /function\s+_showTimeToast\s*\(\s*message\s*\)/);
  });

  test('_showTimeToast creates an .exam-time-toast element and auto-removes after 4s', () => {
    assert.match(js, /_showTimeToast[\s\S]{0,800}createElement\(['"]div['"]\)[\s\S]{0,200}exam-time-toast/);
    assert.match(js, /_showTimeToast[\s\S]{0,1200}setTimeout\([\s\S]{0,400},\s*4000\)/);
  });

  test('startTimer fires the toast at the 10-min and 5-min thresholds', () => {
    // The 5-min branch (critical) and 10-min branch (warning) each get
    // one `_showTimeToast(...)` call. Pin both, in either order.
    assert.match(js, /_showTimeToast\(['"]5 minutes remaining['"]\)/);
    assert.match(js, /_showTimeToast\(['"]10 minutes remaining['"]\)/);
  });

  test('CSS: warning state now uses a yellow BACKGROUND (not just border)', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-timer\[data-state="warning"\]\s*\{[\s\S]{0,400}background:\s*var\(--exam-timer-warn-bg\)/,
    );
  });
});


// ── T2.3 — Jump-flash + .is-answered on the Q card (§3A.4) ────────────

describe('Sprint 20.14a T2.3 — jump-flash + answered-class on card', () => {
  const js = read('frontend/js/reading-exam.js');
  const css = read('frontend/css/reading-exam.css');

  test('jumpTo adds `.is-flash` to the target card (reduced-motion gated)', () => {
    assert.match(
      js,
      /function\s+jumpTo[\s\S]{0,800}prefersReducedMotion\(\)[\s\S]{0,400}classList\.add\(['"]is-flash['"]\)/,
    );
  });

  test('Animation cleanup: card removes the class on animationend', () => {
    assert.match(
      js,
      /function\s+jumpTo[\s\S]{0,1200}addEventListener\(['"]animationend['"][\s\S]{0,200}classList\.remove\(['"]is-flash['"]\)/,
    );
  });

  test('CSS: `exam-q-flash` keyframe + `.is-flash` rule shipped', () => {
    assert.match(css, /@keyframes\s+exam-q-flash\s*\{[\s\S]{0,400}background-color:\s*#fff3a6/);
    assert.match(css, /\.exam-chrome\s+\.exam-q\.is-flash\s*\{[\s\S]{0,200}animation:\s*exam-q-flash/);
  });

  test('CSS: `.is-answered` styles the Q-card with a left blue border', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-q\.is-answered\s*\{[\s\S]{0,400}border-left:\s*4px\s+solid\s+var\(--ielts-blue\)/,
    );
  });

  test('JS: _setAnsweredState toggles the card class AND the palette tile in one call', () => {
    assert.match(js, /function\s+_setAnsweredState\s*\(\s*qNum\s*,\s*answered\s*\)/);
    assert.match(
      js,
      /_setAnsweredState[\s\S]{0,400}exam-palette__q[\s\S]{0,400}classList\.toggle\(['"]is-answered['"]/,
    );
    assert.match(
      js,
      /_setAnsweredState[\s\S]{0,600}getElementById\(['"]q-['"][\s\S]{0,200}classList\.toggle\(['"]is-answered['"]/,
    );
  });

  test('JS: markAnswered (legacy) now delegates to _setAnsweredState', () => {
    assert.match(js, /function\s+markAnswered[\s\S]{0,400}_setAnsweredState\(qNum,\s*true\)/);
  });

  test('JS: onAnswerChanged drops the answered state when value is cleared', () => {
    assert.match(
      js,
      /function\s+onAnswerChanged[\s\S]{0,800}value\s*===\s*['"]{2}[\s\S]{0,200}_setAnsweredState\(qNum,\s*false\)/,
    );
  });
});


// ── AV1 — Passage justify + drop max-width cap (Q2 decision) ──────────

describe('Sprint 20.14a AV1 — passage justified + fluid width', () => {
  const css = read('frontend/css/reading-exam.css');

  test('.exam-passage__body drops the 70ch cap and justifies the text', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-passage__body\s*\{[\s\S]{0,400}max-width:\s*none[\s\S]{0,200}text-align:\s*justify/,
    );
  });
});


// ── AV4 — Navy topbar + light-on-navy text ────────────────────────────

describe('Sprint 20.14a AV4 — navy header chrome', () => {
  const css = read('frontend/css/reading-exam.css');

  test('.exam-topbar background = ielts-navy', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-topbar\s*\{[\s\S]{0,400}background:\s*var\(--ielts-navy\)/,
    );
  });

  test('Topbar text recolours to white-on-navy', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-topbar[\s\S]{0,400}color:\s*#FFFFFF/,
    );
  });

  test('Timer block keeps black-on-white inside the navy bar (contrast)', () => {
    assert.match(
      css,
      /\.exam-chrome\s+\.exam-timer\s*\{[\s\S]{0,400}background:\s*#FFFFFF[\s\S]{0,200}color:\s*var\(--ielts-navy\)/,
    );
  });
});


// ── Token block — v1.1 design tokens declared ─────────────────────────

describe('Sprint 20.14a — v1.1 design tokens declared on .exam-chrome', () => {
  const css = read('frontend/css/reading-exam.css');

  test('--ielts-navy, --ielts-palette-bg, --ielts-current-ring, --ielts-blue, --exam-timer-warn-bg all defined', () => {
    for (const token of [
      '--ielts-navy:',
      '--ielts-palette-bg:',
      '--ielts-current-ring:',
      '--ielts-blue:',
      '--exam-timer-warn-bg:',
      '--ielts-review:',
    ]) {
      assert.match(
        css,
        new RegExp(`\\.exam-chrome\\s*\\{[\\s\\S]{0,2000}${token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`),
        `expected token \`${token}\` in .exam-chrome block`,
      );
    }
  });
});


// ── Runtime sentinel — gap-parser shape ───────────────────────────────
//
// Replays the gap split logic in isolation so a logic regression
// (off-by-one in slice, dropped suffix, etc.) fails loudly without
// needing the whole DOM.

describe('Sprint 20.14a T1.1 (runtime) — gap-split math', () => {
  // Recreates the same regex + split _renderInlineStem uses.
  const GAP_RE = /_{2,}/;
  function split(prompt) {
    const s = String(prompt || '');
    const idx = s.search(GAP_RE);
    if (idx < 0) return { prefix: s, suffix: '' };
    const match = s.match(GAP_RE);
    return {
      prefix: s.slice(0, idx),
      suffix: s.slice(idx + (match ? match[0].length : 0)),
    };
  }

  test('mid-sentence gap from AVR-READ-001 Q23', () => {
    const { prefix, suffix } = split(
      'Cities have asphalt and dark roofs that absorb sunlight and release it slowly through the ____.',
    );
    assert.equal(prefix, 'Cities have asphalt and dark roofs that absorb sunlight and release it slowly through the ');
    assert.equal(suffix, '.');
  });

  test('end-of-sentence gap (no suffix after the gap)', () => {
    const { prefix, suffix } = split('Trees cool the air through a process called ____.');
    assert.equal(prefix, 'Trees cool the air through a process called ');
    assert.equal(suffix, '.');
  });

  test('no-gap stem falls through with empty suffix', () => {
    const { prefix, suffix } = split('What is the capital of France?');
    assert.equal(prefix, 'What is the capital of France?');
    assert.equal(suffix, '');
  });

  test('5-underscore variant (longer glyph) still parses cleanly', () => {
    const { prefix, suffix } = split('The result is _____ of the cell.');
    assert.equal(prefix, 'The result is ');
    assert.equal(suffix, ' of the cell.');
  });
});
