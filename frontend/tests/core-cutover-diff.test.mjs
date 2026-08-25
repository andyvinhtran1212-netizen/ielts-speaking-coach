import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  CORE_CUTOVER_FILE_ALLOWLIST,
  CORE_CUTOVER_SURFACES,
  validateCoreCutoverDiff,
} from '../tooling/verify-core-cutover-diff.mjs';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOOR = 'a'.repeat(40);
const CUTOVER = 'b'.repeat(40);
const CURRENT_SOURCE = readFileSync(path.join(FRONTEND, 'lib/core-player-affinity.mjs'), 'utf8');

function withAdmission(source, surface, admission) {
  const marker = `${surface}: Object.freeze({`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${surface}`);
  const nextSurface = source.indexOf('Object.freeze({', start + marker.length);
  const blockEnd = nextSurface === -1 ? source.length : nextSurface;
  const match = source.slice(start, blockEnd).match(/admit_new: '(legacy|next)'/);
  assert.ok(match, `missing admission for ${surface}`);
  const offset = start + match.index;
  return `${source.slice(0, offset)}admit_new: '${admission}'${source.slice(offset + match[0].length)}`;
}

// These are protocol fixtures, not aliases for the repository's current
// admission state. Keeping both sides synthetic lets this verifier continue
// guarding rollback after the real policy has flipped to Next.
const FLOOR_SOURCE = CORE_CUTOVER_SURFACES.reduce(
  (source, surface) => withAdmission(source, surface, 'legacy'),
  CURRENT_SOURCE,
);
const CUTOVER_SOURCE = CORE_CUTOVER_SURFACES.reduce(
  (source, surface) => withAdmission(source, surface, 'next'),
  FLOOR_SOURCE,
);

const baseInput = {
  floorSha: FLOOR,
  cutoverSha: CUTOVER,
  floorPolicySource: FLOOR_SOURCE,
  cutoverPolicySource: CUTOVER_SOURCE,
  changedFiles: [...CORE_CUTOVER_FILE_ALLOWLIST],
  isAncestor: () => true,
};

describe('Gate E remediation floor -> core cutover boundary', () => {
  test('accepts the minimal descendant that flips exactly four admissions', () => {
    assert.deepEqual(validateCoreCutoverDiff(baseInput), []);
  });

  test('rejects backend, migration or unrelated runtime files in the cutover', () => {
    for (const file of [
      'backend/routers/sessions.py',
      'backend/migrations/224_active_player_resume_ttl.sql',
      'frontend/app/(authed-practice)/practice/session/page.tsx',
    ]) {
      assert.ok(validateCoreCutoverDiff({
        ...baseInput,
        changedFiles: [...baseInput.changedFiles, file],
      }).some((error) => error.includes(file)), file);
    }
  });

  test('rejects a non-descendant, partial flip or Writing drift', () => {
    assert.ok(validateCoreCutoverDiff({ ...baseInput, isAncestor: () => false })
      .includes('cutover-is-not-floor-descendant'));
    assert.ok(validateCoreCutoverDiff({
      ...baseInput,
      cutoverPolicySource: CUTOVER_SOURCE.replace(
        "reading_exam: Object.freeze({\n      // Reading",
        "reading_exam: Object.freeze({\n      // Reading",
      ).replace(
        /reading_exam: Object\.freeze\(\{([\s\S]*?)admit_new: 'next'/,
        "reading_exam: Object.freeze({$1admit_new: 'legacy'",
      ),
    }).includes('cutover-admission-not-next:reading_exam'));
    assert.ok(validateCoreCutoverDiff({
      ...baseInput,
      cutoverPolicySource: CUTOVER_SOURCE.replace(
        /writing_assignment: Object\.freeze\(\{([\s\S]*?)admit_new: 'next'/,
        "writing_assignment: Object.freeze({$1admit_new: 'legacy'",
      ),
    }).includes('writing-admission-drift'));
  });

  test('rejects any non-comment runtime change inside the policy module', () => {
    const changed = CUTOVER_SOURCE.replace(
      "strategy_id: 'stable-player-url-admission-switch-v1'",
      "strategy_id: 'changed-at-cutover'",
    );
    assert.ok(validateCoreCutoverDiff({ ...baseInput, cutoverPolicySource: changed })
      .includes('core-policy-non-admission-runtime-drift'));
  });

  test('allows a dated evidence document but not arbitrary documentation drift', () => {
    assert.deepEqual(validateCoreCutoverDiff({
      ...baseInput,
      changedFiles: [...baseInput.changedFiles, 'docs/GATE_E_CORE_CUTOVER_EVIDENCE_2026-08-20.md'],
    }), []);
    assert.ok(validateCoreCutoverDiff({
      ...baseInput,
      changedFiles: [...baseInput.changedFiles, 'docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md'],
    }).some((error) => error.includes('FE_NEXTJS_MIGRATION_MASTER_PLAN')));
  });
});
