/**
 * frontend/tests/route-registry.test.mjs — page catalogue contract
 * (UIBASE-0056 FR-012, G03-T11; the six checks of plan 5.6).
 *
 * Imports lib/route-registry.mjs and compares it with the real app/ tree.
 * A new page.tsx without an entry, an entry whose file is gone, an orphan
 * nav/child entry, or a required parameter without a fallback parent fails.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appPageRoute } from '../tooling/app-route-inventory.mjs';
import { ROUTES, LEARNER_SECTIONS, routeFor, sectionFor, isV2Route } from '../lib/route-registry.mjs';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(FRONTEND, 'app');

function pageFiles(dir = APP, rel = '') {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...pageFiles(path.join(dir, ent.name), childRel));
    else if (/^page\.(tsx|ts)$/.test(ent.name)) out.push(childRel);
  }
  return out;
}

const appRoutes = new Map();
for (const file of pageFiles()) {
  const route = appPageRoute(file);
  if (route) appRoutes.set(route, `app/${file}`);
}
const byRoute = new Map(ROUTES.map((e) => [e.route, e]));

describe('route registry (FR-012)', () => {
  test('one entry per route, no duplicates', () => {
    assert.equal(byRoute.size, ROUTES.length, 'a route is listed twice');
  });

  test('1. routes from app/ = entries that are not planned', () => {
    const registered = new Set(ROUTES.filter((e) => e.status !== 'planned').map((e) => e.route));
    const missing = [...appRoutes.keys()].filter((r) => !registered.has(r)).sort();
    const extra = [...registered].filter((r) => !appRoutes.has(r)).sort();
    assert.deepEqual(missing, [], `pages without a registry entry (add them to lib/route-registry.mjs): ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `registry entries without a page: ${extra.join(', ')}`);
  });

  test('2. every owner exists and matches the page; planned entries have no file', () => {
    for (const e of ROUTES) {
      if (e.status === 'planned') {
        assert.equal(e.owner, null, `${e.route}: planned entries have owner null`);
        assert.ok(!appRoutes.has(e.route), `${e.route} is planned but a page exists — mark it live`);
      } else {
        assert.ok(e.owner && existsSync(path.join(FRONTEND, e.owner)), `${e.route}: owner ${e.owner} missing`);
        assert.equal(e.owner, appRoutes.get(e.route), `${e.route}: owner should be ${appRoutes.get(e.route)}`);
      }
    }
  });

  test('3. every nav/child entry reaches a nav entry through parent in ≤6 steps', () => {
    for (const e of ROUTES.filter((x) => x.kind === 'nav' || x.kind === 'child')) {
      let cur = e;
      const seen = new Set();
      let steps = 0;
      while (cur.kind !== 'nav') {
        assert.ok(cur.parent, `${e.route}: ${cur.route} has no parent (orphan)`);
        assert.ok(!seen.has(cur.route), `${e.route}: parent loop at ${cur.route}`);
        seen.add(cur.route);
        const next = byRoute.get(cur.parent);
        assert.ok(next, `${e.route}: parent ${cur.parent} is not in the registry`);
        cur = next;
        steps += 1;
        assert.ok(steps <= 6, `${e.route}: more than 6 steps to a nav entry`);
      }
    }
  });

  test('3b. every parent named anywhere is a registry entry', () => {
    const bad = ROUTES.filter((e) => e.parent && !byRoute.has(e.parent)).map((e) => `${e.route} → ${e.parent}`);
    assert.deepEqual(bad, []);
  });

  test('4. entries with requires have parentOnMissing → a live entry without requires', () => {
    for (const e of ROUTES.filter((x) => x.requires.length > 0)) {
      assert.ok(e.parentOnMissing, `${e.route}: requires ${e.requires.join(',')} but no parentOnMissing`);
      const target = byRoute.get(e.parentOnMissing);
      assert.ok(target, `${e.route}: parentOnMissing ${e.parentOnMissing} not in registry`);
      assert.equal(target.status, 'live', `${e.route}: parentOnMissing ${target.route} is not live`);
      assert.deepEqual([...target.requires], [], `${e.route}: parentOnMissing ${target.route} needs parameters itself`);
    }
    for (const e of ROUTES.filter((x) => x.requires.length === 0)) {
      assert.equal(e.parentOnMissing, null, `${e.route}: parentOnMissing without requires`);
    }
  });

  test('5. learner sections are the five shell items or account', () => {
    const allowed = new Set([...LEARNER_SECTIONS, 'account']);
    const bad = ROUTES.filter((e) => e.audience === 'learner' && !allowed.has(e.section)).map((e) => `${e.route}: ${e.section}`);
    assert.deepEqual(bad, []);
    for (const s of LEARNER_SECTIONS) {
      assert.ok(ROUTES.some((e) => e.section === s && e.kind === 'nav'), `section ${s} has no nav entry`);
    }
  });

  test('6. isV2Route matches exactly the ui: v2 set', () => {
    for (const e of ROUTES) {
      const sample = e.route.replace(/\[\[?\.{0,3}([^\]]+)\]\]?/g, 'sample-$1');
      assert.equal(isV2Route(sample), e.ui === 'v2', `${e.route} (${sample})`);
    }
  });

  test('field values stay inside their enums', () => {
    const enums = {
      status: ['live', 'planned', 'redirect'],
      audience: ['public', 'learner', 'instructor', 'admin', 'diagnostic'],
      kind: ['nav', 'child', 'deep-link-only', 'focus', 'redirect', 'diagnostic'],
      ui: ['v1', 'v2'],
    };
    for (const e of ROUTES) {
      for (const [field, values] of Object.entries(enums)) {
        assert.ok(values.includes(e[field]), `${e.route}: ${field}=${e[field]}`);
      }
      if (e.audience === 'admin') assert.match(e.section, /^admin:[a-z-]+$/, `${e.route}: admin section`);
      if (e.audience === 'diagnostic') assert.equal(e.kind, 'diagnostic', `${e.route}: diagnostic kind`);
    }
  });
});

describe('routeFor / sectionFor', () => {
  test('dynamic segments match concrete paths', () => {
    assert.equal(routeFor('/grammar/tenses/present-simple')?.route, '/grammar/[category]/[slug]');
    assert.equal(routeFor('/admin/vocab/sets/abc-123')?.route, '/admin/vocab/sets/[setId]');
    assert.equal(routeFor('/listening/exercise-book/attempts/a1/review')?.route, '/listening/exercise-book/attempts/[attemptId]/review');
  });

  test('static entries win over dynamic ones; query, hash and trailing slash are ignored', () => {
    assert.equal(routeFor('/grammar/compare?slug=x')?.route, '/grammar/compare');
    assert.equal(routeFor('/listening/ielts/80-days')?.route, '/listening/ielts/80-days');
    assert.equal(routeFor('/home/#top')?.route, '/home');
  });

  test('/practice (planned hub) and /practice/session (Speaking player) stay distinct', () => {
    assert.equal(routeFor('/practice')?.status, 'planned');
    assert.equal(routeFor('/practice/session')?.kind, 'focus');
    assert.equal(sectionFor('/practice/session'), 'practice');
  });

  test('unknown paths have no entry', () => {
    assert.equal(routeFor('/zz-not-a-page'), null);
    assert.equal(sectionFor('/zz-not-a-page'), null);
    assert.equal(isV2Route('/zz-not-a-page'), false);
  });
});
