import test from 'node:test';
import assert from 'node:assert/strict';
import { grammarArticleHref, grammarMode, grammarModeHref, grammarReturnHref, grammarSource } from '../lib/grammar-navigation-context.mjs';

test('Grammar mode accepts its actual enum and rejects invalid or duplicate query values', () => {
  assert.equal(grammarMode(new URLSearchParams('mode=learning')), 'learning');
  assert.equal(grammarMode({ mode: 'reference' }), 'reference');
  for (const raw of [undefined, null, { mode: ['learning'] }, { mode: 'roadmap' }, new URLSearchParams('mode=learning&mode=reference')]) {
    assert.equal(grammarMode(raw), 'reference');
    assert.equal(grammarModeHref(raw), '/grammar');
  }
  assert.equal(grammarModeHref({ mode: 'learning', return: 'https://example.invalid' }), '/grammar?mode=learning');
});

test('Only an explicit single learning origin grants the fixed learning return link', () => {
  assert.equal(grammarReturnHref(new URLSearchParams('from=learning')), '/grammar?mode=learning');
  assert.equal(grammarSource({ from: 'learning' }), 'learning');
  for (const raw of [{ from: ['learning'] }, { from: '//example.invalid' }, new URLSearchParams('from=learning&from=learning'), new URLSearchParams('return=https://example.invalid')]) {
    assert.equal(grammarSource(raw), '');
    assert.equal(grammarReturnHref(raw), null);
  }
});

test('Article reading chains encode identity and carry only the allowlisted origin', () => {
  assert.equal(grammarArticleHref('parts of speech', 'noun?from=other', 'learning'), '/grammar/parts%20of%20speech/noun%3Ffrom%3Dother?from=learning');
  assert.equal(grammarArticleHref('tenses', 'present-simple'), '/grammar/tenses/present-simple');
  assert.equal(grammarArticleHref('tenses', 'present-simple', 'https://example.invalid'), '/grammar/tenses/present-simple');
});
