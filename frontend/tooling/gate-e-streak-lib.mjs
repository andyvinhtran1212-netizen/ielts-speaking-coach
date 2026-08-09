import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function walkSuites(suites, visit) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) visit(test);
    }
    walkSuites(suite.suites || [], visit);
  }
}

export function verifyFrozenFiles(root, manifest) {
  const errors = [];
  for (const item of manifest.frozen_files || []) {
    let source;
    try {
      source = readFileSync(path.join(root, item.path));
    } catch {
      errors.push(`frozen-file-missing:${item.path}`);
      continue;
    }
    const actual = createHash('sha256').update(source).digest('hex');
    if (actual !== item.sha256) errors.push(`frozen-file-drift:${item.path}`);
  }
  return errors;
}

export function selectPreviousWorkflowRun(workflowRuns, currentRunId, currentRunNumber) {
  const currentNumber = Number(currentRunNumber);
  if (!currentRunId || currentRunNumber === null || currentRunNumber === undefined ||
      currentRunNumber === '' || !Number.isInteger(currentNumber) || currentNumber < 1) {
    return { verified: false };
  }

  // GitHub may already list newer queued dispatches while the current run is
  // executing. They are not predecessors. Pick the greatest lower run number;
  // any rerun executed out of sequence is still caught by last_run_id mismatch.
  const previous = (workflowRuns || [])
    .filter((item) => String(item.id) !== String(currentRunId))
    .filter((item) => Number.isFinite(Number(item.run_number)))
    .filter((item) => Number(item.run_number) < currentNumber)
    .sort((left, right) => Number(right.run_number) - Number(left.run_number))[0];

  if (!previous) {
    return { verified: true, previous_run_id: null, previous_conclusion: null };
  }
  return {
    verified: true,
    previous_run_id: String(previous.id),
    previous_conclusion: previous.conclusion,
  };
}

export function summarizePlaywrightReport(report, manifest) {
  if (!report || typeof report !== 'object') {
    return { clean: false, reasons: ['playwright-report-missing'], project_counts: {} };
  }

  const stats = report.stats || {};
  const projectCounts = {};
  walkSuites(report.suites, (item) => {
    const project = item.projectName || item.projectId || 'unknown';
    projectCounts[project] = (projectCounts[project] || 0) + 1;
  });

  const expected = Number(stats.expected || 0);
  const skipped = Number(stats.skipped || 0);
  const unexpected = Number(stats.unexpected || 0);
  const flaky = Number(stats.flaky || 0);
  const total = expected + skipped + unexpected + flaky;
  const reasons = [];

  if ((report.errors || []).length) reasons.push('playwright-top-level-errors');
  if (unexpected !== manifest.thresholds.unexpected) reasons.push(`unexpected:${unexpected}`);
  if (flaky !== manifest.thresholds.flaky) reasons.push(`flaky:${flaky}`);
  if (skipped !== manifest.thresholds.skipped) reasons.push(`skipped:${skipped}`);
  if (total !== manifest.expected_total_tests) {
    reasons.push(`test-total:${total}/${manifest.expected_total_tests}`);
  }
  if (total === 0 || expected / total !== manifest.thresholds.pass_rate) {
    reasons.push(`pass-rate:${total ? expected / total : 0}`);
  }

  for (const [project, count] of Object.entries(manifest.expected_project_counts)) {
    if (projectCounts[project] !== count) {
      reasons.push(`project-count:${project}:${projectCounts[project] || 0}/${count}`);
    }
  }
  for (const project of Object.keys(projectCounts)) {
    if (!(project in manifest.expected_project_counts)) reasons.push(`unexpected-project:${project}`);
  }

  return {
    clean: reasons.length === 0,
    reasons,
    stats: { expected, skipped, unexpected, flaky, total },
    project_counts: projectCounts,
  };
}

const validSha = (value) => /^[a-f0-9]{40}$/.test(String(value || ''));

