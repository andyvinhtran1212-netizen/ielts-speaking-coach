import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validatePreviousPhaseHandoff({
  phase,
  floorSha,
  previousRunId,
  previousLegacySessionId,
  previousNextSessionId,
  runMetadata,
  previousEvidence,
}) {
  if (!['floor', 'cutover', 'rollback'].includes(phase)) throw new Error('phase-invalid');
  if (phase === 'floor') {
    if (previousRunId || previousLegacySessionId || previousNextSessionId) {
      throw new Error('floor-must-not-declare-previous-phase');
    }
    return { verified: true, previous_phase: null, previous_run_id: null };
  }

  if (!/^\d+$/.test(previousRunId || '')) throw new Error('previous-phase-run-id-invalid');
  if (runMetadata?.workflowName !== 'Speaking Gate E coexistence drill' ||
      runMetadata?.event !== 'workflow_dispatch' ||
      runMetadata?.headBranch !== 'main' ||
      runMetadata?.conclusion !== 'success') {
    throw new Error('previous-run-provenance-invalid');
  }

  const expectedPhase = phase === 'cutover' ? 'floor' : 'cutover';
  const expectedAdmission = expectedPhase === 'floor' ? 'legacy' : 'next';
  const handoffSessionId = phase === 'cutover' ? previousLegacySessionId : previousNextSessionId;
  const unusedSessionId = phase === 'cutover' ? previousNextSessionId : previousLegacySessionId;
  if (!UUID.test(handoffSessionId || '') || unusedSessionId) {
    throw new Error('previous-session-handoff-invalid');
  }
  if (!previousEvidence || previousEvidence.schema_version !== 1 ||
      previousEvidence.drill_id !== 'gate-e-speaking-coexistence-v1' ||
      previousEvidence.phase !== expectedPhase ||
      previousEvidence.status !== 'passed' || previousEvidence.ok !== true ||
      previousEvidence.expected_admission !== expectedAdmission ||
      previousEvidence.rollback_floor_sha !== floorSha ||
      previousEvidence.floor_lineage_verified !== true ||
      previousEvidence.deployed_frontend_sha !== previousEvidence.source_sha ||
      previousEvidence.deployed_frontend_branch !== 'staging' ||
      previousEvidence.backend_release !== previousEvidence.source_sha ||
      previousEvidence.backend_git_branch !== 'staging' ||
      previousEvidence.backend_environment_name !== 'staging' ||
      previousEvidence.created_session_id !== handoffSessionId) {
    throw new Error('previous-phase-evidence-invalid');
  }
  if (expectedPhase === 'floor' && previousEvidence.source_sha !== floorSha) {
    throw new Error('previous-floor-source-mismatch');
  }

  return {
    verified: true,
    previous_phase: expectedPhase,
    previous_run_id: previousRunId,
    previous_created_session_id: handoffSessionId,
  };
}

function findEvidence(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findEvidence(target);
      if (found) return found;
    } else if (entry.name === 'gate-e-speaking-coexistence-evidence.json') {
      return target;
    }
  }
  return null;
}

function run() {
  const phase = process.env.GATE_E_DRILL_PHASE || '';
  const floorSha = process.env.GATE_E_ROLLBACK_FLOOR_SHA || '';
  const previousRunId = process.env.GATE_E_PREVIOUS_PHASE_RUN_ID || '';
  const previousLegacySessionId = process.env.GATE_E_PREVIOUS_LEGACY_SESSION_ID || '';
  const previousNextSessionId = process.env.GATE_E_PREVIOUS_NEXT_SESSION_ID || '';
  const inputDir = path.resolve('test-results/gate-e-previous-phase');
  const output = path.resolve('test-results/gate-e-speaking-coexistence-handoff.json');
  let result;

  try {
    let runMetadata = null;
    let previousEvidence = null;
    if (phase !== 'floor') {
      const metadataSource = execFileSync('gh', [
        'run', 'view', previousRunId,
        '--json', 'workflowName,event,headBranch,conclusion,databaseId',
      ], { encoding: 'utf8' });
      runMetadata = JSON.parse(metadataSource);
      const evidencePath = findEvidence(inputDir);
      if (!evidencePath) throw new Error('previous-phase-evidence-file-missing');
      previousEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    }
    result = validatePreviousPhaseHandoff({
      phase,
      floorSha,
      previousRunId,
      previousLegacySessionId,
      previousNextSessionId,
      runMetadata,
      previousEvidence,
    });
  } catch (error) {
    result = {
      verified: false,
      previous_phase: null,
      previous_run_id: previousRunId || null,
      error: String(error?.message || error),
    };
  }

  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ schema_version: 1, phase, ...result }, null, 2)}\n`);
  if (result.verified && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'verified=true\n');
  }
  console.log(`Gate E coexistence handoff: ${result.verified ? 'VERIFIED' : 'INVALID'}`);
  if (!result.verified) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();
