/**
 * frontend/tests/reading-rich-chuabai.test.mjs
 *
 * reading-rich Part C — the post-submit chữa-bài (solution review) UI:
 * reading-review.html + reading-review.js + reading-review.css, fed by the
 * submitted-only review endpoint. Per-Q cards show user-vs-correct with a
 * semantic verdict + an expandable rich solution (steps/source/vocab/
 * paraphrase/trap/tips); per-passage translation reuses #372; the exam results
 * panel links to it. XSS-safe; token-driven; theme-aware.
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


describe('A — page + data wiring', () => {
  test('review page links chrome + tokens + the review script', () => {
    assert.match(html, /css\/reading-review\.css/);
    assert.match(html, /js\/reading-review\.js/);
    assert.match(html, /<aver-chrome/);
    assert.match(html, /id="rr-content"/);
  });

  test('fetches the submitted-only review endpoint by attempt_id', () => {
    assert.match(js, /attempt_id/);
    assert.match(js, /\/api\/reading\/test\/attempts\/' \+ encodeURIComponent\(attemptId\) \+ '\/review/);
  });

  test('handles the 409 "chưa submit" gate with a clear message', () => {
    assert.match(js, /status === 409[\s\S]{0,120}chưa nộp|status === 409[\s\S]{0,160}chưa có chữa bài/i);
  });
});


describe('B — per-question cards (verdict + expandable solution)', () => {
  test('verdict is semantic (correct/incorrect class), not text-only', () => {
    assert.match(js, /is-correct['"] : ['"]is-incorrect/);
    assert.match(css, /\.rr-card\.is-correct[\s\S]{0,80}var\(--av-success\)/);
    assert.match(css, /\.rr-card\.is-incorrect[\s\S]{0,80}var\(--av-error\)/);
  });

  test('user-vs-correct answers both rendered', () => {
    assert.match(js, /Bạn trả lời/);
    assert.match(js, /Đáp án/);
  });

  test('rich solution sections rendered (the learning value)', () => {
    // steps / source / vocab / paraphrase / trap+skill / tips
    assert.match(js, /Các bước ra đáp án/);
    assert.match(js, /Trích đoạn nguồn/);
    assert.match(js, /Phân tích bẫy & kỹ năng/);
    assert.match(js, /Mẹo làm bài/);
    // collapsed by default (details) + an expand-all toggle
    assert.match(js, /document\.createElement\('details'\)/);
    assert.match(js, /rr-expand-all/);
  });

  test('solution fields set via textContent (XSS-safe)', () => {
    const fn = js.slice(js.indexOf('function _solSection'));
    assert.match(fn, /\.textContent = value/);
    // the rich-solution builder must not innerHTML untrusted solution text
    assert.ok(!/sec\.innerHTML/.test(fn));
  });
});


describe('C — reuse + skill breakdown + link from results', () => {
  test('skill breakdown bars from skill_breakdown', () => {
    assert.match(js, /skill_breakdown/);
    assert.match(js, /rr-skill__fill/);
    assert.match(css, /\.rr-skill\.is-weak[\s\S]{0,80}var\(--av-error\)/);
  });

  test('reuses the #372 translation toggle pattern', () => {
    assert.match(js, /rv-translation__toggle/);
    assert.match(js, /Xem bản dịch tiếng Việt/);
  });

  test('2-pane layout stacks on mobile', () => {
    assert.match(css, /\.rr-layout\s*\{[\s\S]{0,200}grid-template-columns/);
    assert.match(css, /@media \(max-width: 860px\)[\s\S]{0,400}\.rr-layout \{[\s\S]{0,120}grid-template-columns: 1fr/);
  });

  test('exam results panel links to the chữa-bài review for the attempt', () => {
    assert.match(examHtml, /id="results-chuabai-link"/);
    assert.match(examJs, /reading-review\.html\?attempt_id=' \+ encodeURIComponent\(result\.attempt_id\)/);
  });
});
