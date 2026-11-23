// The routes rendered by the "Bản in" (v2) tree, for client code that must
// know the legacy / v2 boundary (UIBASE-0056 FR-015, plan 5.7.3).
//
// `route-registry.mjs` is the source of truth (`ui: 'v2'`), but it is ~47 KB
// and ChromeNavigationBridge sits in the root layout, so importing it there
// would ship the whole registry to every page. This list is the slim copy;
// `tests/v2-routes.test.mjs` fails when it drifts from the registry. Static
// routes are a Set lookup; the few dynamic ones (`[param]` = exactly one
// non-empty segment, the same rule as the registry matcher) are listed in
// V2_DYNAMIC_ROUTES and matched segment by segment.

/** @type {readonly string[]} */
export const V2_ROUTES = Object.freeze([
  '/about',
  '/contact',
  '/library',
  '/library/speaking',
  '/library/writing-guides',
  '/library/writing-samples',
  '/privacy',
  '/profile/v2-pilot',
  '/terms',
  '/ui-library',
]);

/** Dynamic v2 routes: one `[param]` stands for one path segment. @type {readonly string[]} */
export const V2_DYNAMIC_ROUTES = Object.freeze([
  '/library/speaking/[slug]',
]);

const V2_SET = new Set(V2_ROUTES);
const V2_PATTERNS = V2_DYNAMIC_ROUTES.map((route) => route.split('/'));

/** @param {string} path @returns {boolean} */
function matchesDynamic(path) {
  const parts = path.split('/');
  return V2_PATTERNS.some((pattern) => pattern.length === parts.length
    && pattern.every((seg, i) => (/^\[[^\].]+\]$/.test(seg) ? parts[i] !== '' : seg === parts[i])));
}

/**
 * Same answer as `isV2Route` from route-registry.mjs, for a pathname
 * (query/hash and trailing slashes ignored).
 * @param {string} pathname @returns {boolean}
 */
export function isV2Path(pathname) {
  const raw = String(pathname ?? '').split(/[?#]/, 1)[0];
  const trimmed = raw.replace(/\/+$/, '');
  const path = trimmed === '' ? '/' : trimmed;
  return V2_SET.has(path) || matchesDynamic(path);
}
