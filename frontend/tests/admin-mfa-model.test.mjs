// ADMINAAL2-0032 T010 — gate and /admin/mfa decisions (lib/admin-mfa-model.mjs).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  abandonedTotpFactors,
  adminGateDecision,
  adminMfaMode,
  adminMfaUrl,
  isAdminMfaPath,
  isCompleteTotpCode,
  isInactiveError,
  isMfaRequiredError,
  mfaErrorKind,
  nextFactorName,
  normalizeAdminMfaStatus,
  normalizeTotpCode,
  sanitizeAdminNext,
  verifiedTotpFactors,
} from '../lib/admin-mfa-model.mjs';

const admin = { id: 'a1', email: 'a@x.test', role: 'admin', is_active: true };
const aal1Enforced = { aal: 'aal1', enforce: true, verified_factor_count: 1, next_step: 'challenge' };
const aal1ReportOnly = { aal: 'aal1', enforce: false, verified_factor_count: 0, next_step: 'enroll' };
const aal2 = { aal: 'aal2', enforce: true, verified_factor_count: 1, next_step: 'none' };

describe('normalizeAdminMfaStatus', () => {
  test('accepts the exact AdminMfaStatusOut shape and drops extra keys', () => {
    assert.deepEqual(normalizeAdminMfaStatus({ ...aal2, extra: 'x' }), aal2);
  });
  test('fails closed on the `{}` a verifier catch-all returns and on loose types', () => {
    assert.equal(normalizeAdminMfaStatus({}), null);
    assert.equal(normalizeAdminMfaStatus(null), null);
    assert.equal(normalizeAdminMfaStatus([]), null);
    assert.equal(normalizeAdminMfaStatus({ ...aal2, aal: 'AAL2' }), null);
    assert.equal(normalizeAdminMfaStatus({ ...aal2, enforce: 'true' }), null);
    assert.equal(normalizeAdminMfaStatus({ ...aal2, verified_factor_count: -1 }), null);
    assert.equal(normalizeAdminMfaStatus({ ...aal2, verified_factor_count: 1.5 }), null);
    assert.equal(normalizeAdminMfaStatus({ ...aal2, next_step: 'skip' }), null);
  });
});

describe('adminGateDecision (FR-013)', () => {
  test('enforced AAL1 admin is redirected; children never mount', () => {
    assert.equal(adminGateDecision(admin, aal1Enforced), 'redirect');
  });
  test('AAL2 admin gets in, with or without enforcement', () => {
    assert.equal(adminGateDecision(admin, aal2), 'ready');
    assert.equal(adminGateDecision(admin, { ...aal2, enforce: false }), 'ready');
  });
  test('report-only AAL1 admin gets in under the banner', () => {
    assert.equal(adminGateDecision(admin, aal1ReportOnly), 'banner');
  });
  test('inactive admin is refused before any assurance', () => {
    assert.equal(adminGateDecision({ ...admin, is_active: false }, aal2), 'inactive');
  });
  test('unreported is_active relies on the backend status probe', () => {
    assert.equal(adminGateDecision({ ...admin, is_active: null }, aal2), 'ready');
  });
  test('non-admin and missing status are denied', () => {
    assert.equal(adminGateDecision({ ...admin, role: 'instructor' }, aal2), 'denied');
    assert.equal(adminGateDecision(null, aal2), 'denied');
    assert.equal(adminGateDecision(admin, null), 'denied');
  });
});

describe('sanitizeAdminNext (FR-012)', () => {
  test('keeps same-origin /admin/ paths with query and hash', () => {
    assert.equal(sanitizeAdminNext('/admin/users?tab=codes'), '/admin/users?tab=codes');
    assert.equal(sanitizeAdminNext('/admin/system/alerts#x'), '/admin/system/alerts#x');
  });
  test('falls back to /admin for everything else', () => {
    for (const raw of [
      null, undefined, '', 'admin/users', '/admin', '/home', '/instructor', '//evil.test/admin/x',
      'https://evil.test/admin/x', '/\\evil.test/admin', '/admin/../login', '/admin/%2e%2e/login',
      '/admin/mfa', '/admin/mfa?next=/admin/x', '/admin/mfa/', '/admin/x\n', 'javascript:alert(1)',
    ]) {
      assert.equal(sanitizeAdminNext(raw), '/admin', String(raw));
    }
  });
});

