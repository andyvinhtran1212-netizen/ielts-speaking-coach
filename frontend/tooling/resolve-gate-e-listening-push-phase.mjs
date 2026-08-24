import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_PLAYER_AFFINITY_POLICY } from '../lib/core-player-affinity.mjs';

const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function blank(value) { return value === null || value === undefined || value === ''; }

export function resolveListeningPushPhase({ sourceSha, admission, inputs }) {
  if (!SHA.test(sourceSha || '')) throw new Error('push-source-sha-invalid');
  if (inputs?.schema_version !== 1) throw new Error('push-input-schema-invalid');
  const legacyAttempt = inputs.previous_legacy_attempt_id;
  const legacyTest = inputs.previous_legacy_test_id;
  const nextAttempt = inputs.previous_next_attempt_id;
  const nextTest = inputs.previous_next_test_id;
  const previousRun = inputs.previous_phase_run_id;
  const floorSha = inputs.rollback_floor_sha;
  const previousValues = [previousRun, legacyAttempt, legacyTest, nextAttempt, nextTest];

  if (admission === 'next') {
    if (!SHA.test(floorSha || '') || !/^\d+$/.test(previousRun || '') ||
        !UUID.test(legacyAttempt || '') || blank(legacyTest) ||
        !blank(nextAttempt) || !blank(nextTest)) {
      throw new Error('cutover-push-input-invalid');
    }
    return { phase: 'cutover', floor_sha: floorSha, previous_run: previousRun,
      legacy_attempt: legacyAttempt, legacy_test: legacyTest,
      next_attempt: '', next_test: '' };
  }
  if (admission !== 'legacy') throw new Error('listening-admission-invalid');

  const rollbackDeclared = !blank(nextAttempt) || !blank(nextTest);
  if (rollbackDeclared) {
    if (!SHA.test(floorSha || '') || !/^\d+$/.test(previousRun || '') ||
        !UUID.test(nextAttempt || '') || blank(nextTest) ||
        !blank(legacyAttempt) || !blank(legacyTest)) {
      throw new Error('rollback-push-input-invalid');
    }
    return { phase: 'rollback', floor_sha: floorSha, previous_run: previousRun,
      legacy_attempt: '', legacy_test: '', next_attempt: nextAttempt, next_test: nextTest };
  }

  if (previousValues.some((value) => !blank(value)) || !blank(floorSha)) {
    throw new Error('floor-push-must-not-declare-handoff');
  }
  return { phase: 'floor', floor_sha: sourceSha, previous_run: '',
    legacy_attempt: '', legacy_test: '', next_attempt: '', next_test: '' };
}

function run() {
  const sourceSha = process.env.SOURCE_SHA || '';
  const inputs = JSON.parse(readFileSync(
    path.resolve('tooling/gate-e-listening-coexistence-push-inputs.json'), 'utf8',
  ));
  const resolved = resolveListeningPushPhase({
    sourceSha,
    admission: CORE_PLAYER_AFFINITY_POLICY.surfaces.listening_test.admit_new,
    inputs,
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT-missing');
  appendFileSync(process.env.GITHUB_OUTPUT,
    `${Object.entries(resolved).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();

