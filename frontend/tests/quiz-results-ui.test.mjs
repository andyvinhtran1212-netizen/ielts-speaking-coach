/**
 * quiz-results-ui.test.mjs — end-of-quiz result screen + "Thống kê" page.
 *
 * Source-sentinel checks (the pages are DOM/IIFE, not importable) that the vocab
 * Quick-Check result screen and the redesigned progress page ship the expected
 * structure and stay on the --av-* design system. Zero-dep node:test.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const QUIZ = read('pages', 'quiz.html');
const PROG = read('pages', 'quiz-progress.html');

describe('quiz.html — option order is shuffled per (session, qid), grading by original index', () => {
  test('renders options in a seeded shuffled order (defeats fixed answer position)', () => {
    // A per-(session,qid) permutation is computed and used to render the options.
    assert.match(QUIZ, /function _shuffledIndices\(/);
    assert.match(QUIZ, /_shuffledIndices\(list\.length, \(sessionId \|\| ''\) \+ ':' \+ \(q\.qid \|\| ''\)\)/);
  });
  test('each option button keeps its ORIGINAL index (data-oi) and grades with it', () => {
    assert.match(QUIZ, /b\.dataset\.oi = String\(oi\)/);
    assert.match(QUIZ, /b\.onclick = \(\) => grade\(oi\)/);
  });
  test('reveal marks ✓/✗ by original index, not DOM position', () => {
    assert.match(QUIZ, /const oi = Number\(b\.dataset\.oi\)/);
    assert.match(QUIZ, /if \(oi === q\.answer\)/);
    assert.match(QUIZ, /if \(oi === value && !res\.correct\)/);
  });
});

describe('vocabulary back-nav consistency (Hub → Picker → Quiz/Stats)', () => {
  test('quiz.html: BOTH back controls target the picker, never the public word wiki', () => {
    // vocab branch of boot() sets top + end back to the same practice picker.
    assert.match(QUIZ, /back\.href = '\/pages\/vocab-practice\.html'/);
    assert.match(QUIZ, /topBack\.href = '\/pages\/vocab-practice\.html'/);
    // The old ambiguous "back to /vocabulary.html (public wiki)" is gone.
    assert.doesNotMatch(QUIZ, /href="\/vocabulary\.html"/);
    assert.doesNotMatch(QUIZ, /\.href = '\/vocabulary\.html'/);
  });
  test('quiz-progress.html back → the picker (not the public wiki)', () => {
    assert.match(PROG, /subpage-header__back" href="\/pages\/vocab-practice\.html"/);
    assert.doesNotMatch(PROG, /subpage-header__back" href="\/vocabulary\.html"/);
  });
});

describe('quiz.html — end-of-session result screen', () => {
  test('hero stat tiles: time · questions · mastered', () => {
    for (const id of ['qz-res-time', 'qz-res-q', 'qz-res-mastered']) {
      assert.match(QUIZ, new RegExp(`id="${id}"`), `missing #${id}`);
    }
    assert.match(QUIZ, /class="qz-res-tiles"/);
  });
  test('performance card: accuracy + bar + correct/wrong + hardest', () => {
    for (const id of ['qz-res-acc', 'qz-res-accbar', 'qz-res-correct', 'qz-res-wrong', 'qz-res-hardest']) {
      assert.match(QUIZ, new RegExp(`id="${id}"`), `missing #${id}`);
    }
  });
  test('renderResult fills from in-memory summary (no fetch) + gates sync warn', () => {
    assert.match(QUIZ, /function renderResult\(s, durSec, ok\)/);
    assert.match(QUIZ, /function fmtDuration\(sec\)/);
    assert.match(QUIZ, /\$\('qz-res-warn'\)\.classList\.remove\('hidden'\)/);
  });
  test('review chips reuse the vocab-card popup (openCard) when a card exists', () => {
    assert.match(QUIZ, /id="qz-res-review"/);
    assert.match(QUIZ, /wordCards\[key\]/);
    assert.match(QUIZ, /openCard\(key, el\)/);
  });
  test('actions still link to the stats page; old summary-body id retired', () => {
    assert.match(QUIZ, /\/pages\/quiz-progress\.html/);
    assert.doesNotMatch(QUIZ, /id="qz-summary-body"/);
  });
});

describe('quiz-progress.html — Thống kê page on the design system', () => {
  test('canonical chrome + subpage-header + read width', () => {
    assert.match(PROG, /<aver-chrome active="vocabulary"><\/aver-chrome>/);
    assert.match(PROG, /class="subpage-header"/);
    assert.match(PROG, /class="av-w-read/);
  });
  test('renders lifetime totals from p.totals (time, sessions, mastered, accuracy)', () => {
    assert.match(PROG, /p\.totals/);
    assert.match(PROG, /function fmtHm\(sec\)/);
    assert.match(PROG, /Tổng thời gian/);
    assert.match(PROG, /Độ chính xác TB/);
  });
  test('fetches the canonical progress endpoint + renders banks/sessions', () => {
    assert.match(PROG, /\/api\/quiz\/progress/);
    assert.match(PROG, /id="pg-banks"/);
    assert.match(PROG, /id="pg-sessions"/);
    assert.match(PROG, /s\.duration_sec/);          // session duration column
  });
});
