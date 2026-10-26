import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingSkillContext, readingSkillArticleHref, readingSkillReturnHref } from '../lib/reading-skill-context.mjs';
import { normalizeReadingReview } from '../lib/reading-review-model.mjs';
test('Skill returns the bounded search, filters and all loaded batches', () => {
  const context = { difficulty: 'advanced', skill: 'detail', q: 'Battery', batches: 3 };
  const article = new URL(readingSkillArticleHref('battery', context), 'https://example.test');
  assert.deepEqual(readingSkillContext(article.searchParams), context);
  assert.equal(readingSkillReturnHref(article.searchParams), '/reading/skill?difficulty=advanced&skill=detail&q=Battery&batches=3');
  assert.deepEqual(readingSkillContext(new URLSearchParams('difficulty=x&skill=evil&q=x&q=y&batches=1000')), { difficulty: '', skill: '', q: '', batches: 1 });
});
test('practice review is driven by canonical type; a forged Mini origin cannot enable it', () => {
  const fixture = { status: 'submitted', score: 0, max_score: 0, passages: [], review: [], from: 'mini' };
  assert.equal(normalizeReadingReview(fixture).practiceReview, false);
  assert.equal(normalizeReadingReview({ ...fixture, test_type: 'full' }).practiceReview, false);
  assert.equal(normalizeReadingReview({ ...fixture, test_type: 'mini' }).practiceReview, true);
  assert.throws(() => normalizeReadingReview({ ...fixture, status: 'in_progress', test_type: 'mini' }));
});
