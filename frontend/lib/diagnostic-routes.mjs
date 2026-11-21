// Gate for the two engineering-only routes (`/next-probe`, `/recorder-spike`).
//
// U-03: the old gate only hid them when VERCEL_ENV was `production` or the
// branch was `main`, so every staging/preview deployment served them to
// signed-out visitors (commit SHA + env leak, an unauthenticated recorder).
// They now fail closed everywhere except `next dev` or a deployment that opts
// in explicitly with AVER_ENABLE_DIAGNOSTIC_ROUTES=1 (not set on staging).
//
// `.mjs` so `node --test` exercises the real predicate, not a source regex.

/**
 * @param {{ NODE_ENV?: string, AVER_ENABLE_DIAGNOSTIC_ROUTES?: string }} [env]
 * @returns {boolean}
 */
export function diagnosticRoutesEnabled(env = process.env) {
  return env.NODE_ENV === 'development' || env.AVER_ENABLE_DIAGNOSTIC_ROUTES === '1';
}

/**
 * Gate for the component library `/ui-library` (UIBASE-0056 FR-013, G03-T04).
 * Open whenever the diagnostic routes are, plus one narrower opt-in,
 * AVER_ENABLE_UI_LIBRARY=1, so the CI browser job can screenshot the library
 * without also opening `/next-probe` and `/recorder-spike` (that job asserts
 * those two stay 404 on its production build). Never set on staging/production.
 *
 * @param {{ NODE_ENV?: string, AVER_ENABLE_DIAGNOSTIC_ROUTES?: string, AVER_ENABLE_UI_LIBRARY?: string }} [env]
 * @returns {boolean}
 */
export function uiLibraryEnabled(env = process.env) {
  return diagnosticRoutesEnabled(env) || env.AVER_ENABLE_UI_LIBRARY === '1';
}
