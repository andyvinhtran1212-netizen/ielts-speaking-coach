/**
 * frontend/tests/reading-rich-chuabai.test.mjs
 *
 * reading-rich Part C + chuabai-refine — the chữa-bài review, refined to:
 *  1. full-screen EXAM-like layout (reuses .exam-chrome shell + .exam-split)
 *  2. original/translation toggle on the LEFT (above the passage)
 *  3. the exam's 40-question navigator grouped by passage (no "Phần" tabs)
 *  4. a prominent per-Q "Xem lời giải" toggle (not a tiny chevron)
 *  5. vocab/backtick terms rendered as mono <code> (no literal backticks)
 *  6. paraphrase + trap/skill as bullet lists
 * Reuses the #379 review endpoint; solution stays stripped during the test.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const html = read('frontend/pages/reading-review.html');
const js = read('frontend/js/reading-review.js');
const css = read('frontend/css/reading-review.css');
const examJs = read('frontend/js/reading-exam.js');
const examHtml = read('frontend/pages/reading-exam.html');
const readExamCss = read('frontend/css/reading-exam.css');


describe('1 — full-screen exam-like layout (reuses the exam shell)', () => {
  test('page is exam-chrome + links the exam stylesheet + reuses .exam-split / .exam-palette', () => {
    assert.match(html, /<body class="exam-chrome"/);
    assert.match(html, /css\/reading-exam-mockup\.css/);
    assert.match(html, /class="exam-split" id="rr-content"/);
    assert.match(html, /class="exam-palette" id="rr-palette"/);
  });
});

describe('2 — original/translation toggle on the LEFT (above the passage)', () => {
  test('the toggle sits inside the passage pane (.exam-passage), before the body', () => {
    assert.match(html, /class="exam-passage" id="rr-passage-pane"[\s\S]{0,300}rr-passage-toggle[\s\S]{0,500}rr-passage__body/);
    assert.match(html, /id="rr-mode-original"[\s\S]{0,60}Văn bản gốc/);
    assert.match(html, /id="rr-mode-translation"[\s\S]{0,60}Bài dịch/);
  });
});

describe('3 — 40-Q navigator grouped by passage (no Phần tabs)', () => {
  test('navigator reuses the exam palette groups + tints by right/wrong', () => {
    assert.match(js, /function renderNavigator\(d\)/);
    assert.match(js, /exam-palette__group/);
    assert.match(js, /rr-nav-q ' \+ \(correctByQ\[qn\] \? 'is-correct' : 'is-incorrect'\)/);
    assert.match(js, /jumpToQ\(qn\)/);
  });
  test('navigator lays out horizontally (reading-display-fixes B) + has a legend', () => {
    // the group layout (missing from the linked mockup CSS) is replicated here
    assert.match(css, /\.exam-palette__grid\s*\{[\s\S]{0,120}display:\s*flex\s*!important/);
    assert.match(css, /\.exam-palette__group\s*\{[\s\S]{0,80}flex-direction:\s*column/);
    assert.match(css, /\.exam-palette__group-btns\s*\{[\s\S]{0,120}grid-auto-flow:\s*column/);
    assert.match(html, /rr-nav-legend/);
  });
  test('the 3 "Phần" tabs are gone (navigator replaces them)', () => {
    assert.ok(!/rr-part-tab/.test(js) && !/rr-part-tab/.test(html) && !/rr-part-tab/.test(css));
    assert.ok(!/function renderParts/.test(js));
  });
  test('jumpToQ switches passage if needed + scrolls + expands the card', () => {
    assert.match(js, /function jumpToQ\(qNum\)/);
    assert.match(js, /passage_order !== SESSION\.part\) selectPart/);
    assert.match(js, /scrollIntoView/);
  });
});

describe('4 — prominent per-Q expand toggle', () => {
  test('a labelled "Xem lời giải" affordance (not just a chevron)', () => {
    assert.match(js, /rr-card__toggle[\s\S]{0,80}Xem lời giải/);
    assert.match(js, /toggleText\.textContent = open \? 'Ẩn lời giải' : 'Xem lời giải'/);
    // styled as a clear button (accent background)
    assert.match(css, /\.rr-card__toggle\s*\{[\s\S]{0,200}var\(--exam-accent\)/);
  });
});

describe('5 — vocab / backtick terms render as mono (no literal backticks)', () => {
  test('formatProse converts `backtick` spans to <code> (after escaping)', () => {
    const fn = js.slice(js.indexOf('function formatProse'), js.indexOf('function _bulletList'));
    assert.match(fn, /escapeHtml\(s\)/);
    assert.match(fn, /replace\(\/`\(\[\^`\]\+\)`\/g/);
    assert.match(fn, /rr-code/);
    assert.ok(!/innerHTML/.test(fn));   // escape-first, no raw HTML injection
  });
  test('.rr-code is mono-styled', () => {
    assert.match(css, /\.rr-code\s*\{[\s\S]{0,120}var\(--av-font-mono\)/);
  });
});

describe('6 — paraphrase + trap/skill as bullet lists', () => {
  test('paraphrase + trap go through the bullet builder', () => {
    assert.match(js, /function _bulletList\(text\)/);
    assert.match(js, /_section\('Paraphrase', sol\.paraphrase \? _bulletList\(sol\.paraphrase\)/);
    assert.match(js, /_section\('Phân tích bẫy & kỹ năng', sol\.trap_analysis \? _bulletList\(sol\.trap_analysis\)/);
    assert.match(js, /rr-sol__bullets/);
  });
  test('Mẹo is refactored: 💡 label + bullets + distinct tint (reading-display-fixes C)', () => {
    assert.match(js, /_section\('💡 Mẹo làm bài', sol\.tips \? _bulletList\(sol\.tips\)[\s\S]{0,40}rr-sol__sec--tip/);
    assert.match(css, /\.rr-sol__sec--tip \.rr-sol__text/);
  });
});

describe('regression — endpoint reuse, security, results link, XSS, tokens', () => {
  test('reuses the submitted-only review endpoint (409 gated)', () => {
    assert.match(js, /\/api\/reading\/test\/attempts\/' \+ encodeURIComponent\(attemptId\) \+ '\/review/);
    assert.match(js, /status === 409[\s\S]{0,160}chưa nộp/i);
  });
  test('source highlight + clear-on-collapse intact; VI via textContent', () => {
    assert.match(js, /function highlightSource\(excerpt\)/);
    assert.match(js, /classList\.add\('rr-src-hl'\)/);
    assert.match(js, /if \(open\) highlightSource\(sol\.source_excerpt\); else clearHighlight/);
    assert.match(js, /\.textContent = s;/);   // VI paragraphs
  });
  test('exam results panel still links to the review', () => {
    assert.match(examHtml, /id="results-chuabai-link"/);
    assert.match(examJs, /reading-review\.html\?attempt_id=' \+ encodeURIComponent\(result\.attempt_id\)/);
  });
  test('token-clean: no undefined --av-space, no --av-fs-md / --av-on-primary', () => {
    const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/--av-space-(5|7|9|10|11|13|14|15)\b/.test(live));
    assert.ok(!/--av-fs-md\b/.test(live) && !/--av-on-primary\b/.test(live));
  });
});


/* ── reading-header-notefill — header refinements (A) + note block (B) ── */
describe('header-notefill A — clean header, inline skills, sticky toggle', () => {
  test('back link is a clean link (no awkward exam-tool box) + test label', () => {
    assert.match(html, /class="rr-back" href="\/pages\/reading\.html"/);
    assert.ok(!/exam-tool[^>]*Thư viện/.test(html), 'back link must not use the boxed .exam-tool');
    assert.match(html, /class="rr-test-label" id="rr-test-label"/);
  });
  test('skills shown INLINE as chips (no dropdown)', () => {
    assert.match(js, /rr-skill-chip/);
    assert.ok(!/rr-skills-pop/.test(html) && !/rr-skills-pop/.test(js), 'no skills dropdown');
    assert.ok(!/Kỹ năng ▾/.test(html), 'no "Kỹ năng ▾" dropdown summary');
    assert.match(css, /\.rr-skill-chip\.is-weak[\s\S]{0,120}var\(--av-error\)/);
  });
  test('passage toggle is sticky (stays on scroll)', () => {
    assert.match(css, /\.rr-passage-toggle\s*\{[\s\S]{0,200}position:\s*sticky/);
  });
});

describe('header-notefill B — exam note/summary completion as one inline-blank block', () => {
  test('the flowing-block path now gates notes_completion too', () => {
    assert.match(examJs, /type === 'summary_completion' \|\| type === 'notes_completion'\)[\s\S]{0,300}_renderFlowingSummaryBlock/);
  });
  test('notes preserve their line/bullet structure (pre-wrap), not justified', () => {
    assert.match(examJs, /question_type === 'notes_completion'/);
    assert.match(examJs, /exam-summary__prose--notes/);
    assert.match(readExamCss, /\.exam-summary__prose--notes[\s\S]{0,120}white-space:\s*pre-wrap/);
  });
  test('answer binding stays per q_num (grading intact)', () => {
    // inline inputs carry name="q-N" + dataset.q=N → the existing per-q path
    assert.match(examJs, /name = 'q-' \+ qNum/);
    assert.match(examJs, /_summaryGapChanged\(qNum/);
  });
});
