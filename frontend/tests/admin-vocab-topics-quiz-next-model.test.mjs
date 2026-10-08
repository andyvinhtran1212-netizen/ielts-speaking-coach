import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bankCanManage,
  bankStateLabel,
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

  test('distinguishes current, paused and preserved banks using canonical fields rather than codes or published', () => {
    const grammar = { ...bank, skill_area: 'grammar', grammar_canonical_code: 'G-tenses-present-simple',
      grammar_revision: 'a'.repeat(64), grammar_is_current: true, grammar_new_starts_enabled: true };
    const current = normalizeBankList([grammar], 'grammar')[0];
    assert.equal(bankStateLabel(current), 'Bản hiện hành · Cho phép lượt mới');
    assert.equal(bankCanManage(current), false);
    const paused = normalizeBankList([{ ...grammar, grammar_new_starts_enabled: false }], 'grammar')[0];
    assert.equal(bankStateLabel(paused), 'Bản hiện hành · Tạm ngừng lượt mới');
    const legacy = normalizeBankList([{ ...grammar, grammar_is_current: false }], 'grammar')[0];
    assert.equal(bankStateLabel(legacy), 'Bản gốc · Giữ lịch sử');
    assert.equal(bankCanManage(legacy), false);
    const unmanaged = normalizeBankList([{ ...grammar, code: 'G-looking-managed~abcdef',
      grammar_canonical_code: null, grammar_revision: null, grammar_is_current: false }], 'grammar')[0];
    assert.equal(bankStateLabel(unmanaged), 'published');
    assert.equal(bankCanManage(unmanaged), true);
  });

  test('missing or malformed Grammar revision metadata remains unknown and blocks generic mutation', () => {
    const grammar = { ...bank, skill_area: 'grammar', grammar_canonical_code: 'G-tenses-present-simple',
      grammar_revision: 'a'.repeat(64), grammar_is_current: true, grammar_new_starts_enabled: true };
    for (const changed of [{ ...bank, skill_area: 'grammar' }, { ...grammar, grammar_revision: null },
      { ...grammar, grammar_is_current: 1 }, { ...grammar, grammar_new_starts_enabled: 'false' },
      { ...grammar, grammar_canonical_code: [] }, { ...grammar, grammar_canonical_code: null }]) {
      const value = normalizeBankList([changed], 'grammar')[0];
      assert.equal(bankStateLabel(value), 'Chưa xác minh phiên bản');
      assert.equal(bankCanManage(value), false);
    }
    assert.equal(bankCanManage(normalizeBankList([bank], 'vocab')[0]), true);
    assert.equal(bankCanManage(normalizeBankList([{ ...bank, grammar_is_current: false }], 'vocab')[0]), false);
  });
});
