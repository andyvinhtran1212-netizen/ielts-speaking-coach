/**
 * frontend/tests/vocab-topic-study.test.mjs
 *
 * PR1 — study a topic's vocab stack with flashcards:
 *  • each #vocab-topics card gets a "🃏 Flashcards" launch (+ "Khám phá" browse),
 *    pointing at flashcard-study.html?stack=wiki:<category>
 *  • flashcard-study.js gains a wiki mode: loads the public category-cards
 *    endpoint, renders the rich fields (audio/IPA/collocations/synonyms/memory
 *    hook/common error), and tracks progress in localStorage (no server SRS)
 *  • the rich card + chips + callouts are styled
 *
 * Source-string assertions (same approach as the other vocab tests).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const LANDING = front('js', 'vocab-landing.js');
const STUDY_JS = front('js', 'flashcard-study.js');
const STUDY_HTML = front('pages', 'flashcard-study.html');
const VOCAB_CSS = front('css', 'vocabulary.css');

describe('topic cards launch flashcards for that stack', () => {
  test('each topic card has a Flashcards launch to wiki:<category>', () => {
    assert.match(LANDING, /vtc-act--study/);
    assert.match(LANDING, /flashcard-study\.html\?stack=wiki:/);
    assert.match(LANDING, /Khám phá/);          // browse-wiki action still present
  });
  test('action buttons are styled (theme-aware)', () => {
    assert.match(VOCAB_CSS, /\.vtc-actions/);
    assert.match(VOCAB_CSS, /\.vtc-act--study[\s\S]{0,200}var\(--av-/);
  });
});

describe('flashcard-study wiki mode', () => {
  test('detects wiki: stacks and loads the public category-cards endpoint', () => {
    assert.match(STUDY_JS, /stackId\.indexOf\('wiki:'\)\s*===\s*0/);
    assert.match(STUDY_JS, /\/api\/vocabulary\/categories\/'\s*\+\s*encodeURIComponent\(_state\.category\)\s*\+\s*'\/cards/);
    assert.match(STUDY_JS, /function loadWikiCards\(/);
    assert.match(STUDY_JS, /function renderWikiCard\(/);
  });
  test('surfaces the rich fields (audio + collocations + synonyms + hook + error)', () => {
    assert.match(STUDY_JS, /audio_headword/);
    assert.match(STUDY_JS, /audio_example/);
    assert.match(STUDY_JS, /collocations/);
    assert.match(STUDY_JS, /synonyms/);
    assert.match(STUDY_JS, /antonyms/);
    assert.match(STUDY_JS, /memory_hook/);
    assert.match(STUDY_JS, /common_error/);
    assert.match(STUDY_JS, /function playAudio\(/);   // pronunciation playback
  });
  test('tracks progress in localStorage (no server SRS for wiki cards)', () => {
    assert.match(STUDY_JS, /function markWiki\(/);
    assert.match(STUDY_JS, /localStorage\.(get|set)Item/);
    assert.match(STUDY_JS, /vocabflash:wiki:/);
    // wiki mode never POSTs to the per-user /review SRS endpoint
    assert.match(STUDY_JS, /Đã thuộc/);
    assert.match(STUDY_JS, /Cần ôn/);
  });
  test('rich card is styled (audio button + chips + callouts)', () => {
    assert.match(STUDY_HTML, /\.wiki-audio/);
    assert.match(STUDY_HTML, /\.wiki-chip/);
    assert.match(STUDY_HTML, /\.wiki-callout/);
    assert.match(STUDY_HTML, /prefers-reduced-motion/);   // a11y floor
  });
});
