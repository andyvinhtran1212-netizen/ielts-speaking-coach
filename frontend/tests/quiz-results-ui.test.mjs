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
  test('shuffles MCQ options (choice) but keeps syllable segments in authored order', () => {
    // A per-(session,qid) permutation is computed for choice; syllable stays ordered
    // (segments are the word's ordered syllables, e.g. ba-na-na — not interchangeable).
    assert.match(QUIZ, /function _shuffledIndices\(/);
    assert.match(QUIZ, /q\.input === 'choice'\s*\?\s*_shuffledIndices\(list\.length, \(sessionId \|\| ''\) \+ ':' \+ \(q\.qid \|\| ''\)\)/);
    assert.match(QUIZ, /:\s*list\.map\(\(_, i\) => i\)/);
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

describe('quiz.html — audio is preloaded + cached + prefetched (seamless playback)', () => {
  test('caches Audio by URL instead of building a fresh one per click', () => {
    assert.match(QUIZ, /const _audioCache = new Map\(\)/);
    assert.match(QUIZ, /function _getAudio\(url\)/);
    // the old "new Audio(...).play()" on every click is gone from the play paths
    assert.doesNotMatch(QUIZ, /new Audio\(q\.audio_url\)\.play\(\)/);
    assert.doesNotMatch(QUIZ, /new Audio\(b\.dataset\.audio\)\.play\(\)/);
  });
  test('warms the current question audio on render + prefetches upcoming words', () => {
    assert.match(QUIZ, /_getAudio\(q\.audio_url\);\s*\/\/ start buffering NOW/);
    assert.match(QUIZ, /function _prefetchUpcoming\(\)/);
    assert.match(QUIZ, /engine\._state\(\)/);
    assert.match(QUIZ, /_prefetchUpcoming\(\);\s*\/\/ warm the next words/);
  });
  test('builds item_key → audio_url map from the bank for prefetch', () => {
    assert.match(QUIZ, /_audioByKey\[k\] = q\.audio_url/);
  });
});

describe('quiz.html — {{audio}} prompts stay readable and answerable', () => {
  test('strips the {{audio}} token instead of printing it at the learner', () => {
    // The token is a player placeholder; the audio has its own 🔊 control, so the
    // prompt must never render a literal "{{audio}}".
    assert.match(QUIZ, /const AUDIO_TOKEN = '\{\{audio\}\}'/);
    assert.match(QUIZ, /rawPrompt\.replace\(AUDIO_TOKEN_RE, ' '\)\.trim\(\)/);
    assert.doesNotMatch(QUIZ, /\$\('qz-prompt'\)\.innerHTML = fmt\(q\.prompt\);/);
  });
  test('the strip regex also eats a bold wrapper, which fmt() would leave as ****', () => {
    // fmt()'s /\*\*(.+?)\*\*/ needs >=1 char between the fences, so a bare token
    // strip would turn `**{{audio}}**` into a literal `****` in front of the
    // learner. AUDIO_TOKEN itself stays the exact literal the backend keys on.
    const m = QUIZ.match(/const AUDIO_TOKEN_RE = (\/.*\/g);/);
    assert.ok(m, 'AUDIO_TOKEN_RE is defined');
    const re = () => new RegExp(m[1].slice(1, -2), 'g');
    assert.equal('Nghe **{{audio}}** rồi gõ'.replace(re(), ' ').trim(), 'Nghe rồi gõ');
    assert.equal('Gõ từ có nghĩa: "x"  {{audio}}'.replace(re(), ' ').trim(), 'Gõ từ có nghĩa: "x"');
    assert.equal('a{{audio}}b'.replace(re(), ' ').trim(), 'a b');
  });
  test('keeps the 🔊 button on an audio question even when audio_url is missing', () => {
    // A "nghe rồi gõ chữ" question with no pre-generated file used to render with no
    // audio at all — unanswerable. The button now stays and falls back to TTS.
    assert.match(QUIZ, /const wantsAudio = rawPrompt\.includes\(AUDIO_TOKEN\)/);
    assert.match(QUIZ, /if \(q\.audio_url \|\| wantsAudio\)/);
    assert.match(QUIZ, /else _speak\(q\.item_key\)/);
  });
});

describe('quiz.html — typo-tolerant accept shows the canonical spelling', () => {
  test('renders "Đáp án chuẩn" from res.corrected when a fuzzy match was accepted', () => {
    assert.match(QUIZ, /res\.correct && res\.corrected/);
    assert.match(QUIZ, /Đáp án chuẩn:/);
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
