// SEC-CSP-NONCE step 2 / PC-J221: exercise the actual proxy and config with
// isolated build environments. No authentication or remote requests needed.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import * as csp from '../tooling/content-security-policy.mjs';
import * as articleIndex from '../lib/grammar-article-index.mjs';
import * as legacyRedirects from '../tooling/legacy-url-redirects.mjs';
import * as routeTable from '../tooling/nonce-route-table.mjs';
import { appPageRoute } from '../tooling/app-route-inventory.mjs';
import {
  auditEncodedPath,
  auditNonceResponse,
  auditNonceRoute,
  ENCODED_STATIC_PATHS,
  NOT_FOUND_PATHS,
  SIGNED_IN_PATHS,
  SOFT_NOT_FOUND_PATHS,
} from '../tooling/check-csp-nonce-deployed.mjs';

const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NONCE = 'AAECAwQFBgcICQoLDA0ODw==';
const PREVIEW = {
  NODE_ENV: 'production', VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'staging', AVER_CSP_NONCE_ENFORCE: '1',
  AVER_CSP_NONCE_REPORT_ONLY: '1',
};
const PUBLIC_PATHS = ['/', '/login', '/grammar', '/vocabulary', '/pricing'];

function loadModule(filename, env) {
  const source = readFileSync(path.join(FRONTEND, filename), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const modules = {
    '@/lib/backend': { API_BASE: 'https://unused.invalid' },
    '@/lib/grammar-article-index.mjs': articleIndex,
    '@/tooling/content-security-policy.mjs': csp,
    './tooling/content-security-policy.mjs': csp,
    './tooling/legacy-url-redirects.mjs': legacyRedirects,
    './tooling/nonce-route-table.mjs': routeTable,
  };
  const exports = {};
  new Function('require', 'exports', 'process', '__dirname', compiled)(
    (name) => modules[name] ?? require(name), exports, { env }, FRONTEND,
  );
  return exports;
}

const proxyFor = (env) => loadModule('proxy.ts', env).proxy;
const configFor = (env) => loadModule('next.config.ts', env).default;
const request = (pathname = '/home', hostname = 'staging.averlearning.com', headers = {}) =>
  new NextRequest(`https://${hostname}${pathname}`, { headers });

function enforcedHeader(response) {
  const entries = [...response.headers].filter(([name]) => name === 'content-security-policy');
  assert.equal(entries.length, 1, 'exactly one blocking CSP header');
  const policy = entries[0][1];
  assert.ok(!policy.includes(','), 'no combined second blocking policy');
  assert.match(policy, /'strict-dynamic'/);
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, 'blocking policy contains the server nonce');
  return { policy, nonce };
}

