// SEC-CSP-NONCE step 1 (PC-J38): a nonce + 'strict-dynamic' script-src is
// sent as Content-Security-Policy-Report-Only on the AuthedShell route groups,
// while the enforced CSP stays exactly as it was. Browser evidence (0 reports
// on the signed-in routes, an injected <img onerror> reported):
// tooling/verify-csp-nonce-report-only-flow.mjs.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildContentSecurityPolicy,
  buildNonceReportOnlyPolicy,
  nonceReportOnlyEnabled,
} from '../tooling/content-security-policy.mjs';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const { unstable_doesMiddlewareMatch: matches } = createRequire(import.meta.url)(
  'next/experimental/testing/server',
);

const PROXY = read('proxy.ts');
const SHELL = read('components/authed-shell.tsx');
const NONCE = 'AAECAwQFBgcICQoLDA0ODw==';

function stripComments(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\'"])\/\/.*$/gm, '$1');
}

/** Top-level route groups whose layout renders AuthedShell. */
function shellGroups() {
  return readdirSync(path.join(FRONTEND, 'app'))
    .filter((dir) => {
      try {
        return /<AuthedShell\b/.test(read('app', dir, 'layout.tsx'));
      } catch { return false; }
    });
}

/** Every page URL under app/, with a sample value for each dynamic segment. */
function pageRoutes() {
  const shell = new Set(shellGroups());
  const out = [];
  const walk = (dir, parts) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, [...parts, name]);
      else if (name === 'page.tsx') {
        const segments = parts
          .filter((p) => !(p.startsWith('(') && p.endsWith(')')))
          .map((p) => (p.startsWith('[') ? 'sample' : p));
        out.push({ url: `/${segments.join('/')}`, shell: shell.has(parts[0]) });
      }
    }
  };
  walk(path.join(FRONTEND, 'app'), []);
  return out;
}

const proxyConfig = (() => {
  const literal = PROXY.match(/export const config = (\{[\s\S]*?\n\});/)?.[1];
  assert.ok(literal, 'proxy.ts must export a literal config');
  return new Function(`return (${literal});`)();
})();

const proxyMatches = (url, host) =>
  matches({ config: proxyConfig, url, headers: { host } });

