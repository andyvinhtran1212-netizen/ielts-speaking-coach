import assert from 'node:assert/strict';
import { test } from 'node:test';

import { searchParamsSuffix } from '../lib/search-params.mjs';

test('query serialization works when the implementation has no size property', () => {
  const legacyParams = {
    toString: () => 'p2_id=part-2&p3_id=part-3',
  };

  assert.equal('size' in legacyParams, false);
  assert.equal(searchParamsSuffix(legacyParams), '?p2_id=part-2&p3_id=part-3');
});

test('empty and absent query parameters do not append a bare question mark', () => {
  assert.equal(searchParamsSuffix({ toString: () => '' }), '');
  assert.equal(searchParamsSuffix(), '');
});
