import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildEditorialDiff,
  editorialCatalogQuery,
  normalizeEditorialListPayload,
  safeEditorialSourceHref,
} from '../lib/admin-vocab-editorial-model.mjs';

const gate = {
  states: { language: 'approved', pedagogy: 'pending', assessment: 'changes_requested' },
  pending_review_types: ['pedagogy', 'assessment'],
  has_distinct_reviewers: false,
  ready_for_publish: false,
};

describe('admin vocab editorial model', () => {
  test('normalizes a bounded catalog without silently dropping malformed units', () => {
    const payload = normalizeEditorialListPayload({
      total: 1, offset: 0, limit: 100,
      items: [{
        id: 'unit-1', unit_slug: 'have-an-impact-on',
        display_headword: 'have an impact on', unit_type: 'learning_unit',
        target_level: 'B1', status: 'draft', current_published_version_id: null,
        versions: [{
          id: 'version-1', unit_id: 'unit-1', version_number: 1,
          status: 'in_review', task_count: 4,
          dimensions: ['meaning_recall', 'usage_control', 'productive_transfer'],
          review_count: 2, review_gate: gate,
        }],
      }],
    });
    assert.equal(payload.items[0].versions[0].reviewGate.states.assessment, 'changes_requested');
    assert.deepEqual(payload.items[0].versions[0].reviewGate.pendingReviewTypes, ['pedagogy', 'assessment']);
    assert.equal(normalizeEditorialListPayload({ total: 1, offset: 0, limit: 100, items: [{}] }), null);
  });

  test('diff covers learner content, sources and private task contracts', () => {
    const base = {
      content: { title_vi: 'Cũ', usage_vi: 'Giữ nguyên' },
      sources: [{ title: 'A', url: 'https://example.com/a' }],
      tasks: [{ sequence: 1, taskType: 'meaning_recall', dimension: 'meaning_recall', prompt: 'Cũ', options: [], answerKey: { accepted: ['a'] }, explanationVi: 'A', status: 'active' }],
    };
    const target = {
      content: { title_vi: 'Mới', usage_vi: 'Giữ nguyên' },
      sources: [{ title: 'B', url: 'https://example.com/b' }],
      tasks: [{ ...base.tasks[0], answerKey: { accepted: ['b'] } }],
    };
    assert.deepEqual(buildEditorialDiff(base, target).map((entry) => entry.field), [
      'content.title_vi', 'sources', 'tasks',
    ]);
  });

  test('catalog query rejects unbounded or unknown filters', () => {
    assert.equal(editorialCatalogQuery({ status: 'draft', offset: 0, limit: 100 }), 'offset=0&limit=100&status=draft');
    assert.equal(editorialCatalogQuery({ status: 'unknown', offset: 0, limit: 100 }), null);
    assert.equal(editorialCatalogQuery({ status: '', offset: 0, limit: 101 }), null);
  });

  test('preview links only admit valid HTTPS editorial sources', () => {
    assert.equal(safeEditorialSourceHref('https://dictionary.cambridge.org/dictionary/english/impact'), 'https://dictionary.cambridge.org/dictionary/english/impact');
    assert.equal(safeEditorialSourceHref('javascript:alert(1)'), null);
    assert.equal(safeEditorialSourceHref('http://example.com/source'), null);
    assert.equal(safeEditorialSourceHref('not a url'), null);
  });
});