test('adminMfaUrl encodes the current path + search as next', () => {
  assert.equal(adminMfaUrl('/admin/users', '?tab=codes'), '/admin/mfa?next=%2Fadmin%2Fusers%3Ftab%3Dcodes');
  assert.equal(sanitizeAdminNext(new URLSearchParams(adminMfaUrl('/admin/users', '?tab=codes').split('?')[1]).get('next')), '/admin/users?tab=codes');
  assert.equal(isAdminMfaPath('/admin/mfa'), true);
  assert.equal(isAdminMfaPath('/admin/mfaX'), false);
});

test('transport errors are classified by status + detail only', () => {
  const mfa = { status: 403, detail: { code: 'mfa_required', next_step: 'enroll', message: 'm' } };
  assert.equal(isMfaRequiredError(mfa), true);
  assert.equal(isMfaRequiredError({ ...mfa, status: 401 }), false);
  assert.equal(isMfaRequiredError({ status: 403, detail: 'mfa_required' }), false);
  assert.equal(isInactiveError({ status: 403, detail: 'Tài khoản chưa được kích hoạt' }), true);
  assert.equal(isInactiveError({ status: 403, detail: 'Admin only' }), false);
  assert.equal(isInactiveError(null), false);
});

describe('/admin/mfa mode and factors', () => {
  const factors = [
    { id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Ứng dụng xác thực' },
    { id: 'f2', factor_type: 'totp', status: 'unverified', friendly_name: 'Dự phòng' },
    { id: 'p1', factor_type: 'phone', status: 'verified' },
    { bad: true },
  ];
  test('AAL2 manages; AAL1 with a verified TOTP challenges; otherwise enrolls', () => {
    assert.equal(adminMfaMode(aal2, factors), 'manage');
    assert.equal(adminMfaMode(aal1Enforced, factors), 'challenge');
    assert.equal(adminMfaMode(aal1Enforced, [factors[1]]), 'enroll');
    assert.equal(adminMfaMode(aal1Enforced, null), 'enroll');
  });
  test('splits verified and abandoned TOTP factors', () => {
    assert.deepEqual(verifiedTotpFactors(factors).map((f) => f.id), ['f1']);
    assert.deepEqual(abandonedTotpFactors(factors).map((f) => f.id), ['f2']);
  });
  test('picks a friendly name GoTrue will not refuse as a duplicate', () => {
    assert.equal(nextFactorName('Dự phòng', []), 'Dự phòng');
    assert.equal(nextFactorName('Dự phòng', factors), 'Dự phòng 2');
    assert.equal(nextFactorName('Dự phòng', [...factors, { id: 'f3', friendly_name: 'Dự phòng 2' }]), 'Dự phòng 3');
  });
  test('codes are six digits only', () => {
    assert.equal(normalizeTotpCode(' 12-34 567 '), '123456');
    assert.equal(isCompleteTotpCode('123456'), true);
    assert.equal(isCompleteTotpCode('12345'), false);
  });
});

test('Supabase Auth MFA errors map to the ui-states', () => {
  assert.equal(mfaErrorKind({ status: 422, code: 'mfa_verification_failed' }), 'wrong_code');
  assert.equal(mfaErrorKind({ status: 422, code: 'mfa_challenge_expired' }), 'wrong_code');
  assert.equal(mfaErrorKind({ status: 422 }), 'wrong_code');
  assert.equal(mfaErrorKind({ status: 422, code: 'mfa_factor_name_conflict' }), 'other');
  assert.equal(mfaErrorKind({ status: 429, code: 'over_request_rate_limit' }), 'rate_limited');
  assert.equal(mfaErrorKind({ status: 403, code: 'insufficient_aal' }), 'needs_aal2');
  assert.equal(mfaErrorKind({ name: 'AuthRetryableFetchError', status: 0 }), 'network');
  assert.equal(mfaErrorKind({ status: 503 }), 'network');
  assert.equal(mfaErrorKind(null), 'other');
});
