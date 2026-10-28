import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { answerOptions, candidateErrorOptions, localiseSpeaker } from '../lib/web-explanation-model.mjs';

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

describe('web explanation "speaker" localisation keeps English evidence verbatim', () => {
  test('localises Vietnamese prose labels', () => {
    assert.equal(
      localiseSpeaker('Từ này do chính Speaker 1 nói, không phải Speaker 2.'),
      'Từ này do chính người nói 1 nói, không phải người nói 2.',
    );
    assert.equal(
      localiseSpeaker('**Mốc nghe lại:** Section 1, phần nơi ở — speaker LOUISE'),
      '**Mốc nghe lại:** Section 1, phần nơi ở — người nói LOUISE',
    );
  });

  test('never rewrites text inside quotation marks or code spans', () => {
    const quoted = 'Đoạn chứa nó mở ra bằng *“Speaker 2 (Friend): The food\'s amazing.”* — dò từ mốc đó.';
    assert.equal(localiseSpeaker(quoted), quoted);
    const straight = 'Audio nói "like today\'s speaker to talk to us", rồi speaker 2 trả lời.';
    assert.equal(
      localiseSpeaker(straight),
      'Audio nói "like today\'s speaker to talk to us", rồi người nói 2 trả lời.',
    );
    assert.equal(localiseSpeaker('`speaker notes`'), '`speaker notes`');
  });

  test('leaves English noun phrases alone', () => {
    // C18 T1 Q24 evidence: "today's người nói" was the reported regression.
    const english = 'They could have asked more people like today\'s speaker to talk to us.';
    assert.equal(localiseSpeaker(english), english);
    const prose = 'The speaker stresses that reliability matters.';
    assert.equal(localiseSpeaker(prose), prose);
  });

  test('panel renders transcript extracts and source quotes without localisation', () => {
    const panel = readFileSync(new URL('../components/web-explanation-panel.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(panel, /\\bspeaker\\s\+\/gi, 'người nói '/, 'no blanket speaker rewrite in clean()');
    assert.match(panel, /quote: cleanVerbatim\(item\.quote\)/);
    assert.match(panel, /inlineNodes\(row\.quote, cleanVerbatim\)/);
    assert.match(panel, /inlineNodes\(explanation\.script_extract, cleanVerbatim\)/);
    assert.match(panel, /function clean\(value: unknown\) \{\n  return localiseSpeaker\(cleanVerbatim\(value\)\);/);
  });
});
