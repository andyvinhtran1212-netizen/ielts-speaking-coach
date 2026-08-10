/** Gate E: active attempts never change implementation during cutover/rollback. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_PLAYER_AFFINITY_POLICY,
  admitCorePlayer,
  corePlayerUrl,
  resolveCorePlayerAdmission,
  validateCorePlayerAffinityPolicy,
} from '../lib/core-player-affinity.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const DOC = read('docs/GATE_E_ACTIVE_SESSION_AFFINITY_2026-08-09.md');
const PREFLIGHT = read('docs/GATE_E_PREFLIGHT_2026-08-09.md');
const RUNTIME_ROUTE = read('frontend/app/core-player/launch/route.ts');

const NEXT_LAUNCHERS = [
  'frontend/app/(authed-speaking)/speaking/speaking-behavior.tsx',
  'frontend/app/(authed-reading)/reading/test/reading-test-behavior.tsx',
  'frontend/app/(authed-reading)/reading/mini-test/reading-mini-test-behavior.tsx',
  'frontend/app/(authed-listening)/listening/tests/listening-tests-behavior.tsx',
  'frontend/app/(authed-listening)/listening/mini-test/listening-mini-test-behavior.tsx',
  'frontend/app/(authed-listening)/listening/skills/listening-skills-behavior.tsx',
];
const PLAYER_LITERAL = /\/pages\/(practice|reading-exam|listening-test(?:-dictation)?)\.html/;
const POLICY_FILE = path.join(FRONTEND, 'lib', 'core-player-affinity.mjs');
const SHARED_SOURCE_ROOTS = ['app', 'components', 'lib']
  .map((directory) => path.join(FRONTEND, directory));

function sourceFilesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(absolute);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [absolute] : [];
  });
}

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

  test('launchers use the runtime endpoint and the current server policy preserves legacy semantics', () => {
    assert.equal(
      admitCorePlayer('speaking', { session_id: 'session A' }),
      '/core-player/launch?surface=speaking&session_id=session+A',
    );
    assert.equal(
      admitCorePlayer('reading_exam', { test_id: 'AVR-1', from: 'full' }),
      '/core-player/launch?surface=reading_exam&test_id=AVR-1&from=full',
    );
    assert.equal(
      admitCorePlayer('listening_test', { id: 'test-1', from: 'mini' }),
      '/core-player/launch?surface=listening_test&id=test-1&from=mini',
    );
    assert.equal(
      admitCorePlayer('listening_dictation', { test_id: 'test-1' }),
      '/core-player/launch?surface=listening_dictation&test_id=test-1',
    );
    assert.equal(
      resolveCorePlayerAdmission('reading_exam', { test_id: 'AVR-1', class_item: 'homework-1' }),
      '/pages/reading-exam.html?test_id=AVR-1&class_item=homework-1',
    );
    assert.equal(
      resolveCorePlayerAdmission('listening_test', { id: 'test-1', class_item: 'homework-1' }),
      '/pages/listening-test.html?id=test-1&class_item=homework-1',
    );
    assert.equal(
      resolveCorePlayerAdmission('listening_dictation', { test_id: 'test-1', section: 3 }),
      '/pages/listening-test-dictation.html?test_id=test-1&section=3',
    );
  });

  test('runtime route resolves server-side, redirects temporarily and cannot be cached', () => {
    assert.match(RUNTIME_ROUTE, /resolveCorePlayerAdmission\(surface, query\)/);
    assert.match(RUNTIME_ROUTE, /new NextResponse\(null, \{[\s\S]*status: 307/);
    assert.match(RUNTIME_ROUTE, /headers: \{ Location: destination, \.\.\.NO_STORE_HEADERS \}/);
    assert.doesNotMatch(RUNTIME_ROUTE, /request\.nextUrl\.origin/);
    assert.match(RUNTIME_ROUTE, /'Cache-Control': 'private, no-store, max-age=0, must-revalidate'/);
    assert.match(RUNTIME_ROUTE, /'CDN-Cache-Control': 'no-store'/);
    assert.match(RUNTIME_ROUTE, /'Vercel-CDN-Cache-Control': 'no-store'/);
    assert.match(RUNTIME_ROUTE, /key !== 'surface'/);
    assert.match(RUNTIME_ROUTE, /getAll\('surface'\)/);
    assert.match(RUNTIME_ROUTE, /hasDuplicate \|\| surfaces\.length !== 1/);
    assert.match(RUNTIME_ROUTE, /status: 400/);
  });

  test('canonical Next launchers use the policy, not scattered player literals', () => {
    for (const file of NEXT_LAUNCHERS) {
      const source = read(file);
      assert.match(source, /import \{ admitCorePlayer \} from '@\/lib\/core-player-affinity\.mjs'/, file);
      assert.match(source, /admitCorePlayer\(/, file);
      assert.doesNotMatch(source, PLAYER_LITERAL, file);
    }
  });

  test('no Next or shared source can bypass the central admission policy with a player literal', () => {
    const files = SHARED_SOURCE_ROOTS.flatMap(sourceFilesUnder);
    assert.ok(files.length >= 100, `shared source scan unexpectedly shrank to ${files.length} files`);
    const scanned = new Set(files);
    for (const launcher of NEXT_LAUNCHERS) {
      assert.ok(scanned.has(path.join(ROOT, launcher)), `launcher missing from scan: ${launcher}`);
    }
    for (const file of files) {
      if (file === POLICY_FILE) continue;
      assert.doesNotMatch(
        readFileSync(file, 'utf8'),
        PLAYER_LITERAL,
        path.relative(ROOT, file),
      );
    }
  });
});

describe('cutover and rollback drill', () => {
  test('an already-open launcher asks the current runtime again after rollback', () => {
    const cutover = readyNextPolicy();
    cutover.surfaces.speaking.admit_new = 'next';

    const legacyAttempt = corePlayerUrl(
      'speaking', 'legacy', { session_id: 'legacy-attempt' }, cutover,
    );
    const cachedLauncherHref = admitCorePlayer(
      'speaking', { session_id: 'next-attempt' }, cutover,
    );
    const nextAttempt = resolveCorePlayerAdmission(
      'speaking', { session_id: 'next-attempt' }, cutover,
    );
    assert.equal(legacyAttempt, '/pages/practice.html?session_id=legacy-attempt');
    assert.equal(
      cachedLauncherHref,
      '/core-player/launch?surface=speaking&session_id=next-attempt',
    );
    assert.equal(nextAttempt, '/practice/session?session_id=next-attempt');

    const rollback = structuredClone(cutover);
    rollback.surfaces.speaking.admit_new = 'legacy';
    assert.equal(
      corePlayerUrl('speaking', 'next', { session_id: 'next-attempt' }, rollback),
      nextAttempt,
    );
    assert.equal(
      admitCorePlayer('speaking', { session_id: 'next-attempt' }, rollback),
      cachedLauncherHref,
    );
    assert.equal(
      resolveCorePlayerAdmission('speaking', { session_id: 'next-attempt' }, rollback),
      '/pages/practice.html?session_id=next-attempt',
    );
  });

  test('an admission flip fails closed until its stable route is ready', () => {
    const unsafe = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
    unsafe.surfaces.speaking.admit_new = 'next';
    assert.deepEqual(validateCorePlayerAffinityPolicy(unsafe), [
      'speaking:admission-route-not-ready',
    ]);
    assert.throws(
      () => resolveCorePlayerAdmission('speaking', { session_id: 'x' }, unsafe),
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

    for (const pathValue of ['/\\outside.example/player', '/%2F%2Foutside.example/player', '/safe/../player']) {
      const unsafeVariant = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
      unsafeVariant.surfaces.speaking.legacy.path = pathValue;
      assert.ok(
        validateCorePlayerAffinityPolicy(unsafeVariant).includes('speaking:legacy-path-invalid'),
        pathValue,
      );
    }

    const unsafeQuery = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
    unsafeQuery.surfaces.speaking.allowed_query = [];
    assert.ok(validateCorePlayerAffinityPolicy(unsafeQuery)
      .includes('speaking:query-contract-invalid'));

    const reservedWireKey = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
    reservedWireKey.surfaces.speaking.allowed_query.push('surface');
    assert.ok(validateCorePlayerAffinityPolicy(reservedWireKey)
      .includes('speaking:query-contract-invalid'));

    const incomplete = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
    incomplete.schema_version = 2;
    delete incomplete.surfaces.reading_exam;
    assert.deepEqual(validateCorePlayerAffinityPolicy(incomplete), [
      'schema-version-invalid',
      'reading_exam:surface-missing',
    ]);

    const malformedQueryContract = structuredClone(CORE_PLAYER_AFFINITY_POLICY);
    malformedQueryContract.surfaces.speaking.identity_query_any_of = { session_id: true };
    malformedQueryContract.surfaces.speaking.allowed_query = ['session_id', 'bad-key?'];
    assert.deepEqual(validateCorePlayerAffinityPolicy(malformedQueryContract), [
      'speaking:identity-query-missing',
      'speaking:query-contract-invalid',
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
    for (const inheritedKey of ['constructor', '__proto__', 'toString', 'valueOf']) {
      assert.throws(
        () => resolveCorePlayerAdmission(inheritedKey, { session_id: 'x' }),
        /unknown-core-player-surface/,
        inheritedKey,
      );
    }
  });

  test('empty optional context is omitted without weakening identity or unknown-key checks', () => {
    assert.equal(
      admitCorePlayer('reading_exam', { test_id: 'AVR-1', from: '' }),
      '/core-player/launch?surface=reading_exam&test_id=AVR-1',
    );
    assert.throws(
      () => admitCorePlayer('reading_exam', { test_id: '', from: '' }),
      /invalid-core-player-query:test_id/,
    );
    assert.throws(
      () => admitCorePlayer('reading_exam', { test_id: 'AVR-1', utm_source: '' }),
      /unknown-core-player-query/,
    );
  });
});

describe('evidence truth', () => {
  test('calls the unit contract accurately and does not claim a live Gate E pass', () => {
    assert.match(DOC, /MECHANISM READY; LIVE CORE DRILL PENDING/);
    assert.match(DOC, /không tuyên\s+bố Gate E PASS/);
    assert.match(DOC, /không\s+có finite maximum active-session TTL/);
    assert.match(DOC, /[Qq]uery flag không phải affinity/);
    assert.match(DOC, /rollback floor SHA/);
    assert.match(DOC, /khác PR và khác commit/i);
    assert.match(DOC, /Writing[\s\S]*ngoài helper/i);
    assert.match(PREFLIGHT, /Sticky active-session hoặc drain strategy đã drill \| \*\*MISSING\*\*/);
    assert.match(PREFLIGHT, /unit-level only; chưa có active attempt nào được drill/);
  });
});