describe('Report-Only policy builder', () => {
  test('script-src is self + the request nonce + strict-dynamic, with the CSP2 fallback', () => {
    assert.equal(
      buildNonceReportOnlyPolicy(NONCE, { NODE_ENV: 'production' }),
      `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic' 'unsafe-inline'`,
    );
    assert.match(buildNonceReportOnlyPolicy(NONCE, { NODE_ENV: 'development' }), / 'unsafe-eval'$/);
  });

  test('a missing or malformed nonce never produces a policy', () => {
    for (const bad of ['', undefined, 'short', `${NONCE}' 'unsafe-eval`, 'a b c d e f g h i j k l']) {
      assert.throws(() => buildNonceReportOnlyPolicy(bad, {}), /nonce must be base64/);
    }
  });

  test('next.config.ts resolves the flag once and inlines it for the proxy and AuthedShell', () => {
    assert.match(read('next.config.ts'), /env: \{\s*\[NONCE_REPORT_ONLY_FLAG\]: nonceReportOnlyEnabled\(process\.env\) \? '1' : '0',\s*\}/);
    assert.doesNotMatch(PROXY + SHELL, /nonceReportOnlyEnabled/, 'a runtime re-read could disagree with the build');
  });

  test('enabled on staging, previews and local builds; off for a production build unless forced', () => {
    assert.equal(nonceReportOnlyEnabled({ VERCEL_ENV: 'production' }), false);
    assert.equal(nonceReportOnlyEnabled({ VERCEL_ENV: 'preview' }), true);
    assert.equal(nonceReportOnlyEnabled({}), true);
    assert.equal(nonceReportOnlyEnabled({ VERCEL_ENV: 'production', AVER_CSP_NONCE_REPORT_ONLY: '1' }), true);
    assert.equal(nonceReportOnlyEnabled({ VERCEL_ENV: 'preview', AVER_CSP_NONCE_REPORT_ONLY: '0' }), false);
  });

  test('the enforced policy is unchanged: no nonce, no strict-dynamic, still self + unsafe-inline', () => {
    for (const env of [{ VERCEL_ENV: 'production', NODE_ENV: 'production' }, { VERCEL_ENV: 'preview', NODE_ENV: 'production' }]) {
      const scriptSrc = buildContentSecurityPolicy(env).split('; ').find((d) => d.startsWith('script-src '));
      assert.match(scriptSrc, /^script-src 'self' 'unsafe-inline'( https:\/\/vercel\.live)?$/);
    }
    assert.doesNotMatch(read('next.config.ts'), /key: 'Content-Security-Policy-Report-Only'|'nonce-|strict-dynamic/i);
  });
});

describe('proxy.ts', () => {
  test('sets both request headers Next needs and the Report-Only response header', () => {
    assert.match(PROXY, /requestHeaders\.delete\('content-security-policy'\)/);
    assert.match(PROXY, /requestHeaders\.set\('content-security-policy-report-only', policy\)/);
    assert.match(PROXY, /requestHeaders\.set\('x-nonce', nonce\)/);
    assert.match(PROXY, /response\.headers\.set\('Content-Security-Policy-Report-Only', policy\)/);
    assert.match(PROXY, /if \(process\.env\.AVER_CSP_NONCE_REPORT_ONLY !== '1'\) return NextResponse\.next\(\);/);
    assert.match(PROXY, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
    assert.doesNotMatch(PROXY, /Content-Security-Policy',/, 'the enforced header is owned by next.config.ts');
  });

  test('matches exactly the AuthedShell routes on non-production hosts', () => {
    const routes = pageRoutes();
    assert.ok(routes.filter((r) => r.shell).length > 100, 'route discovery found the signed-in routes');
    const wrong = routes
      .filter((r) => !r.url.startsWith('/grammar/'))
      .filter((r) => proxyMatches(r.url, 'staging.averlearning.com') !== r.shell)
      .map((r) => `${r.url} (${r.shell ? 'AuthedShell, not matched' : 'not AuthedShell, matched'})`);
    assert.deepEqual(wrong, []);
    for (const url of ['/', '/login', '/grammar', '/vocabulary', '/pricing', '/core-player/launch', '/api/health', '/js/api.js', '/css/ds.css', '/_next/static/chunks/x.js']) {
      assert.equal(proxyMatches(url, 'staging.averlearning.com'), false, url);
    }
  });

  test('production hosts never reach the nonce branch; the grammar 404 branch still runs there', () => {
    for (const host of ['averlearning.com', 'www.averlearning.com']) {
      for (const url of ['/admin', '/admin/writing/grade', '/home', '/vocabulary/hub', '/writing/result']) {
        assert.equal(proxyMatches(url, host), false, `${host}${url}`);
      }
      assert.equal(proxyMatches('/grammar/tenses/present-simple', host), true);
    }
    assert.equal(proxyMatches('/admin', 'ielts-git-staging.vercel.app'), true);
  });
});

describe('AuthedShell routes', () => {
  test('both inline scripts carry the request nonce, read only when the build flag is on', () => {
    const code = stripComments(SHELL);
    assert.equal((code.match(/<script\b/g) || []).length, 2);
    assert.equal((code.match(/<script nonce=\{nonce\}|<script\s+nonce=\{nonce\}/g) || []).length, 2);
    assert.match(code, /if \(process\.env\.AVER_CSP_NONCE_REPORT_ONLY !== '1'\) return undefined;\s*return \(await headers\(\)\)\.get\('x-nonce'\) \?\? undefined;/);
    assert.match(code, /export async function AuthedShell\(/);
  });

  test('every AuthedShell layout opts out of the static-shell check so it can render per request', () => {
    const groups = shellGroups();
    assert.ok(groups.length >= 75, `${groups.length} groups`);
    const missing = groups.filter((group) => !/^export const instant = false;$/m.test(read('app', group, 'layout.tsx')));
    assert.deepEqual(missing, []);
  });
});

describe('legacy public/js', () => {
  // A nonce policy ignores 'unsafe-inline', so on* attributes in rendered
  // HTML strings would be blocked once it is enforced.
  test('builds no inline on* event-handler attributes', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== 'vendor') walk(full);
        } else if (/\.m?js$/.test(name) && !/\.min\.js$/.test(name)) {
          stripComments(readFileSync(full, 'utf8')).split('\n').forEach((line, i) => {
            if (/\son[a-z]{3,20}\s*=\s*\\?["'`]/.test(line)) offenders.push(`${path.relative(FRONTEND, full)}:${i + 1}`);
          });
        }
      }
    };
    walk(path.join(FRONTEND, 'public/js'));
    assert.deepEqual(offenders, []);
  });
});
