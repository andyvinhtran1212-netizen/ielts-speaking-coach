import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeVocabContextLinks,
} from '../lib/vocab-context-links-model.mjs';

describe('curated vocabulary context-link model', () => {
  test('uses the server-bound request term and drops malformed duplicates or slugs', () => {
    const links = normalizeVocabContextLinks({ links: [
      { request_term: 'Straße', normalized_term: 'strasse', rationale_vi: 'Phân biệt nghĩa trong ngữ cảnh.', unit: { unit_slug: 'actually-vs-currently', title_vi: 'Actually hay currently?', target_level: 'B1' } },
      { request_term: 'Straße', normalized_term: 'strasse', rationale_vi: 'Bản trùng.', unit: { unit_slug: 'other-unit', title_vi: 'Trùng' } },
      { request_term: 'fun', normalized_term: 'fun', rationale_vi: 'Unsafe.', unit: { unit_slug: '../admin', title_vi: 'Unsafe' } },
    ] });
    assert.equal(links.length, 1);
    assert.equal(links[0].requestTerm, 'Straße');
    assert.equal(links[0].unitSlug, 'actually-vs-currently');
    assert.equal(links[0].level, 'B1');
  });

  test('fails closed for malformed response contracts', () => {
    assert.deepEqual(normalizeVocabContextLinks(null), []);
    assert.deepEqual(normalizeVocabContextLinks({ links: 'not-an-array' }), []);
    assert.deepEqual(normalizeVocabContextLinks({ links: [{ request_term: 'fun' }] }), []);
  });
});
