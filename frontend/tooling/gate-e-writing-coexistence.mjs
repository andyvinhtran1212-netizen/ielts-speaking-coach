import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORE_PLAYER_AFFINITY_POLICY,
  corePlayerAdmissionForDeployment,
} from '../lib/core-player-affinity.mjs';

const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHASES = new Set(['floor', 'rollback', 'restore']);

function checkedInputs(inputs) {
  if (!inputs || inputs.schema_version !== 1) throw new Error('writing-push-input-schema-invalid');
  return inputs;
}

export function resolveWritingPushPhase({ sourceSha, admission, inputs }) {
  const value = checkedInputs(inputs);
  if (!SHA.test(sourceSha || '')) throw new Error('writing-source-sha-invalid');
  if (!['legacy', 'next'].includes(admission)) throw new Error('writing-admission-invalid');
  const floorSha = value.rollback_floor_sha;
  const previousRun = value.previous_phase_run_id;
  const previousLegacy = value.previous_legacy_assignment_id;
  const previousNext = value.previous_next_assignment_id;

  if (!floorSha) {
    if (admission !== 'next' || [previousRun, previousLegacy, previousNext].some(Boolean)) {
      throw new Error('writing-floor-push-input-invalid');
    }
    return { phase: 'floor', floor_sha: sourceSha, legacy_assignment: '',
      next_assignment: '', previous_run: '' };
  }
  if (!SHA.test(floorSha) || !/^\d+$/.test(previousRun || '')) {
    throw new Error('writing-phase-push-input-invalid');
  }
  if (admission === 'legacy') {
    if (!UUID.test(previousNext || '') || previousLegacy) {
      throw new Error('writing-rollback-push-input-invalid');
    }
    return { phase: 'rollback', floor_sha: floorSha, legacy_assignment: '',
      next_assignment: previousNext, previous_run: previousRun };
  }
  if (!UUID.test(previousLegacy || '') || previousNext) {
    throw new Error('writing-restore-push-input-invalid');
  }
  return { phase: 'restore', floor_sha: floorSha, legacy_assignment: previousLegacy,
    next_assignment: '', previous_run: previousRun };
}

export function validateWritingPhaseLineage({ phase, sourceSha, floorSha, isAncestor }) {
  if (!PHASES.has(phase)) throw new Error('writing-phase-invalid');
  if (!SHA.test(sourceSha || '') || !SHA.test(floorSha || '')) throw new Error('writing-lineage-sha-invalid');
  if (phase === 'floor') {
    if (sourceSha !== floorSha) throw new Error('writing-floor-source-mismatch');
    return { phase, source_sha: sourceSha, rollback_floor_sha: floorSha, verified: true };
  }
  if (sourceSha === floorSha || !isAncestor(floorSha, sourceSha)) {
    throw new Error('writing-phase-is-not-floor-descendant');
  }
  return {
    phase,
    source_sha: sourceSha,
    rollback_floor_sha: floorSha,
    verified: true,
    transition_mode: phase === 'rollback' ? 'staging-admission-override' : 'forward-restore',
  };
}

