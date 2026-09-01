import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  d1Query,
  lemmaQuery,
  normalizeD1ListPayload,
  normalizeD1PatchAck,
  normalizeLemmaCreateAck,
  normalizeLemmaListPayload,
} from '../lib/admin-vocab-curation-model.mjs';

const d1Row = {
  id: '00000000-0000-4000-8000-000000000201',
  user_id: '00000000-0000-4000-8000-000000000202',
  vocabulary_id: '00000000-0000-4000-8000-000000000203',
  context_sentence: 'We need to ___ the risk.',
  target_answer: 'mitigate',
  acceptable_variants: ['mitigates'],
  hint: 'reduce',
  source_evidence_substring: 'mitigate the risk',
  generated_by: 'haiku',
  generated_at: '2026-08-15T00:00:00Z',
  is_active: true,
  attempt_count: 0,
  last_used_at: null,
  created_at: '2026-08-15T00:00:00Z',
  headword: 'mitigate',
};
const lemmaRow = {
  id: '00000000-0000-4000-8000-000000000211',
  original_word: 'children',
  lemma: 'child',
  pos_tag: 'NOUN',
  notes: null,
  created_at: '2026-08-15T00:00:00Z',
};

describe('Admin Vocabulary curation canonical models', () => {
  test('normalizes the exact D1 list shape and preserves zero attempts', () => {
    const result = normalizeD1ListPayload({ items: [d1Row], total: 1, offset: 0, limit: 50 });
    assert.equal(result.items[0].attemptCount, 0);
    assert.equal(result.items[0].headword, 'mitigate');
    assert.equal(result.items[0].lastUsedAt, '');
    assert.equal(normalizeD1ListPayload({ items: [], total: '1', offset: 0, limit: 50 }), null);
  });

  test('drops malformed nested D1 rows rather than trusting admin HTML', () => {
    const unsafe = { ...d1Row, id: 'not-a-uuid', context_sentence: '<img onerror=alert(1)>' };
    assert.deepEqual(normalizeD1ListPayload({ items: [d1Row, unsafe], total: 2, offset: 0, limit: 50 }).items.map((row) => row.id), [d1Row.id]);
  });

  test('requires exact D1 write acknowledgement fields', () => {
    assert.deepEqual(normalizeD1PatchAck({ ok: true, id: d1Row.id, updated_fields: ['hint', 'target_answer'] }, d1Row.id, ['target_answer', 'hint']), { ok: true, id: d1Row.id, updatedFields: ['hint', 'target_answer'] });
    assert.equal(normalizeD1PatchAck({ ok: true, id: d1Row.id, updated_fields: ['hint'] }, d1Row.id, ['target_answer', 'hint']), null);
    assert.equal(normalizeD1PatchAck({ ok: true, id: '00000000-0000-4000-8000-000000000299', updated_fields: ['hint'] }, d1Row.id, ['hint']), null);
  });

  test('pins filter names and validates optional D1 user UUID', () => {
    assert.equal(d1Query({ source: 'fallback_evidence', active: 'false', userId: d1Row.user_id, offset: 50, limit: 50 }), `source=fallback_evidence&active=false&user_id=${d1Row.user_id}&offset=50&limit=50`);
    assert.equal(d1Query({ source: 'unknown' }), null);
    assert.equal(d1Query({ userId: 'student-1' }), null);
  });

  test('normalizes lemma list/create contracts and rejects an empty item', () => {
    const list = normalizeLemmaListPayload({ items: [lemmaRow], total: 1, offset: 0, limit: 100 });
    assert.equal(list.items[0].originalWord, 'children');
    assert.deepEqual(normalizeLemmaCreateAck({ ok: true, item: lemmaRow }), { ok: true, item: list.items[0] });
    assert.equal(normalizeLemmaCreateAck({ ok: true, item: null }), null);
  });

  test('builds the backend prefix-search query without invented filters', () => {
    assert.equal(lemmaQuery({ search: ' child ', offset: 100, limit: 100 }), 'search=child&offset=100&limit=100');
    assert.equal(lemmaQuery({ search: '', offset: -1, limit: 100 }), null);
  });
});
