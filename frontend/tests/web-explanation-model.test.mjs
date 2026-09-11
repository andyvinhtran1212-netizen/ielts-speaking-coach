import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { answerOptions } from '../lib/web-explanation-model.mjs';

describe('web explanation answer options', () => {
  test('preserves label and letter identifiers as the submitted answer', () => {
    const options = answerOptions({ item: { options: [
      { label: 'A', text: 'Weather' },
      { letter: 'B', text: 'Climate' },
    ] } });

    assert.deepEqual(options, [
      ['A', 'Weather'],
      ['B', 'Climate'],
    ]);
    assert.equal(options[0][0], 'A', 'corrected_answer must submit the authored label');
    assert.equal(options[1][0], 'B', 'corrected_answer must submit the authored letter');
  });

  test('keeps value plus label and map-shaped options compatible', () => {
    assert.deepEqual(answerOptions({ item: { options: [
      { value: 'C', label: 'Wind' },
    ] } }), [['C', 'Wind']]);
    assert.deepEqual(answerOptions({ item: { options: {
      D: 'Rain',
    } } }), [['D', 'Rain']]);
  });
});
