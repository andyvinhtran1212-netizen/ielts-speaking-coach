import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;

export function validateReadingPreviousPhaseHandoff(input) {
  const { phase, sourceSha, floorSha, previousRunId, previousLegacyAttemptId,
    previousLegacyTestId, previousNextAttemptId, previousNextTestId,
    runMetadata, previousEvidence, isAncestor = () => false } = input;
  if (!['floor', 'cutover', 'rollback'].includes(phase)) throw new Error('phase-invalid');
  if (!SHA.test(sourceSha || '') || !SHA.test(floorSha || '')) throw new Error('handoff-sha-invalid');
  const supplied = [previousRunId, previousLegacyAttemptId, previousLegacyTestId,
    previousNextAttemptId, previousNextTestId].filter(Boolean);
  if (phase === 'floor') {
    if (supplied.length) throw new Error('floor-must-not-declare-previous-phase');
    return { verified: true, previous_phase: null, previous_run_id: null };
  }
  if (!/^\d+$/.test(previousRunId || '')) throw new Error('previous-run-id-invalid');
  const validTrigger = (runMetadata?.event === 'workflow_dispatch' &&
      ['main', 'staging'].includes(runMetadata?.headBranch)) ||
    (runMetadata?.event === 'push' && runMetadata?.headBranch === 'staging');
  if (runMetadata?.workflowName !== 'Reading Gate E coexistence drill' ||
      !validTrigger || runMetadata?.conclusion !== 'success') {
    throw new Error('previous-run-provenance-invalid');
  }
  const cutover = phase === 'cutover';
  const attemptId = cutover ? previousLegacyAttemptId : previousNextAttemptId;
  const testId = cutover ? previousLegacyTestId : previousNextTestId;
  const unused = cutover
    ? [previousNextAttemptId, previousNextTestId] : [previousLegacyAttemptId, previousLegacyTestId];
  if (!UUID.test(attemptId || '') || !testId || unused.some(Boolean)) {
    throw new Error('previous-attempt-handoff-invalid');
  }
  const expectedPhase = cutover ? 'floor' : 'cutover';
  const expectedAdmission = cutover ? 'legacy' : 'next';
  const e = previousEvidence;
  if (!e || e.schema_version !== 1 || e.drill_id !== 'gate-e-reading-coexistence-v1' ||
      e.phase !== expectedPhase || e.status !== 'passed' || e.ok !== true ||
      e.expected_admission !== expectedAdmission || e.rollback_floor_sha !== floorSha ||
      e.floor_lineage_verified !== true || e.deployed_frontend_sha !== e.source_sha ||
      e.deployed_frontend_branch !== 'staging' || e.backend_release !== e.source_sha ||
      e.backend_git_branch !== 'staging' || e.backend_environment_name !== 'staging' ||
      e.created_attempt_id !== attemptId || e.created_test_id !== testId) {
    throw new Error('previous-phase-evidence-invalid');
  }
  if (expectedPhase === 'floor' && e.source_sha !== floorSha) throw new Error('previous-floor-source-mismatch');
  if (phase === 'rollback' && e.source_sha === sourceSha) throw new Error('rollback-source-must-differ');
  if (phase === 'rollback' && sourceSha !== floorSha && !isAncestor(e.source_sha, sourceSha)) {
    throw new Error('forward-rollback-source-is-not-cutover-descendant');
  }
  return { verified: true, previous_phase: expectedPhase, previous_run_id: previousRunId,
    previous_created_attempt_id: attemptId, previous_created_test_id: testId };
}

function findEvidence(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { const found = findEvidence(target); if (found) return found; }
    else if (entry.name === 'gate-e-reading-coexistence-evidence.json') return target;
  }
  return null;
}

function run() {
  const env = process.env;
  const phase = env.GATE_E_DRILL_PHASE || '';
  const previousRunId = env.GATE_E_PREVIOUS_PHASE_RUN_ID || '';
  const output = path.resolve('test-results/gate-e-reading-coexistence-handoff.json');
  let result;
  try {
    let runMetadata = null; let previousEvidence = null;
    if (phase !== 'floor') {
      runMetadata = JSON.parse(execFileSync('gh', ['run', 'view', previousRunId,
        '--json', 'workflowName,event,headBranch,conclusion,databaseId'], { encoding: 'utf8' }));
      const evidencePath = findEvidence(path.resolve('test-results/gate-e-previous-phase'));
      if (!evidencePath) throw new Error('previous-evidence-missing');
      previousEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    }
    result = validateReadingPreviousPhaseHandoff({
      phase, sourceSha: env.GATE_E_SOURCE_SHA || '', floorSha: env.GATE_E_ROLLBACK_FLOOR_SHA || '',
      previousRunId, previousLegacyAttemptId: env.GATE_E_PREVIOUS_LEGACY_ATTEMPT_ID || '',
      previousLegacyTestId: env.GATE_E_PREVIOUS_LEGACY_TEST_ID || '',
      previousNextAttemptId: env.GATE_E_PREVIOUS_NEXT_ATTEMPT_ID || '',
      previousNextTestId: env.GATE_E_PREVIOUS_NEXT_TEST_ID || '', runMetadata, previousEvidence,
      isAncestor(a, d) { try { execFileSync('git', ['merge-base', '--is-ancestor', a, d], { stdio: 'ignore' }); return true; } catch { return false; } },
    });
  } catch (error) { result = { verified: false, error: String(error?.message || error) }; }
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ schema_version: 1, phase, ...result }, null, 2)}\n`);
  if (result.verified && env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'verified=true\n');
  if (!result.verified) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();
