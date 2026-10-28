import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activationErrorMessage,
  loginDestination,
  normalizeAccessCode,
  normalizeLoginProfile,
} from '../lib/login-model.mjs';

describe('native login canonical model', () => {
  test('accepts only explicit canonical /auth/me booleans', () => {
    assert.deepEqual(normalizeLoginProfile({
      id: ' user-1 ', is_active: true, onboarding_completed: false,
    }), { id: 'user-1', isActive: true, onboardingCompleted: false });
    assert.equal(normalizeLoginProfile({ id: 'user-1', is_active: 'true', onboarding_completed: false }), null);
    assert.equal(normalizeLoginProfile({ id: 'user-1', is_active: true }), null);
    assert.equal(normalizeLoginProfile({ is_active: true, onboarding_completed: true }), null);
  });

  test('routes inactive, onboarding and ready accounts without a client-side guess', () => {
    assert.equal(loginDestination({ isActive: false, onboardingCompleted: false }), 'activate');
    assert.equal(loginDestination({ isActive: true, onboardingCompleted: false }), '/onboarding');
    assert.equal(loginDestination({ isActive: true, onboardingCompleted: true }), '/home');
  });

  test('normalizes access codes without changing their internal identity', () => {
    assert.equal(normalizeAccessCode('  ielts-test-001  '), 'IELTS-TEST-001');
    assert.equal(normalizeAccessCode(null), '');
  });

  test('reads the activation error_code and keeps the Vietnamese rate-limit copy (F09)', () => {
    assert.equal(
      activationErrorMessage(429, { detail: { error_code: 'activate_rate_limited', retry_after_s: 42, message: 'x' } }),
      'Quá nhiều lần thử kích hoạt. Vui lòng đợi vài phút rồi thử lại.',
    );
    assert.equal(
      activationErrorMessage(429, { detail: { error_code: 'activate_rate_limited', retry_after_s: 42 } }),
      'Quá nhiều lần thử kích hoạt. Vui lòng đợi vài phút rồi thử lại.',
    );
    assert.equal(
      activationErrorMessage(503, { detail: { error_code: 'activation_unavailable', message: 'm', ref: 'r1' } }),
      'Chưa kiểm tra được lượt kích hoạt. Mã CHƯA được sử dụng — vui lòng thử lại sau ít phút.',
    );
  });

  test('keeps string details, falls back to a structured message, then to the HTTP status', () => {
    assert.equal(activationErrorMessage(400, { detail: 'Bạn đã kích hoạt mã này rồi.' }), 'Bạn đã kích hoạt mã này rồi.');
    assert.equal(
      activationErrorMessage(500, { detail: { error_code: 'internal_error', message: 'Đã xảy ra lỗi nội bộ, vui lòng thử lại.' } }),
      'Đã xảy ra lỗi nội bộ, vui lòng thử lại.',
    );
    for (const payload of [{}, null, { detail: { error_code: 'unknown' } }, { detail: '  ' }, { detail: ['x'] }]) {
      assert.equal(activationErrorMessage(502, payload), 'Kích hoạt thất bại (HTTP 502).');
    }
  });
});
