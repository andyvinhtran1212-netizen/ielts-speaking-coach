// PC-J145 / SA-1029-CSP1: HTTP-level nonce check against a DEPLOYED build
// (staging alias or a PR preview). The browser verifier
// (verify-csp-nonce-report-only-flow.mjs) runs on `next start`, which does not
// reproduce Vercel's PPR resume. On Vercel that resume request carries the
// deployment's response headers, the enforced `content-security-policy`
// included, and Next takes the nonce from that header first (it has none), so
// only AuthedShell's own inline scripts get one. See
// docs/CONTENT_SECURITY_POLICY.md, "Known gap on Vercel".
//
//   node frontend/tooling/check-csp-nonce-deployed.mjs https://staging.averlearning.com
//   node frontend/tooling/check-csp-nonce-deployed.mjs --enforced <preview origin>
//
// Deployment Protection: set VERCEL_AUTOMATION_BYPASS_SECRET in the
// environment; it is sent only to HTTPS staging/preview hosts, never printed.
// Read-only: GET only,
// signed out (the HTML is the same for every visitor; auth is client-side).
import { pathToFileURL } from 'node:url';

const REPORT_ONLY = /^script-src 'self' 'nonce-([A-Za-z0-9+/]{16,}={0,2})' 'strict-dynamic' 'unsafe-inline'( 'unsafe-eval')?$/;
const ENFORCED_SCRIPT = /^script-src 'self' 'nonce-([A-Za-z0-9+/]{16,}={0,2})' 'strict-dynamic' 'unsafe-inline'( 'unsafe-eval')?( https:\/\/vercel\.live)?$/;
export const SIGNED_IN_PATHS = ['/home', '/admin', '/profile', '/vocabulary/hub', '/instructor'];
export const PUBLIC_PATHS = ['/', '/login', '/grammar', '/vocabulary'];
// PC-J566 / SA-1029-CSP1 F1 (b), `--enforced` only. Next answers these with
// the prerendered root 404, so the proxy leaves them the public baseline: HTTP
// 404, the original nonce-free blocking policy, no Report-Only. A nonce header
// here means its scripts are blocked. `/admin/404` is the path-confusion case
// (no route, so a 404 like the others; `/admin` itself keeps the nonce).
// `/nope-top-level` and `/login/nope-xyz` (outside the matcher) are controls.
export const NOT_FOUND_PATHS = Object.freeze([
  '/practice', '/home/does-not-exist', '/admin/nope-xyz', '/instructor/nope-xyz',
  '/vocabulary/nope/xyz/abc', '/login/nope-xyz', '/admin/404', '/nope-top-level',
]);
// A real route whose page calls notFound() under <Suspense>: a soft 404 (HTTP
// 200 + noindex, U-03 / PC-J526) that keeps the nonce on every script.
export const SOFT_NOT_FOUND_PATHS = Object.freeze(['/listening/ielts/80-days/999']);
// PC-J576 (#2216 R3 P3-1), `--enforced` only: real static routes sent with a
// percent-encoded byte. The proxy matches segments as sent, so it leaves these
// the baseline; `next start` answers them with the root 404. An edge that
// decodes the path before routing would serve the real page instead, which
// must then carry the nonce. 404 + baseline or 200 + nonce pass; 200 + the
// nonce-free baseline is a real page that lost its nonce policy.
export const ENCODED_STATIC_PATHS = Object.freeze([
  '/admin/cl%61sses', '/instructor/gr%61de', '/h%6Fme', '/admin%2Fclasses',
]);

/** Only the staging alias and Vercel previews may receive the bypass secret. */
export function bypassAllowed(origin) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username && !url.password
      // URL normalizes an explicit HTTPS port 443 to the empty string.
      && url.port === ''
      && (hostname === 'staging.averlearning.com'
        || (hostname.endsWith('.vercel.app') && hostname.length > '.vercel.app'.length));
  } catch {
    return false;
  }
}

