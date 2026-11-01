// SEC-CSP-NONCE step 2 / PC-J221: exercise the actual proxy and config with
// isolated build environments. No authentication or remote requests needed.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import * as csp from '../tooling/content-security-policy.mjs';
import * as articleIndex from '../lib/grammar-article-index.mjs';
import * as legacyRedirects from '../tooling/legacy-url-redirects.mjs';
import { auditNonceResponse, auditNonceRoute } from '../tooling/check-csp-nonce-deployed.mjs';

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
