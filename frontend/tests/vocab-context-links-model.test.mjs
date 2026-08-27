import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeContextTerm,
  normalizeVocabContextLinks,
} from '../lib/vocab-context-links-model.mjs';

describe('curated vocabulary context-link model', () => {
  test('normalizes compatibility case and whitespace without fuzzy expansion', () => {
    assert.equal(normalizeContextTerm('  ＡＣＴＵＡＬＬＹ\n'), 'actually');
    assert.notEqual(normalizeContextTerm('impact-on'), normalizeContextTerm('impact on'));
  });

  test('accepts one safe exact link and drops malformed duplicates or slugs', () => {
    const links = normalizeVocabContextLinks({ links: [
      { normalized_term: 'actually', rationale_vi: 'Phân biệt nghĩa trong ngữ cảnh.', unit: { unit_slug: 'actually-vs-currently', title_vi: 'Actually hay currently?', target_level: 'B1' } },
      { normalized_term: 'ACTUALLY', rationale_vi: 'Bản trùng.', unit: { unit_slug: 'other-unit', title_vi: 'Trùng' } },
      { normalized_term: 'fun', rationale_vi: 'Unsafe.', unit: { unit_slug: '../admin', title_vi: 'Unsafe' } },
    ] });
    assert.deepEqual(Object.keys(links), ['actually']);
    assert.equal(links.actually.unitSlug, 'actually-vs-currently');
    assert.equal(links.actually.level, 'B1');
  });

  test('fails closed for malformed response contracts', () => {
    assert.deepEqual(normalizeVocabContextLinks(null), {});
    assert.deepEqual(normalizeVocabContextLinks({ links: 'not-an-array' }), {});
    assert.deepEqual(normalizeVocabContextLinks({ links: [{ normalized_term: 'fun' }] }), {});
  });
});
