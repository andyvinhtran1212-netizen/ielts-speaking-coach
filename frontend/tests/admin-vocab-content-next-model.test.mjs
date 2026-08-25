import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeAudioAck,
  normalizeBulkDeleteAck,
  normalizeDeleteAck,
  normalizeVocabDetail,
  normalizeVocabImport,
  normalizeVocabList,
  parseJsonList,
  parseStringList,
} from '../lib/admin-vocab-content-model.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const row = { id: ID, slug: 'holistic', headword: 'Holistic', category: 'health', level: 'B2', part_of_speech: 'adjective', pronunciation: '/həʊˈlɪstɪk/', gloss_vi: 'toàn diện', audio_headword: null, audio_example: '', audio_status: 'pending', updated_at: '2026-08-15T00:00:00Z' };

describe('Admin Vocabulary Content canonical models', () => {
  test('normalizes a strictly scoped page and rejects malformed counts or rows', () => {
    assert.equal(normalizeVocabList({ words: [row], total: 1, limit: 50, offset: 0 }, 50, 0)?.words[0].headword, 'Holistic');
    assert.equal(normalizeVocabList({ words: [row], total: '1', limit: 50, offset: 0 }, 50, 0), null);
    assert.equal(normalizeVocabList({ words: [{ ...row, id: 'bad' }], total: 1, limit: 50, offset: 0 }, 50, 0), null);
    assert.equal(normalizeVocabList({ words: [row], total: 1, limit: 25, offset: 0 }, 50, 0), null);
  });

  test('preserves rich word-family JSON and rejects a mismatched identity', () => {
    const detail = normalizeVocabDetail({ ...row, syllables: null, definition_en: '', definition_vi: null, example: '', register: '', common_error: '', memory_hook: '', source: '', group: '', body_html: '<p>x</p>', synonyms: ['complete'], antonyms: [], collocations: [], related_words: [], word_family: [{ form: 'holistically', pos: 'adv' }] }, ID);
    assert.deepEqual(detail?.wordFamily, [{ form: 'holistically', pos: 'adv' }]);
    assert.equal(normalizeVocabDetail({ ...row }, ID2), null);
  });

  test('pins delete, bulk-delete and audio ACK identities', () => {
    assert.equal(normalizeDeleteAck({ id: ID, message: 'Đã xóa' }, ID), true);
    assert.equal(normalizeDeleteAck({ id: ID2, message: 'Đã xóa' }, ID), false);
    assert.deepEqual(normalizeBulkDeleteAck({ deleted_count: 1, not_found: [ID2] }, [ID, ID2]), { deletedCount: 1, notFound: [ID2] });
    assert.equal(normalizeBulkDeleteAck({ deleted_count: 1, not_found: [] }, [ID, ID2]), null);
    assert.deepEqual(normalizeAudioAck({ queued_count: 2, engine: 'openai', scope: 'both' }, 'openai', 'both', 2), { queuedCount: 2, engine: 'openai', scope: 'both' });
    assert.equal(normalizeAudioAck({ queued_count: 3, engine: 'openai', scope: 'both' }, 'openai', 'both', 2), null);
  });

  test('validates dry-run and commit summaries without inventing write success', () => {
    const block = { index: 0, headword: 'Holistic', slug: 'holistic', parsed_data: { category: 'health' }, action: null, db_action: 'created', validation_errors: [] };
    const summary = { total: 1, created: 0, updated: 0, errors: 0, forecast_created: 1, forecast_updated: 0 };
    assert.equal(normalizeVocabImport({ dry_run: true, blocks: [block], validation_errors: [], committed_ids: [], duplicate_slugs: [], summary }, true)?.summary.forecastCreated, 1);
    assert.equal(normalizeVocabImport({ dry_run: false, blocks: [{ ...block, action: 'created', db_action: null }], validation_errors: [], committed_ids: ['holistic'], duplicate_slugs: [], summary: { ...summary, created: 1, forecast_created: 0 } }, false)?.committedIds[0], 'holistic');
    assert.equal(normalizeVocabImport({ dry_run: false, blocks: [{ ...block, action: 'created' }], validation_errors: [], committed_ids: [], duplicate_slugs: [], summary: { ...summary, created: 1 } }, false), null);
  });

  test('parses comma lists and rich JSON arrays safely', () => {
    assert.deepEqual(parseStringList(' one, two ,, '), ['one', 'two']);
    assert.deepEqual(parseJsonList('[{"form":"holistically"}]'), [{ form: 'holistically' }]);
    assert.equal(parseJsonList('{"form":"holistically"}'), null);
    assert.equal(parseJsonList('[undefined]'), null);
  });
});
