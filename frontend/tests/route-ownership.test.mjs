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

test('pilot-2 cutover: grammar is now an app route, its legacy rewrite is GONE', () => {
  const { routes, sources } = findCollisions();
  // Grammar (pilot #2) cut over: the app route owns the canonical URL and the
  // legacy rewrite was removed in the SAME change (atomic — route-ownership
  // check would flag a leftover rewrite as a collision).
  assert.ok(routes.includes('/grammar/[category]/[slug]'), 'grammar canonical is now a Next app route');
  assert.ok(!sources.includes('/grammar/:category/:slug'), 'legacy grammar rewrite must be removed at cutover');
});

test('not-yet-piloted clean URLs stay legacy-owned', () => {
  const { sources } = findCollisions();
  assert.ok(sources.includes('/home'));
  assert.ok(sources.includes('/speaking'));
});
