import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  formatPilotMetric,
  isPilotSampleReady,
  normalizePilotMetrics,
} from '../lib/admin-vocab-pilot-metrics-model.mjs';

const PAGE = fs.readFileSync(new URL('../app/(authed-admin-vocab)/admin/vocab/pilot-metrics/admin-vocab-pilot-metrics.tsx', import.meta.url), 'utf8');

const delayed = {
  eligible_unit_starts: 0,
  assessed_unit_starts: 0,
  attempts: 0,
  transfer_attempts: 0,
  followup_rate_percent: null,
  accuracy_percent: null,
  transfer_success_percent: null,
};

const payload = {
  period_days: 90,
  computed_at: '2026-08-27T00:00:00+00:00',
  cohort: { enabled_users: 12, learners_started: 4, unit_starts: 7 },
  runtime_flags: {
    vocab_units_read: true,
    vocab_unit_attempts_write: true,
    vocab_unit_recommendations: false,
    vocab_ai_scoring: false,
  },
  immediate: {
    eligible_unit_starts: 6,
    completed_unit_starts: 5,
    attempts: 24,
    completion_rate_percent: 83.3,
    accuracy_percent: 75,
  },
  day7: delayed,
  day28: delayed,
  recommendations: {
    created: 3, opened: 1, completed: 0, dismissed: 0,
    open_rate_percent: 33.3, completion_rate_percent: 0,
  },
  units: [{
    unit_slug: 'prefer-x-to-y', display_headword: 'prefer X to Y',
    started: 4, immediate_eligible: 4, immediate_completed: 3,
    day7_eligible: 0, day7_assessed: 0, day7_accuracy_percent: null,
    day28_eligible: 0, day28_assessed: 0, day28_accuracy_percent: null,
  }],
};

test('keeps unavailable delayed outcomes as null instead of manufacturing zero', () => {
  const normalized = normalizePilotMetrics(payload);
  assert.equal(normalized.day7.accuracy_percent, null);
  assert.equal(normalized.day28.transfer_success_percent, null);
  assert.equal(formatPilotMetric(normalized.day7.accuracy_percent, '%'), 'Chưa đủ dữ liệu');
});

test('rejects out-of-range percentages and incomplete runtime gate truth', () => {
  assert.equal(normalizePilotMetrics({
    ...payload,
    immediate: { ...payload.immediate, accuracy_percent: 101 },
  }), null);
  const { vocab_ai_scoring: _removed, ...flags } = payload.runtime_flags;
  assert.equal(normalizePilotMetrics({ ...payload, runtime_flags: flags }), null);
  const { accuracy_percent: _missing, ...incompleteImmediate } = payload.immediate;
  assert.equal(normalizePilotMetrics({ ...payload, immediate: incompleteImmediate }), null);
});

test('sample readiness is deliberately conservative', () => {
  assert.equal(isPilotSampleReady(9), false);
  assert.equal(isPilotSampleReady(10), true);
});

test('cohort mutation requires canonical readback and exposes failures as alerts', () => {
  assert.match(PAGE, /if \(!await load\(days\)\)/);
  assert.match(PAGE, /Backend đã xác nhận thay đổi nhưng chưa đọc lại được cohort canonical/);
  assert.match(PAGE, /role=\{notice\.kind === 'error' \? 'alert' : 'status'\}/);
  assert.match(PAGE, /Chỉ cohort đã đi hết toàn bộ cửa sổ/);
});