describe('enforcement build flag and full policy', () => {
  test('requires an explicit 1 and is always off for a production deployment', () => {
    assert.equal(typeof csp.nonceEnforceEnabled, 'function');
    for (const VERCEL_ENV of ['preview', 'development', undefined]) {
      assert.equal(csp.nonceEnforceEnabled({ VERCEL_ENV, AVER_CSP_NONCE_ENFORCE: '1' }), true);
      for (const flag of ['0', undefined, '', 'true']) {
        assert.equal(csp.nonceEnforceEnabled({ VERCEL_ENV, AVER_CSP_NONCE_ENFORCE: flag }), false);
      }
    }
    assert.equal(csp.nonceEnforceEnabled({ VERCEL_ENV: 'production', AVER_CSP_NONCE_ENFORCE: '1' }), false);
  });

  test('preserves every directive except script-src, including configured origins', () => {
    assert.equal(typeof csp.buildNonceEnforcedPolicy, 'function');
    for (const env of [PREVIEW, { ...PREVIEW, NODE_ENV: 'development' }, {
      ...PREVIEW, AVER_API_BASE: 'https://api.example.test', AVER_SUPABASE_URL: 'https://db.example.test',
    }]) {
      const baseline = csp.buildContentSecurityPolicy(env).split('; ');
      const enforced = csp.buildNonceEnforcedPolicy(NONCE, env).split('; ');
      assert.deepEqual(enforced.filter((d) => !d.startsWith('script-src ')), baseline.filter((d) => !d.startsWith('script-src ')));
      const script = enforced.find((d) => d.startsWith('script-src '));
      assert.ok(script.startsWith(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic' 'unsafe-inline'`));
      assert.ok(script.includes('https://vercel.live'));
      assert.equal(script.includes("'unsafe-eval'"), env.NODE_ENV === 'development');
    }
  });

  test('rejects missing, malformed and injected nonces', () => {
    assert.equal(typeof csp.buildNonceEnforcedPolicy, 'function');
    for (const nonce of [undefined, '', 'short', `${NONCE}' 'unsafe-eval`, 'a b c', `${NONCE}\n`]) {
      assert.throws(() => csp.buildNonceEnforcedPolicy(nonce, PREVIEW), /nonce must be base64/);
    }
  });
});

describe('enforced proxy behavior', () => {
  test('sends one full policy with the same fresh nonce to Next and the browser; overwrites client headers', async () => {
    const proxy = proxyFor(PREVIEW);
    const seen = [];
    for (let i = 0; i < 2; i++) {
      const response = await proxy(request('/home', 'staging.averlearning.com', {
        'content-security-policy': "script-src 'nonce-client-chosen'",
        'content-security-policy-report-only': "script-src 'nonce-client-chosen'",
        'x-nonce': 'client-chosen',
      }));
      const { policy, nonce } = enforcedHeader(response);
      assert.equal(policy, csp.buildNonceEnforcedPolicy(nonce, PREVIEW));
      assert.equal(response.headers.get('x-middleware-request-content-security-policy'), policy);
      assert.equal(response.headers.get('x-middleware-request-x-nonce'), nonce);
      assert.equal(response.headers.get('content-security-policy-report-only'), null);
      assert.equal(response.headers.get('x-middleware-request-content-security-policy-report-only'), null);
      assert.ok(!policy.includes('client-chosen'));
      seen.push(nonce);
    }
    assert.notEqual(seen[0], seen[1]);
  });

  test('permits only the specified staging, preview and loopback hosts', async () => {
    const proxy = proxyFor(PREVIEW);
    for (const host of ['staging.averlearning.com', 'app-git-test.vercel.app', 'localhost', '127.0.0.1']) {
      enforcedHeader(await proxy(request('/home', host)));
    }
    for (const host of ['averlearning.com', 'www.averlearning.com', 'vercel.app', 'evilvercel.app', 'app.vercel.app.evil.test', 'staging.averlearning.com.evil.test', 'other.example.test']) {
      const response = await proxy(request('/home', host));
      assert.equal(response.headers.get('content-security-policy'), null, host);
      assert.equal(response.headers.get('content-security-policy-report-only'), null, host);
      assert.equal(response.headers.get('x-middleware-request-x-nonce'), null, host);
    }
  });

  test('does not add a nonce policy when called directly on public paths', async () => {
    const proxy = proxyFor(PREVIEW);
    for (const pathname of PUBLIC_PATHS) {
      const response = await proxy(request(pathname));
      assert.equal(response.headers.get('content-security-policy'), null, pathname);
      assert.equal(response.headers.get('content-security-policy-report-only'), null, pathname);
      assert.equal(response.headers.get('x-middleware-request-x-nonce'), null, pathname);
    }
  });

  test('the runtime route guard agrees with the matcher for every app page and prefix boundary', () => {
    const { unstable_doesMiddlewareMatch: matches } = require('next/experimental/testing/server');
    const config = loadModule('proxy.ts', PREVIEW).config;
    const routes = globSync('app/**/page.tsx', { cwd: FRONTEND }).map((file) => `/${file.split(path.sep)
      .slice(1, -1).filter((part) => !part.startsWith('(')).map((part) => part.startsWith('[') ? 'sample' : part).join('/')}`);
    for (const url of [...routes, ...PUBLIC_PATHS, '/homework', '/vocabulary/', '/vocabulary/hub', '/admin/a/b', '/reading-other']) {
      if (url.startsWith('/grammar/')) continue;
      assert.equal(csp.nonceRouteAllowed(url), matches({ config, url, headers: { host: 'staging.averlearning.com' } }), url);
    }
  });

  test('preserves the exact existing embeddable workspace allowlist', async () => {
    const config = configFor(PREVIEW);
    const framed = (await config.headers()).filter((rule) => rule.headers.some((header) => header.key === 'X-Frame-Options' && header.value === 'SAMEORIGIN'));
    assert.deepEqual(csp.NONCE_SAME_ORIGIN_FRAME_ROUTES, framed.map((rule) => rule.source).filter(csp.nonceRouteAllowed));
    const proxy = proxyFor(PREVIEW);
    for (const { source } of framed.filter((rule) => csp.nonceRouteAllowed(rule.source))) {
      const { policy } = enforcedHeader(await proxy(request(source)));
      assert.ok(policy.includes("frame-ancestors 'self'"), source);
      const child = enforcedHeader(await proxy(request(`${source}/child`)));
      assert.ok(child.policy.includes("frame-ancestors 'none'"), `${source}/child`);
    }
  });

  test('the runtime production lock cannot be bypassed by setting the flag to 1', async () => {
    const response = await proxyFor({ ...PREVIEW, VERCEL_ENV: 'production' })(request());
    assert.equal(response.headers.get('content-security-policy'), null);
    assert.equal(response.headers.get('content-security-policy-report-only'), null);
    assert.equal(response.headers.get('x-middleware-request-x-nonce'), null);
  });

  test('keeps existing Report-Only behavior with enforcement off', async () => {
    const response = await proxyFor({ ...PREVIEW, AVER_CSP_NONCE_ENFORCE: '0' })(request());
    assert.equal(response.headers.get('content-security-policy'), null);
    const nonce = response.headers.get('x-middleware-request-x-nonce');
    assert.ok(nonce);
    assert.equal(response.headers.get('content-security-policy-report-only'), csp.buildNonceReportOnlyPolicy(nonce, PREVIEW));
    const disabled = await proxyFor({ ...PREVIEW, AVER_CSP_NONCE_ENFORCE: '0', AVER_CSP_NONCE_REPORT_ONLY: '0' })(request());
    assert.equal(disabled.headers.get('content-security-policy-report-only'), null);
    assert.equal(disabled.headers.get('x-middleware-request-x-nonce'), null);
  });
});

describe('enforced deployment analyzer', () => {
  const OTHER = 'EBESExQVFhcYGRobHB0eHw==';
  const options = { enforced: true };
  const response = (nonce) => ({
    status: 200, reportOnly: null,
    contentSecurityPolicy: csp.buildNonceEnforcedPolicy(nonce, PREVIEW),
    html: `<script nonce="${nonce}" src="/_next/static/chunk.js"></script><script nonce="${nonce}">self.__next_f=[]</script>`,
  });

  test('reads the blocking nonce, requires every script to match and rejects reused nonces', () => {
    assert.deepEqual(auditNonceRoute('/home', response(NONCE), response(OTHER), options), []);
    assert.equal(auditNonceResponse(response(NONCE), options).scripts, 2);
    assert.match(auditNonceRoute('/home', response(NONCE), response(NONCE), options).join(), /same nonce was served twice/);
    assert.match(auditNonceRoute('/home', { ...response(NONCE), html: '<script src="/missing.js"></script>' }, response(OTHER), options).join(), /lack the request nonce/);
  });

  test('rejects two blocking policies, a Report-Only-only response and a second Report-Only policy', () => {
    const first = response(NONCE);
    for (const contentSecurityPolicy of [null, `${first.contentSecurityPolicy}, ${first.contentSecurityPolicy}`, `${first.contentSecurityPolicy}, script-src 'self'`]) {
      assert.match(auditNonceRoute('/home', { ...first, contentSecurityPolicy }, response(OTHER), options).join(), /exactly one enforced nonce policy/);
    }
    assert.match(auditNonceRoute('/home', { ...first, reportOnly: csp.buildNonceReportOnlyPolicy(NONCE, PREVIEW) }, response(OTHER), options).join(), /must not send Report-Only/);
    assert.match(auditNonceRoute('/home', { ...first, status: 500 }, response(OTHER), options).join(), /HTTP 500/);
  });
});

describe('build configuration safety', () => {
  test('enforcement implies the existing per-request rendering flag even if Report-Only was explicitly disabled', () => {
    const config = configFor({ ...PREVIEW, AVER_CSP_NONCE_REPORT_ONLY: '0' });
    assert.equal(config.env.AVER_CSP_NONCE_ENFORCE, '1');
    assert.equal(config.env.AVER_CSP_NONCE_REPORT_ONLY, '1');
  });

  test('production headers match the pre-enforcement baseline even with the new flag set', async () => {
    const production = { NODE_ENV: 'production', VERCEL_ENV: 'production' };
    const before = configFor(production);
    const after = configFor({ ...production, AVER_CSP_NONCE_ENFORCE: '1' });
    assert.equal(after.env.AVER_CSP_NONCE_ENFORCE, '0');
    assert.equal(after.env.AVER_CSP_NONCE_REPORT_ONLY, '0');
    assert.deepEqual(await after.headers(), await before.headers());
    const global = (await after.headers()).find((rule) => rule.source === '/:path*');
    assert.deepEqual(global.headers, [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), usb=()' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://ielts-speaking-coach-production.up.railway.app https://huwsmtubwulikhlmcirx.supabase.co; form-action 'self'" },
    ]);
  });
});

// PC-J566 / SA-1029-CSP1 F1 fix (b): Next answers a URL no route matches with
// the prerendered root not-found page, whose scripts cannot carry a request
// nonce. The proxy therefore gives the nonce policy only to URLs in the
// build's route table (inlined by next.config.ts) and leaves every other
// prefixed URL on the public baseline. Browser evidence on a real build:
// tooling/verify-csp-nonce-404-flow.mjs.
describe('404s under signed-in prefixes (PC-J566, option b)', () => {
  const OTHER = 'EBESExQVFhcYGRobHB0eHw==';
  const options = { enforced: true };
  const ROUTES = JSON.stringify(routeTable.collectNonceRoutes(FRONTEND));
  const ROUTED = { ...PREVIEW, AVER_CSP_NONCE_ROUTES: ROUTES };
  const SIGNED_IN_404 = NOT_FOUND_PATHS.filter(csp.nonceRouteAllowed);
  const stamped = (nonce, status = 404) => ({
    status, reportOnly: null,
    contentSecurityPolicy: csp.buildNonceEnforcedPolicy(nonce, PREVIEW),
    html: `<script nonce="${nonce}" src="/_next/static/chunk.js"></script><script nonce="${nonce}">self.__next_f=[]</script>`,
  });
  function baseline(response, label) {
    assert.equal(response.headers.get('content-security-policy'), null, `${label}: next.config's baseline stays`);
    assert.equal(response.headers.get('content-security-policy-report-only'), null, label);
    assert.equal(response.headers.get('x-middleware-request-x-nonce'), null, label);
    assert.equal(response.headers.get('x-middleware-request-content-security-policy'), null, label);
  }

  test('the root not-found stays a static prerender (no request-time render)', () => {
    const source = readFileSync(path.join(FRONTEND, 'app/not-found.tsx'), 'utf8');
    assert.doesNotMatch(source, /connection|headers\(|cookies\(|instant|async function/);
    assert.match(source, /<link rel="stylesheet" href="\/css\/aver-design\/tokens\.css" \/><NotFoundCard \/>/);
  });

  test('the route table is every page and route handler under the nonce prefixes', () => {
    const table = JSON.parse(ROUTES);
    const pages = globSync('app/**/{page,route}.{ts,tsx}', { cwd: FRONTEND })
      .map((file) => appPageRoute(file.split(path.sep).slice(1).join('/').replace(/route\.tsx?$/, 'page.tsx')))
      .filter((route) => route && csp.nonceRouteAllowed(route));
    assert.deepEqual(table, [...new Set(pages)].sort());
    for (const route of [...SIGNED_IN_PATHS, '/listening/ielts/80-days/[day]', '/admin/classes/[cohortId]']) assert.ok(table.includes(route), route);
    for (const pathname of SIGNED_IN_404) assert.equal(csp.nonceRouteExists(pathname, table), false, pathname);
    assert.ok(table.every(csp.nonceRouteAllowed));
    // public/ files are not in the table, so none may sit under a nonce prefix
    // (it would be served with the baseline, not the nonce policy).
    const publicFiles = readdirSync(path.join(FRONTEND, 'public'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `/${path.relative(path.join(FRONTEND, 'public'), path.join(entry.parentPath, entry.name)).split(path.sep).join('/')}`);
    assert.ok(publicFiles.length > 100, 'public/ walk found the assets');
    assert.deepEqual(publicFiles.filter(csp.nonceRouteAllowed), []);
  });

  test('next.config.ts inlines the table only when the nonce render flag is on', () => {
    assert.equal(configFor(PREVIEW).env.AVER_CSP_NONCE_ROUTES, ROUTES);
    assert.equal(configFor({ ...PREVIEW, AVER_CSP_NONCE_ENFORCE: '0' }).env.AVER_CSP_NONCE_ROUTES, ROUTES);
    for (const env of [{ NODE_ENV: 'production', VERCEL_ENV: 'production', AVER_CSP_NONCE_ENFORCE: '1' },
      { ...PREVIEW, AVER_CSP_NONCE_ENFORCE: '0', AVER_CSP_NONCE_REPORT_ONLY: '0' }]) {
      assert.equal(configFor(env).env.AVER_CSP_NONCE_ROUTES, '');
    }
  });

  test('real signed-in routes keep the enforced nonce policy; signed-in 404s get the public baseline', async () => {
    const proxy = proxyFor(ROUTED);
    for (const pathname of [...SIGNED_IN_PATHS, ...SOFT_NOT_FOUND_PATHS, '/admin/classes/abc', '/admin/listening/content/x/edit', '/reading/vocab/x%2Fy']) {
      const { policy } = enforcedHeader(await proxy(request(pathname)));
      assert.equal(policy, csp.buildNonceEnforcedPolicy(policy.match(/'nonce-([^']+)'/)[1], ROUTED), pathname);
    }
    assert.deepEqual(SIGNED_IN_404, ['/practice', '/home/does-not-exist', '/admin/nope-xyz', '/instructor/nope-xyz', '/vocabulary/nope/xyz/abc', '/admin/404']);
    for (const pathname of SIGNED_IN_404) baseline(await proxy(request(pathname)), pathname);
    // Report-Only builds send no Report-Only policy for them either.
    const reportOnly = proxyFor({ ...ROUTED, AVER_CSP_NONCE_ENFORCE: '0' });
    for (const pathname of SIGNED_IN_404) baseline(await reportOnly(request(pathname)), pathname);
    assert.ok((await reportOnly(request('/home'))).headers.get('content-security-policy-report-only'));
    // Production and unlisted hosts are unchanged: no nonce anywhere.
    for (const env of [ROUTED, { ...ROUTED, VERCEL_ENV: 'production' }]) {
      baseline(await proxyFor(env)(request('/home/does-not-exist', 'averlearning.com')), 'production host');
    }
  });

  test('path confusion: only the route table decides, never a "404" in the URL or request headers', async () => {
    const proxy = proxyFor(ROUTED);
    for (const pathname of ['/admin/404', '/home/404', '/admin/_not-found', '/admin/not-found', '/admin/%zz', '/admin/classes/a/b']) {
      baseline(await proxy(request(pathname)), pathname);
    }
    for (const pathname of ['/admin?x=/404', '/admin?_not-found=1', '/home#/404', '/admin/classes/404', '/admin/classes/%2e%2e%2f404', '/admin/%2E%2E/admin', '/admin/../home']) {
      enforcedHeader(await proxy(request(pathname)));
    }
    for (const headers of [
      { 'x-matched-path': '/404' }, { 'x-invoke-status': '404' }, { 'x-invoke-path': '/_not-found' },
      { 'x-nextjs-data': '1' }, { 'x-now-route-matches': '1' }, { 'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy' },
      { 'x-nonce': 'client-chosen', 'content-security-policy': "script-src 'nonce-client-chosen'" },
    ]) {
      for (const pathname of ['/admin', '/home']) enforcedHeader(await proxy(request(pathname, 'staging.averlearning.com', headers)));
    }
  });

  test('Vercel-style encoded routing keeps a fresh nonce for raw OR once-decoded routes (PC-J604)', async () => {
    const proxy = proxyFor(ROUTED);
    for (const pathname of [...ENCODED_STATIC_PATHS, '/%61dmin/classes', '/admin%2fclasses',
      '/admin/classes/a%2Fb', '/reading/vocab/x%2Fy', '/admin/classes/%zz', '/admin/classes/%E0%A4%A']) {
      const first = await proxy(request(pathname));
      const { nonce } = enforcedHeader(first);
      assert.equal(first.headers.get('x-middleware-request-x-nonce'), nonce, pathname);
      assert.equal(first.headers.get('x-middleware-request-content-security-policy'), first.headers.get('content-security-policy'), pathname);
      assert.notEqual(enforcedHeader(await proxy(request(pathname))).nonce, nonce, pathname);
      const reportOnly = await proxyFor({ ...ROUTED, AVER_CSP_NONCE_ENFORCE: '0' })(request(pathname));
      assert.ok(reportOnly.headers.get('content-security-policy-report-only'), pathname);
    }
    for (const pathname of ['/admin/CL%41SSES', '/admin/cl%2561sses', '/h%256Fme', '/admin%252Fclasses',
      '/admin/cl%61sses/a/b', '/admin/%E0%A4%A', '/h%6Fme%zz', '/%6Cogin', '/%67rammar', '/%76ocabulary']) {
      baseline(await proxy(request(pathname)), pathname);
    }
    for (const env of [ROUTED, { ...ROUTED, VERCEL_ENV: 'production' }]) {
      for (const pathname of ENCODED_STATIC_PATHS) {
        for (const host of ['averlearning.com', 'www.averlearning.com', 'unlisted.example.test']) {
          baseline(await proxyFor(env)(request(pathname, host)), `${host}${pathname}`);
        }
      }
    }
    for (const pathname of ENCODED_STATIC_PATHS) {
      baseline(await proxyFor({ ...ROUTED, VERCEL_ENV: 'production' })(request(pathname)), pathname);
    }
  });

  test('encoded framing exceptions remain exact matches to the existing allowlist', async () => {
    const proxy = proxyFor(ROUTED);
    for (const route of csp.NONCE_SAME_ORIGIN_FRAME_ROUTES) {
      const encoded = route.replace(/.$/, (last) => `%${last.charCodeAt(0).toString(16)}`);
      const { policy } = enforcedHeader(await proxy(request(encoded)));
      assert.match(policy, /frame-ancestors 'self'/, encoded);
      baseline(await proxy(request(`${encoded}/nope/xyz`)), encoded);
    }
  });

  test('an unusable inlined table keeps the nonce policy on every prefixed URL (the pre-fix behavior)', async () => {
    for (const value of [undefined, '', 'null', '[]', '{}', '["admin"]', '[1]', 'not json']) {
      assert.equal(csp.parseNonceRouteTable(value), null, String(value));
      const proxy = proxyFor({ ...PREVIEW, AVER_CSP_NONCE_ROUTES: value });
      for (const pathname of ['/home', '/home/does-not-exist']) enforcedHeader(await proxy(request(pathname)));
    }
  });

  test('segment matching mirrors Next: raw static segments, non-empty dynamic and catch-all segments', () => {
    const table = ['/a', '/a/[id]', '/a/[id]/edit', '/b/[...rest]', '/c/[[...rest]]'];
    const yes = ['/a', '/a/x', '/a/x%2Fy', '/a/%20', '/a/x/edit', '/b/x', '/b/x/y/z', '/c', '/c/x', '/c/x/y'];
    const no = ['/', '/ab', '/a/x/y', '/a/x/edi%74', '/a/x/Edit', '/b', '/b/', '/b/x//y', '/c/x/', '/d', '/A'];
    for (const pathname of yes) assert.equal(csp.nonceRouteExists(pathname, table), true, pathname);
    for (const pathname of no) assert.equal(csp.nonceRouteExists(pathname, table), false, pathname);
    assert.equal(csp.nonceRouteExists('/anything', null), true);
  });

  test('the collector maps groups, slots, private folders and route handlers, and refuses what it cannot model', () => {
    assert.equal(routeTable.appRoutePattern(['(g)', 'home', '@modal', '[id]', 'page.tsx']), '/home/[id]');
    assert.equal(routeTable.appRoutePattern(['(g)', 'admin', 'x', 'route.ts']), '/admin/x');
    assert.equal(routeTable.appRoutePattern(['(g)', 'admin', '_parts', 'page.tsx']), null);
    assert.equal(routeTable.appRoutePattern(['(g)', 'admin', 'layout.tsx']), null);
    assert.throws(() => routeTable.appRoutePattern(['admin', '(.)photo', 'page.tsx']), /intercepting/);
    const root = mkdtempSync(path.join(os.tmpdir(), 'nonce-route-table-'));
    try {
      const file = (rel, body = '') => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), body); };
      file('app/(g)/home/page.tsx');
      file('app/(g)/grammar/x/page.tsx');
      file('app/(g)/admin/x/route.ts');
      assert.deepEqual(routeTable.collectNonceRoutes(root), ['/admin/x', '/home']);
      file('app/(g)/home/ä/page.tsx');
      assert.throws(() => routeTable.collectNonceRoutes(root), /percent-encode/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the analyzer accepts the expected status and rejects any other', () => {
    const route = (status) => auditNonceRoute('/x', stamped(NONCE, status), stamped(OTHER, status), { ...options, status: 200 });
    assert.deepEqual(route(200), []);
    for (const status of [404, 302, 500]) assert.match(route(status).join(), new RegExp(`/x #1: HTTP ${status}; expected HTTP 200`));
    // Without an expected status the 2xx rule of the signed-in pages still applies.
    assert.match(auditNonceRoute('/home', stamped(NONCE), stamped(OTHER), options).join(), /HTTP 404; expected a successful document/);
  });

  test('the analyzer fails the staging shape: an enforced nonce header over unstamped prerendered scripts', () => {
    const unstamped = (nonce) => ({ ...stamped(nonce), html: '<script src="/_next/static/chunk.js" async=""></script><script>self.__next_f=[]</script>' });
    const found = auditNonceRoute('/admin/nope-xyz', unstamped(NONCE), unstamped(OTHER), { ...options, status: 404 });
    assert.equal(found.length, 2);
    assert.match(found[0], /2\/2 <script> tags lack the request nonce/);
  });

  test('encoded static paths: 404 + baseline or 200 + nonce pass, 200 + baseline fails (PC-J576)', () => {
    const publicPolicy = csp.buildContentSecurityPolicy(PREVIEW);
    const plain = (status) => ({ status, reportOnly: null, contentSecurityPolicy: publicPolicy, html: '<script src="/_next/static/chunk.js"></script>' });
    assert.deepEqual(auditEncodedPath('/admin/cl%61sses', plain(404), null, publicPolicy), []);
    assert.deepEqual(auditEncodedPath('/admin/cl%61sses', stamped(NONCE, 200), stamped(OTHER, 200), publicPolicy), []);
    assert.deepEqual(auditEncodedPath('/admin/cl%61sses', plain(200), null, publicPolicy),
      ['/admin/cl%61sses: HTTP 200 with the nonce-free baseline; the edge served the real page without its nonce policy']);
    assert.match(auditEncodedPath('/x', stamped(NONCE, 404), null, publicPolicy).join(), /404 got a nonce policy/);
    assert.match(auditEncodedPath('/x', { ...plain(404), contentSecurityPolicy: 'x' }, null, publicPolicy).join(), /differs from the original nonce-free baseline/);
    assert.match(auditEncodedPath('/x', stamped(NONCE, 200), stamped(NONCE, 200), publicPolicy).join(), /same nonce was served twice/);
    for (const status of [301, 307, 500]) assert.match(auditEncodedPath('/x', plain(status), null, publicPolicy).join(), new RegExp(`HTTP ${status}; expected HTTP 404`));
    // Each probe is a real static route sent encoded: the raw path misses the
    // route table (or the prefix guard), the decoded one is a nonce route.
    const table = routeTable.collectNonceRoutes(FRONTEND);
    assert.ok(ENCODED_STATIC_PATHS.includes('/admin/cl%61sses'));
    for (const pathname of ENCODED_STATIC_PATHS) {
      assert.ok(!csp.nonceRouteAllowed(pathname) || !csp.nonceRouteExists(pathname, table), pathname);
      const decoded = decodeURIComponent(pathname);
      assert.ok(csp.nonceRouteAllowed(decoded) && table.includes(decoded), decoded);
    }
  });

  async function runEnforcedChecker({ notFoundNonce = false, notFoundStatus = 404, encodedShape = '404' } = {}) {
    const counts = new Map();
    const server = createServer((req, res) => {
      const n = counts.get(req.url) ?? 0;
      counts.set(req.url, n + 1);
      const nonce = n % 2 ? OTHER : NONCE;
      // Model baseline 404s, Vercel's decoded page, and PC-J604's accepted
      // next-start static 404 + nonce even for an encoded prefix.
      const encoded = ENCODED_STATIC_PATHS.includes(req.url);
      const notFound = NOT_FOUND_PATHS.includes(req.url) || (encoded && ['404', 'next-start'].includes(encodedShape));
      const nonced = SIGNED_IN_PATHS.includes(req.url) || SOFT_NOT_FOUND_PATHS.includes(req.url)
        || (encoded && encodedShape === 'nonce')
        || (encoded && encodedShape === 'next-start')
        || (notFound && notFoundNonce && csp.nonceRouteAllowed(req.url));
      res.writeHead(notFound ? (encoded ? 404 : notFoundStatus) : 200, {
        'content-type': 'text/html',
        'content-security-policy': nonced ? csp.buildNonceEnforcedPolicy(nonce, PREVIEW) : csp.buildContentSecurityPolicy(PREVIEW),
      });
      res.end(nonced && !notFound ? stamped(nonce).html : '<script src="/_next/static/chunk.js"></script>');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      return await new Promise((resolve) => {
        execFile(process.execPath, [
          path.join(FRONTEND, 'tooling/check-csp-nonce-deployed.mjs'), '--enforced', `http://127.0.0.1:${server.address().port}`,
        ], { timeout: 30_000, env: { ...process.env, VERCEL_AUTOMATION_BYPASS_SECRET: '' } },
        (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr, counts }));
      });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }

  test('the enforced CLI probes the 404s (incl. /instructor, /login and /admin/404) and passes baseline 404s', async () => {
    assert.deepEqual(NOT_FOUND_PATHS, ['/practice', '/home/does-not-exist', '/admin/nope-xyz', '/instructor/nope-xyz',
      '/vocabulary/nope/xyz/abc', '/login/nope-xyz', '/admin/404', '/nope-top-level']);
    assert.deepEqual(SOFT_NOT_FOUND_PATHS, ['/listening/ielts/80-days/999']);
    const result = await runEnforcedChecker();
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /\bPASS\b/);
    for (const p of [...NOT_FOUND_PATHS, ...ENCODED_STATIC_PATHS]) assert.equal(result.counts.get(p), 1, p);
    for (const p of [...SIGNED_IN_PATHS, ...SOFT_NOT_FOUND_PATHS]) assert.equal(result.counts.get(p), 2, p);
  });

  test('the enforced CLI passes encoded paths decoded to a nonce page and fails them on the baseline (PC-J576)', async () => {
    assert.deepEqual(ENCODED_STATIC_PATHS, ['/admin/cl%61sses', '/instructor/gr%61de', '/h%6Fme', '/admin%2Fclasses']);
    const decoded = await runEnforcedChecker({ encodedShape: 'nonce' });
    assert.equal(decoded.code, 0, decoded.stdout + decoded.stderr);
    for (const p of ENCODED_STATIC_PATHS) assert.equal(decoded.counts.get(p), 2, p);
    const weakened = await runEnforcedChecker({ encodedShape: 'baseline' });
    assert.equal(weakened.code, 1);
    for (const p of ENCODED_STATIC_PATHS) {
      assert.ok(weakened.stderr.includes(`${p}: HTTP 200 with the nonce-free baseline`), weakened.stderr);
    }
    assert.match(weakened.stdout, /FAIL \(4\)/);
  });

  test('the deployed checker still rejects next-start encoded 404 + nonce (accepted local limitation)', async () => {
    const result = await runEnforcedChecker({ encodedShape: 'next-start' });
    assert.equal(result.code, 1);
    for (const pathname of ENCODED_STATIC_PATHS) {
      assert.ok(result.stderr.includes(`${pathname}: 404 got a nonce policy`), result.stderr);
    }
    assert.match(result.stdout, /FAIL \(4\)/);
  });

  test('the enforced CLI fails a nonce policy on a 404 (the staging shape) and a soft-200 404', async () => {
    const nonced = await runEnforcedChecker({ notFoundNonce: true });
    assert.equal(nonced.code, 1);
    for (const p of SIGNED_IN_404) assert.ok(nonced.stderr.includes(`${p}: 404 got a nonce policy`), nonced.stderr);
    for (const p of ['/login/nope-xyz', '/nope-top-level']) assert.ok(!nonced.stderr.includes(`${p}:`), nonced.stderr);
    const soft = await runEnforcedChecker({ notFoundStatus: 200 });
    assert.equal(soft.code, 1);
    for (const p of NOT_FOUND_PATHS) assert.ok(soft.stderr.includes(`${p}: HTTP 200; expected HTTP 404`), soft.stderr);
  });
});
