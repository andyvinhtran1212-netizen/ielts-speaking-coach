// U-03 — which App Router routes are signed-out-guarded, public by design, or
// engineering-only (debug-gated).
//
// WHY: auth is client-only (ADR-003, no middleware), so a private page is only
// private if its own component sends signed-out visitors to /login. Staging
// served `/course-exercises`, `/grammar-checkup`, `/advanced-vocabulary`,
// `/vocabulary/exam` shells to anyone, and `/next-probe` / `/recorder-spike`
// (commit SHA + env, an unauthenticated recorder) because their gate only
// looked at VERCEL_ENV=production / branch main. This file pins the three
// classes so a later edit has to change the inventory on purpose.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnosticRoutesEnabled } from '../lib/diagnostic-routes.mjs';
import { appPageRoute, NON_PRODUCT_APP_PAGE_ROUTES } from '../tooling/app-route-inventory.mjs';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(FRONTEND, 'app');
const read = (rel) => readFileSync(path.join(FRONTEND, rel), 'utf8');
// Source without `//` comments, so explanatory notes don't count as usage.
const code = (rel) => read(rel).replace(/(^|\s)\/\/.*$/gm, '$1');

// Route → the client component that owns the signed-out redirect.
const GUARDED = Object.freeze({
  '/course-exercises': 'app/(authed)/course-exercises/course-behavior.tsx',
  '/grammar-checkup': 'app/(authed)/grammar-checkup/grammar-checkup.tsx',
  '/grammar-checkup/review/[routeId]': 'app/(authed)/grammar-checkup/review/[routeId]/review-route.tsx',
  '/advanced-vocabulary': 'app/(authed-advanced-vocab)/advanced-vocabulary/advanced-vocabulary-lesson.tsx',
  '/vocabulary/exam': 'app/(authed-vocab-exam)/vocabulary/exam/vocab-exam-behavior.tsx',
});

// Reachable signed-out on purpose. `/reading/review` (anonymous capability) and
// `/flashcard-study` (public stacks) are hybrid; `/grammar/roadmap` is public
// with `?slug` and only its personal view (no slug) redirects — see below.
const PUBLIC_BY_DESIGN = Object.freeze([
  '/',
  '/pricing',
  '/login',
  '/grammar',
  '/grammar/[category]/[slug]',
  '/grammar/compare',
  '/grammar/exercises',
  '/grammar/roadmap',
  '/grammar/search',
  '/vocabulary',
  '/flashcard-study',
  '/reading/review',
  '/core-player/launch',
]);

const DEBUG_GATED = Object.freeze({
  '/next-probe': 'app/next-probe/page.tsx',
  '/recorder-spike': 'app/(spike)/recorder-spike/page.tsx',
});

const SIGNED_OUT_GUARD = /useEffect\(\(\) => \{\s*if \(status === 'signed-out'\) window\.location\.replace\('\/login'\);\s*\}, \[status\]\);/;
const UNCONDITIONAL_GUARD = /if \(status === 'signed-out'\)/;

/** route → files (page.tsx/page.ts/route.ts) relative to frontend/. */
function routeInventory() {
  const routes = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const rel = path.relative(APP, full).replaceAll('\\', '/');
      const route = entry.name === 'route.ts'
        ? appPageRoute(rel.replace(/route\.ts$/, 'page.ts'))
        : appPageRoute(rel);
      if (!route) continue;
      routes.set(route, [...(routes.get(route) || []), `app/${rel}`]);
    }
  };
  walk(APP);
  return routes;
}

const ROUTES = routeInventory();
const dirOf = (route) => path.dirname(ROUTES.get(route)[0]);
const siblings = (route) => readdirSync(path.join(FRONTEND, dirOf(route)), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(tsx|ts|mjs)$/.test(entry.name))
  .map((entry) => `${dirOf(route)}/${entry.name}`);

