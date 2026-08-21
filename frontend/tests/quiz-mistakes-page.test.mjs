/**
 * quiz-mistakes-page.test.mjs — audit 2026-07-28 §C2/§C3.
 *
 * §C2: the in-session review list lived only in the tab's memory (`sessionLog`
 * in quiz.html), so leaving the result screen destroyed every wrong answer. The
 * stats page now reads them back from /api/quiz/mistakes.
 * §C3: the same page is reachable from the Vocabulary hub AND from a grammar
 * Quick-Check, so both it and its callers must carry `skill_area`.
 *
 * quiz-progress.html is a DOM/IIFE page (not importable), so structure is pinned
 * by source sentinels — the pattern quiz-review-screen.test.mjs already uses.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
// Logic của trang đã TÁCH sang `/js/quiz-progress.js` khi port sang Next: bản
// Next phải chạy CHÍNH mã đó chứ không chép lại. Các khẳng định ở đây là
// "nguồn trang có chứa X", nên nguồn trang nay = HTML + module của nó. Gộp
// giữ ĐÚNG ý định cũ; ở tệp này không có khẳng định nào phụ thuộc THỨ TỰ
// trong HTML (đã kiểm), nên gộp là an toàn.
const PROGRESS = read('pages', 'quiz-progress.html') + '\n' + read('js', 'quiz-progress.js');
const QUIZ = read('pages', 'quiz.html');
const PRACTICE = read('pages', 'vocab-practice.html');
const LANDING = read('js', 'vocab-landing.js');

describe('quiz-progress.html — mistakes review', () => {
  test('renders a dedicated section fed by /api/quiz/mistakes', () => {
    assert.match(PROGRESS, /id=["']pg-mistakes["']/);
    assert.match(PROGRESS, /Câu bạn từng trả lời sai/);
    assert.match(PROGRESS, /\/api\/quiz\/mistakes/);
  });

  test('a review card shows the four things the in-session list showed', () => {
    // prompt, the learner's answer, the correct answer, the explanation.
    assert.match(PROGRESS, /pg-mk__prompt/);
    assert.match(PROGRESS, /Bạn trả lời:/);
    assert.match(PROGRESS, /Đáp án đúng:/);
    assert.match(PROGRESS, /pg-mk__explain/);
  });

  test('prompts run through fmt() so **bold** and ____ render like the player', () => {
    assert.match(PROGRESS, /const fmt = \(s\) => esc\(s\)/);
    assert.match(PROGRESS, /fmt\(q\.prompt\)/);
    // The escaper still runs first — fmt is built on esc(), never on raw input.
    assert.ok(!/innerHTML[^;]*\bq\.prompt\b(?![\s\S]{0,40}fmt)/.test(PROGRESS));
  });

  test('a mistakes-read failure does not blank the progress already rendered', () => {
    // The mistakes fetch sits in its own try/catch after the progress render.
    assert.match(PROGRESS, /Không tải được danh sách câu sai/);
  });

  test('a word later mastered reads as fixed, not as an open error', () => {
    assert.match(PROGRESS, /it\.status === 'mastered'/);
    assert.match(PROGRESS, /đã thuộc/);
  });
});

describe('skill_area scoping (audit §C3)', () => {
  test('the page reads ?skill_area= and forwards it to both endpoints', () => {
    assert.match(PROGRESS, /new URLSearchParams\(location\.search\)\.get\('skill_area'\)/);
    assert.match(PROGRESS, /'\/api\/quiz\/progress' \+ qs\(\)/);
    assert.match(PROGRESS, /'\/api\/quiz\/mistakes' \+ qs\(\)/);
  });

  test('the back link follows the skill instead of always going to vocab', () => {
    assert.match(PROGRESS, /SKILL === 'grammar'/);
    assert.match(PROGRESS, /pg-back/);
  });

  test('every vocab entry point passes skill_area=vocab', () => {
    assert.match(LANDING, /\/quiz\/progress\?skill_area=vocab/);
    assert.match(PRACTICE, /\/quiz\/progress\?skill_area=vocab/);
  });

  test('the player stamps the skill it just practised onto its stats link', () => {
    assert.match(QUIZ, /id=["']qz-stats["']/);
    assert.match(QUIZ, /\/quiz\/progress\?skill_area=' \+ encodeURIComponent\(area\)/);
  });
});
