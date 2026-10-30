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
//
// Deployment Protection: set VERCEL_AUTOMATION_BYPASS_SECRET in the
// environment; it is sent as a header and never printed. Read-only: GET only,
// signed out (the HTML is the same for every visitor; auth is client-side).
import { pathToFileURL } from 'node:url';

const REPORT_ONLY = /^script-src 'self' 'nonce-([A-Za-z0-9+/]{16,}={0,2})' 'strict-dynamic' 'unsafe-inline'( 'unsafe-eval')?$/;
export const SIGNED_IN_PATHS = ['/home', '/admin', '/profile', '/vocabulary/hub'];
export const PUBLIC_PATHS = ['/', '/login', '/grammar', '/vocabulary'];

/** One signed-in response: the Report-Only nonce and the <script> tags lacking it. */
export function auditNonceResponse({ reportOnly, html }) {
  const nonce = REPORT_ONLY.exec(reportOnly || '')?.[1] ?? null;
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  const unnonced = scripts.filter((tag) => !nonce || !tag.includes(` nonce="${nonce}"`));
  return { nonce, scripts: scripts.length, unnonced };
}

/** Two consecutive responses for one signed-in path → failure strings (empty = pass). */
export function auditNonceRoute(path, first, second) {
  const failures = [];
  [first, second].forEach(({ status }, i) => {
    if (!(status >= 200 && status < 300)) failures.push(`${path} #${i + 1}: HTTP ${status}; expected a successful document response (2xx)`);
  });
  if (failures.length) return failures;
  const audits = [first, second].map(auditNonceResponse);
  audits.forEach((audit, i) => {
    if (!audit.nonce) failures.push(`${path} #${i + 1}: no Report-Only nonce policy`);
    else if (audit.scripts === 0 || audit.unnonced.length) {
      failures.push(`${path} #${i + 1}: ${audit.unnonced.length}/${audit.scripts} <script> tags lack the request nonce, e.g. ${audit.unnonced[0] ?? '(none served)'}`);
    }
  });
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
    vercelCache: res.headers.get('x-vercel-cache'),
    cacheControl: res.headers.get('cache-control'),
    html: await res.text(),
  };
}

async function main(base) {
  const failures = [];
  for (const path of SIGNED_IN_PATHS) {
    const first = await get(base, path);
    const second = await get(base, path);
    const found = auditNonceRoute(path, first, second);
    failures.push(...found);
    const a = auditNonceResponse(second);
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
    console.log(`${ok ? '✓' : '✗'} ${path} HTTP ${res.status}: no Report-Only header`);
  }
  for (const failure of failures) console.error(`  ${failure}`);
  console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
  return failures.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const base = process.argv[2];
  if (!/^https?:\/\//.test(base || '')) {
    console.error('usage: node check-csp-nonce-deployed.mjs <deployment origin>');
    process.exit(2);
  }
  process.exitCode = await main(base);
}
