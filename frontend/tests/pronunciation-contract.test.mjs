// Mục 27 (B5) — full-test-result.html pronunciation radar reads each part's
// score from `pronunciation_score` (the per-part field the backend actually
// sends), not `overall_pron_score` (a top-level-only field). The old code read
// s.overall_pron_score off a per-part sample → always undefined → the overall
// axis never plotted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'pages', 'full-test-result.html'), 'utf8');

// Isolate the per-part loop inside renderPronChart.
const chart = src.slice(src.indexOf('function renderPronChart'), src.indexOf('function avg'));

test('per-part loop reads pronunciation_score', () => {
  assert.match(chart, /s\.pronunciation_score\s*!=\s*null/);
  assert.match(chart, /scores\.overall\.push\(s\.pronunciation_score\)/);
});

test('per-part loop no longer reads overall_pron_score off a sample', () => {
  assert.doesNotMatch(chart, /s\.overall_pron_score/);
});

test('top-level overall_pron_score is still used for the headline number', () => {
  // pd.overall_pron_score (the aggregate the backend sends at the top level) is correct.
  assert.match(src, /pd\.overall_pron_score/);
});
