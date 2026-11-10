import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPublicSitemap } from '../lib/public-sitemap-model.mjs';
import { findCollisions } from '../tooling/route-ownership-check.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) => readFileSync(path.join(FRONTEND, ...segments), 'utf8');

test('sitemap model emits stable roots and only valid, published canonical articles', () => {
  const entries = buildPublicSitemap({
    categories: [
      {
        slug: 'tenses',
        articles: [
          { slug: 'present-simple', status: 'complete', last_updated: '2026-09-01' },
          { slug: 'draft-page', status: 'draft' },
          { slug: 'nested/bad', status: 'complete' },
          { slug: 'present-simple', status: 'complete' },
        ],
      },
      { slug: 'bad/category', articles: [{ slug: 'ignored' }] },
    ],
  });
  assert.deepEqual(entries.slice(0, 4).map(({ url }) => url), [
    'https://www.averlearning.com/',
    'https://www.averlearning.com/grammar',
    'https://www.averlearning.com/grammar/exercises',
    'https://www.averlearning.com/vocabulary',
  ]);
  assert.equal(entries.length, 5);
  assert.equal(entries[4].url, 'https://www.averlearning.com/grammar/tenses/present-simple');
  assert.equal(entries[4].lastModified.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(buildPublicSitemap(null).length, 4, 'backend outage keeps stable public roots');
});

test('Next metadata endpoints are owned routes and private product areas stay out of discovery', () => {
  const { routes, collisions } = findCollisions();
  for (const route of ['/robots.txt', '/sitemap.xml', '/manifest.webmanifest']) {
    assert.ok(routes.includes(route), `route ownership must include ${route}`);
  }
  assert.deepEqual(collisions, []);

  const robots = read('app', 'robots.ts');
  const sitemap = read('app', 'sitemap.ts');
  assert.match(robots, /'\/admin'/);
  assert.match(robots, /'\/pages\/'/);
  assert.match(robots, /'\/writing'/);
  assert.doesNotMatch(sitemap, /\/admin|\/login|\/home|\/writing/);
  assert.match(sitemap, /getHome\(\)/, 'dynamic article URLs come from canonical Grammar content');
});

test('public query workspaces are noindex and canonical content routes identify themselves', () => {
  for (const file of [
    ['app', '(public-content)', 'grammar', 'search', 'page.tsx'],
    ['app', '(public-content)', 'grammar', 'compare', 'page.tsx'],
    ['app', '(public-content)', 'grammar', 'roadmap', 'page.tsx'],
  ]) {
    assert.match(read(...file), /robots:\s*\{\s*index:\s*false,\s*follow:\s*true\s*\}/);
  }
  for (const file of [
    ['app', '(marketing)', 'page.tsx'],
    ['app', '(public-content)', 'grammar', 'page.tsx'],
    ['app', '(public-content)', 'grammar', 'exercises', 'page.tsx'],
    ['app', '(public-content)', 'vocabulary', 'page.tsx'],
  ]) {
    assert.match(read(...file), /alternates:\s*\{\s*canonical:/);
  }
  assert.match(
    read('app', '(public-content)', 'grammar', '[category]', '[slug]', 'page.tsx'),
    /alternates:\s*\{\s*canonical:/,
  );
});

// Production redirects apex to www. Metadata must identify the final host,
// rather than sending crawlers back through the redirect for every URL.
test('canonical metadata and both sitemap producers match the production www host', () => {
  const origin = 'https://www.averlearning.com';
  const layout = read('app', 'layout.tsx');
  const robots = read('app', 'robots.ts');
  const backendSitemap = readFileSync(path.join(FRONTEND, '..', 'backend', 'routers', 'sitemap.py'), 'utf8');
  assert.ok(layout.includes(`metadataBase: new URL('${origin}')`));
  assert.ok(robots.includes(`sitemap: '${origin}/sitemap.xml'`));
  assert.ok(robots.includes(`host: '${origin}'`));
  assert.ok(backendSitemap.includes(`_BASE = "${origin}"`));
  for (const entry of buildPublicSitemap({ categories: [{ slug: 'tenses', articles: [{ slug: 'present-simple' }] }] })) {
    assert.equal(new URL(entry.url).origin, origin);
  }
});
