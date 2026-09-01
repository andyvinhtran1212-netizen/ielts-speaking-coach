import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOnboardingPayload,
  normalizeOnboardingProfile,
  onboardingDestination,
  validateOnboardingStep,
} from '../lib/onboarding-model.mjs';

const completeDraft = {
  targetBand: '7.0',
  examDate: '2027-04-05',
  selfLevel: 'upper_intermediate',
  topic: 'technology',
};

describe('native onboarding canonical model', () => {
  test('accepts only strict /auth/me identity and boolean truth', () => {
    assert.deepEqual(normalizeOnboardingProfile({
      id: ' user-1 ', is_active: true, onboarding_completed: false,
    }), { id: 'user-1', isActive: true, onboardingCompleted: false });
    assert.equal(normalizeOnboardingProfile({ id: 'user-1', is_active: 'true', onboarding_completed: false }), null);
    assert.equal(normalizeOnboardingProfile({ id: 'user-1', is_active: true }), null);
  });

  test('fails closed for inactive and completed accounts', () => {
    assert.equal(onboardingDestination({ isActive: false, onboardingCompleted: false }), '/login');
    assert.equal(onboardingDestination({ isActive: true, onboardingCompleted: true }), '/home');
    assert.equal(onboardingDestination({ isActive: true, onboardingCompleted: false }), null);
  });

  test('validates each step without accepting invented enum values', () => {
    assert.equal(validateOnboardingStep(1, { ...completeDraft, targetBand: '9.0' }).step, 1);
    assert.equal(validateOnboardingStep(1, { ...completeDraft, examDate: '2027-02-30' }).step, 1);
    assert.equal(validateOnboardingStep(2, { ...completeDraft, selfLevel: 'expert' }).step, 2);
    assert.equal(validateOnboardingStep(3, { ...completeDraft, topic: 'other' }).step, 3);
  });

  test('builds exactly the canonical five-field profile mutation', () => {
    assert.deepEqual(buildOnboardingPayload(completeDraft), {
      ok: true,
      payload: {
        target_band: 7,
        exam_date: '2027-04-05',
        self_level: 'upper_intermediate',
        preferred_topics: ['technology'],
        onboarding_completed: true,
      },
    });
    assert.equal(buildOnboardingPayload({ ...completeDraft, examDate: '' }).payload.exam_date, null);
  });
});
