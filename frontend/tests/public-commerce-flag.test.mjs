// PUBLICSITE-0059 FR-029 — AVER_PUBLIC_COMMERCE has one reader, and every link
// to /courses* is built by coursesHref(), so a flag that is off leaves no link
// to a 404 page.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coursesHref, publicCommerceEnabled } from '../lib/public-commerce.mjs';

test('FR-029: coursesHref follows the build flag, one reader', () => {
  const on = { AVER_PUBLIC_COMMERCE: '1' };
  const off = { AVER_PUBLIC_COMMERCE: '0' };
  assert.equal(publicCommerceEnabled(on), true);
  assert.equal(publicCommerceEnabled({}), false);
  assert.equal(coursesHref(undefined, { env: on }), '/courses');
  assert.equal(coursesHref('khoa-a', { env: on }), '/courses/khoa-a');
  assert.equal(coursesHref(undefined, { env: off }), null);
  assert.equal(coursesHref(undefined, { env: off, fallback: '/' }), '/');
});
