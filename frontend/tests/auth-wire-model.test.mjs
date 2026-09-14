import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  normalizeAuthActiveStatus,
  normalizeAuthMe,
  normalizeAuthProfile,
  normalizeAuthRoleIdentity,
} from '../lib/auth-wire-model.mjs';

const profile = {
  id: '00000000-0000-4000-8000-000000000111',
  email: 'learner@example.test',
  display_name: 'Learner',
  avatar_url: null,
  role: 'user',
  is_active: true,
  onboarding_completed: true,
  target_band: 7,
  exam_date: null,
  self_level: 'upper_intermediate',
  preferred_topics: ['education'],
};

const me = {
  ...profile,
  permissions: ['practice_single'],
  vocab_bank_enabled: true,
  d1_enabled: false,
  d3_enabled: false,
  flashcard_enabled: true,
  vocab_curated_enabled: false,
};

describe('auth wire normalizers', () => {
  test('accept exact canonical identity and profile payloads', () => {
    assert.deepEqual(normalizeAuthRoleIdentity(me), {
      id: me.id, email: me.email, role: me.role,
    });
    assert.equal(normalizeAuthMe(me), me);
    const full = {
      ...profile,
      timezone: 'Asia/Ho_Chi_Minh',
      weekly_goal: 5,
      notification_email: true,
      joined_at: '2026-01-01T00:00:00Z',
      stats: { total_sessions: 4, avg_band: 6.5, joined_at: null },
    };
    assert.equal(normalizeAuthProfile(full), full);
    assert.deepEqual(normalizeAuthActiveStatus({ is_active: false }), { is_active: false });
  });

  test('rejects truthy authorization flags and malformed permission lists', () => {
    assert.equal(normalizeAuthMe({ ...me, is_active: 'true' }), null);
    assert.equal(normalizeAuthMe({ ...me, permissions: ['practice_single', null] }), null);
    assert.equal(normalizeAuthMe({ ...me, flashcard_enabled: 1 }), null);
    assert.equal(normalizeAuthActiveStatus({ is_active: 'false' }), null);
    assert.equal(normalizeAuthRoleIdentity({ id: me.id, email: me.email, role: '' }), null);
  });

  test('rejects incomplete profile statistics and non-finite bands', () => {
    const full = {
      ...profile,
      timezone: 'Asia/Ho_Chi_Minh',
      weekly_goal: 5,
      notification_email: true,
      joined_at: null,
      stats: { total_sessions: 1, avg_band: 6.5, joined_at: null },
    };
    assert.equal(normalizeAuthProfile({ ...full, stats: { total_sessions: -1 } }), null);
    assert.equal(normalizeAuthProfile({ ...full, target_band: Number.NaN }), null);
  });
});
