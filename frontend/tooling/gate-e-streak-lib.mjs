import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function walkSuites(suites, visit) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) visit(test, spec);
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

export function verifyFrozenDirs(root, manifest) {
  const errors = [];
  const allowed = new Set((manifest.frozen_files || []).map((item) => item.path));
  for (const relativeDir of manifest.frozen_dirs || []) {
    const absoluteDir = path.join(root, relativeDir);
    const pending = [{ absolute: absoluteDir, relative: relativeDir }];
    try {
      while (pending.length) {
        const current = pending.pop();
        for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
          const relative = path.join(current.relative, entry.name).split(path.sep).join('/');
          const absolute = path.join(current.absolute, entry.name);
          if (entry.isDirectory()) {
            pending.push({ absolute, relative });
          } else if (entry.isSymbolicLink()) {
            errors.push(`frozen-dir-symlink:${relative}`);
          } else if (entry.isFile() && !allowed.has(relative)) {
            errors.push(`frozen-dir-extra-file:${relative}`);
          }
        }
      }
    } catch {
      errors.push(`frozen-dir-missing:${relativeDir}`);
    }
  }
  return errors;
}

export function digestManifestContract(manifest) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export function isReviewedAncestorComparison(payload, testedSha) {
  return ['ahead', 'identical'].includes(payload?.status) &&
    payload?.merge_base_commit?.sha === testedSha;
}

export function isReviewedSourceComparison(payload, testedSha) {
  if (isReviewedAncestorComparison(payload, testedSha)) return true;

  const testedTreeSha = payload?.base_commit?.commit?.tree?.sha;
  const reviewedTreeSha = payload?.merge_base_commit?.commit?.tree?.sha;
  return ['behind', 'diverged'].includes(payload?.status) &&
    payload?.base_commit?.sha === testedSha &&
    /^[a-f0-9]{40}$/.test(String(testedTreeSha || '')) &&
    testedTreeSha === reviewedTreeSha;
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
  if (Number(previous.run_number) !== currentNumber - 1) {
    return { verified: false };
  }
  return {
    verified: true,
    previous_run_id: String(previous.id),
  };
}

export function selectWorkflowJobConclusion(jobs, jobName = 'staging-e2e') {
  const matches = (jobs || []).filter((item) => item.name === jobName);
  if (matches.length !== 1 || matches[0].status !== 'completed' || !matches[0].conclusion) {
    return { verified: false };
  }
  return { verified: true, previous_conclusion: matches[0].conclusion };
}

export function summarizePlaywrightReport(report, manifest) {
  if (!report || typeof report !== 'object') {
    return { clean: false, reasons: ['playwright-report-missing'], project_counts: {} };
  }

  const stats = report.stats || {};
  const projectCounts = {};
  const skippedTests = [];
  walkSuites(report.suites, (item, spec) => {
    const project = item.projectName || item.projectId || 'unknown';
    projectCounts[project] = (projectCounts[project] || 0) + 1;
    if (item.status === 'skipped') {
      const annotation = (item.annotations || []).find((entry) => entry.type === 'skip');
      skippedTests.push({
        project,
        title: spec.title || '(untitled)',
        file: spec.file || '(unknown)',
        description: annotation?.description || '(missing)',
      });
    }
  });

  const expected = Number(stats.expected || 0);
  const skipped = Number(stats.skipped || 0);
  const unexpected = Number(stats.unexpected || 0);
  const flaky = Number(stats.flaky || 0);
  const total = expected + skipped + unexpected + flaky;
  const executed = expected + unexpected + flaky;
  const reasons = [];

  if ((report.errors || []).length) reasons.push('playwright-top-level-errors');
  if (unexpected !== manifest.thresholds.unexpected) reasons.push(`unexpected:${unexpected}`);
  if (flaky !== manifest.thresholds.flaky) reasons.push(`flaky:${flaky}`);
  if (skipped !== skippedTests.length) {
    reasons.push(`skip-detail-count:${skippedTests.length}/${skipped}`);
  }
  if (skipped > Number(manifest.thresholds.max_skipped || 0)) {
    reasons.push(`skipped:${skipped}`);
  }
  const allowedSkipLimits = new Map((manifest.allowed_skips || []).map((item) => [
    [item.project, item.title, item.file, item.description].join('\u0000'),
    Number(item.max_occurrences || 1),
  ]));
  const actualSkipCounts = new Map();
  for (const item of skippedTests) {
    const key = [item.project, item.title, item.file, item.description].join('\u0000');
    actualSkipCounts.set(key, Number(actualSkipCounts.get(key) || 0) + 1);
    if (!allowedSkipLimits.has(key)) {
      reasons.push(`unexpected-skip:${item.project}:${item.file}:${item.title}:${item.description}`);
    }
  }
  for (const [key, count] of actualSkipCounts) {
    const limit = allowedSkipLimits.get(key);
    if (limit !== undefined && count > limit) {
      reasons.push(`skip-limit:${key.split('\u0000').join(':')}:${count}/${limit}`);
    }
  }
  if (total !== manifest.expected_total_tests) {
    reasons.push(`test-total:${total}/${manifest.expected_total_tests}`);
  }
  if (executed === 0 || expected / executed !== manifest.thresholds.pass_rate) {
    reasons.push(`pass-rate:${executed ? expected / executed : 0}`);
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
    skipped_tests: skippedTests,
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
  const manifestDigest = digestManifestContract(manifest);
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

  const continuityReasons = [];
  if (!previous) {
    continuityReasons.push('ledger-seed');
  } else {
    if (previous.suite_id !== manifest.suite_id) continuityReasons.push('suite-version-changed');
    if (previous.matrix_id !== manifest.matrix_id) continuityReasons.push('matrix-version-changed');
    if (previous.manifest_digest !== manifestDigest) continuityReasons.push('manifest-changed');
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
  const failureInjection = manifest.failure_injection || {};
  const coveredFailurePaths = Array.isArray(failureInjection.covered)
    ? failureInjection.covered
    : [];
  const missingFailurePaths = Array.isArray(failureInjection.missing)
    ? failureInjection.missing
    : null;
  const failureMatrixComplete = failureInjection.status === 'complete' &&
    coveredFailurePaths.length > 0 &&
    missingFailurePaths?.length === 0;

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
    manifest_digest: manifestDigest,
    captured_at: provenance?.captured_at || metadata?.generated_at || null,
  };

  return {
    schema_version: 1,
    suite_id: manifest.suite_id,
    matrix_id: manifest.matrix_id,
    manifest_digest: manifestDigest,
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
