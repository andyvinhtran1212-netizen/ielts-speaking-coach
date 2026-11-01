// ADMINAAL2-0032 FR-016 / T009: every live Staging E2E admin sign-in goes
// through helpers.signIn / helpers.signInSession, which step the synthetic
// admin up to AAL2 when STAGING_E2E_ADMIN_TOTP_SECRET is set. A spec that
// signs the admin in itself would keep an AAL1 session and turn red the day
// ADMIN_AAL2_ENFORCE is switched on, so this PR-time contract refuses it.
import { test, mock } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E_DIR = path.join(HERE, 'staging-e2e');
const HELPERS = 'helpers.js';
const ADMIN_HELPERS = new Set(['signIn', 'signInSession']);
const require = createRequire(import.meta.url);
const helpers = require('./staging-e2e/helpers.js');
const ROOT = path.resolve(HERE, '..', '..');

test('every staging release authentication step receives the CI TOTP secret', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/staging-release-smoke.yml'), 'utf8');
  const authSteps = workflow.split(/\n      - name: /).filter((step) => (
    step.includes('E2E_PASSWORD:') && !step.includes('scan-artifact-secrets.mjs')
  ));
  assert.equal(authSteps.length, 3, 'both provenance steps and the browser suite must authenticate');
  for (const step of authSteps) {
    assert.match(step, /STAGING_E2E_ADMIN_TOTP_SECRET: \$\{\{ secrets\.STAGING_E2E_ADMIN_TOTP_SECRET \}\}/);
  }
});


function stringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Names bound by `const { a, b: c } = require('./helpers')`. */
function helperBindings(sourceFile) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) {
      const init = node.initializer;
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)
          && init.expression.text === 'require' && stringValue(init.arguments[0] || {}) === './helpers') {
        for (const element of node.name.elements) {
          const imported = (element.propertyName || element.name).getText(sourceFile);
          if (ts.isIdentifier(element.name) && imported === element.name.text) names.add(imported);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** Locally declared functions (declarations and `const x = (…) => …`). */
function localFunctions(sourceFile) {
  const fns = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) fns.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      fns.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return fns;
}

function containsText(node, sourceFile, needle) {
  return node.getText(sourceFile).includes(needle);
}

/** Returns human-readable violations for one staging spec source. */
export function adminSignInViolations(fileName, source) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const violations = [];
  const where = (node) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return `${fileName}:${line + 1}`;
  };
  const bound = helperBindings(sourceFile);
  const locals = localFunctions(sourceFile);
  const passwordGrantFns = new Set(
    [...locals].filter(([, fn]) => containsText(fn, sourceFile, 'grant_type=password')).map(([name]) => name),
  );

  const visit = (node) => {
    const text = stringValue(node);
    if (text !== null || ts.isTemplateExpression(node)) {
      const raw = text ?? node.getText(sourceFile);
      if (/e2e-admin\b/.test(raw)) violations.push(`${where(node)} names the admin identity directly`);
      if (/\/factors\b/.test(raw)) violations.push(`${where(node)} calls the GoTrue MFA factor API itself`);
    }
    if (text === 'admin') {
      const call = node.parent;
      const callee = call && ts.isCallExpression(call) && call.arguments.includes(node) && call.expression;
      const name = callee && ts.isIdentifier(callee) ? callee.text : null;
      if (!name || !ADMIN_HELPERS.has(name)) {
        violations.push(`${where(node)} uses the 'admin' role outside helpers.signIn/signInSession`);
      } else if (!bound.has(name) || locals.has(name)) {
        violations.push(`${where(node)} calls a local ${name}() for the admin instead of the helpers.js one`);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && passwordGrantFns.has(node.expression.text)) {
      const roles = node.arguments.map(stringValue).filter((v) => v !== null);
      if (!roles.length) {
        violations.push(`${where(node)} calls local password grant ${node.expression.text}() without a literal non-admin role`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

const specFiles = readdirSync(E2E_DIR).filter((f) => f.endsWith('.js') && f !== HELPERS).sort();

test('no staging E2E spec signs the admin in outside helpers.js (FR-016)', () => {
  assert.ok(specFiles.length >= 10, 'staging-e2e specs must be discovered');
  const violations = specFiles.flatMap((file) => (
    adminSignInViolations(file, readFileSync(path.join(E2E_DIR, file), 'utf8'))
  ));
  assert.deepEqual(violations, []);
});

test('the Writing course journey uses one helpers.signInSession admin session for API and browser', () => {
  const source = readFileSync(path.join(E2E_DIR, 'writing-prompt-courses.spec.js'), 'utf8');
  assert.doesNotMatch(source, /grant_type=password/);
  assert.match(source, /const session = await signInSession\(request, 'admin'\);/);
  assert.match(source, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(source, /\[storageKey, JSON\.stringify\(session\)\]/);
});

test('the contract rejects the pre-T009 direct admin password grant and its variants', () => {
  const direct = `const { identityEmail, STAGING_SUPABASE } = require('./helpers');
    test('x', async ({ request }) => {
      await request.post(\`\${STAGING_SUPABASE}/auth/v1/token?grant_type=password\`, {
        data: { email: identityEmail('admin'), password: 'p' },
      });
    });`;
  assert.equal(adminSignInViolations('direct.spec.js', direct).length, 1);

  const localHelper = `async function signInSession(request, role) {
      return request.post('/auth/v1/token?grant_type=password', { data: { email: identityEmail(role) } });
    }
    test('x', async ({ request }) => { await signInSession(request, 'admin'); });`;
  assert.match(adminSignInViolations('local.spec.js', localHelper).join('\n'), /local signInSession\(\)/);

  const dynamicRole = `const login = async (request, role) => request.post('/token?grant_type=password', { data: { role } });
    const role = 'admin';
    test('x', async ({ request }) => { await login(request, role); });`;
  assert.equal(adminSignInViolations('dynamic.spec.js', dynamicRole).length, 2);

  const ownMfa = "await request.post(`${STAGING_SUPABASE}/auth/v1/factors/${id}/verify`, {});";
  assert.equal(adminSignInViolations('mfa.spec.js', ownMfa).length, 1);

  const literalEmail = "const email = 'e2e-admin-smoke@staging-e2e.averlearning.com';";
  assert.equal(adminSignInViolations('email.spec.js', literalEmail).length, 1);

  const allowed = `const { signIn, signInSession } = require('./helpers');
    async function learner(request, role) { return request.post('/token?grant_type=password', { data: { role } }); }
    test('x', async ({ request }) => {
      await signIn(request, 'admin');
      await signInSession(request, 'admin');
      await learner(request, 'student');
    });`;
  assert.deepEqual(adminSignInViolations('allowed.spec.js', allowed), []);
});

// ── helpers.signInSession behaviour against a recorded GoTrue double ──────

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // RFC 6238 SHA-1 test key
const FACTOR_ID = '9a0f2a4e-0000-4000-8000-000000000001';

function response(status, body) {
  return { status: () => status, json: async () => body, text: async () => JSON.stringify(body) };
}

function fakeRequest(script) {
  const calls = [];
  return {
    calls,
    async post(url, options = {}) {
      calls.push({ url, options });
      const step = script.shift();
      assert.ok(step, `unexpected request ${url}`);
      assert.match(url, step.match);
      return response(step.status ?? 200, typeof step.body === 'function' ? step.body(options) : step.body);
    },
  };
}

const passwordStep = (factors = [{ id: FACTOR_ID, factor_type: 'totp', status: 'verified' }]) => ({
  match: /\/auth\/v1\/token\?grant_type=password$/,
  // GoTrue omits `factors` when the user has none.
  body: { access_token: 'aal1-token', refresh_token: 'r1', expires_in: 3600, user: factors ? { id: 'u', factors } : { id: 'u' } },
});
const challengeStep = (status = 200, body = { id: 'challenge-1' }) => ({
  match: new RegExp(`/auth/v1/factors/${FACTOR_ID}/challenge$`), status, body,
});
const verifyStep = (status = 200, body = { access_token: 'aal2-token', refresh_token: 'r2', expires_in: 3600 }) => ({
  match: new RegExp(`/auth/v1/factors/${FACTOR_ID}/verify$`), status, body,
});

async function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('totpCode matches the RFC 6238 SHA-1 vectors', () => {
  for (const [seconds, code] of [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [2000000000, '69279037']]) {
    assert.equal(helpers.totpCode(SECRET, seconds * 1000, { digits: 8 }), code);
  }
  assert.equal(helpers.totpCode(SECRET, 59_000), '287082');
  assert.equal(helpers.totpCode(SECRET.toLowerCase().replace(/(.{4})/g, '$1 '), 59_000), '287082');
  assert.throws(() => helpers.totpCode('not-base32!', 0), /STAGING_E2E_ADMIN_TOTP_SECRET is not valid base32/);
});

test('without the TOTP secret the admin keeps the AAL1 password session (flag off)', async () => {
  await withEnv({ E2E_PASSWORD: 'pw', [helpers.ADMIN_TOTP_ENV]: undefined }, async () => {
    const request = fakeRequest([passwordStep()]);
    const session = await helpers.signInSession(request, 'admin');
    assert.equal(session.access_token, 'aal1-token');
    assert.ok(session.expires_at > Date.now() / 1000);
    assert.equal(request.calls.length, 1);
    assert.equal(request.calls[0].options.data.email, helpers.identityEmail('admin'));
  });
});

test('with the TOTP secret the admin session is the AAL2 verify response', async () => {
  await withEnv({ E2E_PASSWORD: 'pw', [helpers.ADMIN_TOTP_ENV]: SECRET }, async () => {
    const before = Date.now();
    const request = fakeRequest([passwordStep(), challengeStep(), verifyStep()]);
    const token = await helpers.signIn(request, 'admin');
    const after = Date.now();
    assert.equal(token, 'aal2-token');
    const [, challenge, verify] = request.calls;
    assert.equal(challenge.options.headers.Authorization, 'Bearer aal1-token');
    assert.equal(verify.options.data.challenge_id, 'challenge-1');
    assert.ok([helpers.totpCode(SECRET, before), helpers.totpCode(SECRET, after)].includes(verify.options.data.code));
  });
});

test('learner roles never step up, even with the admin secret set', async () => {
  await withEnv({ E2E_PASSWORD: 'pw', [helpers.ADMIN_TOTP_ENV]: SECRET }, async () => {
    const request = fakeRequest([passwordStep()]);
    assert.equal(await helpers.signIn(request, 'student'), 'aal1-token');
    assert.equal(request.calls.length, 1);
  });
});

test('a session killed by a concurrent admin verify is retried with a fresh sign-in', async () => {
  await withEnv({ E2E_PASSWORD: 'pw', [helpers.ADMIN_TOTP_ENV]: SECRET }, async () => {
    const request = fakeRequest([
      passwordStep(), challengeStep(403, { error_code: 'session_not_found', msg: 'Session not found' }),
      passwordStep(), challengeStep(), verifyStep(),
    ]);
    assert.equal(await helpers.signIn(request, 'admin'), 'aal2-token');
    assert.equal(request.calls.length, 5);
  });
});

test('a wrong TOTP code fails loudly without retry or leaking the secret, code or tokens', async () => {
  await withEnv({ E2E_PASSWORD: 'pw-secret', [helpers.ADMIN_TOTP_ENV]: SECRET }, async () => {
    const request = fakeRequest([
      passwordStep(), challengeStep(),
      verifyStep(422, { error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' }),
    ]);
    const error = await helpers.signIn(request, 'admin').then(() => null, (e) => e);
    assert.match(String(error?.message), /admin AAL2 verify failed: HTTP 422 mfa_verification_failed/);
    const sentCode = request.calls[2].options.data.code;
    for (const secret of [SECRET, 'pw-secret', 'aal1-token', 'r1', sentCode]) {
      assert.ok(!error.message.includes(secret), 'error message must not carry a secret');
    }
  });
});

test('the secret without a verified factor points at the seed instead of falling back to AAL1', async () => {
  await withEnv({ E2E_PASSWORD: 'pw', [helpers.ADMIN_TOTP_ENV]: SECRET }, async () => {
    for (const factors of [null, [{ id: FACTOR_ID, factor_type: 'totp', status: 'unverified' }]]) {
      const request = fakeRequest([passwordStep(factors)]);
      await assert.rejects(helpers.signIn(request, 'admin'), /no verified TOTP factor; run backend\/scripts\/staging_seed\.py/);
    }
  });
});


// Exercise the executable provenance gate without network access or artifacts.
async function captureProvenance({ aal = 'aal2', secret = SECRET, factors } = {}) {
  const sha = 'a'.repeat(40);
  const token = `header.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.signature`;
  const script = [passwordStep(factors)];
  if (secret && factors !== null) {
    script.push(challengeStep(), verifyStep(200, { access_token: token, refresh_token: 'r2', expires_in: 3600 }));
  } else if (!secret) {
    script[0].body.access_token = token;
  }
  const authRequest = fakeRequest(script);
  const output = [];
  let evidence;
  const savedExitCode = process.exitCode;
  const mocks = [
    mock.method(fs, 'mkdirSync', () => undefined),
    mock.method(fs, 'writeFileSync', (_path, data) => { evidence = JSON.parse(data); }),
    mock.method(console, 'log', (line) => output.push(line)),
    mock.method(globalThis, 'fetch', async (url, options) => {
      if (url.startsWith(`${helpers.STAGING_SUPABASE}/auth/v1/`)) {
        const response = await authRequest.post(url, { headers: options.headers, data: JSON.parse(options.body) });
        return { status: response.status(), json: response.json };
      }
      if (url === 'https://staging.averlearning.com/js/runtime-config.js') {
        return { ok: true, text: async () => JSON.stringify({
          environment: 'staging', release: sha, gitRef: 'staging', apiBase: helpers.STAGING_API,
          supabaseUrl: helpers.STAGING_SUPABASE, supabaseAnonKey: 'public-staging-key',
        }) };
      }
      assert.equal(url, `${helpers.STAGING_API}/health/runtime`);
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      return { ok: true, json: async () => ({ git_sha: sha, git_branch: 'staging', environment_name: 'staging' }) };
    }),
  ];
  syncBuiltinESMExports();
  try {
    await withEnv({
      E2E_PASSWORD: 'pw-secret', STAGING_BYPASS: 'bypass-secret',
      STAGING_E2E_ADMIN_TOTP_SECRET: secret, RELEASE_SOURCE_SHA: sha, RELEASE_PROVENANCE_REQUIRED: 'true',
    }, async () => {
      const url = new URL('../tooling/capture-staging-release-provenance.mjs', import.meta.url);
      url.searchParams.set('test', String(Math.random()));
      await import(url.href);
    });
    return { evidence, output, calls: authRequest.calls, exitCode: process.exitCode };
  } finally {
    for (const mocked of mocks) mocked.mock.restore();
    syncBuiltinESMExports();
    process.exitCode = savedExitCode;
  }
}

test('release provenance completes the shared MFA flow and records AAL2 without secrets', async () => {
  const result = await captureProvenance();
  assert.equal(result.evidence.ok, true);
  assert.equal(result.evidence.admin_aal, 'aal2');
  assert.equal(result.calls.length, 3, 'password, challenge, verify');
  assert.ok(result.output.includes('Staging admin assurance: aal2'));
  const recorded = JSON.stringify([result.evidence, result.output]);
  for (const value of [SECRET, 'pw-secret', 'bypass-secret', 'header.', 'r2', result.calls[2].options.data.code]) {
    assert.ok(!recorded.includes(value), 'provenance output must not contain credentials');
  }
});

test('release provenance refuses a verify response that has not reached AAL2', async () => {
  const result = await captureProvenance({ aal: 'aal1' });
  assert.equal(result.evidence.ok, false);
  assert.equal(result.evidence.error, 'admin-aal2-required');
  assert.equal(result.exitCode, 1);
});

test('release provenance fails closed when the configured admin factor is missing', async () => {
  const result = await captureProvenance({ factors: null });
  assert.equal(result.evidence.ok, false);
  assert.match(result.evidence.error, /no verified TOTP factor/);
  assert.equal(result.exitCode, 1);
  assert.equal(result.calls.length, 1);
});

test('release provenance preserves AAL1 operation before the CI secret is configured', async () => {
  const result = await captureProvenance({ aal: 'aal1', secret: '' });
  assert.equal(result.evidence.ok, true);
  assert.equal(result.evidence.admin_aal, 'aal1');
  assert.equal(result.calls.length, 1);
});

// ── Amendment 1 (FR-020): a fresh AAL2 before each sensitive step ──────────

test('freshAdminToken runs a new password grant + TOTP verify on every call', async () => {
  await withEnv({ E2E_PASSWORD: 'pw', [helpers.ADMIN_TOTP_ENV]: SECRET }, async () => {
    const request = fakeRequest([
      passwordStep(), challengeStep(), verifyStep(),
      passwordStep(), challengeStep(), verifyStep(200, { access_token: 'aal2-token-2', refresh_token: 'r3', expires_in: 3600 }),
    ]);
    assert.equal(await helpers.freshAdminToken(request), 'aal2-token');
    assert.equal(await helpers.freshAdminToken(request), 'aal2-token-2');
    assert.equal(request.calls.filter((c) => /\/verify$/.test(c.url)).length, 2);
  });
});

test('STEP_UP_ROUTE_PATTERN names exactly the three FR-020 admin routes', () => {
  for (const path of ['/admin/users/${id}/role', '/admin/users/u1/active', '/admin/users/${encodeURIComponent(id)}/revoke-sessions']) {
    assert.match(path, helpers.STEP_UP_ROUTE_PATTERN, path);
  }
  for (const path of ['/admin/users', '/admin/users/u1/security-audit', '/admin/mfa/status', '/admin/users/u1/roles-history']) {
    assert.doesNotMatch(path, helpers.STEP_UP_ROUTE_PATTERN, path);
  }
});

test('a staging spec that calls a step-up route takes its admin token from freshAdminToken', () => {
  const offenders = specFiles.filter((file) => {
    const source = readFileSync(path.join(E2E_DIR, file), 'utf8');
    if (!helpers.STEP_UP_ROUTE_PATTERN.test(source)) return false;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    return !helperBindings(sourceFile).has('freshAdminToken') || !/await freshAdminToken\(request\)/.test(source);
  });
  assert.deepEqual(offenders, []);
});
