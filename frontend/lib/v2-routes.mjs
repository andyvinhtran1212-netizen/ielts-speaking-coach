// The routes rendered by the "Bản in" (v2) tree, for client code that must
// know the legacy / v2 boundary (UIBASE-0056 FR-015, plan 5.7.3).
//
// `route-registry.mjs` is the source of truth (`ui: 'v2'`), but it is ~47 KB
// and ChromeNavigationBridge sits in the root layout, so importing it there
// would ship the whole registry to every page. This list is the slim copy;
// `tests/v2-routes.test.mjs` fails when it drifts from the registry, and
// requires every v2 route to stay static (no `[param]` segment) so a Set
// lookup gives the same answer as `isV2Route`.

/** @type {readonly string[]} */
export const V2_ROUTES = Object.freeze([
  '/about',
  '/contact',
  '/course',
  '/library',
  '/library/speaking',
  '/library/writing-guides',
  '/library/writing-samples',
  '/privacy',
  '/profile/v2-pilot',
  '/terms',
  '/ui-library',
]);

const V2_SET = new Set(V2_ROUTES);

/**
 * Same answer as `isV2Route` from route-registry.mjs, for a pathname
 * (query/hash and trailing slashes ignored).
 * @param {string} pathname @returns {boolean}
 */
export function isV2Path(pathname) {
  const raw = String(pathname ?? '').split(/[?#]/, 1)[0];
  const trimmed = raw.replace(/\/+$/, '');
  return V2_SET.has(trimmed === '' ? '/' : trimmed);
}
