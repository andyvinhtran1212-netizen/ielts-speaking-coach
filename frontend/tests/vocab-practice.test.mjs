/**
 * frontend/tests/vocab-practice.test.mjs
 *
 * Adaptive vocab practice hub — replaces the retired 12-question random MCQ
 * drill (topic-exercise). The student "✍️ Luyện tập" entry now opens a
 * lesson-picker that lists published Quick-Check banks; each bank opens the
 * adaptive player (quiz.html?bank=) which tests until the WHOLE word list is
 * mastered.
 *
 * Source-string assertions (same approach as the other vocab tests).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const frontPath = (...p) => join(__dirname, '..', ...p);

const PAGE = front('pages', 'vocab-practice.html');
const LANDING = front('js', 'vocab-landing.js');

describe('vocab-practice hub — lists published vocab banks', () => {
  test('boots api.js + Supabase (authed fetch)', () => {
    assert.match(PAGE, /\/js\/api\.js/);
    assert.match(PAGE, /initSupabase\(/);
  });

  test('lists only published VOCAB banks via the student endpoint', () => {
    assert.match(PAGE, /api\.get\('\/api\/quiz\/banks\?skill_area=vocab'\)/);
  });

  test('each bank opens the adaptive player at quiz.html?bank=', () => {
    assert.match(PAGE, /\/pages\/quiz\.html\?bank='/);
    assert.match(PAGE, /encodeURIComponent\(b\.id\)/);
  });

  test('renders bank code, title and word count', () => {
    assert.match(PAGE, /b\.code/);
    assert.match(PAGE, /b\.title/);
    assert.match(PAGE, /b\.words_count/);
  });

  test('back link goes UP to the Vocabulary hub, not the public word wiki', () => {
    assert.match(PAGE, /subpage-header__back" href="\/pages\/vocabulary\.html"/);
    assert.doesNotMatch(PAGE, /subpage-header__back" href="\/vocabulary\.html"/);
  });

  test('has empty + error states and a progress link', () => {
    assert.match(PAGE, /id="vp-empty"/);
    assert.match(PAGE, /id="vp-error"/);
    assert.match(PAGE, /\/pages\/quiz-progress\.html/);
  });

  test('communicates the "test until the whole list is mastered" purpose', () => {
    assert.match(PAGE, /thuộc trọn vẹn cả list từ/);
  });

  test('has the canonical anti-flash IIFE', () => {
    assert.match(PAGE, /localStorage\.getItem\('av-theme'\)/);
    assert.match(PAGE, /setAttribute\('data-theme'/);
  });
});

describe('vocab-landing — "Luyện tập" goes straight into the player', () => {
  test('CTA opens the player directly (no intermediate picker), resolving by skill_area', () => {
    assert.match(LANDING, /vtc-act--ex.*href="\/pages\/quiz\.html\?skill_area=vocab"/);
    assert.ok(!/topic-exercise/.test(LANDING),
      'vocab-landing must not reference the retired topic-exercise drill');
  });
  test('progress is reachable from the Vocabulary page', () => {
    assert.match(LANDING, /\/pages\/quiz-progress\.html/);
  });
});

describe('quiz.html resolves a bank from ?skill_area when ?bank is absent', () => {
  const PLAYER = front('pages', 'quiz.html');
  test('reads skill_area and lists published banks for it', () => {
    assert.match(PLAYER, /get\('skill_area'\)/);
    assert.match(PLAYER, /\/api\/quiz\/banks\?skill_area=/);
  });
  test('one bank starts directly; multiple hands off to the lesson picker', () => {
    assert.match(PLAYER, /banks\.length > 1/);
    assert.match(PLAYER, /location\.replace\('\/pages\/vocab-practice\.html'\)/);
  });
});

describe('quiz.html — quick-glance vocab card popup', () => {
  const PLAYER = front('pages', 'quiz.html');
  test('reuses the design-system modal primitive (overlay, not a new page)', () => {
    assert.match(PLAYER, /id="qz-modal"[^>]*class="av-modal-backdrop/);
    assert.match(PLAYER, /class="av-modal"/);
  });
  test('consumes the bank word_cards map from the API', () => {
    assert.match(PLAYER, /bank\.word_cards/);
  });
  test('shows the "Xem nhanh thẻ từ" trigger only when a card exists', () => {
    assert.match(PLAYER, /hasCard/);
    assert.match(PLAYER, /Xem nhanh thẻ từ/);
  });
  test('renders the WHOLE card — meaning, IPA, audio, example', () => {
    assert.match(PLAYER, /qz-modal-ipa/);
    assert.match(PLAYER, /qz-modal__defvi/);
    assert.match(PLAYER, /qz-modal__example/);
    assert.match(PLAYER, /audio_headword/);
    assert.match(PLAYER, /audio_example/);
  });
  test('renders the rich card fields (collocations, synonyms, antonyms, family, notes)', () => {
    for (const f of ['collocations', 'synonyms', 'antonyms', 'word_family', 'related_words', 'common_error', 'memory_hook']) {
      assert.match(PLAYER, new RegExp('c\\.' + f), 'popup must render ' + f);
    }
    assert.match(PLAYER, /Đồng nghĩa/);
    assert.match(PLAYER, /Mẹo ghi nhớ/);
  });
  test('closes via ×, footer button, backdrop, and Escape (stays in the quiz)', () => {
    assert.match(PLAYER, /function closeCard/);
    assert.match(PLAYER, /e\.key === 'Escape'/);
  });
});

describe('the old 12-question drill is retired', () => {
  test('topic-exercise page + script are removed', () => {
    assert.ok(!existsSync(frontPath('pages', 'topic-exercise.html')),
      'topic-exercise.html should be deleted');
    assert.ok(!existsSync(frontPath('js', 'topic-exercise.js')),
      'topic-exercise.js should be deleted');
  });
});
