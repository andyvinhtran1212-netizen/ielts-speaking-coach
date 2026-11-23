// The routes rendered by the "Bản in" (v2) tree, for client code that must
// know the legacy / v2 boundary (UIBASE-0056 FR-015, plan 5.7.3).
//
// `route-registry.mjs` is the source of truth (`ui: 'v2'`), but it is ~47 KB
// and ChromeNavigationBridge sits in the root layout, so importing it there
// would ship the whole registry to every page. This list is the slim copy;
// `tests/v2-routes.test.mjs` fails when it drifts from the registry. Static
// routes are a Set lookup; a dynamic v2 route (`[param]` segment) needs its
// own matcher in V2_DYNAMIC, and the test checks both give the same answer
// as `isV2Route`.

/** @type {readonly string[]} */
export const V2_ROUTES = Object.freeze([
  '/about',
  '/account',
  '/account/orders',
  '/contact',
  '/help',
  '/library',
  '/library/speaking',
  '/library/writing-guides',
  '/library/writing-samples',
  '/privacy',
  '/progress',
  '/start',
  '/profile/v2-pilot',
  '/terms',
  '/ui-library',
]);

/**
 * Dynamic v2 routes: the registry pattern and one segment-exact matcher.
 * @type {readonly { route: string, regex: RegExp }[]}
 */
export const V2_DYNAMIC = Object.freeze([
  { route: '/enroll/[orderCode]', regex: /^\/enroll\/[^/]+$/ },
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
  const path = trimmed === '' ? '/' : trimmed;
  return V2_SET.has(path) || V2_DYNAMIC.some(({ regex }) => regex.test(path));
}
