/** Gate E: active attempts never change implementation during cutover/rollback. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_PLAYER_AFFINITY_POLICY,
  admitCorePlayer,
  corePlayerUrl,
  validateCorePlayerAffinityPolicy,
} from '../lib/core-player-affinity.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const DOC = read('docs/GATE_E_ACTIVE_SESSION_AFFINITY_2026-08-09.md');
const PREFLIGHT = read('docs/GATE_E_PREFLIGHT_2026-08-09.md');

const NEXT_LAUNCHERS = [
  'frontend/app/(authed-speaking)/speaking/speaking-behavior.tsx',
  'frontend/app/(authed-reading)/reading/test/reading-test-behavior.tsx',
  'frontend/app/(authed-reading)/reading/mini-test/reading-mini-test-behavior.tsx',
  'frontend/app/(authed-listening)/listening/tests/listening-tests-behavior.tsx',
  'frontend/app/(authed-listening)/listening/mini-test/listening-mini-test-behavior.tsx',
  'frontend/app/(authed-listening)/listening/skills/listening-skills-behavior.tsx',
];

function readyNextPolicy() {
  const policy = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
  for (const surface of Object.values(policy.surfaces)) surface.next.route_ready = true;
  return policy;
}

describe('current admission policy preserves behavior', () => {
  test('policy is internally valid and every ready legacy target exists', () => {
    assert.deepEqual(validateCorePlayerAffinityPolicy(), []);
    for (const config of Object.values(CORE_PLAYER_AFFINITY_POLICY.surfaces)) {
      assert.equal(config.admit_new, 'legacy');
      assert.equal(config.next.route_ready, false);
      assert.ok(existsSync(path.join(FRONTEND, 'public', config.legacy.path)));
    }
  });

  test('new attempts still receive legacy player URLs with equivalent query semantics', () => {
    assert.equal(
      admitCorePlayer('speaking', { session_id: 'session A' }),
      '/pages/practice.html?session_id=session+A',
    );
    assert.equal(
      admitCorePlayer('reading_exam', { test_id: 'AVR-1', from: 'full' }),
      '/pages/reading-exam.html?test_id=AVR-1&from=full',
    );
    assert.equal(
      admitCorePlayer('listening_test', { id: 'test-1', from: 'mini' }),
      '/pages/listening-test.html?id=test-1&from=mini',
    );
    assert.equal(
      admitCorePlayer('listening_dictation', { test_id: 'test-1' }),
      '/pages/listening-test-dictation.html?test_id=test-1',
    );
  });

  test('canonical Next launchers use the policy, not scattered player literals', () => {
    for (const file of NEXT_LAUNCHERS) {
      const source = read(file);
      assert.match(source, /import \{ admitCorePlayer \} from '@\/lib\/core-player-affinity\.mjs'/, file);
      assert.match(source, /admitCorePlayer\(/, file);
      assert.doesNotMatch(source, /\/pages\/(practice|reading-exam|listening-test(?:-dictation)?)\.html/, file);
    }
  });
});

describe('cutover and rollback drill', () => {
  test('legacy-start stays legacy after cutover; next-start stays Next after admission rollback', () => {
    const cutover = readyNextPolicy();
    cutover.surfaces.speaking.admit_new = 'next';

    const legacyAttempt = corePlayerUrl(
      'speaking', 'legacy', { session_id: 'legacy-attempt' }, cutover,
    );
    const nextAttempt = admitCorePlayer(
      'speaking', { session_id: 'next-attempt' }, cutover,
    );
    assert.equal(legacyAttempt, '/pages/practice.html?session_id=legacy-attempt');
    assert.equal(nextAttempt, '/practice/session?session_id=next-attempt');

    const rollback = structuredClone(cutover);
    rollback.surfaces.speaking.admit_new = 'legacy';
    assert.equal(
      corePlayerUrl('speaking', 'next', { session_id: 'next-attempt' }, rollback),
      nextAttempt,
    );
    assert.equal(
      admitCorePlayer('speaking', { session_id: 'post-rollback' }, rollback),
      '/pages/practice.html?session_id=post-rollback',
    );
  });

  test('an admission flip fails closed until its stable route is ready', () => {
    const unsafe = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
    unsafe.surfaces.speaking.admit_new = 'next';
    assert.deepEqual(validateCorePlayerAffinityPolicy(unsafe), [
      'speaking:admission-route-not-ready',
    ]);
    assert.throws(
      () => admitCorePlayer('speaking', { session_id: 'x' }, unsafe),
      /invalid-core-player-policy:speaking:admission-route-not-ready/,
    );
  });

  test('unsafe path and query-policy edits fail validation', () => {
    const unsafePath = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
    unsafePath.surfaces.speaking.legacy.path = '//outside.example/player';
    assert.ok(validateCorePlayerAffinityPolicy(unsafePath)
      .includes('speaking:legacy-path-invalid'));
    assert.throws(
      () => corePlayerUrl('speaking', 'legacy', { session_id: 'x' }, unsafePath),
      /invalid-core-player-policy:speaking:legacy-path-invalid/,
    );

    const unsafeQuery = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
    unsafeQuery.surfaces.speaking.allowed_query = [];
    assert.ok(validateCorePlayerAffinityPolicy(unsafeQuery)
      .includes('speaking:query-contract-invalid'));

    const incomplete = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
    incomplete.schema_version = 2;
    delete incomplete.surfaces.reading_exam;
    assert.deepEqual(validateCorePlayerAffinityPolicy(incomplete), [
      'schema-version-invalid',
      'reading_exam:surface-missing',
    ]);
  });

  test('missing identity, unknown query and unknown implementation fail closed', () => {
    assert.throws(() => admitCorePlayer('speaking', {}), /missing-core-player-identity/);
    assert.throws(
      () => admitCorePlayer('speaking', { session_id: 'x', implementation: 'next' }),
      /unknown-core-player-query/,
    );
    assert.throws(
      () => corePlayerUrl('speaking', 'random', { session_id: 'x' }),
      /invalid-core-player-implementation/,
    );
  });
});

describe('evidence truth', () => {
  test('does not call the local drill a live Gate E pass', () => {
    assert.match(DOC, /MECHANISM READY; LIVE CORE DRILL PENDING/);
    assert.match(DOC, /không tuyên\s+bố Gate E PASS/);
    assert.match(DOC, /không\s+có finite maximum active-session TTL/);
    assert.match(DOC, /[Qq]uery flag không phải affinity/);
    assert.match(DOC, /rollback floor SHA/);
    assert.match(DOC, /Writing[\s\S]*ngoài helper/i);
    assert.match(PREFLIGHT, /Sticky active-session hoặc drain strategy đã drill \| \*\*PARTIAL\*\*/);
    assert.doesNotMatch(PREFLIGHT, /chưa có drill active-session\s+sticky\/drain/);
  });
});
