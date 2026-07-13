// Route-ownership graph (plan §8.2 / ADR-002 — Phase 1 coexistence).
// One canonical URL = one owner. The check itself lives in
// tooling/route-ownership-check.mjs (also runnable standalone / in build).
import { test } from 'node:test';
import assert from 'node:assert';

import { findCollisions } from '../tooling/route-ownership-check.mjs';

test('route-ownership graph has zero collisions', () => {
  const { collisions } = findCollisions();
  assert.deepEqual(collisions, [], collisions.join('\n'));
});

test('the dark-launch probe is an app route and owns no legacy URL', () => {
  const { routes, sources } = findCollisions();
  assert.ok(routes.includes('/next-probe'), 'probe route missing');
  assert.ok(!sources.includes('/next-probe'), 'probe must not appear in legacy config sources');
});

test('legacy clean URLs stay legacy-owned until their atomic cutover', () => {
  const { sources } = findCollisions();
  // Grammar is the designated pilot #2 — its rewrite must exist until the
  // cutover change removes it TOGETHER with adding the app route.
  assert.ok(sources.includes('/grammar/:category/:slug'));
  assert.ok(sources.includes('/home'));
  assert.ok(sources.includes('/speaking'));
});