export function advanceStreak({
  previous,
  metadata,
  provenance,
  report,
  manifest,
  frozenFileErrors = [],
  previousWorkflowRun,
}) {
  const summary = summarizePlaywrightReport(report, manifest);
  const currentReasons = [...frozenFileErrors, ...summary.reasons];
  const runAttempt = Number(metadata?.run_attempt || 0);

  if (metadata?.matrix_id !== manifest.matrix_id) currentReasons.push('matrix-version-mismatch');
  if (metadata?.run_outcome !== 'success') currentReasons.push(`run-outcome:${metadata?.run_outcome || 'missing'}`);
  if (runAttempt !== manifest.thresholds.run_attempt) currentReasons.push(`run-attempt:${runAttempt}`);
  if (!provenance?.ok) currentReasons.push('staging-provenance-invalid');
  if (!validSha(metadata?.git_sha)) currentReasons.push('tested-source-sha-invalid');
  if (provenance?.frontend_release !== metadata?.git_sha) currentReasons.push('frontend-release-mismatch');
  if (provenance?.backend_release !== metadata?.git_sha) currentReasons.push('backend-release-mismatch');
  if (provenance?.frontend_git_ref !== metadata?.git_ref) currentReasons.push('frontend-ref-mismatch');
  if (provenance?.backend_git_branch !== metadata?.git_ref) currentReasons.push('backend-ref-mismatch');

  const continuityReasons = [];
  if (!previous) {
    continuityReasons.push('ledger-seed');
  } else {
    if (previous.suite_id !== manifest.suite_id) continuityReasons.push('suite-version-changed');
    if (previous.matrix_id !== manifest.matrix_id) continuityReasons.push('matrix-version-changed');
    if (!previousWorkflowRun?.verified) {
      continuityReasons.push('workflow-history-unverified');
    } else {
      if (String(previousWorkflowRun.previous_run_id) !== String(previous.last_run_id)) {
        continuityReasons.push('previous-run-state-mismatch');
      }
      if (previousWorkflowRun.previous_conclusion !== 'success') {
        continuityReasons.push(`previous-run:${previousWorkflowRun.previous_conclusion || 'unknown'}`);
      }
    }
    if (previous.frontend_release !== provenance?.frontend_release) {
      continuityReasons.push('frontend-release-changed');
    }
    if (previous.backend_release !== provenance?.backend_release) {
      continuityReasons.push('backend-release-changed');
    }
  }

  const clean = currentReasons.length === 0;
  const canContinue = clean && previous && continuityReasons.length === 0;
  const streakCount = clean ? (canContinue ? Number(previous.streak_count || 0) + 1 : 1) : 0;
  const thresholdMet = streakCount >= manifest.target_consecutive_clean_runs;
  const realDevicesComplete = (metadata?.real_device_requirements || []).length > 0 &&
    metadata.real_device_requirements.every((item) => item.status === 'complete');
  const failureMatrixComplete = manifest.failure_injection.status === 'complete';

  const entry = {
    run_id: metadata?.run_id || null,
    run_number: metadata?.run_number || null,
    run_attempt: metadata?.run_attempt || null,
    git_sha: metadata?.git_sha || null,
    run_outcome: metadata?.run_outcome || null,
    frontend_release: provenance?.frontend_release || null,
    backend_release: provenance?.backend_release || null,
    clean,
    reset_reasons: [...currentReasons, ...continuityReasons],
    stats: summary.stats || null,
    project_counts: summary.project_counts,
    captured_at: provenance?.captured_at || metadata?.generated_at || null,
  };

  return {
    schema_version: 1,
    suite_id: manifest.suite_id,
    matrix_id: manifest.matrix_id,
    target_consecutive_clean_runs: manifest.target_consecutive_clean_runs,
    streak_count: streakCount,
    threshold_met: thresholdMet,
    failure_matrix_complete: failureMatrixComplete,
    real_devices_complete: realDevicesComplete,
    gate_e_evidence_eligible: thresholdMet && failureMatrixComplete && realDevicesComplete,
    last_run_id: metadata?.run_id || null,
    frontend_release: provenance?.frontend_release || null,
    backend_release: provenance?.backend_release || null,
    entries: [...(previous?.entries || []), entry].slice(-50),
  };
}
