import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCorrectionContentHealth,
  normalizeCorrectionPerformance,
  normalizeCorrectionTimeline,
} from '../lib/admin-mock-corrections-model.mjs';

test('performance rejects a malformed root and filters malformed items', () => {
  assert.equal(normalizeCorrectionPerformance({ items: [] }), null);
  const value = normalizeCorrectionPerformance({
    summary: { accuracy: 0.5 },
    items: [
      { id: 'one', skill: 'reading', question_number: 7 },
      { id: 'bad', skill: 'writing', question_number: 1 },
    ],
  });
  assert.equal(value.items.length, 1);
  assert.equal(value.malformedCount, 1);
});

test('timeline keeps only event-shaped rows', () => {
  const value = normalizeCorrectionTimeline({ item: { id: 'one' }, events: [
    { event_name: 'correction_result_seen' }, null,
  ] });
  assert.equal(value.events.length, 1);
});

test('content health requires a version map and numeric count', () => {
  assert.equal(normalizeCorrectionContentHealth({ object_count: 12 }), null);
  assert.equal(normalizeCorrectionContentHealth({ object_count: 2880, versions: {} }).object_count, 2880);
});
