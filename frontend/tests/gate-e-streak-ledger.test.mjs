/** Gate E streak ledger: clean means exact, consecutive and release-frozen. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceStreak,
  selectPreviousWorkflowRun,
  summarizePlaywrightReport,
  verifyFrozenFiles,
} from '../tooling/gate-e-streak-lib.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));
const MANIFEST = json('frontend/tooling/gate-e-critical-suite.json');
const WORKFLOW = read('.github/workflows/staging-e2e.yml');
const UPDATER = read('frontend/tooling/update-gate-e-streak-ledger.mjs');
const CAPTURE = read('frontend/tooling/capture-gate-e-staging-provenance.mjs');
const HEALTH = read('backend/routers/health.py');
const SETTINGS = read('backend/config.py');
const DOC = read('docs/GATE_E_STREAK_LEDGER_2026-08-09.md');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function cleanReport(overrides = {}) {
  const suites = Object.entries(MANIFEST.expected_project_counts).map(([project, count]) => ({
    specs: [{ tests: Array.from({ length: count }, () => ({ projectName: project })) }],
  }));
  return {
    suites,
    errors: [],
    stats: {
      expected: MANIFEST.expected_total_tests,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
      ...overrides,
    },
  };
}

const metadata = (runId, sha = SHA_A, attempt = '1') => ({
  matrix_id: MANIFEST.matrix_id,
  generated_at: '2026-08-09T00:00:00Z',
  git_sha: sha,
  git_ref: 'staging',
  run_id: String(runId),
  run_number: String(runId),
  run_attempt: attempt,
  run_outcome: 'success',
  real_device_requirements: [
    { id: 'safari-floor', status: 'pending' },
    { id: 'ios-safari-floor', status: 'pending' },
  ],
});

const provenance = (sha = SHA_A) => ({
  ok: true,
  captured_at: '2026-08-09T00:00:00Z',
  frontend_release: sha,
  frontend_git_ref: 'staging',
  backend_release: sha,
  backend_git_branch: 'staging',
});

const history = (previousRunId, conclusion = 'success') => ({
  verified: true,
  previous_run_id: String(previousRunId),
  previous_conclusion: conclusion,
});

function advance(previous, runId, options = {}) {
  return advanceStreak({
    previous,
    metadata: options.metadata || metadata(runId),
    provenance: options.provenance || provenance(),
    report: options.report || cleanReport(),
    manifest: options.manifest || MANIFEST,
    frozenFileErrors: options.frozenFileErrors || [],
    previousWorkflowRun: previous ? (options.history || history(previous.last_run_id)) : undefined,
  });
}

describe('frozen suite and clean thresholds', () => {
  test('all committed frozen-file hashes match', () => {
    assert.deepEqual(verifyFrozenFiles(ROOT, MANIFEST), []);
    const tampered = structuredClone(MANIFEST);
    tampered.frozen_files[0].sha256 = '0'.repeat(64);
    assert.deepEqual(verifyFrozenFiles(ROOT, tampered), [
      'frozen-file-drift:frontend/playwright.staging.config.js',
    ]);
  });

  test('exact 33-test/project report is clean; one skip is not', () => {
    const clean = summarizePlaywrightReport(cleanReport(), MANIFEST);
    assert.equal(clean.clean, true);
    const skipped = summarizePlaywrightReport(
      cleanReport({ expected: 32, skipped: 1 }),
      MANIFEST,
    );
    assert.equal(skipped.clean, false);
    assert.ok(skipped.reasons.includes('skipped:1'));
  });
});

describe('candidate streak advances and resets fail-closed', () => {
  test('seed starts at 1; exact next run reaches 2', () => {
    const first = advance(null, 101);
    assert.equal(first.streak_count, 1);
    assert.deepEqual(first.entries.at(-1).reset_reasons, ['ledger-seed']);
    const second = advance(first, 102);
    assert.equal(second.streak_count, 2);
    assert.deepEqual(second.entries.at(-1).reset_reasons, []);
  });

  test('skip or rerun attempt resets the streak to zero', () => {
    const first = advance(null, 201);
    const skipped = advance(first, 202, {
      report: cleanReport({ expected: 32, skipped: 1 }),
    });
    assert.equal(skipped.streak_count, 0);
    assert.ok(skipped.entries.at(-1).reset_reasons.includes('skipped:1'));

    const rerun = advance(first, 202, { metadata: metadata(202, SHA_A, '2') });
    assert.equal(rerun.streak_count, 0);
    assert.ok(rerun.entries.at(-1).reset_reasons.includes('run-attempt:2'));
  });

  test('failure, flake, provenance, ref and frozen-file drift all reset to zero', () => {
    const first = advance(null, 211);
    const cases = [
      {
        options: { metadata: { ...metadata(212), run_outcome: 'failure' } },
        reason: 'run-outcome:failure',
      },
      {
        options: { report: cleanReport({ expected: 32, unexpected: 1 }) },
        reason: 'unexpected:1',
      },
      {
        options: { report: cleanReport({ expected: 32, flaky: 1 }) },
        reason: 'flaky:1',
      },
      {
        options: { provenance: { ...provenance(), ok: false } },
        reason: 'staging-provenance-invalid',
      },
      {
        options: { provenance: { ...provenance(), frontend_git_ref: 'main' } },
        reason: 'frontend-ref-mismatch',
      },
      {
        options: { provenance: { ...provenance(), backend_git_branch: 'main' } },
        reason: 'backend-ref-mismatch',
      },
      {
        options: { frozenFileErrors: ['frozen-file-drift:fixture.js'] },
        reason: 'frozen-file-drift:fixture.js',
      },
    ];

    for (const item of cases) {
      const result = advance(first, 212, item.options);
      assert.equal(result.streak_count, 0, item.reason);
      assert.ok(result.entries.at(-1).reset_reasons.includes(item.reason), item.reason);
    }
  });

  test('history gap or release change restarts a clean run at 1', () => {
    const first = advance(null, 301);
    const gap = advance(first, 303, { history: history(302) });
    assert.equal(gap.streak_count, 1);
    assert.ok(gap.entries.at(-1).reset_reasons.includes('previous-run-state-mismatch'));

    const changed = advance(first, 302, {
      metadata: metadata(302, SHA_B),
      provenance: provenance(SHA_B),
    });
    assert.equal(changed.streak_count, 1);
    assert.ok(changed.entries.at(-1).reset_reasons.includes('frontend-release-changed'));
    assert.ok(changed.entries.at(-1).reset_reasons.includes('backend-release-changed'));
  });

  test('20 clean runs meet candidate threshold but cannot overclaim Gate E', () => {
    let ledger = null;
    for (let run = 1; run <= 20; run += 1) ledger = advance(ledger, run);
    assert.equal(ledger.streak_count, 20);
    assert.equal(ledger.threshold_met, true);
    assert.equal(ledger.failure_matrix_complete, false);
    assert.equal(ledger.real_devices_complete, false);
    assert.equal(ledger.gate_e_evidence_eligible, false);
  });

  test('eligibility becomes true only when all three independent gates pass', () => {
    const completeManifest = structuredClone(MANIFEST);
    completeManifest.failure_injection.status = 'complete';
    const completeMetadata = (runId) => ({
      ...metadata(runId),
      real_device_requirements: metadata(runId).real_device_requirements
        .map((item) => ({ ...item, status: 'complete' })),
    });
    let ledger = null;
    for (let run = 1; run <= 20; run += 1) {
      ledger = advance(ledger, run, {
        manifest: completeManifest,
        metadata: completeMetadata(run),
      });
    }
    assert.equal(ledger.threshold_met, true);
    assert.equal(ledger.failure_matrix_complete, true);
    assert.equal(ledger.real_devices_complete, true);
    assert.equal(ledger.gate_e_evidence_eligible, true);
  });
});

describe('workflow-history continuity', () => {
  test('ignores newer queued runs and selects the greatest lower run number', () => {
    assert.deepEqual(selectPreviousWorkflowRun([
      { id: 104, run_number: 104, conclusion: null },
      { id: 103, run_number: 103, conclusion: 'success' },
      { id: 102, run_number: 102, conclusion: 'failure' },
    ], '103', '103'), {
      verified: true,
      previous_run_id: '102',
      previous_conclusion: 'failure',
    });
  });

  test('fails closed when current run identity is incomplete', () => {
    assert.deepEqual(selectPreviousWorkflowRun([], null, '3'), { verified: false });
    assert.deepEqual(selectPreviousWorkflowRun([], '3', null), { verified: false });
  });
});

describe('workflow and provenance contract', () => {
  test('scheduled/manual staging evidence checks out the deployed branch and exact SHA', () => {
    assert.match(WORKFLOW, /ref: staging/);
    assert.match(WORKFLOW, /id: source_revision/);
    assert.match(WORKFLOW, /EVIDENCE_GIT_SHA: \$\{\{ steps\.source_revision\.outputs\.sha \}\}/);
    assert.match(WORKFLOW, /EVIDENCE_GIT_REF: \$\{\{ steps\.source_revision\.outputs\.ref \}\}/);
  });

  test('cache is transport; ledger and provenance are always-uploaded evidence', () => {
    const restore = WORKFLOW.indexOf('Restore previous Gate E streak state');
    const run = WORKFLOW.indexOf('Run staging E2E');
    const update = WORKFLOW.indexOf('Update Gate E streak ledger');
    const save = WORKFLOW.indexOf('Save Gate E streak state');
    assert.ok(restore < run && run < update && update < save);
    for (const artifact of [
      'gate-e-staging-provenance.json',
      'gate-e-streak-ledger.json',
      'staging-e2e-results.json',
    ]) assert.ok(WORKFLOW.includes(artifact));
    assert.match(WORKFLOW, /Update Gate E streak ledger\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /Save Gate E streak state\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /key: gate-e-streak-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.doesNotMatch(WORKFLOW, /gate-e-streak-\$\{\{ github\.ref_name \}\}/);
    assert.doesNotMatch(UPDATER, /searchParams\.set\('branch'/);
  });

  test('backend health exposes Railway SHA/branch, never fabricates them locally', () => {
    assert.match(SETTINGS, /RAILWAY_GIT_COMMIT_SHA: str = ""/);
    assert.match(SETTINGS, /RAILWAY_GIT_BRANCH: str = ""/);
    assert.match(HEALTH, /"release": settings\.RAILWAY_GIT_COMMIT_SHA or None/);
    assert.match(HEALTH, /"git_branch": settings\.RAILWAY_GIT_BRANCH or None/);
  });

  test('tokens are input-only and are not serialized into evidence', () => {
    assert.match(WORKFLOW, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(CAPTURE, /STAGING_BYPASS/);
    assert.doesNotMatch(CAPTURE, /writeFileSync\([^\n]*bypass/);
    assert.doesNotMatch(UPDATER, /writeFileSync\([^\n]*token/);
    assert.match(DOC, /không được serialize/);
  });
});
