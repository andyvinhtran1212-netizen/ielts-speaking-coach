// Vercel Deployment Protection bypass for staging-e2e (plan §12/§7.1).
//
// The bypass header must only ever reach the STAGING origin: sending it
// browser-wide breaks CORS on every cross-origin request (custom headers
// force preflights that Railway/fonts don't allow). So we make ONE
// request-level call with the header + x-vercel-set-bypass-cookie, which
// drops a `_vercel_jwt` cookie into the context — after that the browser
// navigates the protected deployment with no special headers at all.
// @ts-check

const BYPASS = process.env.STAGING_BYPASS || '';

const BYPASS_HEADERS = BYPASS
  ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' }
  : {};

/** Prime the protection-bypass cookie into a browser context. */
async function primeBypassCookie(context, baseURL) {
  if (!BYPASS) return;
  const res = await context.request.get(baseURL + '/', { headers: BYPASS_HEADERS });
  if (!res.ok()) throw new Error(`bypass priming failed: HTTP ${res.status()}`);
}

module.exports = { BYPASS_HEADERS, primeBypassCookie };
