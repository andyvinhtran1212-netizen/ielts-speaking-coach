// The routes rendered by the "Bản in" (v2) tree, for client code that must
// know the legacy / v2 boundary (UIBASE-0056 FR-015, plan 5.7.3).
//
// `route-registry.mjs` is the source of truth (`ui: 'v2'`), but it is ~47 KB
// and ChromeNavigationBridge sits in the root layout, so importing it there
// would ship the whole registry to every page. This list is the slim copy;
// `tests/v2-routes.test.mjs` fails when it drifts from the registry. Static
// routes are a Set lookup; a route with a `[param]` segment (one segment, no
// catch-all) matches any single non-empty segment there, as `isV2Route` does.

/** @type {readonly string[]} */
export const V2_ROUTES = Object.freeze([
  '/about',
  '/account',
  '/contact',
  '/courses',
  '/help',
  '/library',
  '/library/speaking',
  '/library/speaking/[slug]',
  '/library/writing-guides',
  '/library/writing-guides/[slug]',
  '/library/writing-samples',
  '/library/writing-samples/[slug]',
  '/privacy',
  '/progress',
  '/start',
  '/profile/v2-pilot',
  '/terms',
  '/ui-library',
]);

const V2_SET = new Set(V2_ROUTES.filter((route) => !route.includes('[')));
const V2_DYNAMIC = V2_ROUTES.filter((route) => route.includes('[')).map(
  (route) => new RegExp(`^${route.split('/').map((seg) => (/^\[[^.\]]+\]$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|\\]/g, '\\$&'))).join('/')}$`),
);

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
  return V2_SET.has(path) || V2_DYNAMIC.some((re) => re.test(path));
}
