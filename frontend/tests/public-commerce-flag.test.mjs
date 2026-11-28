// PUBLICSITE-0059 FR-029 — AVER_PUBLIC_COMMERCE has one reader, and every link
// to /courses* is built by coursesHref(), so a flag that is off leaves no link
// to a 404 page.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coursesHref, publicCommerceEnabled } from '../lib/public-commerce.mjs';

test('FR-029: coursesHref follows the build flag, one reader', () => {
  assert.equal(publicCommerceEnabled('1'), true);
  assert.equal(publicCommerceEnabled('0'), false);
  assert.equal(publicCommerceEnabled(undefined), false);
  assert.equal(coursesHref(undefined, { flag: '1' }), '/courses');
  assert.equal(coursesHref('khoa-a', { flag: '1' }), '/courses/khoa-a');
  assert.equal(coursesHref(undefined, { flag: '0' }), null);
  assert.equal(coursesHref(undefined, { flag: undefined, fallback: '/' }), '/');
});

test('the default reads the process flag (what Next inlines at build)', () => {
  const saved = process.env.AVER_PUBLIC_COMMERCE;
  try {
    process.env.AVER_PUBLIC_COMMERCE = '1';
    assert.equal(publicCommerceEnabled(), true);
    assert.equal(coursesHref(), '/courses');
    process.env.AVER_PUBLIC_COMMERCE = '0';
    assert.equal(publicCommerceEnabled(), false);
    assert.equal(coursesHref(undefined, { fallback: '/' }), '/');
  } finally {
    if (saved === undefined) delete process.env.AVER_PUBLIC_COMMERCE; else process.env.AVER_PUBLIC_COMMERCE = saved;
  }
});
