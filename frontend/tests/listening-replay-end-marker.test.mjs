import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { listeningReviewClipClock } from '../lib/listening-review-model.mjs';

const WORKSPACE = readFileSync(new URL('../app/(authed-listening-review)/listening/review/listening-review-workspace.tsx', import.meta.url), 'utf8');

// PC-J125: the label must stay within ±0.15 s of the stored bound the player
// stops at. Windows below are real staging/prod-export bounds (B20-T1 Q1,
// B20-T4 Q40, LIS-025 Q40, LIS-038 Q30, LIS-001 Q35).
test('replay label shows each window bound within ±0.15 s', () => {
  for (const [value, label] of [
    [137.5, '2:17.5'], [144.28, '2:24.3'], [1803.5, '30:03.5'], [1576.16, '26:16.2'],
    [1234.84, '20:34.8'], [1497.84, '24:57.8'], [59.96, '1:00.0'], [0, '0:00.0'],
  ]) {
    const shown = listeningReviewClipClock(value);
    assert.equal(shown, label);
    const [minutes, seconds] = shown.split(':');
    assert.ok(Math.abs(Number(minutes) * 60 + Number(seconds) - value) <= 0.15, `${value} → ${shown}`);
  }
});

test('bad input renders the zero label instead of NaN', () => {
  assert.equal(listeningReviewClipClock(undefined), '0:00.0');
  assert.equal(listeningReviewClipClock(-3), '0:00.0');
  assert.equal(listeningReviewClipClock('abc'), '0:00.0');
});

test('the review card window label uses the precise clip clock for both bounds', () => {
  assert.match(WORKSPACE, /\$\{listeningReviewClipClock\(win\.start\)\}–\$\{listeningReviewClipClock\(win\.end\)\}/);
  assert.doesNotMatch(WORKSPACE, /\$\{clock\(win\.start\)\}–\$\{clock\(win\.end\)\}/);
});
