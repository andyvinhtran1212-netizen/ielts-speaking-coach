// The routes rendered by the "Bản in" (v2) tree, for client code that must
// know the legacy / v2 boundary (UIBASE-0056 FR-015, plan 5.7.3).
//
// `route-registry.mjs` is the source of truth (`ui: 'v2'`), but it is ~47 KB
// and ChromeNavigationBridge sits in the root layout, so importing it there
// would ship the whole registry to every page. This list is the slim copy;
// `tests/v2-routes.test.mjs` fails when it drifts from the registry. Static
// routes are a Set lookup; a dynamic route may use only plain `[param]`
// segments (one path segment each, no catch-all), matched segment by segment,
// so the answer stays the same as `isV2Route`.

/** @type {readonly string[]} */
export const V2_ROUTES = Object.freeze([
  '/about',
  '/contact',
  '/library',
  '/library/speaking',
  '/library/writing-guides',
  '/library/writing-guides/[slug]',
  '/library/writing-samples',
  '/privacy',
  '/profile/v2-pilot',
  '/terms',
  '/ui-library',
]);

const isDynamic = (route) => route.includes('[');
const V2_SET = new Set(V2_ROUTES.filter((route) => !isDynamic(route)));
const V2_DYNAMIC = V2_ROUTES.filter(isDynamic).map((route) => route.slice(1).split('/'));

/** A concrete pathname's segments against a pattern whose `[x]` segments match any one segment. */
function matchesPattern(segments, pattern) {
  return (
    segments.length === pattern.length &&
    pattern.every((part, i) => (part.startsWith('[') ? segments[i] !== '' : part === segments[i]))
  );
}

/**
 * Same answer as `isV2Route` from route-registry.mjs, for a pathname
 * (query/hash and trailing slashes ignored). A static v1 route never shares a
 * prefix-and-length with a v2 pattern today; the drift test checks every
 * registry route, so a clash would fail there.
 * @param {string} pathname @returns {boolean}
 */
export function isV2Path(pathname) {
  const raw = String(pathname ?? '').split(/[?#]/, 1)[0];
  const trimmed = raw.replace(/\/+$/, '');
  const path = trimmed === '' ? '/' : trimmed;
  if (V2_SET.has(path)) return true;
  if (V2_DYNAMIC.length === 0 || path === '/') return false;
  const segments = path.slice(1).split('/');
  return V2_DYNAMIC.some((pattern) => matchesPattern(segments, pattern));
}
