import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flashcardReturnHref } from '../lib/flashcard-study-model.mjs';
test('public topic and exam players return to the originating collection', () => {
  assert.equal(flashcardReturnHref('examlist:awl-sublist-1'), '/vocabulary/exam');
  assert.equal(flashcardReturnHref('wiki:education'), '/vocabulary?cat=education');
  assert.equal(flashcardReturnHref('auto:all_vocab'), '/flashcards');
});
test('return URL is internal and query values are encoded', () => {
  assert.equal(flashcardReturnHref('wiki:education&admin=1'), '/vocabulary?cat=education%26admin%3D1');
  assert.equal(flashcardReturnHref('https://elsewhere.example'), '/flashcards');
});
