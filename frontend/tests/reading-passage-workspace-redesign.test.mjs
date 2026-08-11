import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const css = read('frontend/public/css/reading-vocab.css');
const questions = read('frontend/public/js/components/reading-questions.js');
const pages = [
  ['vocab', read('frontend/public/pages/reading-vocab-passage.html'), read('frontend/public/js/reading-vocab-passage.js')],
  ['skill', read('frontend/public/pages/reading-skill-exercise.html'), read('frontend/public/js/reading-skill-exercise.js')],
];

describe('Reading passage workspace redesign', () => {
  test('both detail pages expose the same orientation, metadata, reader, and question surfaces', () => {
    for (const [name, html] of pages) {
      for (const hook of ['rv-detail__header', 'rv-detail__facts', 'rv-difficulty',
        'rv-estimated-time', 'rv-word-count', 'rv-topic-tags', 'rv-reader', 'rv-questions']) {
        assert.match(html, new RegExp(`(?:class|id)="[^"]*${hook}`), `${name}: missing ${hook}`);
      }
      assert.doesNotMatch(html, /style="color:\s*var\(--av-text-secondary\)/,
        `${name}: back-link appearance belongs in shared CSS`);
    }
  });

  test('detail controllers render only canonical response metadata with DOM-safe APIs', () => {
    for (const [name, , js] of pages) {
      for (const field of ['difficulty_level', 'estimated_minutes', 'word_count', 'topic_tags']) {
        assert.match(js, new RegExp(`p\\.${field}`), `${name}: canonical ${field} is not rendered`);
      }
      assert.match(js, /topics\.replaceChildren\(\)/);
      assert.match(js, /tag\.textContent\s*=\s*topic/);
      assert.doesNotMatch(js, /topic_tags[\s\S]{0,250}innerHTML/);
    }
  });

  test('question rail has a semantic progress header without changing the check endpoint', () => {
    assert.match(questions, /rq-head/);
    assert.match(questions, /rq-description/);
    assert.match(questions, /aria-live/);
    assert.match(questions, /'\/api\/reading\/' \+ session\.library/);
    assert.match(questions, /window\.AverFeedback\.attachCardFlag/);
  });

  test('a passage without questions expands the reader instead of leaving a blank rail', () => {
    assert.match(questions, /host\.hidden\s*=\s*!questions\.length/);
    assert.match(questions, /rv-passage-layout--reading-only/);
    assert.match(css, /\.rv-passage-layout--reading-only\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  test('workspace is split-scroll on desktop and normal document flow on mobile', () => {
    assert.match(css, /\.rv-detail\s*\{[\s\S]{0,180}height:\s*calc\(100dvh/);
    assert.match(css, /\.rv-reader,[\s\S]{0,220}overflow-y:\s*auto/);
    assert.match(css, /@media \(max-width: 860px\)[\s\S]{0,420}\.rv-detail \{[^}]*height:\s*auto/);
    assert.match(css, /@media \(max-width: 860px\)[\s\S]{0,700}overflow-y:\s*visible/);
  });

  test('interactive reading controls retain visible keyboard focus', () => {
    for (const selector of ['rv-back', 'rv-panes__btn', 'rq-option', 'rq-input', 'rq-check']) {
      assert.match(css, new RegExp(`\\.${selector}(?::focus-visible|:focus-within)[^{]*\\{[^}]*outline`),
        `missing keyboard focus treatment for ${selector}`);
    }
  });
});
