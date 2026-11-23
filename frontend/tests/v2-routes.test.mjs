// UIBASE-0056 FR-015: the slim client copy of the v2 route set must give the
// same answer as the registry, which stays the source of truth.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROUTES, isV2Route } from '../lib/route-registry.mjs';
import { V2_DYNAMIC, V2_ROUTES, isV2Path } from '../lib/v2-routes.mjs';

const registryV2 = ROUTES.filter((entry) => entry.ui === 'v2').map((entry) => entry.route);

test('V2_ROUTES plus V2_DYNAMIC is exactly the registry entries with ui: v2', () => {
  const slim = [...V2_ROUTES, ...V2_DYNAMIC.map((d) => d.route)];
  assert.deepEqual(slim.sort(), [...registryV2].sort());
});

test('V2_ROUTES stays static; each dynamic v2 route has a segment-exact matcher', () => {
  // The Set lookup is only right for static routes. A dynamic one carries its
  // own matcher, which must take one value per segment and nothing deeper.
  assert.deepEqual(V2_ROUTES.filter((route) => route.includes('[')), []);
  for (const { route, regex } of V2_DYNAMIC) {
    assert.ok(route.includes('['), `${route} is static: put it in V2_ROUTES`);
    const sample = route.replace(/\[[^\]]+\]/g, 'x');
    assert.equal(regex.test(sample), true, sample);
    assert.equal(regex.test(`${sample}/y`), false, `${sample}/y`);
    assert.equal(regex.test(sample.replace(/\/x$/, '')), false, `${route} parent`);
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
  assert.equal(isV2Path('/enroll/AVER-ABC234'), true);
  assert.equal(isV2Path('/enroll'), false);
  assert.equal(isV2Path('/enroll/AVER-ABC234/x'), false);
});

test('the navigation bridge reads the slim list, not the registry', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../components/chrome-navigation-bridge.tsx', import.meta.url), 'utf8');
  assert.match(source, /from '@\/lib\/v2-routes\.mjs'/);
  assert.doesNotMatch(source, /route-registry/);
});
