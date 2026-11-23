// UIBASE-0056 FR-015: the slim client copy of the v2 route set must give the
// same answer as the registry, which stays the source of truth.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROUTES, isV2Route } from '../lib/route-registry.mjs';
import { V2_DYNAMIC_ROUTES, V2_ROUTES, isV2Path } from '../lib/v2-routes.mjs';

const registryV2 = ROUTES.filter((entry) => entry.ui === 'v2').map((entry) => entry.route);

test('V2_ROUTES + V2_DYNAMIC_ROUTES are exactly the registry entries with ui: v2', () => {
  assert.deepEqual([...V2_ROUTES].sort(), registryV2.filter((route) => !route.includes('[')).sort());
  assert.deepEqual([...V2_DYNAMIC_ROUTES].sort(), registryV2.filter((route) => route.includes('[')).sort());
});

test('a dynamic v2 route uses only one-segment params, the only kind isV2Path matches', () => {
  // Catch-all or optional segments need the registry matcher; extend
  // lib/v2-routes.mjs before adding one.
  for (const route of V2_DYNAMIC_ROUTES) assert.doesNotMatch(route, /\[\[|\[\.\.\./, route);
  assert.equal(isV2Path('/courses/khoa-a'), isV2Route('/courses/khoa-a'));
  assert.equal(isV2Path('/courses/khoa-a/enroll'), isV2Route('/courses/khoa-a/enroll'));
});

test('isV2Path agrees with isV2Route on every registry route and its variants', () => {
  for (const { route } of ROUTES) {
    const sample = route.replace(/\[\[?\.{0,3}([^\]]+)\]\]?/g, 'x');
    for (const path of [sample, `${sample}/`, `${sample}?a=1`, `${sample}#h`]) {
      assert.equal(isV2Path(path), isV2Route(path), path);
    }
  }
  assert.equal(isV2Path('/ui-library/'), true);
  assert.equal(isV2Path('/profile'), false);
  assert.equal(isV2Path('/profile/v2-pilot/extra'), false);
  assert.equal(isV2Path(''), false);
});

test('the navigation bridge reads the slim list, not the registry', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../components/chrome-navigation-bridge.tsx', import.meta.url), 'utf8');
  assert.match(source, /from '@\/lib\/v2-routes\.mjs'/);
  assert.doesNotMatch(source, /route-registry/);
});
