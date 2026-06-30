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

describe('vocab-landing — student entry repointed to the adaptive hub', () => {
  test('"Luyện tập" CTA links to the new hub, not the retired drill', () => {
    assert.match(LANDING, /vtc-act--ex.*href="\/pages\/vocab-practice\.html"/);
    assert.ok(!/topic-exercise/.test(LANDING),
      'vocab-landing must not reference the retired topic-exercise drill');
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