describe('route auth-guard inventory (U-03)', () => {
  test('every classified route exists and belongs to exactly one class', () => {
    assert.ok(ROUTES.size >= 50, `only ${ROUTES.size} routes discovered — walker broken?`);
    const all = [...Object.keys(GUARDED), ...PUBLIC_BY_DESIGN, ...Object.keys(DEBUG_GATED)];
    assert.equal(new Set(all).size, all.length, 'a route is listed in two classes');
    for (const route of all) assert.ok(ROUTES.has(route), `${route} is not an App Router route`);
  });

  test('every Grammar Wiki route is classified (new /grammar/* pages need a decision)', () => {
    const grammar = [...ROUTES.keys()].filter((route) => route === '/grammar' || route.startsWith('/grammar/'));
    assert.deepEqual(grammar.filter((route) => !PUBLIC_BY_DESIGN.includes(route)), []);
  });

  for (const [route, guardFile] of Object.entries(GUARDED)) {
    test(`${route} sends signed-out visitors to /login`, () => {
      assert.equal(path.dirname(guardFile), dirOf(route), 'guard must live with the route page');
      const source = read(guardFile);
      assert.match(source, /^'use client';/);
      assert.match(source, /import \{ useAuth \} from '@\/lib\/auth\/auth-provider';/);
      assert.match(source, /const \{ status(?:, user)? \} = useAuth\(\);/);
      assert.match(source, SIGNED_OUT_GUARD);
      // The guard component must actually be mounted by the route.
      const module = `./${path.basename(guardFile, '.tsx')}'`;
      assert.ok(siblings(route).some((file) => file !== guardFile && read(file).includes(module)),
        `${guardFile} is not imported by its route`);
    });

    test(`${route} renders under the AuthProvider shell`, () => {
      const group = ROUTES.get(route)[0].split('/')[1];
      const layout = read(`app/${group}/layout.tsx`);
      assert.match(layout, /<AuthedShell\b/);
      assert.doesNotMatch(layout, /authGated=\{false\}/);
    });
  }

  test('public-by-design routes carry no page-wide signed-out redirect', () => {
    for (const route of PUBLIC_BY_DESIGN) {
      if (route === '/grammar/roadmap') continue; // asserted separately below
      for (const file of siblings(route)) {
        assert.doesNotMatch(read(file), UNCONDITIONAL_GUARD, `${file} would lock ${route} for guests`);
      }
    }
  });

  test('/grammar/roadmap stays public with ?slug; only the personal view redirects', () => {
    const page = read('app/(public-content)/grammar/roadmap/page.tsx');
    assert.match(page, /if \(!slug\) return <PersonalRoadmap \/>;/);
    assert.doesNotMatch(page, UNCONDITIONAL_GUARD);
  });

  for (const [route, file] of Object.entries(DEBUG_GATED)) {
    test(`${route} is not-found unless dev or explicitly enabled`, () => {
      const source = read(file);
      assert.match(source, /import \{ diagnosticRoutesEnabled \} from '@\/lib\/diagnostic-routes\.mjs';/);
      assert.match(source, /if \(!diagnosticRoutesEnabled\(\)\) notFound\(\);/);
      assert.doesNotMatch(source, /VERCEL_ENV === 'production'|VERCEL_GIT_COMMIT_REF/,
        'the old production-only gate left staging/preview open');
      // Static on purpose: the gate is evaluated at prerender with the
      // deployment's build env, so a disabled build ships a real 404. A
      // request-time read here streams behind the root Suspense shell under
      // Cache Components and notFound() degrades to a 200 soft-404.
      assert.doesNotMatch(code(file), /connection\(|headers\(|cookies\(|export const instant|^'use client'/m);
    });
  }

  test('the non-product route list is exactly the debug-gated set', () => {
    assert.deepEqual([...NON_PRODUCT_APP_PAGE_ROUTES].sort(), Object.keys(DEBUG_GATED).sort());
  });

  test('diagnostic gate opens only for `next dev` or AVER_ENABLE_DIAGNOSTIC_ROUTES=1', () => {
    assert.equal(diagnosticRoutesEnabled({}), false);
    assert.equal(diagnosticRoutesEnabled({ NODE_ENV: 'production' }), false);
    assert.equal(diagnosticRoutesEnabled({ NODE_ENV: 'test' }), false);
    assert.equal(diagnosticRoutesEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }), false);
    assert.equal(diagnosticRoutesEnabled({ AVER_ENABLE_DIAGNOSTIC_ROUTES: 'true' }), false);
    assert.equal(diagnosticRoutesEnabled({ AVER_ENABLE_DIAGNOSTIC_ROUTES: '0' }), false);
    assert.equal(diagnosticRoutesEnabled({ NODE_ENV: 'development' }), true);
    assert.equal(diagnosticRoutesEnabled({ NODE_ENV: 'production', AVER_ENABLE_DIAGNOSTIC_ROUTES: '1' }), true);
  });

  test('no built-server or staging journey navigates to a debug route', () => {
    // These suites run against `next start` builds or the deployed staging
    // site, where both routes are 404 now. Only the staging ownership spec may
    // name them, to assert that 404. The spike suite runs `next dev`.
    const scanned = [
      ...readdirSync(path.join(FRONTEND, 'tests/staging-e2e')).map((name) => `tests/staging-e2e/${name}`),
      ...readdirSync(path.join(FRONTEND, 'tests/speaking-regression')).map((name) => `tests/speaking-regression/${name}`),
      ...readdirSync(path.join(FRONTEND, 'tooling')).filter((name) => /^verify-.*\.mjs$/.test(name)).map((name) => `tooling/${name}`),
      ...readdirSync(FRONTEND).filter((name) => /^playwright\..*\.js$/.test(name) && name !== 'playwright.spike.config.js'),
    ].filter((rel) => /\.(m?js)$/.test(rel) && existsSync(path.join(FRONTEND, rel)));
    assert.ok(scanned.length >= 10, `only ${scanned.length} journey files scanned`);
    const offenders = scanned.filter((rel) => {
      const source = code(rel);
      if (!/\/next-probe|\/recorder-spike/.test(source)) return false;
      if (rel !== 'tests/staging-e2e/legacy-alias-redirect.spec.js') return true;
      return /goto\('\/(?:next-probe|recorder-spike)'|assign\('\/(?:next-probe|recorder-spike)'/.test(source);
    });
    assert.deepEqual(offenders, []);
    assert.match(read('tests/staging-e2e/legacy-alias-redirect.spec.js'),
      /for \(const route of \['\/next-probe', '\/recorder-spike'\]\)[\s\S]*?toBe\(404\)/);
    assert.match(read('playwright.spike.config.js'), /command: 'npm run dev'/);
  });
});
