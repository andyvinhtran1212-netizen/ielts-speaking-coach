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
// environment; it is sent as a header and never printed. Read-only: GET only,
// signed out (the HTML is the same for every visitor; auth is client-side).
import { pathToFileURL } from 'node:url';

const REPORT_ONLY = /^script-src 'self' 'nonce-([A-Za-z0-9+/]{16,}={0,2})' 'strict-dynamic' 'unsafe-inline'( 'unsafe-eval')?$/;
const ENFORCED_SCRIPT = /^script-src 'self' 'nonce-([A-Za-z0-9+/]{16,}={0,2})' 'strict-dynamic' 'unsafe-inline'( 'unsafe-eval')?( https:\/\/vercel\.live)?$/;
export const SIGNED_IN_PATHS = ['/home', '/admin', '/profile', '/vocabulary/hub'];
export const PUBLIC_PATHS = ['/', '/login', '/grammar', '/vocabulary'];

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
    if (!(status >= 200 && status < 300)) failures.push(`${path} #${i + 1}: HTTP ${status}; expected a successful document response (2xx)`);
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

async function get(base, path) {
  const headers = {};
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
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
  if (origins.length !== 1 || !/^https?:\/\//.test(base || '')) {
    console.error('usage: node check-csp-nonce-deployed.mjs [--enforced] <deployment origin>');
    process.exit(2);
  }
  process.exitCode = await main(base, options);
}
