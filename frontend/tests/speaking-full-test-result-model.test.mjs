import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  bandTone,
  buildFullTestResult,
  fullTestSummaryPath,
} from '../lib/speaking-full-test-result-model.mjs';

function ready(overrides = {}) {
  return {
    result_status: 'ready',
    results_ready: true,
    chain_verified: true,
    full_test_attempt_id: 'attempt-1',
    overall_band: 7,
    band_fc: 6.5,
    band_lr: 7,
    band_gra: 7.5,
    band_p: 7,
    parts: [1, 2, 3].map((part) => ({
      part, session_id: `p${part}`, topic: `Topic ${part}`,
      status: 'completed', questions_count: part === 1 ? 9 : part === 2 ? 1 : 5,
      band_avg: 6 + part / 2,
      key_feedback: { strength: `Good ${part}`, improvement: `Improve ${part}` },
    })),
    top_strengths: ['Clear ideas'],
    top_improvements: ['More linking'],
    top_grammar_issues: ['I go → I went'],
    pronunciation: {
      response_count: 15, overall: 80, accuracy: 82, fluency: 78,
      completeness: 90, prosody: 76,
    },
    ...overrides,
  };
}

describe('native Full Test result model — canonical truth', () => {
  test('maps one ready three-Part snapshot without recalculating scores', () => {
    const view = buildFullTestResult(ready());
    assert.equal(view.ready, true);
    assert.equal(view.attemptId, 'attempt-1');
    assert.equal(view.overallBand, 7);
    assert.deepEqual(view.criteria.map((item) => item.value), [6.5, 7, 7.5, 7]);
    assert.deepEqual(view.parts.map((part) => part.questionCount), [9, 1, 5]);
    assert.equal(view.pronunciation.responseCount, 15);
  });

  test('pending, failed and sealed states never expose supplied provisional scores', () => {
    for (const status of ['pending', 'failed', 'sealed']) {
      const view = buildFullTestResult(ready({ result_status: status, results_ready: false }));
      assert.equal(view.ready, false);
      assert.equal(view.overallBand, null);
      assert.deepEqual(view.criteria, []);
      assert.deepEqual(view.strengths, []);
      assert.equal(view.pronunciation, null);
    }
  });

  test('requires all three canonical Part records before treating a response as ready', () => {
    const view = buildFullTestResult(ready({ parts: ready().parts.slice(0, 2) }));
    assert.equal(view.ready, false);
    assert.equal(view.overallBand, null);
  });

  test('keeps only bounded numeric bands/scores and plain string lists', () => {
    const view = buildFullTestResult(ready({
      overall_band: 99,
      top_strengths: [' Clear ideas ', { html: '<img>' }, 'Clear ideas'],
      pronunciation: { response_count: 1, overall: 101, accuracy: 72 },
    }));
    assert.equal(view.overallBand, null);
    assert.deepEqual(view.strengths, ['Clear ideas']);
    assert.equal(view.pronunciation.overall, null);
    assert.equal(view.pronunciation.accuracy, 72);
  });

  test('builds the canonical endpoint and retains explicit legacy ids only when present', () => {
    assert.equal(fullTestSummaryPath({ p1: 'p 1' }), '/sessions/p%201/full-test-summary');
    assert.equal(
      fullTestSummaryPath({ p1: 'p1', p2: 'p2', p3: 'p3' }),
      '/sessions/p1/full-test-summary?p2_id=p2&p3_id=p3',
    );
    assert.equal(fullTestSummaryPath({ p1: '' }), '');
  });

  test('uses the shared four-tier band semantics', () => {
    assert.equal(bandTone(7), 'band-high');
    assert.equal(bandTone(6), 'band-mid');
    assert.equal(bandTone(5), 'band-warn');
    assert.equal(bandTone(4.5), 'band-low');
    assert.equal(bandTone(null), 'band-none');
  });
});
