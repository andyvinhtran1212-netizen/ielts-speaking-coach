import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSpeakingLadders } from '../lib/advanced-vocabulary-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lesson = (id) => JSON.parse(readFileSync(
  join(ROOT, 'backend', 'content', 'advanced_vocab', `${id}.json`), 'utf8',
));
const speakingBlocks = (id) => lesson(id).activities.find((row) => row.activity_type === 'speaking_practice').content.blocks;

describe('Advanced Vocabulary Speaking authoring variants', () => {
  test('parses the Example Band 6 → 7 → 8 format', () => {
    const ladders = buildSpeakingLadders(speakingBlocks('ADV-T01'));
    assert.equal(ladders.length, 5);
    assert.deepEqual(ladders[0].bands.map((row) => row.band), ['Band 6', 'Band 7', 'Band 8']);
    assert.match(ladders[0].title, /Ví dụ 1/);
  });

  test('parses bare repeated Band 7 → 8 pairs instead of rendering blank', () => {
    const ladders = buildSpeakingLadders(speakingBlocks('ADV-T04'));
    assert.equal(ladders.length, 5);
    assert.deepEqual(ladders[0].bands.map((row) => row.band), ['Band 7', 'Band 8']);
  });

  test('parses Sentence labels and keeps all five ladders', () => {
    const ladders = buildSpeakingLadders(speakingBlocks('ADV-T08'));
    assert.equal(ladders.length, 5);
    assert.deepEqual(ladders[4].bands.map((row) => row.band), ['Band 6', 'Band 7', 'Band 8']);
  });

  test('all 30 lessons expose at least one visible upgrade ladder', () => {
    for (let number = 1; number <= 30; number += 1) {
      const id = `ADV-T${String(number).padStart(2, '0')}`;
      assert.ok(buildSpeakingLadders(speakingBlocks(id)).length > 0, `${id} has no ladder`);
    }
  });
});
