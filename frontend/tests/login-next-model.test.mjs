import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
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
    assert.equal(loginDestination({ isActive: true, onboardingCompleted: false }), '/onboarding.html');
    assert.equal(loginDestination({ isActive: true, onboardingCompleted: true }), '/home');
  });

  test('normalizes access codes without changing their internal identity', () => {
    assert.equal(normalizeAccessCode('  ielts-test-001  '), 'IELTS-TEST-001');
    assert.equal(normalizeAccessCode(null), '');
  });
});
