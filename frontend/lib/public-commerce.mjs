// PUBLICSITE-0059 FR-029 — the one reader of the build flag AVER_PUBLIC_COMMERCE.
// Off (the default until Andy turns it on): /courses* pages call notFound(),
// so no link may point there; every link to /courses* is built by
// coursesHref(). next.config.ts lists the flag under `env`.
//
// The flag MUST be read as the literal `process.env.AVER_PUBLIC_COMMERCE`:
// Next inlines `env` values only where that exact expression appears, so a
// read through a variable (`env.X`, `process.env[name]`) stays undefined in
// client bundles, shows "off" in the browser and "on" on the server, and the
// two renders disagree (hydration mismatch). The default parameter below is
// that literal; tests pass the flag value explicitly.

/** @param {string | undefined} [flag] the build flag; defaults to the inlined value */
export function publicCommerceEnabled(flag = process.env.AVER_PUBLIC_COMMERCE) {
  return flag === '1';
}

/**
 * @param {string} [slug] one course, or the catalogue when omitted
 * @param {{ fallback?: string | null, flag?: string }} [opts]
 *   fallback: what to return when the flag is off — null (hide the link,
 *   the default) or '/' (e.g. "Khoá học" in PublicShell); flag: tests only
 * @returns {string | null}
 */
export function coursesHref(slug, opts = {}) {
  const { fallback = null } = opts;
  const enabled = 'flag' in opts ? publicCommerceEnabled(opts.flag) : publicCommerceEnabled();
  if (!enabled) return fallback;
  return slug ? `/courses/${encodeURIComponent(slug)}` : '/courses';
}
