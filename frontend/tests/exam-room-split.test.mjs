// EXAMROOM-0066 FR-003–FR-005: split ratio clamping, keys, storage and tabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampRatio, clearSplitRatio, pruneSplitRatios, ratioForKey, ratioFromPointer,
  readSplitRatio, splitBounds, splitLayout, splitStorageKey, writeSplitRatio,
} from '../lib/exam-room/split-ratio.mjs';
import { BrokenStorage, MemoryStorage } from './fixtures/exam-room-fakes.mjs';

const DAY = 24 * 60 * 60 * 1000;

test('clamps to 30–70 and keeps 360 px on each side', () => {
  assert.equal(clampRatio(80, 1280), 70);
  assert.equal(clampRatio(10, 1280), 30);
  assert.equal(clampRatio(64, 1280), 64);
  // 1000 px wide: 360 px = 36 %, so 30 → 36 and 70 → 64.
  assert.equal(clampRatio(30, 1000), 36);
  assert.equal(clampRatio(70, 1000), 64);
  assert.deepEqual(splitBounds(700), { min: 50, max: 50 });
});

test('the preference survives a narrow window and comes back when wider', () => {
  const pref = 30;
  assert.equal(clampRatio(pref, 1000), 36);
  assert.equal(clampRatio(pref, 1600), 30);
});

test('pointer, arrows ±5, Home/End, Enter and double-click', () => {
  assert.equal(ratioFromPointer(819, 1280), 64);
  assert.equal(ratioForKey(50, 'ArrowLeft', 1280), 45);
  assert.equal(ratioForKey(68, 'ArrowRight', 1280), 70);
  assert.equal(ratioForKey(50, 'Home', 1280), 30);
  assert.equal(ratioForKey(50, 'End', 1280), 70);
  assert.equal(ratioForKey(64, 'Enter', 1280), 50);
  assert.equal(ratioForKey(64, 'dblclick', 1280), 50);
  assert.equal(ratioForKey(64, 'a', 1280), null);
});

test('below 900 px the split becomes tabs (700 px → tabs)', () => {
  assert.equal(splitLayout(700), 'tabs');
  assert.equal(splitLayout(899), 'tabs');
  assert.equal(splitLayout(900), 'split');
});

test('stored per attempt; a new attempt starts at 50; 80 is read back as 70', () => {
  const s = new MemoryStorage();
  assert.equal(readSplitRatio(s, 'a1', 0), 50);
  assert.equal(writeSplitRatio(s, 'a1', 64, 0), true);
  assert.equal(readSplitRatio(s, 'a1', DAY), 64);
  assert.equal(readSplitRatio(s, 'a2', DAY), 50);
  s.setItem(splitStorageKey('a3'), JSON.stringify({ ratio: 80, savedAt: 0 }));
  assert.equal(readSplitRatio(s, 'a3', 0), 70);
  clearSplitRatio(s, 'a1');
  assert.equal(readSplitRatio(s, 'a1', DAY), 50);
});

test('entries older than 7 days are dropped; storage errors never throw', () => {
  const s = new MemoryStorage();
  writeSplitRatio(s, 'old', 40, 0);
  writeSplitRatio(s, 'new', 60, 6 * DAY);
  s.setItem(splitStorageKey('junk'), 'not json');
  s.setItem('other-key', 'x');
  assert.equal(pruneSplitRatios(s, 8 * DAY), 2);
  assert.equal(readSplitRatio(s, 'new', 8 * DAY), 60);
  assert.equal(s.getItem('other-key'), 'x');
  assert.equal(readSplitRatio(s, 'old', 8 * DAY), 50);
  const broken = new BrokenStorage();
  assert.equal(readSplitRatio(broken, 'a', 0), 50);
  assert.equal(writeSplitRatio(broken, 'a', 60, 0), false);
  assert.doesNotThrow(() => clearSplitRatio(broken, 'a'));
  assert.equal(pruneSplitRatios(broken, 0), 0);
  assert.equal(readSplitRatio(null, 'a'), 50);
});