/** One signed-in response: the Report-Only nonce and the <script> tags lacking it. */
export function auditNonceResponse({ reportOnly, contentSecurityPolicy, html }, { enforced = false } = {}) {
  // Fetch combines repeated CSP field lines with commas. They are separate
  // intersecting policies in a browser, and must never count as one policy.
  const policy = contentSecurityPolicy || '';
  const script = policy.split('; ').filter((directive) => directive.startsWith('script-src '));
  const nonce = enforced
    ? (!policy.includes(',') && script.length === 1 ? ENFORCED_SCRIPT.exec(script[0])?.[1] : null) ?? null
    : REPORT_ONLY.exec(reportOnly || '')?.[1] ?? null;
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  const unnonced = scripts.filter((tag) => !nonce || !tag.includes(` nonce="${nonce}"`));
  return { nonce, scripts: scripts.length, unnonced };
}

/** Two consecutive responses for one signed-in path → failure strings (empty = pass). */
export function auditNonceRoute(path, first, second, options = {}) {
  const failures = [];
  [first, second].forEach(({ status }, i) => {
    if (options.status !== undefined) {
      if (status !== options.status) failures.push(`${path} #${i + 1}: HTTP ${status}; expected HTTP ${options.status}`);
    } else if (!(status >= 200 && status < 300)) failures.push(`${path} #${i + 1}: HTTP ${status}; expected a successful document response (2xx)`);
  });
  if (failures.length) return failures;
  const audits = [first, second].map((response) => auditNonceResponse(response, options));
  audits.forEach((audit, i) => {
    if (!audit.nonce) failures.push(`${path} #${i + 1}: ${options.enforced ? 'expected exactly one enforced nonce policy' : 'no Report-Only nonce policy'}`);
    else if (audit.scripts === 0 || audit.unnonced.length) {
      failures.push(`${path} #${i + 1}: ${audit.unnonced.length}/${audit.scripts} <script> tags lack the request nonce, e.g. ${audit.unnonced[0] ?? '(none served)'}`);
    }
  });
  if (options.enforced) {
    [first, second].forEach((response, i) => {
      if (response.reportOnly !== null && response.reportOnly !== undefined) failures.push(`${path} #${i + 1}: enforced mode must not send Report-Only`);
    });
  }
  if (audits[0].nonce && audits[0].nonce === audits[1].nonce) failures.push(`${path}: the same nonce was served twice`);
  return failures;
}

