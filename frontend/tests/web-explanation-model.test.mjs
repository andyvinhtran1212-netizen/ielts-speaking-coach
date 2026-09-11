import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { answerOptions, candidateErrorOptions } from '../lib/web-explanation-model.mjs';

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

describe('web explanation error taxonomy options', () => {
  test('keeps canonical analytics values but never exposes internal codes as labels', () => {
    const options = candidateErrorOptions({
      remediation: {
        candidate_error_subtypes: ['R11-COPY_ERROR', 'L07-MISSED_CORRECTION'],
      },
    });

    assert.deepEqual(options, [
      ['R11-COPY_ERROR', 'Chép sai đáp án từ bài đọc'],
      ['L07-MISSED_CORRECTION', 'Bỏ lỡ chỗ người nói tự sửa'],
      ['other', 'Chưa xác định rõ nguyên nhân'],
    ]);
    assert.ok(options.every(([, label]) => !/^[RL]\d{2}-/.test(label)));
  });

  test('uses a learner-safe fallback for an unknown future canonical code', () => {
    assert.deepEqual(candidateErrorOptions({
      remediation: { candidate_error_subtypes: ['R99-FUTURE_CODE'] },
    }), [
      ['R99-FUTURE_CODE', 'Nguyên nhân khác'],
      ['other', 'Chưa xác định rõ nguyên nhân'],
    ]);
  });

  test('localizes every canonical code emitted by the Cambridge importer', () => {
    const importer = readFileSync(new URL(
      '../../backend/scripts/import_cambridge_web_explanations.py',
      import.meta.url,
    ), 'utf8');
    const codes = [...new Set([...importer.matchAll(
      /"[a-z0-9_]+": "([RL]\d{2}-[A-Z0-9_]+)"/g,
    )].map((match) => match[1]))];
    const options = candidateErrorOptions({
      remediation: { candidate_error_subtypes: codes },
    }).filter(([code]) => code !== 'other');

    assert.ok(codes.length > 30, 'expected both complete Reading and Listening taxonomies');
    assert.equal(options.length, codes.length);
    assert.ok(options.every(([, label]) => label !== 'Nguyên nhân khác'));
  });
});