export function validateWritingPreviousPhaseHandoff(input) {
  const { phase, sourceSha, floorSha, previousRunId, previousLegacyAssignmentId,
    previousNextAssignmentId, runMetadata, previousEvidence,
    isAncestor = () => false } = input;
  if (!PHASES.has(phase)) throw new Error('writing-phase-invalid');
  if (!SHA.test(sourceSha || '') || !SHA.test(floorSha || '')) throw new Error('writing-handoff-sha-invalid');
  const supplied = [previousRunId, previousLegacyAssignmentId, previousNextAssignmentId].filter(Boolean);
  if (phase === 'floor') {
    if (supplied.length) throw new Error('writing-floor-must-not-declare-previous-phase');
    return { verified: true, previous_phase: null, previous_run_id: null };
  }
  if (!/^\d+$/.test(previousRunId || '')) throw new Error('writing-previous-run-id-invalid');
  const validTrigger = (runMetadata?.event === 'workflow_dispatch' &&
      ['main', 'staging'].includes(runMetadata?.headBranch)) ||
    (runMetadata?.event === 'push' && runMetadata?.headBranch === 'staging');
  if (runMetadata?.workflowName !== 'Writing Gate E coexistence drill' ||
      !validTrigger || runMetadata?.conclusion !== 'success') {
    throw new Error('writing-previous-run-provenance-invalid');
  }

  const rollback = phase === 'rollback';
  const assignmentId = rollback ? previousNextAssignmentId : previousLegacyAssignmentId;
  const unused = rollback ? previousLegacyAssignmentId : previousNextAssignmentId;
  if (!UUID.test(assignmentId || '') || unused) throw new Error('writing-previous-assignment-invalid');
  const expectedPhase = rollback ? 'floor' : 'rollback';
  const expectedAdmission = rollback ? 'next' : 'legacy';
  const evidence = previousEvidence;
  if (!evidence || evidence.schema_version !== 1 ||
      evidence.drill_id !== 'gate-e-writing-coexistence-v1' ||
      evidence.phase !== expectedPhase || evidence.status !== 'passed' || evidence.ok !== true ||
      evidence.expected_admission !== expectedAdmission || evidence.rollback_floor_sha !== floorSha ||
      evidence.floor_lineage_verified !== true || evidence.previous_phase_handoff_verified !== true ||
      evidence.deployed_frontend_sha !== evidence.source_sha ||
      evidence.deployed_frontend_branch !== 'staging' || evidence.backend_release !== evidence.source_sha ||
      evidence.backend_git_branch !== 'staging' || evidence.backend_environment_name !== 'staging' ||
      evidence.created_assignment_id !== assignmentId ||
      typeof evidence.created_draft_text !== 'string' || !evidence.created_draft_text) {
    throw new Error('writing-previous-phase-evidence-invalid');
  }
  if (expectedPhase === 'floor' && evidence.source_sha !== floorSha) {
    throw new Error('writing-previous-floor-source-mismatch');
  }
  if (evidence.source_sha === sourceSha || !isAncestor(evidence.source_sha, sourceSha)) {
    throw new Error('writing-current-source-is-not-previous-descendant');
  }
  return { verified: true, previous_phase: expectedPhase, previous_run_id: previousRunId,
    previous_created_assignment_id: assignmentId };
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function writeEvidence(filename, body) {
  const output = path.resolve('test-results', filename);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ schema_version: 1, ...body }, null, 2)}\n`);
}

function findEvidence(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { const found = findEvidence(target); if (found) return found; }
    else if (entry.name === 'gate-e-writing-coexistence-evidence.json') return target;
  }
  return null;
}

function runResolve() {
  const inputs = JSON.parse(readFileSync(
    path.resolve('tooling/gate-e-writing-coexistence-push-inputs.json'), 'utf8',
  ));
  const resolved = resolveWritingPushPhase({
    sourceSha: process.env.SOURCE_SHA || '',
    admission: corePlayerAdmissionForDeployment(
      'writing_assignment', { vercelEnv: 'preview', gitRef: 'staging' },
      CORE_PLAYER_AFFINITY_POLICY,
    ),
    inputs,
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT-missing');
  appendFileSync(process.env.GITHUB_OUTPUT,
    `${Object.entries(resolved).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
}

function runLineage() {
  const phase = process.env.GATE_E_DRILL_PHASE || '';
  const sourceSha = process.env.GATE_E_SOURCE_SHA || '';
  const floorSha = process.env.GATE_E_ROLLBACK_FLOOR_SHA || '';
  let result;
  try {
    for (const sha of [sourceSha, floorSha]) if (SHA.test(sha)) {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    }
    result = validateWritingPhaseLineage({ phase, sourceSha, floorSha, isAncestor });
  } catch (error) {
    result = { phase: phase || null, source_sha: sourceSha || null,
      rollback_floor_sha: floorSha || null, verified: false,
      error: String(error?.message || error) };
  }
  writeEvidence('gate-e-writing-coexistence-lineage.json', result);
  if (result.verified && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'verified=true\n');
    if (result.transition_mode) appendFileSync(process.env.GITHUB_OUTPUT,
      `transition_mode=${result.transition_mode}\n`);
  }
  if (!result.verified) process.exitCode = 1;
}

function runHandoff() {
  const env = process.env;
  const phase = env.GATE_E_DRILL_PHASE || '';
  let result;
  try {
    let runMetadata = null; let previousEvidence = null;
    if (phase !== 'floor') {
      runMetadata = JSON.parse(execFileSync('gh', ['run', 'view', env.GATE_E_PREVIOUS_PHASE_RUN_ID || '',
        '--json', 'workflowName,event,headBranch,conclusion,databaseId'], { encoding: 'utf8' }));
      const evidencePath = findEvidence(path.resolve('test-results/gate-e-previous-phase'));
      if (!evidencePath) throw new Error('writing-previous-evidence-missing');
      previousEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    }
    result = validateWritingPreviousPhaseHandoff({
      phase, sourceSha: env.GATE_E_SOURCE_SHA || '', floorSha: env.GATE_E_ROLLBACK_FLOOR_SHA || '',
      previousRunId: env.GATE_E_PREVIOUS_PHASE_RUN_ID || '',
      previousLegacyAssignmentId: env.GATE_E_PREVIOUS_LEGACY_ASSIGNMENT_ID || '',
      previousNextAssignmentId: env.GATE_E_PREVIOUS_NEXT_ASSIGNMENT_ID || '',
      runMetadata, previousEvidence, isAncestor,
    });
  } catch (error) { result = { verified: false, error: String(error?.message || error) }; }
  writeEvidence('gate-e-writing-coexistence-handoff.json', { phase, ...result });
  if (result.verified && env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'verified=true\n');
  if (!result.verified) process.exitCode = 1;
}

function run() {
  const command = process.argv[2];
  if (command === 'resolve') return runResolve();
  if (command === 'lineage') return runLineage();
  if (command === 'handoff') return runHandoff();
  throw new Error('usage: gate-e-writing-coexistence.mjs <resolve|lineage|handoff>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) run();