/** One response for a path Next answers with the root 404 → failure strings. */
export function auditNotFoundResponse(path, res, publicPolicy) {
  const found = [];
  if (res.status !== 404) found.push(`${path}: HTTP ${res.status}; expected HTTP 404`);
  if (res.reportOnly !== null) found.push(`${path}: 404 sent a Report-Only header`);
  if (/'nonce-/.test(res.contentSecurityPolicy || '')) found.push(`${path}: 404 got a nonce policy; its prerendered scripts cannot carry the nonce`);
  else if (!publicPolicy || res.contentSecurityPolicy !== publicPolicy) found.push(`${path}: 404 blocking policy differs from the original nonce-free baseline`);
  return found;
}

/**
 * A percent-encoded static path (ENCODED_STATIC_PATHS) → failure strings.
 * `second` is only fetched (and required) for a 200.
 */
export function auditEncodedPath(path, first, second, publicPolicy, options = { enforced: true }) {
  if (first.status === 404) return auditNotFoundResponse(path, first, publicPolicy);
  if (first.status !== 200) return [`${path}: HTTP ${first.status}; expected HTTP 404 with the baseline or HTTP 200 with the nonce`];
  if (!/'nonce-/.test(first.contentSecurityPolicy || '')) {
    return [`${path}: HTTP 200 with the nonce-free baseline; the edge served the real page without its nonce policy`];
  }
  return auditNonceRoute(path, first, second, { ...options, status: 200 });
}

async function get(base, path) {
  const headers = {};
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET && bypassAllowed(base)) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const res = await fetch(new URL(path, base), { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  return {
    status: res.status,
    reportOnly: res.headers.get('content-security-policy-report-only'),
    contentSecurityPolicy: res.headers.get('content-security-policy'),
    vercelCache: res.headers.get('x-vercel-cache'),
    cacheControl: res.headers.get('cache-control'),
    html: await res.text(),
  };
}

async function main(base, options) {
  const failures = [];
  let publicPolicy;
  for (const path of SIGNED_IN_PATHS) {
    const first = await get(base, path);
    const second = await get(base, path);
    const found = auditNonceRoute(path, first, second, options);
    failures.push(...found);
    const a = auditNonceResponse(second, options);
    if (options.enforced && path === '/home' && a.nonce) {
      publicPolicy = second.contentSecurityPolicy.replace(`'nonce-${a.nonce}' 'strict-dynamic' `, '');
    }
    // x-vercel-cache: HIT on these routes is the cached EMPTY PPR shell; the
    // document is rendered per request by the resume. The nonce comparison
    // above is what proves no nonce is shared.
    console.log(`${found.length ? '✗' : '✓'} ${path} HTTP ${second.status}: ${a.scripts - a.unnonced.length}/${a.scripts} scripts carry the nonce; x-vercel-cache=${second.vercelCache ?? '-'}; cache-control=${second.cacheControl ?? '-'}`);
  }
  if (options.enforced) {
    for (const path of SOFT_NOT_FOUND_PATHS) {
      const first = await get(base, path);
      const second = await get(base, path);
      const found = auditNonceRoute(path, first, second, { ...options, status: 200 });
      failures.push(...found);
      const a = auditNonceResponse(second, options);
      console.log(`${found.length ? '✗' : '✓'} ${path} HTTP ${second.status} (soft 404): ${a.scripts - a.unnonced.length}/${a.scripts} scripts carry the nonce`);
    }
    for (const path of NOT_FOUND_PATHS) {
      const res = await get(base, path);
      const found = auditNotFoundResponse(path, res, publicPolicy);
      failures.push(...found);
      console.log(`${found.length ? '✗' : '✓'} ${path} HTTP ${res.status}: 404 with the original nonce-free blocking policy; x-vercel-cache=${res.vercelCache ?? '-'}`);
    }
    for (const path of ENCODED_STATIC_PATHS) {
      const first = await get(base, path);
      const second = first.status === 200 && /'nonce-/.test(first.contentSecurityPolicy || '') ? await get(base, path) : null;
      const found = auditEncodedPath(path, first, second, publicPolicy, options);
      failures.push(...found);
      const shape = first.status === 404 ? '404 with the original nonce-free blocking policy'
        : second ? 'real page with the request nonce' : 'real page with the nonce-free baseline';
      console.log(`${found.length ? '✗' : '✓'} ${path} HTTP ${first.status} (encoded): ${shape}; x-vercel-cache=${first.vercelCache ?? '-'}`);
    }
  }
  for (const path of PUBLIC_PATHS) {
    const res = await get(base, path);
    if (!(res.status >= 200 && res.status < 300)) {
      failures.push(`${path}: HTTP ${res.status}; expected a successful document response (2xx)`);
      console.log(`✗ ${path} HTTP ${res.status}: expected a successful document response (2xx)`);
      continue;
    }
    const ok = res.reportOnly === null;
    if (!ok) failures.push(`${path}: public route sent a Report-Only header`);
    const unchanged = !options.enforced || (publicPolicy && res.contentSecurityPolicy === publicPolicy);
    if (!unchanged) failures.push(`${path}: public blocking policy differs from the original nonce-free baseline`);
    console.log(`${ok && unchanged ? '✓' : '✗'} ${path} HTTP ${res.status}: no Report-Only header${options.enforced ? '; original blocking policy' : ''}`);
  }
  for (const failure of failures) console.error(`  ${failure}`);
  console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
  return failures.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const options = { enforced: args.includes('--enforced') };
  const origins = args.filter((arg) => arg !== '--enforced');
  const base = origins[0];
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET && !bypassAllowed(base)) {
    let host = '(invalid origin)';
    try { host = new URL(base).hostname || host; } catch { /* Never print raw input or userinfo. */ }
    console.error(`refusing to send VERCEL_AUTOMATION_BYPASS_SECRET to ${host}: only https://staging.averlearning.com or https://*.vercel.app without userinfo or a non-443 port`);
    process.exit(2);
  }
  if (origins.length !== 1 || !/^https?:\/\//.test(base || '')) {
    console.error('usage: node check-csp-nonce-deployed.mjs [--enforced] <deployment origin>');
    process.exit(2);
  }
  process.exitCode = await main(base, options);
}
