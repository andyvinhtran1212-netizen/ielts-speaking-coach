// Existence index for public Grammar articles, used by `proxy.ts` to answer a
// real HTTP 404 for an unknown `/grammar/:category/:slug` before the article
// route starts streaming (a `notFound()` inside the streamed route can only
// produce a soft 404: HTTP 200 + noindex).
//
// The index is the backend's own article list (`/api/grammar/categories`),
// the same in-memory map `get_article()` reads, so a listed key always loads.
// It fails OPEN: when the list is unavailable the answer is `null` and the
// request falls through to the route, which keeps its existing behaviour
// (article, error boundary, or soft 404). Only a fresh list can say "missing".

/** `${category}/${slug}` keys from the `/api/grammar/categories` payload. */
export function articleKeys(categories) {
  if (!Array.isArray(categories)) throw new TypeError('grammar categories payload must be an array');
  const keys = new Set();
  for (const category of categories) {
    for (const article of Array.isArray(category?.articles) ? category.articles : []) {
      if (typeof article?.category === 'string' && typeof article?.slug === 'string') {
        keys.add(`${article.category}/${article.slug}`);
      }
    }
  }
  if (!keys.size) throw new Error('grammar categories payload lists no articles');
  return keys;
}

/**
 * @param {object} options
 * @param {() => Promise<Set<string>>} options.load  fetches the current keys
 * @param {() => number} [options.now]
 * @param {number} [options.ttlMs]     refresh age for any lookup
 * @param {number} [options.missRefreshMs] a miss on a list older than this
 *   refetches once, so a newly published article is not 404'd for a full TTL;
 *   also the back-off after a failed load
 */
export function createArticleIndex({ load, now = Date.now, ttlMs = 300_000, missRefreshMs = 30_000 }) {
  let keys = null;
  let loadedAt = 0;
  let failedAt = -Infinity;
  let inflight = null;

  async function refresh() {
    if (now() - failedAt < missRefreshMs) return;
    inflight ??= (async () => {
      try {
        keys = await load();
        loadedAt = now();
      } catch {
        failedAt = now();
      } finally {
        inflight = null;
      }
    })();
    await inflight;
  }

  /** @returns {Promise<boolean | null>} true = exists, false = missing, null = unknown */
  async function has(category, slug) {
    const key = `${category}/${slug}`;
    if (!keys || now() - loadedAt > ttlMs) await refresh();
    if (keys?.has(key)) return true;
    if (keys && now() - loadedAt > missRefreshMs) await refresh();
    if (!keys) return null;
    if (keys.has(key)) return true;
    // A list that could not be refreshed is too stale to call a miss.
    return now() - loadedAt <= ttlMs ? false : null;
  }

  return { has };
}
