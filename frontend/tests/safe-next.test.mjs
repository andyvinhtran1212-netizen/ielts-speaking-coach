import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveLoginNext, sanitizeLearnerNext } from '../lib/safe-next.mjs';

// G02-T15 — "An toàn chuyển hướng": only same-origin learner paths survive.
describe('sanitizeLearnerNext', () => {
  test('keeps a same-origin path with its query and hash', () => {
    assert.equal(sanitizeLearnerNext('/writing/result?id=1'), '/writing/result?id=1');
    assert.equal(sanitizeLearnerNext('/grammar/tenses/present-simple#vi-du'), '/grammar/tenses/present-simple#vi-du');
  });

  for (const raw of [
    '//evil.com', 'https://evil.com', '/\\evil.com', '/\tevil', 'javascript:alert(1)', '',
    'writing/dashboard', '/login', '/login?x=1', '/onboarding?x', '/onboarding/step', '/admin/mfa', '/', null, 42,
  ]) {
    test(`refuses ${JSON.stringify(raw)}`, () => assert.equal(sanitizeLearnerNext(raw), null));
  }
});

describe('resolveLoginNext', () => {
  const origin = 'https://www.averlearning.com';
  test('prefers ?next= over the referrer', () => {
    assert.equal(resolveLoginNext({ search: '?next=%2Freading%2Fvocab', referrer: `${origin}/home`, origin }), '/reading/vocab');
  });
  test('a refused ?next= does not fall back to the referrer', () => {
    assert.equal(resolveLoginNext({ search: '?next=%2F%2Fevil.com', referrer: `${origin}/home`, origin }), null);
  });
  test('uses a same-origin referrer and ignores a foreign one', () => {
    assert.equal(resolveLoginNext({ referrer: `${origin}/writing/dashboard?tab=history`, origin }), '/writing/dashboard?tab=history');
    assert.equal(resolveLoginNext({ referrer: 'https://evil.com/writing/dashboard', origin }), null);
    assert.equal(resolveLoginNext({ referrer: 'not a url', origin }), null);
  });
});
