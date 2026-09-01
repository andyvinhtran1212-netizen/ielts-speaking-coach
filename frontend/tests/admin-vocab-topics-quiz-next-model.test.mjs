import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBankList,
  normalizeDeleteAck,
  normalizeImportResult,
  normalizeTopicBundle,
  normalizeTopicList,
} from '../lib/admin-vocab-topics-quiz-model.mjs';

const topicId = '00000000-0000-4000-8000-000000000301';
const bankId = '00000000-0000-4000-8000-000000000302';
const topic = { id: topicId, slug: 'work', title: 'Work', skill_area: 'vocab', title_vi: null, description: null, order: 0, is_published: true };
const bank = { id: bankId, topic_id: topicId, code: 'L02', title: null, skill_area: 'vocab', words_count: 20, source: null, version: 1, is_published: true, updated_at: null };

describe('Admin Vocabulary Topics + Quiz strict models', () => {
  test('keeps canonical nullable fields while rejecting wrong scope or malformed rows', () => {
    assert.equal(normalizeTopicList([topic], 'vocab')?.[0].titleVi, '');
    assert.equal(normalizeTopicList([topic], 'grammar'), null);
    assert.equal(normalizeBankList([bank], 'vocab')?.[0].title, '');
    assert.equal(normalizeBankList([{ ...bank, id: 'bad' }], 'vocab'), null);
  });

  test('requires bundle counts to match the canonical rows', () => {
    const card = { id: '00000000-0000-4000-8000-000000000303', slug: 'mitigate', headword: 'mitigate', category: 'work', level: null, part_of_speech: null, audio_status: null, updated_at: null };
    const bundle = { topic, vocab_cards: [card], quiz_banks: [{ ...bank, topic_id: undefined }], counts: { vocab_cards: 1, quiz_banks: 1 } };
    assert.equal(normalizeTopicBundle(bundle, 'vocab', topicId)?.banks[0].topicId, topicId);
    assert.equal(normalizeTopicBundle({ ...bundle, counts: { vocab_cards: 0, quiz_banks: 1 } }, 'vocab', topicId), null);
  });

  test('accepts exact dry-run/commit results and rejects mismatched error totals or IDs', () => {
    const result = { dry_run: true, meta: { code: 'L02', title: null, skill_area: 'vocab' }, questions: [{ index: 1, qid: 'L02-Q1', item_key: 'mitigate', type: 'mcq', skill: 'meaning', validation_errors: [] }], validation_errors: [], summary: { words: 20, questions: 1, errors: 0, pools: 1 }, committed_bank_id: null };
    assert.equal(normalizeImportResult(result, true)?.meta.code, 'L02');
    assert.equal(normalizeImportResult({ ...result, summary: { ...result.summary, errors: 1 } }, true), null);
    assert.equal(normalizeImportResult({ ...result, dry_run: false, committed_bank_id: 'bad' }, false), null);
    assert.equal(normalizeImportResult({ ...result, questions: [] }, true), null);
  });

  test('delete ACK must match both id and deleted=true', () => {
    assert.equal(normalizeDeleteAck({ id: bankId, deleted: true }, bankId), true);
    assert.equal(normalizeDeleteAck({ id: topicId, deleted: true }, bankId), false);
  });
});
