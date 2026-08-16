/** Gate E streak ledger: clean means exact, consecutive and release-frozen. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceStreak,
  digestManifestContract,
  isReviewedAncestorComparison,
  isReviewedSourceComparison,
  selectPreviousWorkflowRun,
  selectWorkflowJobConclusion,
  verifyFrozenDirs,
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
const PREFLIGHT = read('frontend/tooling/verify-gate-e-frozen-suite.mjs');
const HEALTH = read('backend/routers/health.py');
const DOC = read('docs/GATE_E_STREAK_LEDGER_2026-08-09.md');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function cleanReport(overrides = {}) {
  const suites = Object.entries(MANIFEST.expected_project_counts).map(([project, count]) => ({
    specs: project === 'staging-core-chromium'
      ? [
          {
            title: 'critical core fixtures',
            file: 'critical-fixtures.spec.js',
            tests: Array.from({ length: count - 1 }, () => ({ projectName: project, status: 'expected' })),
          },
          {
            title: 'modal chủ đề mở được và nạp danh sách',
            file: 'speaking-start-flow.spec.js',
            tests: [{ projectName: project, status: 'expected' }],
          },
        ]
      : [{
          title: `${project} fixtures`,
          file: 'device-matrix.spec.js',
          tests: Array.from({ length: count }, () => ({ projectName: project, status: 'expected' })),
        }],
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

function reportWithSkip(project, title, description = 'test-only skip') {
  const report = cleanReport({ expected: MANIFEST.expected_total_tests - 1, skipped: 1 });
  const spec = report.suites.flatMap((suite) => suite.specs)
    .find((item) => item.title === title && item.tests.some((item) => item.projectName === project));
  assert.ok(spec, `missing skip fixture: ${project}/${title}`);
  const item = spec.tests.find((entry) => entry.projectName === project);
  item.status = 'skipped';
  item.annotations = [{ type: 'skip', description }];
  return report;
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
      'frozen-file-drift:frontend/package.json',
    ]);
    assert.match(digestManifestContract(MANIFEST), /^[a-f0-9]{64}$/);
    assert.deepEqual(verifyFrozenDirs(ROOT, MANIFEST), []);
  });

  test('frozen staging directory rejects added specs before secrets are exposed', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'gate-e-frozen-dir-'));
    try {
      const relativeDir = 'frontend/tests/staging-e2e';
      const absoluteDir = path.join(tempRoot, relativeDir);
      mkdirSync(absoluteDir, { recursive: true });
      writeFileSync(path.join(absoluteDir, 'unreviewed.spec.js'), 'throw new Error("exfil")');
      assert.deepEqual(verifyFrozenDirs(tempRoot, {
        frozen_dirs: [relativeDir],
        frozen_files: [],
      }), [
        'frozen-dir-extra-file:frontend/tests/staging-e2e/unreviewed.spec.js',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('exact suite and the one whitelisted core skip are clean; any other skip is not', () => {
    const clean = summarizePlaywrightReport(cleanReport(), MANIFEST);
    assert.equal(clean.clean, true);
    const allowed = summarizePlaywrightReport(
      reportWithSkip(
        'staging-core-chromium',
        'modal chủ đề mở được và nạp danh sách',
        MANIFEST.allowed_skips[0].description,
      ),
      MANIFEST,
    );
    assert.equal(allowed.clean, true);
    assert.deepEqual(allowed.skipped_tests, [{
      project: 'staging-core-chromium',
      title: 'modal chủ đề mở được và nạp danh sách',
      file: 'speaking-start-flow.spec.js',
      description: MANIFEST.allowed_skips[0].description,
    }]);

    const wrongReason = summarizePlaywrightReport(
      reportWithSkip(
        'staging-core-chromium',
        'modal chủ đề mở được và nạp danh sách',
        'staging route unreachable',
      ),
      MANIFEST,
    );
    assert.equal(wrongReason.clean, false);
    assert.ok(wrongReason.reasons.some((reason) => reason.startsWith('unexpected-skip:')));
    const unexpected = summarizePlaywrightReport(
      reportWithSkip('staging-core-chromium', 'critical core fixtures'),
      MANIFEST,
    );
    assert.equal(unexpected.clean, false);
    assert.ok(unexpected.reasons.some((reason) => reason.startsWith('unexpected-skip:')));
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
      report: reportWithSkip('staging-core-chromium', 'critical core fixtures'),
    });
    assert.equal(skipped.streak_count, 0);
    assert.ok(skipped.entries.at(-1).reset_reasons.some(
      (reason) => reason.startsWith('unexpected-skip:'),
    ));

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

    const changedManifest = structuredClone(MANIFEST);
    changedManifest.frozen_files[0].sha256 = '0'.repeat(64);
    const suiteDrift = advance(first, 302, { manifest: changedManifest });
    assert.equal(suiteDrift.streak_count, 1);
    assert.ok(suiteDrift.entries.at(-1).reset_reasons.includes('manifest-changed'));
    assert.notEqual(suiteDrift.manifest_digest, first.manifest_digest);
  });

  test('20 clean runs meet candidate threshold but cannot overclaim Gate E', () => {
    let ledger = null;
    for (let run = 1; run <= 20; run += 1) ledger = advance(ledger, run);
    assert.equal(ledger.streak_count, 20);
    assert.equal(ledger.threshold_met, true);
    assert.equal(ledger.failure_matrix_complete, true);
    assert.equal(ledger.real_devices_complete, false);
    assert.equal(ledger.gate_e_evidence_eligible, false);
  });

  test('eligibility becomes true only when all three independent gates pass', () => {
    const completeManifest = structuredClone(MANIFEST);
    completeManifest.failure_injection.status = 'complete';
    completeManifest.failure_injection.missing = [];
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

  test('failure status cannot overclaim completion while required paths remain', () => {
    const inconsistentManifest = structuredClone(MANIFEST);
    inconsistentManifest.failure_injection.status = 'complete';
    inconsistentManifest.failure_injection.missing = [
      'live-staging-core-player-failure-injection-evidence',
    ];
    const ledger = advance(null, 1, { manifest: inconsistentManifest });
    assert.equal(ledger.failure_matrix_complete, false);
    assert.equal(ledger.gate_e_evidence_eligible, false);
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
    });
  });

  test('fails closed when the immediately preceding run is absent', () => {
    assert.deepEqual(selectPreviousWorkflowRun([
      { id: 101, run_number: 101, conclusion: 'success' },
    ], '103', '103'), { verified: false });
  });

  test('uses only the staging-e2e job conclusion, not unrelated workflow jobs', () => {
    assert.deepEqual(selectWorkflowJobConclusion([
      { name: 'staging-e2e', status: 'completed', conclusion: 'success' },
      { name: 'production-release-drift', status: 'completed', conclusion: 'failure' },
    ]), {
      verified: true,
      previous_conclusion: 'success',
    });
    assert.deepEqual(selectWorkflowJobConclusion([
      { name: 'production-release-drift', status: 'completed', conclusion: 'success' },
    ]), { verified: false });
  });

  test('fails closed when current run identity is incomplete', () => {
    assert.deepEqual(selectPreviousWorkflowRun([], null, '3'), { verified: false });
    assert.deepEqual(selectPreviousWorkflowRun([], '3', null), { verified: false });
  });
});

describe('trusted-source ancestry', () => {
  test('allows only identical or reviewed ancestor staging SHAs', () => {
    assert.equal(isReviewedAncestorComparison({
      status: 'ahead',
      merge_base_commit: { sha: SHA_A },
    }, SHA_A), true);
    assert.equal(isReviewedAncestorComparison({
      status: 'identical',
      merge_base_commit: { sha: SHA_A },
    }, SHA_A), true);
    assert.equal(isReviewedAncestorComparison({
      status: 'diverged',
      merge_base_commit: { sha: SHA_A },
    }, SHA_A), false);
    assert.equal(isReviewedAncestorComparison({
      status: 'ahead',
      merge_base_commit: { sha: SHA_B },
    }, SHA_A), false);
  });

  test('allows a staging sync commit only when its tree equals the reviewed merge base', () => {
    assert.equal(isReviewedSourceComparison({
      status: 'ahead',
      merge_base_commit: { sha: SHA_A },
    }, SHA_A), true);
    assert.equal(isReviewedSourceComparison({
      status: 'diverged',
      base_commit: { sha: SHA_A, commit: { tree: { sha: SHA_B } } },
      merge_base_commit: { sha: 'c'.repeat(40), commit: { tree: { sha: SHA_B } } },
    }, SHA_A), true);
    assert.equal(isReviewedSourceComparison({
      status: 'behind',
      base_commit: { sha: SHA_A, commit: { tree: { sha: SHA_B } } },
      merge_base_commit: { sha: 'c'.repeat(40), commit: { tree: { sha: SHA_B } } },
    }, SHA_A), true);
  });

  test('rejects divergent staging content, mismatched commits and malformed tree SHAs', () => {
    assert.equal(isReviewedSourceComparison({
      status: 'diverged',
      base_commit: { sha: SHA_A, commit: { tree: { sha: SHA_B } } },
      merge_base_commit: { sha: 'c'.repeat(40), commit: { tree: { sha: 'd'.repeat(40) } } },
    }, SHA_A), false);
    assert.equal(isReviewedSourceComparison({
      status: 'diverged',
      base_commit: { sha: SHA_B, commit: { tree: { sha: SHA_A } } },
      merge_base_commit: { sha: 'c'.repeat(40), commit: { tree: { sha: SHA_A } } },
    }, SHA_A), false);
    assert.equal(isReviewedSourceComparison({
      status: 'diverged',
      base_commit: { sha: SHA_A, commit: { tree: { sha: 'not-a-git-tree' } } },
      merge_base_commit: { sha: 'c'.repeat(40), commit: { tree: { sha: 'not-a-git-tree' } } },
    }, SHA_A), false);
    assert.equal(isReviewedSourceComparison({
      status: 'unknown',
      base_commit: { sha: SHA_A, commit: { tree: { sha: SHA_B } } },
      merge_base_commit: { sha: 'c'.repeat(40), commit: { tree: { sha: SHA_B } } },
    }, SHA_A), false);
  });
});

describe('workflow and provenance contract', () => {
  test('scheduled/manual staging evidence checks out the deployed branch and exact SHA', () => {
    assert.match(WORKFLOW, /ref: staging/);
    assert.match(WORKFLOW, /name: Checkout trusted Gate E auditor[\s\S]*?ref: main[\s\S]*?path: \.gate-e-auditor/);
    assert.match(WORKFLOW, /id: source_revision/);
    assert.match(WORKFLOW, /id: auditor_revision/);
    assert.match(WORKFLOW, /EVIDENCE_GIT_SHA: \$\{\{ steps\.source_revision\.outputs\.sha \}\}/);
    assert.match(WORKFLOW, /EVIDENCE_GIT_REF: \$\{\{ steps\.source_revision\.outputs\.ref \}\}/);
    assert.match(
      WORKFLOW,
      /name: Capture staging release provenance[\s\S]*?GATE_E_SOURCE_SHA: \$\{\{ steps\.source_revision\.outputs\.sha \}\}[\s\S]*?capture-gate-e-staging-provenance\.mjs/,
    );
    assert.match(CAPTURE, /if \(!shaPattern\.test\(sourceSha\)\) throw new Error\('source-sha-invalid'\)/);
    for (const tool of [
      'verify-gate-e-live-staging-failure-evidence.mjs',
      'verify-gate-e-speaking-failure-evidence.mjs',
      'verify-gate-e-reading-failure-evidence.mjs',
      'verify-gate-e-listening-failure-evidence.mjs',
      'verify-gate-e-writing-failure-evidence.mjs',
      'write-gate-e-device-matrix-evidence.mjs',
      'capture-gate-e-staging-provenance.mjs',
      'update-gate-e-streak-ledger.mjs',
    ]) assert.ok(WORKFLOW.includes(`.gate-e-auditor/frontend/tooling/${tool}`));
    assert.equal((WORKFLOW.match(/GATE_E_TESTED_ROOT: \$\{\{ github\.workspace \}\}/g) || []).length, 9);
    assert.match(WORKFLOW, /name: Run staging E2E[\s\S]*?timeout-minutes: 20[\s\S]*?E2E_PASSWORD[\s\S]*?GATE_E_SOURCE_SHA/);
    const gateJob = WORKFLOW.slice(
      WORKFLOW.indexOf('  staging-e2e:'),
      WORKFLOW.indexOf('  production-release-drift:'),
    );
    const jobTimeout = Number(gateJob.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/m)?.[1]);
    const stepStarts = [...gateJob.matchAll(/^ {6}- (?:name|uses):/gm)]
      .map((match) => match.index);
    const stepBlocks = stepStarts.map((start, index) => gateJob.slice(
      start,
      stepStarts[index + 1] ?? gateJob.length,
    ));
    const missingTimeouts = stepBlocks
      .filter((block) => !/^ {8}timeout-minutes:\s*\d+\s*$/m.test(block))
      .map((block) => block.match(/^ {6}- (?:name|uses):\s*(.+)$/m)?.[1]);
    assert.deepEqual(missingTimeouts, [], `uncapped Gate E steps: ${missingTimeouts.join(', ')}`);
    const allStepTimeouts = stepBlocks.map((block) => Number(
      block.match(/^ {8}timeout-minutes:\s*(\d+)\s*$/m)?.[1],
    ));
    assert.equal(allStepTimeouts.reduce((total, value) => total + value, 0), 149);
    assert.ok(jobTimeout >= allStepTimeouts.reduce((total, value) => total + value, 0) + 30);
    assert.match(DOC, /Job có timeout 180 phút/);
    assert.match(DOC, /mọi step có timeout riêng/);
    assert.match(DOC, /bốn failure\s+matrix có timeout 10 phút mỗi bước/);
    assert.match(UPDATER, /manifest = readJson\(path\.join\(AUDITOR_FRONTEND/);
    assert.match(UPDATER, /verifyFrozenFiles\(TESTED_ROOT, manifest\)/);
    assert.match(PREFLIGHT, /compare\/\$\{testedSha\}\.\.\.\$\{auditorSha\}/);
    assert.match(PREFLIGHT, /isReviewedSourceComparison\(payload, testedSha\)/);
  });

  test('cache is transport; ledger and provenance have independent validated artifacts', () => {
    const restore = WORKFLOW.indexOf('Restore previous Gate E streak state');
    const preflight = WORKFLOW.indexOf('Verify frozen Gate E suite before executing staging code');
    const install = WORKFLOW.indexOf('Install frontend deps');
    const verifySpeakingPins = WORKFLOW.indexOf('Verify Speaking Gate E matrix pins');
    const verifyReadingPins = WORKFLOW.indexOf('Verify Reading Gate E matrix pins');
    const verifyListeningPins = WORKFLOW.indexOf('Verify Listening Gate E matrix pins');
    const verifyWritingPins = WORKFLOW.indexOf('Verify Writing Gate E matrix pins');
    const run = WORKFLOW.indexOf('Run staging E2E');
    const liveFailureEvidence = WORKFLOW.indexOf('Verify live-staging core-player failure evidence');
    const failureMatrix = WORKFLOW.indexOf('Run Gate E Speaking failure matrix');
    const failureEvidence = WORKFLOW.indexOf('Verify Speaking failure-matrix evidence');
    const readingFailureMatrix = WORKFLOW.indexOf('Run Gate E Reading failure matrix');
    const readingFailureEvidence = WORKFLOW.indexOf('Verify Reading failure-matrix evidence');
    const listeningFailureMatrix = WORKFLOW.indexOf('Run Gate E Listening failure matrix');
    const listeningFailureEvidence = WORKFLOW.indexOf('Verify Listening failure-matrix evidence');
    const writingFailureMatrix = WORKFLOW.indexOf('Run Gate E Writing failure matrix');
    const writingFailureEvidence = WORKFLOW.indexOf('Verify Writing failure-matrix evidence');
    const update = WORKFLOW.indexOf('Update Gate E streak ledger');
    const save = WORKFLOW.indexOf('Save Gate E streak state');
    assert.ok(
      restore < preflight && preflight < install && install < verifySpeakingPins &&
      verifySpeakingPins < verifyReadingPins && verifyReadingPins < verifyListeningPins && verifyListeningPins < verifyWritingPins && verifyWritingPins < run &&
      run < liveFailureEvidence && liveFailureEvidence < failureMatrix && failureMatrix < failureEvidence &&
      failureEvidence < readingFailureMatrix && readingFailureMatrix < readingFailureEvidence &&
      readingFailureEvidence < listeningFailureMatrix && listeningFailureMatrix < listeningFailureEvidence &&
      listeningFailureEvidence < writingFailureMatrix && writingFailureMatrix < writingFailureEvidence &&
      writingFailureEvidence < update && update < save,
    );
    for (const artifact of [
      'gate-e-staging-provenance.json',
      'gate-e-live-staging-failure-injection.json',
      'gate-e-streak-ledger.json',
      'staging-e2e-results.json',
    ]) assert.ok(WORKFLOW.includes(artifact));
    assert.match(WORKFLOW, /Update Gate E streak ledger\n\s+id: streak_ledger\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /Verify frozen Gate E suite before executing staging code\n\s+id: frozen_preflight/);
    assert.match(WORKFLOW, /runs-on: ubuntu-24\.04/);
    assert.match(WORKFLOW, /Verify Speaking Gate E matrix pins[\s\S]*?GATE_E_RUNNER_IMAGE: ubuntu24\.04-x64[\s\S]*?verify-gate-e-speaking-device-matrix\.mjs/);
    assert.match(WORKFLOW, /Verify Reading Gate E matrix pins[\s\S]*?GATE_E_RUNNER_IMAGE: ubuntu24\.04-x64[\s\S]*?verify-gate-e-reading-device-matrix\.mjs/);
    assert.match(WORKFLOW, /Verify Listening Gate E matrix pins[\s\S]*?GATE_E_RUNNER_IMAGE: ubuntu24\.04-x64[\s\S]*?verify-gate-e-listening-device-matrix\.mjs/);
    assert.match(WORKFLOW, /Verify Writing Gate E matrix pins[\s\S]*?GATE_E_RUNNER_IMAGE: ubuntu24\.04-x64[\s\S]*?verify-gate-e-writing-device-matrix\.mjs/);
    assert.match(
      WORKFLOW,
      /Run Gate E Speaking failure matrix[\s\S]*?id: speaking_failure_matrix[\s\S]*?if: always\(\) && steps\.frozen_preflight\.outcome == 'success' && steps\.staging_e2e\.outcome != 'skipped'[\s\S]*?npm run test:e2e:gate-e/,
    );
    assert.equal((WORKFLOW.match(
      /if: always\(\) && steps\.frozen_preflight\.outcome == 'success' && steps\.staging_e2e\.outcome != 'skipped'/g,
    ) || []).length, 4);
    for (const id of ['matrix_evidence', 'staging_provenance', 'streak_ledger']) {
      assert.match(WORKFLOW, new RegExp(`id: ${id}\\n\\s+if: always\\(\\)`));
    }
    assert.match(
      WORKFLOW,
      /GATE_E_RUN_OUTCOME: \$\{\{ steps\.staging_e2e\.outcome == 'success' && steps\.live_staging_failure_evidence\.outcome == 'success' && steps\.speaking_failure_matrix\.outcome == 'success' && steps\.speaking_failure_evidence\.outcome == 'success' && steps\.reading_failure_matrix\.outcome == 'success' && steps\.reading_failure_evidence\.outcome == 'success' && steps\.listening_failure_matrix\.outcome == 'success' && steps\.listening_failure_evidence\.outcome == 'success' && steps\.writing_failure_matrix\.outcome == 'success' && steps\.writing_failure_evidence\.outcome == 'success' && 'success' \|\| 'failure' \}\}/,
    );
    assert.match(WORKFLOW, /Upload Speaking failure-matrix evidence[\s\S]*?gate-e-speaking-failure-matrix-/);
    assert.match(WORKFLOW, /Upload live-staging core-player failure evidence[\s\S]*?gate-e-live-staging-failure-/);
    assert.match(WORKFLOW, /Run Gate E Reading failure matrix[\s\S]*?npm run test:e2e:gate-e:reading/);
    assert.match(WORKFLOW, /Upload Reading failure-matrix evidence[\s\S]*?gate-e-reading-failure-matrix-/);
    assert.match(WORKFLOW, /Run Gate E Listening failure matrix[\s\S]*?npm run test:e2e:gate-e:listening/);
    assert.match(WORKFLOW, /Upload Listening failure-matrix evidence[\s\S]*?gate-e-listening-failure-matrix-/);
    assert.match(WORKFLOW, /Run Gate E Writing failure matrix[\s\S]*?npm run test:e2e:gate-e:writing/);
    assert.match(WORKFLOW, /Upload Writing failure-matrix evidence[\s\S]*?gate-e-writing-failure-matrix-/);
    assert.match(WORKFLOW, /Save Gate E streak state\n\s+if: always\(\) && steps\.streak_ledger\.outcome == 'success'/);
    assert.equal((WORKFLOW.match(/path: \$\{\{ runner\.temp \}\}\/gate-e-streak-state/g) || []).length, 2);
    assert.match(WORKFLOW, /GATE_E_STATE_ROOT: \$\{\{ runner\.temp \}\}\/gate-e-streak-state/);
    assert.match(UPDATER, /process\.env\.GATE_E_STATE_ROOT/);
    assert.doesNotMatch(UPDATER, /TESTED_FRONTEND, '\.gate-e-streak-state'/);
    assert.match(WORKFLOW, /name: Upload staging provenance[\s\S]*?steps\.staging_provenance\.outcome == 'success'[\s\S]*?gate-e-staging-provenance-/);
    assert.match(WORKFLOW, /name: Package verifiable streak evidence[\s\S]*?test -f frontend\/test-results\/gate-e-streak-ledger\.json[\s\S]*?test -f frontend\/test-results\/staging-e2e-results\.json/);
    assert.match(WORKFLOW, /name: Upload streak ledger evidence[\s\S]*?steps\.streak_bundle\.outcome == 'success' && steps\.streak_ledger\.outputs\.clean == 'true'[\s\S]*?gate-e-streak-ledger-/);
    assert.match(WORKFLOW, /name: Upload streak ledger evidence[\s\S]*?path: frontend\/test-results\/gate-e-streak-bundle/);
    assert.match(WORKFLOW, /name: Upload verifiable streak reset evidence[\s\S]*?steps\.streak_ledger\.outputs\.clean != 'true'/);
    assert.match(WORKFLOW, /name: Upload incomplete streak reset ledger[\s\S]*?steps\.streak_bundle\.outcome == 'failure'/);
    assert.match(WORKFLOW, /key: gate-e-streak-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.doesNotMatch(WORKFLOW, /gate-e-streak-\$\{\{ github\.ref_name \}\}/);
    assert.doesNotMatch(UPDATER, /searchParams\.set\('branch'/);
    assert.match(UPDATER, /actions\/runs\/\$\{previous\.previous_run_id\}\/jobs/);
    assert.match(UPDATER, /selectWorkflowJobConclusion/);
    assert.equal((UPDATER.match(/AbortSignal\.timeout\(20000\)/g) || []).length, 2);
    assert.match(PREFLIGHT, /verifyFrozenFiles\(TESTED_ROOT, manifest\)/);
    assert.match(PREFLIGHT, /verifyFrozenDirs\(TESTED_ROOT, manifest\)/);
    assert.match(PREFLIGHT, /'\.npmrc', 'frontend\/\.npmrc'/);
    assert.match(PREFLIGHT, /'frontend\/\.gate-e-streak-state'/);
    assert.match(PREFLIGHT, /'frontend\/test-results'/);
  });

  test('backend provenance uses the existing authenticated runtime endpoint', () => {
    assert.match(CAPTURE, /signIn\(\{/);
    assert.match(CAPTURE, /e2e-admin-smoke@staging-e2e\.averlearning\.com/);
    assert.match(CAPTURE, /\/health\/runtime/);
    assert.match(HEALTH, /"git_sha":[\s\S]*if is_admin else _REDACTED/);
    const publicHealth = HEALTH.slice(HEALTH.indexOf('async def health_basic'), HEALTH.indexOf('@router.get("/health/ready")'));
    assert.doesNotMatch(publicHealth, /RAILWAY_GIT_COMMIT_SHA|git_branch|"release"/);
  });

  test('staging secrets can only be sent to canonical allowlisted origins', () => {
    assert.match(CAPTURE, /const stagingOrigin = 'https:\/\/staging\.averlearning\.com'/);
    assert.match(CAPTURE, /const expectedSupabase = 'https:\/\/zjphffoujxkpltixsbzj\.supabase\.co'/);
    assert.doesNotMatch(CAPTURE, /STAGING_BASE_URL/);
    assert.match(CAPTURE, /supabaseUrl !== expectedSupabase/);
    assert.equal((CAPTURE.match(/AbortSignal\.timeout\(20000\)/g) || []).length, 2);
  });

  test('tokens are input-only and are not serialized into evidence', () => {
    assert.match(WORKFLOW, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(WORKFLOW, /E2E_PASSWORD: \$\{\{ secrets\.E2E_PASSWORD \}\}/);
    assert.match(CAPTURE, /STAGING_BYPASS/);
    assert.doesNotMatch(CAPTURE, /writeFileSync\([^\n]*bypass/);
    assert.doesNotMatch(CAPTURE, /writeFileSync\([^\n]*password/);
    assert.doesNotMatch(UPDATER, /writeFileSync\([^\n]*token/);
    assert.match(DOC, /không được serialize/);
  });
});
