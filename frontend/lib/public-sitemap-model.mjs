const SITE_ORIGIN = 'https://averlearning.com';

export const STATIC_PUBLIC_PATHS = Object.freeze([
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/grammar', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/grammar/exercises', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/vocabulary', changeFrequency: 'weekly', priority: 0.8 },
]);

function cleanSegment(value) {
  const segment = typeof value === 'string' ? value.trim() : '';
  return segment && !segment.includes('/') ? segment : '';
}

function lastModified(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

/** Build only canonical, published public URLs from the Grammar home contract. */
export function buildPublicSitemap(home) {
  const entries = STATIC_PUBLIC_PATHS.map(({ path, ...metadata }) => ({
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

  return entries;
}
