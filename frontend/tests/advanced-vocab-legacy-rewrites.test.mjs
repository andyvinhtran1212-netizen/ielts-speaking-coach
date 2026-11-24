// MEDIAOUT-0078 T002 (option D): the legacy Advanced Vocabulary media rewrite.
// FR-006: flag off → no rule. FR-003/FR-007: the table follows
// core30-manifest.json and every rule lands on a version directory whose files
// are byte-identical to the legacy tree they stand in for.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ADVANCED_VOCAB_LEGACY_REWRITE_FLAG,
  buildAdvancedVocabLegacyRewrites,
} from '../tooling/advanced-vocab-legacy-rewrites.mjs';
import { ADVANCED_VOCAB_LEGACY_CHECKSUMS } from '../tooling/advanced-vocab-legacy-table.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(FRONTEND);
const MEDIA = path.join(FRONTEND, 'public', 'assets', 'advanced-vocab');
const manifest = JSON.parse(readFileSync(
  path.join(REPO, 'backend', 'content', 'advanced_vocab', 'core30-manifest.json'), 'utf8',
));

const files = (root) => {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out.sort();
};
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('advanced-vocab legacy rewrites (MEDIAOUT-0078 D)', () => {
  it('produces no rule unless the flag is exactly "1" (FR-006)', () => {
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) {
      const env = value === undefined ? {} : { [ADVANCED_VOCAB_LEGACY_REWRITE_FLAG]: value };
      assert.deepEqual(buildAdvancedVocabLegacyRewrites(env), [], `flag=${JSON.stringify(value)}`);
    }
  });

  it('the static table equals lesson_id → content_checksum of core30-manifest.json', () => {
    const expected = Object.fromEntries(
      manifest.lessons.map((row) => [row.lesson_id, row.content_checksum]),
    );
    assert.deepEqual({ ...ADVANCED_VOCAB_LEGACY_CHECKSUMS }, expected);
    assert.equal(Object.keys(expected).length, 30);
  });

  it('with the flag on, emits one rule per lesson onto its current version directory', () => {
    const rules = buildAdvancedVocabLegacyRewrites({ [ADVANCED_VOCAB_LEGACY_REWRITE_FLAG]: '1' });
    assert.equal(rules.length, 30);
    for (const row of manifest.lessons) {
      const rule = rules.find((r) => r.source === `/assets/advanced-vocab/${row.lesson_id}/:path*`);
      assert.ok(rule, row.lesson_id);
      assert.equal(
        rule.destination,
        `/assets/advanced-vocab/versions/${row.lesson_id}/${row.content_checksum}/:path*`,
      );
      assert.ok(!rule.source.startsWith('/assets/advanced-vocab/versions/'));
    }
  });

  it('rejects a malformed table entry instead of emitting a broken rule', () => {
    assert.throws(
      () => buildAdvancedVocabLegacyRewrites(
        { [ADVANCED_VOCAB_LEGACY_REWRITE_FLAG]: '1' }, { 'ADV-T01': 'not-a-checksum' },
      ),
      /invalid entry/,
    );
  });

  it('every legacy file is served byte-identically by its rewrite target (FR-003)', () => {
    let count = 0;
    let expectedCount = 0;
    for (const row of manifest.lessons) {
      const legacyRoot = path.join(MEDIA, row.lesson_id);
      const versionRoot = path.join(MEDIA, 'versions', row.lesson_id, row.content_checksum);
      assert.ok(statSync(versionRoot).isDirectory(), versionRoot);
      const legacy = files(legacyRoot);
      assert.deepEqual(files(versionRoot), legacy, `${row.lesson_id}: same relative paths`);
      assert.equal(legacy.length, row.asset_count, `${row.lesson_id}: asset_count`);
      expectedCount += row.asset_count;
      for (const rel of legacy) {
        assert.equal(sha(path.join(versionRoot, rel)), sha(path.join(legacyRoot, rel)), rel);
        count += 1;
      }
    }
    assert.equal(count, expectedCount);
    assert.ok(count > 0);
  });
});
