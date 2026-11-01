// ADMINAAL2-0032 T010 — shared `/admin/mfa/status` stub for Next-native admin
// verifiers. AdminAccessGate now reads the caller's assurance after the
// `/auth/me` role check and fails closed on a malformed payload, while the
// verifiers answer unknown API paths with `{}`. Register this next to a
// verifier's catch-all route (Playwright tries the newest route first) so the
// gate sees an AAL2 admin and the page renders as before.
export const AAL2_STATUS = Object.freeze({ aal: 'aal2', enforce: false, verified_factor_count: 1, next_step: 'none' });

/**
 * @param {{ route: Function }} target  Playwright Page or BrowserContext
 * @param {object | ((request: import('playwright').Request) => object)} [status]  body, or a per-request factory
 */
export async function stubAdminMfaStatus(target, status = AAL2_STATUS) {
  // Suffix match: some verifiers mount the API under a prefix on the app origin.
  await target.route((url) => url.pathname.endsWith('/admin/mfa/status'), (route) => {
    const request = route.request();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Some verifiers serve the API from another origin with explicit CORS.
      headers: { 'access-control-allow-origin': request.headers().origin || '*' },
      body: JSON.stringify(typeof status === 'function' ? status(request) : status),
    });
  });
}
