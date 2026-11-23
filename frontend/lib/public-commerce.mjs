// PUBLICSITE-0059 FR-029 — the one reader of the build flag AVER_PUBLIC_COMMERCE.
// Off (the default until Andy turns it on): /courses* pages call notFound(),
// so no link may point there; every link to /courses* is built by
// coursesHref(). next.config.ts inlines the flag into `env`.

/** @param {Record<string, string | undefined>} [env] */
export function publicCommerceEnabled(env = process.env) {
  return env.AVER_PUBLIC_COMMERCE === '1';
}

/**
 * @param {string} [slug] one course, or the catalogue when omitted
 * @param {{ fallback?: string | null, env?: Record<string, string | undefined> }} [opts]
 *   fallback: what to return when the flag is off — null (hide the link,
 *   the default) or '/' (e.g. "Khoá học" in PublicShell)
 * @returns {string | null}
 */
export function coursesHref(slug, opts = {}) {
  const { fallback = null, env = process.env } = opts;
  if (!publicCommerceEnabled(env)) return fallback;
  return slug ? `/courses/${encodeURIComponent(slug)}` : '/courses';
}
