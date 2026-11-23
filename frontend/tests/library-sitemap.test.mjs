// LIBRARY-0061 FR-062 (G06-T17, Writing part): Library lists and published
// Writing sample pages in the sitemap, each only once its page is live;
// robots allows /library. Speaking pages join with T013.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { buildPublicSitemap, LIBRARY_PUBLIC_PATHS, LIBRARY_SAMPLE_INDEX_PATH } from '../lib/public-sitemap-model.mjs';

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
