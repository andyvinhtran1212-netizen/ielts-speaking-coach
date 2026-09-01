import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBulkAck,
  normalizeExerciseAck,
  normalizeExerciseList,
  normalizeGenerationAck,
  parseTargetWords,
  targetStatus,
} from '../lib/admin-vocab-exercises-model.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const row = { id: ID, exercise_type: 'D1', status: 'draft', content_payload: { sentence: 'This ___ matters.', answer: 'work', distractors: ['play', 'rest', 'sleep'] }, created_at: '2026-08-15T00:00:00Z', reviewed_at: null };

describe('Admin Vocabulary Exercises canonical models', () => {
  test('normalizes status-scoped D1 rows without hiding incomplete payloads', () => {
    assert.equal(normalizeExerciseList([row], 'draft', 200)?.[0].payloadComplete, true);
    assert.equal(normalizeExerciseList([{ ...row, content_payload: {} }], 'draft', 200)?.[0].payloadComplete, false);
    assert.equal(normalizeExerciseList([{ ...row, status: 'published' }], 'draft', 200), null);
    assert.equal(normalizeExerciseList([{ ...row, id: 'bad' }], 'draft', 200), null);
    assert.equal(normalizeExerciseList([row, row], 'draft', 200), null);
  });

  test('pins single transition identity and target status', () => {
    assert.equal(targetStatus('unpublish'), 'draft');
    assert.equal(normalizeExerciseAck({ ...row, status: 'published' }, ID, 'publish')?.id, ID);
    assert.equal(normalizeExerciseAck({ ...row, id: ID2, status: 'published' }, ID, 'publish'), null);
    assert.equal(normalizeExerciseAck({ ...row, status: 'draft' }, ID, 'publish'), null);
  });

  test('requires bulk ACK to cover exactly the requested set', () => {
    assert.deepEqual(normalizeBulkAck({ action: 'reject', affected: 2, ids: [ID2, ID] }, [ID, ID2], 'reject')?.ids, [ID2, ID]);
    assert.equal(normalizeBulkAck({ action: 'reject', affected: 1, ids: [ID] }, [ID, ID2], 'reject'), null);
    assert.equal(normalizeBulkAck({ action: 'publish', affected: 2, ids: [ID, ID2] }, [ID, ID2], 'reject'), null);
  });

  test('validates synchronous completed and partial Gemini summaries', () => {
    const base = { job_id: ID, inserted_count: 2, requested_count: 2, word_count: 2, total_chunks: 1, successful_chunks: 1, failed_chunks: 0, estimated_cost_usd: 0.001, message: 'done' };
    assert.equal(normalizeGenerationAck({ ...base, status: 'completed' }, ['one', 'two'], 2)?.insertedCount, 2);
    assert.equal(normalizeGenerationAck({ ...base, status: 'partial', successful_chunks: 0, failed_chunks: 1, inserted_count: 0 }, ['one', 'two'], 2)?.status, 'partial');
    assert.equal(normalizeGenerationAck({ ...base, status: 'completed', failed_chunks: 1 }, ['one', 'two'], 2), null);
    assert.equal(normalizeGenerationAck({ ...base, status: 'completed', requested_count: 10 }, ['one', 'two'], 2), null);
    assert.equal(normalizeGenerationAck({ ...base, status: 'partial', successful_chunks: 0, failed_chunks: 1 }, ['one', 'two'], 2), null);
  });

  test('deduplicates target words case-insensitively', () => {
    assert.deepEqual(parseTargetWords(' Mitigate, adapt\nmitigate,  thrive '), ['Mitigate', 'adapt', 'thrive']);
  });
});
