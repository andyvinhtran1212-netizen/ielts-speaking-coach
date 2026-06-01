/**
 * frontend/tests/reading-rich-chuabai.test.mjs
 *
 * reading-rich Part C + chuabai-redesign — the post-submit chữa-bài review,
 * refactored to MIRROR the test view: 2-pane (passage | question cards), part
 * tabs, a passage original/translation toggle, and per-Q dropdown cards whose
 * expansion shows a richly-formatted solution (steps as bullets, trap/tips
 * colour-coded, vocab as a definition list, source as a quote) AND highlights
 * the source paragraph in the passage. Reuses the #379 review endpoint.
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


describe('A — page + data wiring (reuses #379 endpoint)', () => {
  test('review page links chrome + tokens + the review script', () => {
    assert.match(html, /css\/reading-review\.css/);
    assert.match(html, /js\/reading-review\.js/);
    assert.match(html, /<aver-chrome/);
  });
  test('fetches the submitted-only review endpoint by attempt_id; gates 409', () => {
    assert.match(js, /\/api\/reading\/test\/attempts\/' \+ encodeURIComponent\(attemptId\) \+ '\/review/);
    assert.match(js, /status === 409[\s\S]{0,160}chưa nộp/i);
  });
});


describe('B — per-Q dropdown card mirrors the test view', () => {
  test('card top is a keyboard-accessible toggle with a chevron', () => {
    assert.match(js, /rr-card__top['"] role="button" tabindex="0" aria-expanded="false"/);
    assert.match(js, /rr-card__chevron/);
    assert.match(css, /\.rr-card\.is-open \.rr-card__chevron[\s\S]{0,80}rotate/);
  });
  test('detail is collapsed by default and toggles on click', () => {
    assert.match(js, /rr-card__detail['"] hidden/);
    assert.match(js, /detail\.hidden = !open/);
    assert.match(js, /top\.addEventListener\('click', toggle\)/);
  });
  test('verdict is semantic (correct/incorrect), user-vs-correct shown', () => {
    assert.match(js, /is-correct['"] : ['"]is-incorrect/);
    assert.match(css, /\.rr-card\.is-correct[\s\S]{0,80}var\(--av-success\)/);
    assert.match(css, /\.rr-card\.is-incorrect[\s\S]{0,80}var\(--av-error\)/);
    assert.match(js, /Bạn trả lời/);
    assert.match(js, /Đáp án/);
  });
});


describe('C — rich solution formatting (bullets / colour / bold / vocab)', () => {
  test('steps render as a numbered list (split on "(n)")', () => {
    assert.match(js, /function _stepsList\(steps\)/);
    assert.match(js, /split\(\/\\s\*\\\(\\d\+\\\)\\s\*\/\)/);
    assert.match(js, /rr-sol__steps/);
  });
  test('vocab renders as a definition list (term → meaning)', () => {
    assert.match(js, /function _vocabList\(vocab\)/);
    assert.match(js, /rr-sol__vocab/);
    assert.match(css, /\.rr-sol__vocab-row dt/);
  });
  test('trap + tips are colour-coded, source is a quote block', () => {
    assert.match(js, /rr-sol__sec--trap/);
    assert.match(js, /rr-sol__sec--tip/);
    assert.match(js, /rr-sol__sec--quote/);
    assert.match(js, /'<blockquote>' \+ formatProse\(sol\.source_excerpt\)/);
    assert.match(css, /\.rr-sol__sec--trap \.rr-sol__text[\s\S]{0,160}var\(--av-error-soft\)/);
    assert.match(css, /\.rr-sol__sec--tip \.rr-sol__text[\s\S]{0,160}var\(--av-success-soft\)/);
  });
  test('formatProse bolds quoted spans AFTER escaping (XSS-safe)', () => {
    const fn = js.slice(js.indexOf('function formatProse'), js.indexOf('function showState'));
    assert.match(fn, /escapeHtml\(s\)\.replace/);
    assert.match(fn, /<strong>/);
    // it escapes first, so it never injects raw user HTML
    assert.ok(!/innerHTML/.test(fn));
  });
});


describe('D — source highlighting (text-match, no MD change)', () => {
  test('splits source_excerpt on ellipsis + highlights matching paragraphs', () => {
    assert.match(js, /function highlightSource\(excerpt\)/);
    assert.match(js, /split\(\/\\s\*\(\?:…\|\\\.\\\.\\\.\)\\s\*\//);
    assert.match(js, /classList\.add\('rr-src-hl'\)/);
    assert.match(js, /scrollIntoView/);
    assert.match(css, /\.rr-src-hl/);
  });
  test('expanding a card highlights its source; collapsing clears it', () => {
    assert.match(js, /if \(open\) highlightSource\(sol\.source_excerpt\); else clearHighlight/);
    // highlight needs the English body → expand forces original mode
    assert.match(js, /passageMode !== 'original'\) setPassageMode\('original'\)/);
  });
});


describe('E — passage original / translation toggle (#372 reuse)', () => {
  test('two toggle buttons: Văn bản gốc / Bài dịch', () => {
    assert.match(html, /id="rr-mode-original"[\s\S]{0,80}Văn bản gốc/);
    assert.match(html, /id="rr-mode-translation"[\s\S]{0,80}Bài dịch/);
  });
  test('setPassageMode swaps the body between English + VI translation', () => {
    assert.match(js, /function setPassageMode\(mode\)/);
    assert.match(js, /passageMode === 'translation'/);
    assert.match(js, /translation_vi/);
    assert.match(js, /\.textContent = s;/);   // VI paragraphs via textContent (XSS-safe)
  });
});


describe('F — reuse + no regression', () => {
  test('exam results panel still links to the chữa-bài review', () => {
    assert.match(examHtml, /id="results-chuabai-link"/);
    assert.match(examJs, /reading-review\.html\?attempt_id=' \+ encodeURIComponent\(result\.attempt_id\)/);
  });
  test('2-pane stacks on mobile; tokens only (no undefined --av-space)', () => {
    assert.match(css, /@media \(max-width: 860px\)[\s\S]{0,400}\.rr-layout \{[\s\S]{0,120}grid-template-columns: 1fr/);
    assert.ok(!/--av-space-(5|7|9|10|11|13|14|15)\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
    assert.ok(!/--av-fs-md\b/.test(css) && !/--av-on-primary\b/.test(css));
  });
});
