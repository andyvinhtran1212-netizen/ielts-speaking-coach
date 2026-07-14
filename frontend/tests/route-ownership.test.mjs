// Route-ownership graph (plan §8.2 / ADR-002 — Phase 1 coexistence).
// One canonical URL = one owner. The check itself lives in
// tooling/route-ownership-check.mjs (also runnable standalone / in build).
import { test } from 'node:test';
import assert from 'node:assert';

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findCollisions, findManifestProblems, samePath } from '../tooling/route-ownership-check.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

// ── AUDIT F7 (2026-07-14) ───────────────────────────────────────────────

test('catch-all patterns collide across segment counts (old equal-length check was blind to them)', () => {
  // A Next catch-all owns URLs of ANY depth — a legacy source with a
  // different segment count must still register as a collision.
  assert.ok(samePath('/grammar/[...slug]', '/grammar/:category/:slug'));
  assert.ok(samePath('/docs/:path*', '/docs/a/b/c'));
  assert.ok(samePath('/docs/[[...slug]]', '/docs'), 'optional catch-all matches zero segments');
  assert.ok(!samePath('/docs/[...slug]', '/docs'), 'required catch-all needs ≥1 segment');
  assert.ok(!samePath('/grammar/[...slug]', '/vocab/a/b'), 'literal prefix still must match');
  // The pre-F7 behaviour (equal length, dyn matches dyn) must be preserved.
  assert.ok(samePath('/grammar-preview/[category]/[slug]', '/grammar-preview/:c/:s'));
  assert.ok(!samePath('/a/b', '/a'));
});

test('manifest-based check: compiled truth matches the source heuristic (when a build exists)', (t) => {
  // The artifact that routes production traffic is .next/routes-manifest.json
  // (AUDIT F7). Local runs without a build skip; CI runs this after
  // `next build` via `route-ownership-check.mjs --manifest`.
  const manifestPath = path.join(FRONTEND, '.next', 'routes-manifest.json');
  if (!existsSync(manifestPath)) {
    t.skip('no .next build present — CI covers this via the route-manifest workflow');
    return;
  }
  const { compiled, problems } = findManifestProblems(manifestPath);
  assert.ok(compiled.length >= 1, 'manifest must list app routes');
  assert.deepEqual(problems, [], problems.join('\n'));
});
