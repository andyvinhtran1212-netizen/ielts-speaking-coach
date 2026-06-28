/**
 * frontend/tests/topic-exercise.test.mjs
 *
 * PR2 — practise a topic's vocab stack with auto-generated drills:
 *  • each #vocab-topics card gets a "✍️ Luyện tập" launch → topic-exercise.html?cat=…
 *  • topic-exercise.js loads the topic's cards (PR1 endpoint) and BUILDS MCQs
 *    client-side from the rich fields: def↔word, example/collocation cloze,
 *    synonym/antonym, listen→word — graded client-side, feedback reveals meaning
 *  • the exercise UI is styled + a11y (focus-visible, reduced-motion)
 *
 * Source-string assertions (same approach as vocab-topic-study.test.mjs).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const LANDING  = front('js', 'vocab-landing.js');
const EX_JS    = front('js', 'topic-exercise.js');
const EX_HTML  = front('pages', 'topic-exercise.html');
const VOCAB_CSS = front('css', 'vocabulary.css');

describe('topic cards launch exercises', () => {
  test('each card has a Luyện tập launch to topic-exercise.html?cat=', () => {
    assert.match(LANDING, /vtc-act--ex/);
    assert.match(LANDING, /topic-exercise\.html\?cat=/);
  });
  test('the action is styled (theme-aware)', () => {
    assert.match(VOCAB_CSS, /\.vtc-act--ex/);
  });
});

describe('topic-exercise generates drills from the rich card data', () => {
  test('loads the public category-cards endpoint (PR1)', () => {
    assert.match(EX_JS, /\/api\/vocabulary\/categories\/'\s*\+\s*encodeURIComponent\(_state\.cat\)\s*\+\s*'\/cards/);
  });
  test('builds the full set of question types client-side', () => {
    for (const t of ['def_to_word', 'word_to_def', 'example_cloze', 'colloc_cloze', 'synonym', 'antonym', 'listen']) {
      assert.match(EX_JS, new RegExp(`'${t}'`), `missing question type ${t}`);
    }
    assert.match(EX_JS, /function makeQuestion\(/);
    assert.match(EX_JS, /function buildQuestions\(/);
  });
  test('exploits the fields flashcards/exercises previously ignored', () => {
    assert.match(EX_JS, /synonyms/);
    assert.match(EX_JS, /antonyms/);
    assert.match(EX_JS, /collocations/);
    assert.match(EX_JS, /audio_headword/);   // listen-mode audio
    assert.match(EX_JS, /memory_hook/);       // shown in feedback
  });
  test('grades client-side and reveals meaning in feedback', () => {
    assert.match(EX_JS, /function onAnswer\(/);
    assert.match(EX_JS, /idx === q\.answer/);
    assert.match(EX_JS, /feedback-word/);
    assert.match(EX_JS, /function renderSummary\(/);
  });
  test('distractors come from the same topic (in-domain)', () => {
    assert.match(EX_JS, /function pickWords\(/);
    assert.match(EX_JS, /function pickDefs\(/);
  });
});

describe('topic-exercise page is styled + accessible', () => {
  test('option/feedback styles + reduced-motion + back link', () => {
    assert.match(EX_HTML, /\.option-btn/);
    assert.match(EX_HTML, /\.feedback/);
    assert.match(EX_HTML, /prefers-reduced-motion/);
    assert.match(EX_HTML, /vocabulary\.html#vocab-topics/);   // back to topics
    assert.match(EX_HTML, /topic-exercise\.js/);
  });
});
