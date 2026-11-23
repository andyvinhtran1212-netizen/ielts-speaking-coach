// LIBRARY-0061 FR-062 (G06-T17, Writing part): Library lists and published
// Writing sample pages in the sitemap, each only once its page is live;
// robots allows /library. FR-062 is partial: Speaking prompt pages (T013)
// and Writing guide articles (T011) have no public index endpoint yet.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { buildPublicSitemap, LIBRARY_PUBLIC_PATHS, LIBRARY_SAMPLE_INDEX_PATH, writingSamplePagesLive } from '../lib/public-sitemap-model.mjs';
import { ROUTES, routeFor } from '../lib/route-registry.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) => readFileSync(path.join(FRONTEND, ...segments), 'utf8');
const ORIGIN = 'https://www.averlearning.com';
const urls = (entries) => entries.map(({ url }) => url);
const allLive = () => true;

test('Library lists join only when live; with the real registry, /library is in and pending lists are out', () => {
  const real = urls(buildPublicSitemap(null));
  assert.ok(real.includes(`${ORIGIN}/library`));
  const all = urls(buildPublicSitemap(null, { isLive: allLive }));
  for (const { path: p } of LIBRARY_PUBLIC_PATHS) assert.ok(all.includes(`${ORIGIN}${p}`), p);
  const none = urls(buildPublicSitemap(null, { isLive: () => false }));
  assert.ok(!none.some((u) => u.includes('/library')));
});

test('every published Writing set gets its page URL with updated_at; bad rows and duplicates are skipped', () => {
  const entries = buildPublicSitemap(null, {
    isLive: allLive,
    writingSamples: [
      { slug: 'working-from-home', updated_at: '2026-11-21T03:00:00+00:00' },
      { slug: 'bike-lanes', updated_at: null },
      { slug: 'working-from-home', updated_at: '2026-11-22T00:00:00Z' },
      { slug: 'nested/bad' },
      { slug: '' },
      null,
    ],
  });
  const samples = entries.filter(({ url }) => url.startsWith(`${ORIGIN}/library/writing-samples/`));
  assert.deepEqual(urls(samples), [
    `${ORIGIN}/library/writing-samples/working-from-home`,
    `${ORIGIN}/library/writing-samples/bike-lanes`,
  ]);
  assert.equal(samples[0].lastModified.toISOString(), '2026-11-21T03:00:00.000Z');
  assert.equal('lastModified' in samples[1], false);
});

test('no sample URL while the sample page is not live, or when the index could not be read', () => {
  const rows = [{ slug: 'working-from-home', updated_at: '2026-11-21T03:00:00Z' }];
  const pageOff = buildPublicSitemap(null, { writingSamples: rows, isLive: (p) => !p.startsWith('/library/writing-samples/') });
  assert.ok(!urls(pageOff).some((u) => u.includes('/library/writing-samples/')));
  for (const unreadable of [null, { detail: 'library_unavailable' }]) {
    const entries = buildPublicSitemap(null, { writingSamples: unreadable, isLive: allLive });
    assert.ok(!urls(entries).some((u) => u.includes('/library/writing-samples/')));
  }
});

test('sitemap route reads the index through the cached public reader and skips it on failure; robots allows /library', () => {
  const sitemap = read('app', 'sitemap.ts');
  assert.equal(LIBRARY_SAMPLE_INDEX_PATH, '/api/library/writing-samples/index');
  assert.match(sitemap, /getPublicJson\(LIBRARY_SAMPLE_INDEX_PATH\)/);
  assert.match(sitemap, /catch \{\s*return null;\s*\}/);
  assert.match(read('app', 'robots.ts'), /allow: \[[^\]]*'\/library'/);
});

test('real registry: sample URLs follow the [slug] entry #2496 adds, and none without it', () => {
  // The sample page route and its registry entry ship with T010 (#2496). Until
  // then routeFor() finds nothing and the gate is closed; once merged, the gate
  // is exactly that entry's status. No planned entry here: a dynamic v2 entry
  // needs the v2-routes change #2496 makes.
  const entry = routeFor('/library/writing-samples/working-from-home');
  assert.ok(entry === null || entry.route === '/library/writing-samples/[slug]', String(entry?.route));
  assert.equal(writingSamplePagesLive(), entry?.status === 'live');
  const rows = [{ slug: 'working-from-home', updated_at: '2026-11-21T03:00:00Z' }];
  const real = urls(buildPublicSitemap(null, { writingSamples: rows }));
  assert.equal(real.includes(`${ORIGIN}/library/writing-samples/working-from-home`), entry?.status === 'live');
});

test('with the #2496 [slug] entry added live to a registry copy, the gate lists the sample URL', () => {
  const sampleEntry = { route: '/library/writing-samples/[slug]', status: 'live' };
  const lookup = (p) => (/^\/library\/writing-samples\/[^/]+$/.test(p) ? sampleEntry : ROUTES.find((e) => e.route === p) ?? null);
  const isLive = (p) => lookup(p)?.status === 'live';
  assert.equal(writingSamplePagesLive(isLive), true);
  const rows = [{ slug: 'working-from-home', updated_at: '2026-11-21T03:00:00Z' }];
  assert.ok(urls(buildPublicSitemap(null, { writingSamples: rows, isLive })).includes(`${ORIGIN}/library/writing-samples/working-from-home`));
  assert.equal(writingSamplePagesLive((p) => (lookup(p) === sampleEntry ? false : isLive(p))), false);
});

test('sitemap route does not call the index while the sample page is not live', () => {
  const sitemap = read('app', 'sitemap.ts');
  const guard = sitemap.indexOf('if (!writingSamplePagesLive()) return null;');
  assert.ok(guard > 0, 'guard present');
  assert.ok(guard < sitemap.indexOf('getPublicJson(LIBRARY_SAMPLE_INDEX_PATH)'), 'guard runs before the fetch');
});
