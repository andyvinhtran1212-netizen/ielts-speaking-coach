// ADMINAAL2-0032 T010 — source contract for /admin/mfa, the gate wiring and
// the shared AAL2 status stub in the Next-native admin verifiers.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const ROUTE = join('app', '(authed-admin-mfa)', 'admin', 'mfa');
const PAGE = read(ROUTE, 'page.tsx');
const VIEW = read(ROUTE, 'admin-mfa.tsx');
const GATE = read('components', 'admin-access-gate.tsx');
const API = read('lib', 'admin-mfa-api.ts');

test('/admin/mfa is not wrapped in AdminAccessGate (the gate redirects there)', () => {
  assert.doesNotMatch(PAGE, /<AdminAccessGate|admin-access-gate/);
  assert.match(PAGE, /<AdminMfa \/>/);
  assert.match(read('app', '(authed-admin-mfa)', 'layout.tsx'), /AuthedShell/);
});

test('the page runs its own signed-in + admin + active gate and reads the backend status', () => {
  assert.match(VIEW, /status === 'signed-out'\) window\.location\.replace\('\/login'\)/);
  assert.match(VIEW, /identity\.role !== 'admin' \|\| identity\.is_active === false/);
  assert.match(VIEW, /await getAdminMfaStatus\(\)/);
  assert.match(VIEW, /window\.location\.replace\(nextTarget\(\)\)/);
  assert.match(VIEW, /sanitizeAdminNext\(/);
});

test('factors go through the shared Supabase client only', () => {
  assert.match(VIEW, /window\.getSupabase\(\)/);
  assert.doesNotMatch(VIEW, /createClient|getBrowserSupabase|@supabase\/supabase-js/);
  for (const call of ['listFactors', 'enroll', 'challenge', 'verify', 'unenroll']) assert.match(VIEW, new RegExp(`mfa\\.${call}\\(`));
  // An abandoned unverified factor is removed before a new enroll.
  assert.match(VIEW, /abandonedTotpFactors\(factors\)[\s\S]*mfa\.unenroll[\s\S]*mfa\.enroll\(/);
});

test('ui-states copy and accessibility hooks', () => {
  assert.match(VIEW, /inputMode="numeric"/);
  assert.match(VIEW, /autoComplete="one-time-code"/);
  assert.match(VIEW, /aria-live="assertive"/);
  assert.match(VIEW, /alt=\{ADMIN_MFA_COPY\.qrAlt\}/);
  assert.match(VIEW, /width=\{192\} height=\{192\}/);
  assert.match(VIEW, /'Bắt đầu thiết lập'/);
  assert.match(VIEW, /Thêm yếu tố dự phòng/);
  assert.match(VIEW, /<Dialog/);
});

test('the gate probes assurance after the role check and keeps its existing contract', () => {
  const role = GATE.indexOf('const profile = await getAuthorizationIdentity()');
  const probe = GATE.indexOf('await getAdminMfaStatus()');
  assert.ok(role > 0 && probe > role, 'status probe must follow the /auth/me role check');
  assert.match(GATE, /window\.location\.replace\(access\.target\)/);
  assert.match(GATE, /ACCOUNT_INACTIVE_EVENT/);
  assert.match(GATE, /role="status"/);
});

test('typed status client binds the generated OpenAPI path and fails closed', () => {
  assert.match(API, /ApiGetJson<'\/admin\/mfa\/status'>/);
  assert.match(API, /normalizeAdminMfaStatus/);
  assert.match(API, /throw new Error/);
});

test('every Next-native admin verifier registers the shared AAL2 status stub after its catch-all', () => {
  const tooling = join(ROOT, 'tooling');
  const verifiers = readdirSync(tooling).filter((name) => /^verify-admin-.*\.mjs$/.test(name) && name !== 'verify-admin-mfa-flow.mjs');
  assert.ok(verifiers.length >= 60, `expected the 60 admin verifiers, found ${verifiers.length}`);
  const others = ['verify-assigned-grammar-flow.mjs', 'verify-csp-nonce-report-only-flow.mjs', 'verify-dictation-versioned-flow.mjs',
    'verify-vocabulary-class-sets-flow.mjs', 'verify-mock-ui-remediation-flow.mjs', 'verify-shared-runtime-client-navigation.mjs'];
  for (const name of [...verifiers, ...others]) {
    const source = readFileSync(join(tooling, name), 'utf8');
    assert.match(source, /import \{ stubAdminMfaStatus \} from '\.\/admin-mfa-stub\.mjs';/, name);
    const catchAll = source.search(/\.route\('\*\*\/\*'/);
    const stub = source.indexOf('await stubAdminMfaStatus(');
    assert.ok(catchAll >= 0 && stub > catchAll, `${name}: stub must be registered after the catch-all (newest route wins)`);
  }
});
