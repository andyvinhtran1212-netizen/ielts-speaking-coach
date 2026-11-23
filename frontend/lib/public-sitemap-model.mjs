import { routeFor } from './route-registry.mjs';

const SITE_ORIGIN = 'https://www.averlearning.com';

export const STATIC_PUBLIC_PATHS = Object.freeze([
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/grammar', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/grammar/exercises', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/vocabulary', changeFrequency: 'weekly', priority: 0.8 },
]);

// Library list pages (LIBRARY-0061 FR-062, G06-T17). Each joins the sitemap
// only once its page is `live` in the route registry, so the sitemap never
// lists a URL that answers 404 while T009/T011/T013 are pending.
export const LIBRARY_PUBLIC_PATHS = Object.freeze([
  { path: '/library', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/library/writing-samples', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/library/writing-guides', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/library/speaking', changeFrequency: 'weekly', priority: 0.7 },
]);

const WRITING_SAMPLE_PAGE = '/library/writing-samples/';
/** Backend index of published sets, `[{slug, updated_at}]` (routers/library.py). */
export const LIBRARY_SAMPLE_INDEX_PATH = '/api/library/writing-samples/index';

/** @param {string} path */
function isLiveRoute(path) {
  return routeFor(path)?.status === 'live';
}

function cleanSegment(value) {
  const segment = typeof value === 'string' ? value.trim() : '';
  return segment && !segment.includes('/') ? segment : '';
}

function lastModified(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

/** A full ISO timestamp (`updated_at` of the Library index) as a Date, else undefined. */
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

/**
 * Build only canonical, published public URLs: static roots, live Library
 * lists, Grammar articles from the Grammar home contract and published
 * Writing sample sets from `GET /api/library/writing-samples/index`
 * (`[{slug, updated_at}]`; null when it could not be read → no sample URL).
 *
 * @param {unknown} home
 * @param {{ writingSamples?: unknown, isLive?: (path: string) => boolean }} [library]
 */
export function buildPublicSitemap(home, { writingSamples = null, isLive = isLiveRoute } = {}) {
  const statics = [...STATIC_PUBLIC_PATHS, ...LIBRARY_PUBLIC_PATHS.filter(({ path }) => isLive(path))];
  const entries = statics.map(({ path, ...metadata }) => ({
    url: new URL(path, SITE_ORIGIN).toString(),
    ...metadata,
  }));
  const seen = new Set(entries.map(({ url }) => url));
  const categories = Array.isArray(home?.categories) ? home.categories : [];

  for (const category of categories) {
    const categorySlug = cleanSegment(category?.slug);
    if (!categorySlug || !Array.isArray(category?.articles)) continue;
    for (const article of category.articles) {
      const slug = cleanSegment(article?.slug);
      if (!slug || article?.status === 'draft') continue;
      const url = new URL(
        `/grammar/${encodeURIComponent(categorySlug)}/${encodeURIComponent(slug)}`,
        SITE_ORIGIN,
      ).toString();
      if (seen.has(url)) continue;
      seen.add(url);
      const modified = lastModified(article?.last_updated);
      entries.push({
        url,
        changeFrequency: 'monthly',
        priority: 0.6,
        ...(modified ? { lastModified: modified } : {}),
      });
    }
  }

  // Writing sample pages (FR-062), only while the page route is live.
  const samples = Array.isArray(writingSamples) && isLive(`${WRITING_SAMPLE_PAGE}x`) ? writingSamples : [];
  for (const sample of samples) {
    const slug = cleanSegment(sample?.slug);
    if (!slug) continue;
    const url = new URL(`${WRITING_SAMPLE_PAGE}${encodeURIComponent(slug)}`, SITE_ORIGIN).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const modified = timestamp(sample?.updated_at);
    entries.push({
      url,
      changeFrequency: 'monthly',
      priority: 0.6,
      ...(modified ? { lastModified: modified } : {}),
    });
  }

  return entries;
}
