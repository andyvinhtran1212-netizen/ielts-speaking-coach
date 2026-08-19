/** Gate E device-matrix foundation must stay versioned and evidence-honest. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const require = createRequire(import.meta.url);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));

const MANIFEST = json('frontend/tooling/gate-e-device-matrix.json');
const LOCK = json('frontend/package-lock.json');
const CONFIG = read('frontend/playwright.staging.config.js');
const WORKFLOW = read('.github/workflows/staging-e2e.yml');
const SPEC = read('frontend/tests/staging-e2e/device-matrix.spec.js');
const LIVE_FAILURE_SPEC = read(
  'frontend/tests/staging-e2e/core-player-failure-injection.spec.js',
);
const GATE_A_SPEC = read('frontend/tests/staging-e2e/gate-a-flows.spec.js');
const SPEAKING_START_SPEC = read('frontend/tests/staging-e2e/speaking-start-flow.spec.js');
const HELPERS = read('frontend/tests/staging-e2e/helpers.js');
const WRITER = read('frontend/tooling/write-gate-e-device-matrix-evidence.mjs');
const DOC = read('docs/GATE_E_DEVICE_MATRIX_2026-08-09.md');
const STAGING_CONFIG = require('../playwright.staging.config.js');
const configCode = CONFIG.replace(/^\s*\/\/.*$/gm, '');
const workflowCode = WORKFLOW.replace(/^\s*#.*$/gm, '');
const stagingJobCode = workflowCode.match(/^  staging-e2e:\n[\s\S]*?(?=^  production-release-drift:)/m)?.[0] || '';
const evidenceUploadCode = workflowCode.match(
  /^      - name: Upload device-matrix evidence\n[\s\S]*?(?=^      - )/m,
)?.[0] || '';
const speakingEvidenceCheckCode = workflowCode.match(
  /^      - name: Verify Speaking failure-matrix evidence\n[\s\S]*?(?=^      - )/m,
)?.[0] || '';
const liveFailureEvidenceCheckCode = workflowCode.match(
  /^      - name: Verify live-staging core-player failure evidence\n[\s\S]*?(?=^      - )/m,
)?.[0] || '';
const liveFailureEvidenceUploadCode = workflowCode.match(
  /^      - name: Upload live-staging core-player failure evidence\n[\s\S]*?(?=^      - )/m,
)?.[0] || '';
const speakingEvidenceUploadCode = workflowCode.match(
  /^      - name: Upload Speaking failure-matrix evidence\n[\s\S]*?(?=^      - )/m,
)?.[0] || '';
const speakingEvidenceVerifier = read(
  'frontend/tooling/verify-gate-e-speaking-failure-evidence.mjs',
);
const readingEvidenceVerifier = read(
  'frontend/tooling/verify-gate-e-reading-failure-evidence.mjs',
);
const listeningEvidenceVerifier = read(
  'frontend/tooling/verify-gate-e-listening-failure-evidence.mjs',
);
const writingEvidenceVerifier = read(
  'frontend/tooling/verify-gate-e-writing-failure-evidence.mjs',
);
const liveFailureEvidenceVerifier = read(
  'frontend/tooling/verify-gate-e-live-staging-failure-evidence.mjs',
);

const writeSyntheticReport = (file, includedProjects, { extraSkippedProjects = [], errors = [] } = {}) => {
  const tests = includedProjects.map((project) => ({
    projectName: project,
    status: 'expected',
    results: [{ status: 'passed' }],
  }));
  tests.push(...extraSkippedProjects.map((project) => ({
    projectName: project,
    status: 'skipped',
    results: [{ status: 'skipped' }],
  })));
  writeFileSync(file, JSON.stringify({
    config: { projects: MANIFEST.automated_projects.map(({ project }) => ({ name: project })) },
    suites: [{ specs: [{ tests }] }],
    errors,
    stats: { unexpected: errors.length },
  }));
};

const runWriter = (resultFile, outputFile, outcome = 'success') => spawnSync(
  process.execPath,
  ['tooling/write-gate-e-device-matrix-evidence.mjs'],
  {
    cwd: FRONTEND,
    encoding: 'utf8',
    env: {
      ...process.env,
      GATE_E_MATRIX_RESULTS: resultFile,
      GATE_E_MATRIX_OUTPUT: outputFile,
      GATE_E_RUN_OUTCOME: outcome,
    },
  },
);

describe('Gate E device matrix is pinned and bounded', () => {
  test('manifest Playwright pin matches the package lock', () => {
    assert.equal(
      MANIFEST.playwright_version,
      LOCK.packages['node_modules/@playwright/test'].version,
    );
    assert.equal(MANIFEST.matrix_id, 'gate-e-device-matrix-v1');
  });

  test('full shared-state suite runs once; the bounded matrix spec runs on three targets', () => {
    const expectedMatrixProjects = MANIFEST.automated_projects
      .filter(({ scope }) => scope === 'device-matrix-spec')
      .map(({ project }) => project);
    const projects = new Map(STAGING_CONFIG.projects.map((project) => [project.name, project]));
    assert.equal(projects.get('staging-core-chromium')?.testIgnore, '**/device-matrix.spec.js');
    for (const project of expectedMatrixProjects) {
      assert.equal(projects.get(project)?.testMatch, '**/device-matrix.spec.js');
      assert.ok(MANIFEST.automated_projects.some((item) => item.project === project));
    }
    const configProjects = [...projects.keys()].sort();
    const manifestProjects = MANIFEST.automated_projects.map((item) => item.project).sort();
    assert.deepEqual(configProjects, manifestProjects, 'every configured project must be versioned in the manifest');
    assert.match(configCode, /^\s*workers:\s*1,\s*$/m);
    assert.match(configCode, /^\s*retries:\s*0,\s*$/m);
  });

  test('every core session writer uses the fail-loud staging-only cleanup seam', () => {
    assert.match(
      HELPERS,
      /request\.delete\([\s\S]*?\/admin\/e2e\/sessions\/\$\{encodeURIComponent\(sessionId\)\}/,
    );
    assert.match(HELPERS, /if \(response\.status\(\) !== 204\)[\s\S]*?throw new Error/);
    for (const source of [GATE_A_SPEC, SPEAKING_START_SPEC, LIVE_FAILURE_SPEC]) {
      assert.match(source, /cleanupE2ESession\(request, [^,]+, adminToken\)/);
    }
    assert.match(SPEAKING_START_SPEC, /page\.waitForResponse\([\s\S]*?created\.push\(createdSessionId\)/);
    assert.match(LIVE_FAILURE_SPEC, /test\.afterEach\([\s\S]*?cleanupE2ESession/);
  });

  test('CI installs both engines and uploads only validated machine-readable evidence', () => {
    assert.match(workflowCode, /name: Install Playwright matrix engines[\s\S]*?timeout-minutes: 15/);
    assert.match(workflowCode, /test -f \/etc\/apt\/apt-mirrors\.txt/);
    assert.match(workflowCode, /https:\/\/archive\.ubuntu\.com\/ubuntu/);
    assert.match(workflowCode, /Acquire::Retries "2";/);
    assert.match(workflowCode, /Acquire::https::Timeout "15";/);
    assert.match(workflowCode, /npx playwright install --with-deps chromium webkit/);
    assert.match(CONFIG, /staging-e2e-results\.json/);
    assert.match(WORKFLOW, /id: staging_e2e/);
    assert.match(WORKFLOW, /steps\.staging_e2e\.outcome/);
    assert.match(workflowCode, /name: Write versioned device-matrix metadata\n\s+id: matrix_evidence\n\s+if: always\(\)/);
    assert.match(evidenceUploadCode, /^      - name: Upload device-matrix evidence\n\s+if: always\(\) && steps\.matrix_evidence\.outcome == 'success'\n\s+uses: actions\/upload-artifact@v4/);
    assert.match(evidenceUploadCode, /gate-e-device-matrix-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.match(evidenceUploadCode, /^\s*if-no-files-found:\s*error\s*$/m);
    assert.match(stagingJobCode, /^\s*timeout-minutes:\s*190\s*$/m);
    assert.match(WRITER, /GATE_E_RUN_OUTCOME/);
    assert.match(WRITER, /if \(!existsSync\(browsersPath\)\) \{[\s\S]*?throw new Error/);
    assert.match(WRITER, /if \(!existsSync\(resultPath\)\) \{[\s\S]*?throw new Error/);
    assert.match(WRITER, /matrix project executed zero tests/);
    assert.match(WRITER, /project_results: projectResults/);
    assert.match(WRITER, /result_file_present: true/);
    assert.match(WRITER, /target\.version !== project\.browser_version/);
    assert.ok(WRITER.includes('!= installed target'));
    assert.doesNotMatch(WRITER, /STAGING_BYPASS|E2E_PASSWORD|access_token|refresh_token/);
  });

  test('all core failure evidence is semantically verified before any streak state advances', () => {
    assert.match(
      WORKFLOW,
      /Run Gate E Speaking failure matrix[\s\S]*?GATE_E_REQUIRE_AFFINITY: 'true'[\s\S]*?npm run test:e2e:gate-e/,
    );
    assert.match(liveFailureEvidenceCheckCode, /id: live_staging_failure_evidence/);
    assert.match(liveFailureEvidenceCheckCode, /GATE_E_SOURCE_SHA: \$\{\{ steps\.source_revision\.outputs\.sha \}\}/);
    assert.match(
      liveFailureEvidenceCheckCode,
      /verify-gate-e-live-staging-failure-evidence\.mjs/,
    );
    assert.match(
      liveFailureEvidenceUploadCode,
      /steps\.live_staging_failure_evidence\.outcome == 'success'/,
    );
    assert.match(LIVE_FAILURE_SPEC, /route\.fetch\(\{ timeout: 60_000, maxRetries: 0 \}\)/);
    assert.match(LIVE_FAILURE_SPEC, /route\.abort\('connectionreset'\)/);
    assert.match(LIVE_FAILURE_SPEC, /uploadAttempts[^]*?toBe\(1\)/);
    assert.match(LIVE_FAILURE_SPEC, /clientResult\._reconciled[^]*?toBe\(true\)/);
    assert.match(liveFailureEvidenceVerifier, /upload-replay-detected/);
    assert.match(liveFailureEvidenceVerifier, /response-identity-mismatch/);
    assert.match(liveFailureEvidenceVerifier, /forbidden-field:/);
    assert.match(speakingEvidenceCheckCode, /id: speaking_failure_evidence/);
    assert.match(speakingEvidenceCheckCode, /GATE_E_TESTED_ROOT: \$\{\{ github\.workspace \}\}/);
    assert.match(
      speakingEvidenceCheckCode,
      /node \.gate-e-auditor\/frontend\/tooling\/verify-gate-e-speaking-failure-evidence\.mjs/,
    );
    assert.match(
      speakingEvidenceUploadCode,
      /if: always\(\) && steps\.speaking_failure_evidence\.outcome == 'success'/,
    );
    assert.ok(
      WORKFLOW.indexOf('Verify Speaking failure-matrix evidence')
      < WORKFLOW.indexOf('Write versioned device-matrix metadata'),
      'runtime evidence must be verified before metadata and ledger generation',
    );
    assert.match(
      WORKFLOW,
      /GATE_E_RUN_OUTCOME: \$\{\{ steps\.staging_e2e\.outcome == 'success' && steps\.live_staging_failure_evidence\.outcome == 'success' && steps\.speaking_failure_matrix\.outcome == 'success' && steps\.speaking_failure_evidence\.outcome == 'success' && steps\.reading_failure_matrix\.outcome == 'success' && steps\.reading_failure_evidence\.outcome == 'success' && steps\.listening_failure_matrix\.outcome == 'success' && steps\.listening_failure_evidence\.outcome == 'success' && steps\.writing_failure_matrix\.outcome == 'success' && steps\.writing_failure_evidence\.outcome == 'success' && 'success' \|\| 'failure' \}\}/,
    );
    assert.match(speakingEvidenceVerifier, /JSON discovered \$\{tests\.length\} tests/);
    assert.match(speakingEvidenceVerifier, /HTML embedded ZIP is truncated/);
    assert.match(readingEvidenceVerifier, /JSON discovered \$\{tests\.length\} tests/);
    assert.match(readingEvidenceVerifier, /did not execute each required Reading failure path exactly once/);
    assert.match(listeningEvidenceVerifier, /JSON discovered \$\{tests\.length\} tests/);
    assert.match(listeningEvidenceVerifier, /did not execute each required Listening failure path exactly once/);
    assert.match(writingEvidenceVerifier, /discovered \$\{tests\.length\} tests != \$\{manifest\.expected_total_tests\}/);
    assert.match(writingEvidenceVerifier, /required paths mismatch/);
  });

  test('every bounded matrix journey enforces the shared production-egress denylist', () => {
    assert.match(HELPERS, /const PRODUCTION_ORIGINS = Object\.freeze/);
    assert.match(HELPERS, /'x-vercel-skip-toolbar': '1'/);
    assert.match(HELPERS, /context\.route\(`\$\{origin\}\/\*\*`/);
    assert.match(HELPERS, /headers: \{ \.\.\.route\.request\(\)\.headers\(\), \.\.\.TOOLBAR_HEADER \}/);
    assert.match(HELPERS, /await installToolbarSkip\(context, baseURL\)/);
    assert.doesNotMatch(configCode, /extraHTTPHeaders/,
      'Vercel automation headers must remain origin-scoped to avoid cross-origin CORS preflights');
    assert.match(SPEC, /test\.afterEach\(async \(\{ page \}\) =>/);
    assert.match(SPEC, /productionRequestsByPage\.get\(page\)/);
    assert.match(SPEC, /gate-e-device-matrix\.json/);
    assert.doesNotMatch(SPEC, /ielts-speaking-coach-production|huwsmtubwulikhlmcirx/);
  });

  test('evidence writer reconciles executed and passed counts per project', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gate-e-matrix-'));
    try {
      const resultFile = path.join(tempDir, 'results.json');
      const outputFile = path.join(tempDir, 'evidence.json');
      const projectNames = MANIFEST.automated_projects.map(({ project }) => project);
      writeSyntheticReport(resultFile, projectNames);
      const result = runWriter(resultFile, outputFile);
      assert.equal(result.status, 0, result.stderr);
      const evidence = JSON.parse(readFileSync(outputFile, 'utf8'));
      assert.equal(evidence.matrix_complete, true);
      assert.equal(evidence.result_file_present, true);
      for (const project of projectNames) {
        assert.deepEqual(evidence.project_results[project], {
          discovered: 1,
          executed: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
        });
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('evidence writer rejects a configured project that executed zero tests', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gate-e-matrix-'));
    try {
      const resultFile = path.join(tempDir, 'results.json');
      const outputFile = path.join(tempDir, 'evidence.json');
      const projectNames = MANIFEST.automated_projects.map(({ project }) => project);
      writeSyntheticReport(resultFile, projectNames.slice(0, -1));
      const result = runWriter(resultFile, outputFile);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /matrix project executed zero tests/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('evidence writer rejects a skipped matrix journey on an otherwise green run', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gate-e-matrix-'));
    try {
      const resultFile = path.join(tempDir, 'results.json');
      const outputFile = path.join(tempDir, 'evidence.json');
      const projectNames = MANIFEST.automated_projects.map(({ project }) => project);
      const matrixProjects = MANIFEST.automated_projects
        .filter(({ scope }) => scope === 'device-matrix-spec')
        .map(({ project }) => project);
      writeSyntheticReport(resultFile, projectNames, { extraSkippedProjects: matrixProjects });
      const result = runWriter(resultFile, outputFile);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /matrix result is incomplete or failed/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('evidence writer records an allowed core skip without suppressing matrix evidence', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gate-e-matrix-'));
    try {
      const resultFile = path.join(tempDir, 'results.json');
      const outputFile = path.join(tempDir, 'evidence.json');
      const projectNames = MANIFEST.automated_projects.map(({ project }) => project);
      writeSyntheticReport(resultFile, projectNames, { extraSkippedProjects: ['staging-core-chromium'] });
      const result = runWriter(resultFile, outputFile);
      assert.equal(result.status, 0, result.stderr);
      const evidence = JSON.parse(readFileSync(outputFile, 'utf8'));
      assert.equal(evidence.matrix_complete, true);
      assert.equal(evidence.project_results['staging-core-chromium'].skipped, 1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('evidence writer records top-level report errors and never marks a failed run complete', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gate-e-matrix-'));
    try {
      const resultFile = path.join(tempDir, 'results.json');
      const outputFile = path.join(tempDir, 'evidence.json');
      const projectNames = MANIFEST.automated_projects.map(({ project }) => project);
      writeSyntheticReport(resultFile, projectNames, { errors: [{ message: 'top-level error' }] });
      const result = runWriter(resultFile, outputFile, 'failure');
      assert.equal(result.status, 0, result.stderr);
      const evidence = JSON.parse(readFileSync(outputFile, 'utf8'));
      assert.equal(evidence.matrix_complete, false);
      assert.equal(evidence.report_error_count, 1);
      assert.equal(evidence.report_unexpected_count, 1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('Synthetic WebKit is never reported as real Safari/iOS', () => {
  test('real-device requirements are complete with attested evidence', () => {
    assert.deepEqual(
      MANIFEST.real_device_requirements.map((item) => item.id),
      ['safari-desktop', 'ios-safari'],
    );
    assert.ok(MANIFEST.real_device_requirements.every(
      (item) => item.status === 'complete' && /^\d+$/.test(String(item.evidence_run_id)),
    ));
    assert.match(DOC, /AUTOMATED MATRIX EXECUTED; REAL SAFARI\/iOS COMPLETE/);
    assert.match(DOC, /31348712238/);
    assert.match(DOC, /`matrix_complete: true`/);
    assert.match(DOC, /WebKit không phải Safari shipping/);
  });

  test('WebKit projects carry a synthetic evidence class', () => {
    const webkit = MANIFEST.automated_projects.filter((item) => item.engine === 'webkit');
    assert.equal(webkit.length, 2);
    assert.ok(webkit.every((item) => item.evidence_class.startsWith('synthetic-webkit-not-real-')));
  });

  test('version-bearing project names agree with pinned browser versions', () => {
    for (const project of MANIFEST.automated_projects.filter(({ project }) => project.startsWith('matrix-'))) {
      const majorOrRelease = project.browser_version.split('.').slice(0, project.engine === 'webkit' ? 2 : 1).join('.');
      assert.match(project.project, new RegExp(`^matrix-${project.engine}-${majorOrRelease.replace('.', '\\.')}[-]`));
    }
  });
});
