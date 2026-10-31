// SEC-CSP-NONCE step 1 (PC-J38): a nonce + 'strict-dynamic' script-src is
// sent as Content-Security-Policy-Report-Only on the AuthedShell route groups,
// while the enforced CSP stays exactly as it was. Browser evidence (0 reports
// on the signed-in routes, an injected <img onerror> reported):
// tooling/verify-csp-nonce-report-only-flow.mjs.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildContentSecurityPolicy,
  buildNonceReportOnlyPolicy,
  nonceReportOnlyEnabled,
} from '../tooling/content-security-policy.mjs';
import {
  auditNonceResponse,
  auditNonceRoute,
  bypassAllowed,
  PUBLIC_PATHS,
  SIGNED_IN_PATHS,
} from '../tooling/check-csp-nonce-deployed.mjs';

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

describe('deployed checker bypass origin guard (PC-J212)', () => {
  const tool = path.join(FRONTEND, 'tooling/check-csp-nonce-deployed.mjs');
  const allowed = [
    'https://staging.averlearning.com',
    'https://ielts-speaking-coach-git-x-abc.vercel.app',
    'https://STAGING.averlearning.com',
    'https://x.vercel.app',
    'https://x.y.vercel.app:443',
    'https://staging.averlearning.com:443',
  ];
  const denied = [
    'https://example.com',
    'https://staging.averlearning.com.evil.com',
    'https://evilstaging.averlearning.com',
    'https://vercel.app.evil.com',
    'https://evilvercel.app',
    'https://vercel.app',
    'http://staging.averlearning.com',
    'http://x.vercel.app',
    'https://www.averlearning.com',
    'https://averlearning.com',
    'https://user@staging.averlearning.com',
    'https://:password@x.vercel.app',
    'https://staging.averlearning.com:8443',
    'https://x.vercel.app:8443',
    'https://.vercel.app',
    'https://staging.averlearning.com.',
    'not a URL',
    undefined,
  ];

  for (const origin of allowed) {
    test(`allows bypass for ${origin}`, () => assert.equal(bypassAllowed(origin), true));
  }
  for (const origin of denied) {
    test(`denies bypass for ${origin}`, () => assert.equal(bypassAllowed(origin), false));
  }

  function runIsolatedChecker(origin, secret, fetchStub) {
    return spawnSync(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(fetchStub)}`,
      tool, origin,
    ], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, VERCEL_AUTOMATION_BYPASS_SECRET: secret },
    });
  }

  // Replace fetch before the CLI loads: even a regressed guard cannot send a request.
  const blockFetch = `globalThis.fetch = () => { throw new Error('unexpected fetch attempt'); };`;

  for (const origin of [
    'https://staging.averlearning.com.evil.com',
    'http://staging.averlearning.com',
    'https://dummy-test-value@staging.averlearning.com',
    'https://staging.averlearning.com:8443',
    'https://dummy-test-value@:8443',
  ]) {
    test(`CLI refuses ${origin} before calling fetch and never prints the secret`, () => {
      const result = runIsolatedChecker(origin, 'dummy-test-value', blockFetch);
      assert.ifError(result.error);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /refusing/);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stdout + result.stderr, /dummy-test-value|unexpected fetch attempt/);
    });
  }

  for (const { origin, secret } of [
    { origin: 'https://staging.averlearning.com', secret: 'dummy-test-value' },
    { origin: 'https://x.vercel.app', secret: 'dummy-test-value' },
    { origin: 'http://example.invalid', secret: '' },
  ]) {
    test(`CLI preserves requests and headers for ${origin} ${secret ? 'with' : 'without'} bypass`, () => {
      const stub = `
        import assert from 'node:assert/strict';
        let requests = 0;
        globalThis.fetch = async (url, options) => {
          assert.equal(options.redirect, 'manual');
          assert.equal(options.headers['x-vercel-protection-bypass'], ${JSON.stringify(secret || null)} ?? undefined);
          const nonce = requests++ % 2 ? 'EBESExQVFhcYGRobHB0eHw==' : '${NONCE}';
          return new Response('<script nonce="' + nonce + '"></script>', {
            headers: ${JSON.stringify(SIGNED_IN_PATHS)}.includes(url.pathname)
              ? { 'content-security-policy-report-only': "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic' 'unsafe-inline'" }
              : {},
          });
        };
        process.on('exit', () => assert.equal(requests, 12));
      `;
      const result = runIsolatedChecker(origin, secret, stub);
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /\bPASS\b/);
      assert.equal(result.stderr, '');
      assert.doesNotMatch(result.stdout + result.stderr, /dummy-test-value/);
    });
  }
});

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
    // PC-J221 step 2, Vinh t521u: narrowed from "exactly one inlined flag" to
    // the step-1 entry unchanged plus only the build-time enforce flag (forced
    // to '0' for production builds; covered by csp-nonce-enforce.test.mjs).
    assert.match(read('next.config.ts'), /env: \{\s*\[NONCE_REPORT_ONLY_FLAG\]: nonceReportOnlyEnabled\(process\.env\) \? '1' : '0',\s*\[NONCE_ENFORCE_FLAG\]: nonceEnforceEnabled\(process\.env\) \? '1' : '0',\s*\}/);
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
    // PC-J221 step 2, Vinh t521u: narrowed from "never". The Report-Only branch
    // still never sets the blocking header; the one write is the enforce branch,
    // reached only after the route, flag-off, production and host exits.
    // Behaviour for each exit: csp-nonce-enforce.test.mjs.
    const reportOnlyBranch = PROXY.match(/function nonceReportOnly\([\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(reportOnlyBranch, /response\.headers\.set\('Content-Security-Policy-Report-Only', policy\)/);
    assert.doesNotMatch(reportOnlyBranch, /Content-Security-Policy',/, 'the enforced header is owned by next.config.ts');
    assert.equal((PROXY.match(/Content-Security-Policy',/g) || []).length, 1, 'one blocking header write');
    assert.match(PROXY, /if \(!nonceRouteAllowed\(request\.nextUrl\.pathname\)\) return NextResponse\.next\(\);\s*if \(process\.env\.AVER_CSP_NONCE_ENFORCE !== '1'\) return nonceReportOnly\(request\);\s*if \(process\.env\.VERCEL_ENV === 'production' \|\| !nonceHostAllowed\(request\.nextUrl\.hostname\)\) \{\s*return NextResponse\.next\(\);\s*\}[^]*?response\.headers\.set\('Content-Security-Policy', policy\);/, 'outside the guarded enforce branch the enforced header is owned by next.config.ts');
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

// PC-J145 / SA-1029-CSP1: the deployed-build check. `next start` stamps every
// script; a Vercel deployment stamped only AuthedShell's two (staging
// c0370655c, 2/17 on /home), because the PPR resume request carries the
// enforced `content-security-policy` and Next reads the nonce from it first.
describe('deployed nonce check (tooling/check-csp-nonce-deployed.mjs)', () => {
  const OTHER = 'EBESExQVFhcYGRobHB0eHw==';
  const ro = (nonce) => `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`;
  const page = (nonce, { nextStamped }) => [
    `<script src="/_next/static/immutable/chunks/a.js" async=""${nextStamped ? ` nonce="${nonce}"` : ''}></script>`,
    `<script nonce="${nonce}">document.documentElement.dataset.theme='light'</script>`,
    `<script src="/_next/static/immutable/chunks/b.js" id="_R_" async=""${nextStamped ? ` nonce="${nonce}"` : ''}></script>`,
    `<script${nextStamped ? ` nonce="${nonce}"` : ''}>(self.__next_f=self.__next_f||[]).push([0])</script>`,
  ].join('');

  async function runChecker(statusForPath) {
    const requests = [];
    const server = createServer((req, res) => {
      const nonce = requests.length % 2 ? OTHER : NONCE;
      requests.push(req.url);
      const status = statusForPath(req.url);
      res.writeHead(status, {
        'content-type': 'text/html',
        ...(SIGNED_IN_PATHS.includes(req.url) ? { 'content-security-policy-report-only': ro(nonce) } : {}),
        ...(status >= 300 && status < 400 ? { location: '/login' } : {}),
      });
      res.end(page(nonce, { nextStamped: true }));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      return await new Promise((resolve) => {
        execFile(process.execPath, [
          path.join(FRONTEND, 'tooling/check-csp-nonce-deployed.mjs'),
          `http://127.0.0.1:${server.address().port}`,
        ], {
          timeout: 30_000,
          env: { ...process.env, VERCEL_AUTOMATION_BYPASS_SECRET: '' },
        }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr, requests }));
      });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }

  test('passes only when every served <script> carries the header nonce and the nonce changes', () => {
    assert.deepEqual(auditNonceRoute('/home',
      { status: 200, reportOnly: ro(NONCE), html: page(NONCE, { nextStamped: true }) },
      { status: 200, reportOnly: ro(OTHER), html: page(OTHER, { nextStamped: true }) }), []);
  });

  test('rejects a non-2xx status in either signed-in response before accepting nonce evidence', () => {
    const first = { status: 200, reportOnly: ro(NONCE), html: page(NONCE, { nextStamped: true }) };
    const second = { status: 200, reportOnly: ro(OTHER), html: page(OTHER, { nextStamped: true }) };
    for (const status of [199, 300, 302, 400, 500]) {
      assert.match(auditNonceRoute('/home', { ...first, status }, second).join(), new RegExp(`/home #1: HTTP ${status}`));
      assert.match(auditNonceRoute('/home', first, { ...second, status }).join(), new RegExp(`/home #2: HTTP ${status}`));
    }
    assert.deepEqual(auditNonceRoute('/home', { ...first, status: 201 }, { ...second, status: 299 }), []);
  });

  test('the CLI passes successful documents with valid nonce evidence', async () => {
    const result = await runChecker(() => 200);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\bPASS\b/);
    assert.equal(result.stderr, '');
  });

  test('the CLI fails HTTP 500 documents on every path despite valid nonce-bearing scripts', async () => {
    const result = await runChecker(() => 500);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stdout, /\bFAIL\b/);
    assert.doesNotMatch(result.stdout, /✓|\bPASS\b/);
    for (const route of SIGNED_IN_PATHS) {
      for (const request of [1, 2]) assert.ok(result.stderr.includes(`${route} #${request}: HTTP 500`), result.stderr);
    }
    for (const route of PUBLIC_PATHS) assert.ok(result.stderr.includes(`${route}: HTTP 500`), result.stderr);
  });

  test('the CLI fails public HTTP 500 documents when every signed-in document passes', async () => {
    const result = await runChecker((route) => PUBLIC_PATHS.includes(route) ? 500 : 200);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stdout, /FAIL \(4\)/);
    for (const route of PUBLIC_PATHS) assert.ok(result.stderr.includes(`${route}: HTTP 500`), result.stderr);
  });

  test('the CLI rejects redirects without following them', async () => {
    const result = await runChecker(() => 302);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stdout, /\bFAIL\b/);
    assert.match(result.stderr, /\/home #1: HTTP 302/);
    for (const route of PUBLIC_PATHS) assert.ok(result.stderr.includes(`${route}: HTTP 302`), result.stderr);
    assert.deepEqual(result.requests, [...SIGNED_IN_PATHS.flatMap((route) => [route, route]), ...PUBLIC_PATHS]);
  });

  test('the staging shape (Next chunks, bootstrap and flight scripts without the nonce) fails', () => {
    const audit = auditNonceResponse({ reportOnly: ro(NONCE), html: page(NONCE, { nextStamped: false }) });
    assert.equal(audit.nonce, NONCE);
    assert.equal(audit.scripts, 4);
    assert.equal(audit.unnonced.length, 3);
    assert.equal(auditNonceRoute('/home',
      { status: 200, reportOnly: ro(NONCE), html: page(NONCE, { nextStamped: false }) },
      { status: 200, reportOnly: ro(OTHER), html: page(OTHER, { nextStamped: false }) }).length, 2);
  });

  test('a repeated nonce, a different nonce or a missing policy fails', () => {
    const stamped = { status: 200, reportOnly: ro(NONCE), html: page(NONCE, { nextStamped: true }) };
    assert.match(auditNonceRoute('/home', stamped, stamped).join(), /same nonce was served twice/);
    assert.equal(auditNonceResponse({ reportOnly: ro(OTHER), html: page(NONCE, { nextStamped: true }) }).unnonced.length, 4);
    assert.match(auditNonceRoute('/home', { status: 200, reportOnly: null, html: '' }, stamped).join(), /no Report-Only nonce policy/);
  });

  test('it probes signed-in paths the proxy matches and public paths it does not', () => {
    for (const url of SIGNED_IN_PATHS) assert.equal(proxyMatches(url, 'staging.averlearning.com'), true, url);
    for (const url of PUBLIC_PATHS) assert.equal(proxyMatches(url, 'staging.averlearning.com'), false, url);
  });
});
