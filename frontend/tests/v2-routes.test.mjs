// UIBASE-0056 FR-015: the slim client copy of the v2 route set must give the
// same answer as the registry, which stays the source of truth.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROUTES, isV2Route } from '../lib/route-registry.mjs';
import { V2_ROUTES, isV2Path } from '../lib/v2-routes.mjs';

const registryV2 = ROUTES.filter((entry) => entry.ui === 'v2').map((entry) => entry.route);

test('V2_ROUTES is exactly the registry entries with ui: v2', () => {
  assert.deepEqual([...V2_ROUTES].sort(), [...registryV2].sort());
});

test('a dynamic v2 route uses only plain [param] segments', () => {
  // lib/v2-routes.mjs matches `[x]` as exactly one segment; a catch-all
  // (`[...x]`, `[[...x]]`) needs the registry matcher there first.
  const dynamic = registryV2.filter((route) => route.includes('['));
  for (const route of dynamic) {
    for (const segment of route.slice(1).split('/')) {
      if (segment.includes('[')) assert.match(segment, /^\[[^.[\]]+\]$/, route);
    }
  }
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
  // Dynamic v2 route: one segment only.
  assert.equal(isV2Path('/library/speaking/a-city-part-2'), true);
  assert.equal(isV2Path('/library/speaking/a-city-part-2/'), true);
  assert.equal(isV2Path('/library/speaking/a/b'), false);
});

test('the navigation bridge reads the slim list, not the registry', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../components/chrome-navigation-bridge.tsx', import.meta.url), 'utf8');
  assert.match(source, /from '@\/lib\/v2-routes\.mjs'/);
  assert.doesNotMatch(source, /route-registry/);
});
