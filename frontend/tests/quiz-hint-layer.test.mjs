/**
 * quiz-hint-layer.test.mjs — audit 2026-07-17 §I: gợi ý là field `hint` riêng
 * (migration 159), render thành dòng 💡 muted — không nhét trong prompt nữa.
 * Source sentinels (quiz.html is DOM/IIFE, not importable).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUIZ = readFileSync(join(__dirname, '..', 'pages', 'quiz.html'), 'utf8');

describe('quiz.html — authored hint line (#qz-hint)', () => {
  test('ships a dedicated hint element between prompt and instruction', () => {
    assert.match(QUIZ, /<p id="qz-prompt" class="qz-prompt"><\/p>\s*<p id="qz-hint" class="qz-hint hidden"><\/p>\s*<p id="qz-instr"/);
  });
  test('renderQuestion fills it from q.hint and hides when absent', () => {
    assert.match(QUIZ, /const hint = String\(q\.hint \|\| ''\)\.trim\(\)/);
    assert.match(QUIZ, /hintEl\.innerHTML = hint \? '💡 ' \+ fmt\(hint\) : ''/);
    assert.match(QUIZ, /hintEl\.classList\.toggle\('hidden', !hint\)/);
  });
  test('word-count instruction now shows for 1-word answers too', () => {
    // Bank prompts no longer carry "write one word"-style tails; the count on
    // the instruction line is the single remaining source of that info.
    assert.match(QUIZ, /itxt = n >= 1 \? \('Gõ đáp án vào ô trống \(' \+ n \+ ' từ\)\.'\)/);
  });
  test('the review log carries the hint so items keep their context', () => {
    assert.match(QUIZ, /hint: String\(q\.hint \|\| ''\)\.trim\(\) \|\| null/);
    assert.match(QUIZ, /it\.hint \? '<div class="qz-rl-row">💡 ' \+ fmt\(it\.hint\)/);
  });
});
