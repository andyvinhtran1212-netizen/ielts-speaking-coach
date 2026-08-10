import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(FRONTEND, 'tooling', 'gate-e-device-matrix.json');
const lockPath = path.join(FRONTEND, 'package-lock.json');
const browsersPath = path.join(FRONTEND, 'node_modules', 'playwright-core', 'browsers.json');
const resultPath = path.resolve(
  FRONTEND,
  process.env.GATE_E_MATRIX_RESULTS || 'test-results/staging-e2e-results.json',
);
const outputPath = path.resolve(
  FRONTEND,
  process.env.GATE_E_MATRIX_OUTPUT || 'test-results/gate-e-device-matrix-evidence.json',
);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const installedPlaywright = lock.packages?.['node_modules/@playwright/test']?.version || null;

if (installedPlaywright !== manifest.playwright_version) {
  throw new Error(
    `matrix manifest Playwright ${manifest.playwright_version} != lockfile ${installedPlaywright}`,
  );
}

if (!existsSync(browsersPath)) {
  throw new Error(`missing Playwright browser metadata: ${browsersPath}`);
}
if (!existsSync(resultPath)) {
  throw new Error(`missing Playwright JSON report: ${resultPath}`);
}

const browsers = JSON.parse(readFileSync(browsersPath, 'utf8')).browsers || [];
const browserTargets = Object.fromEntries(
  browsers
    .filter((item) => item.name === 'chromium' || item.name === 'webkit')
    .map((item) => [item.name, {
      version: item.browserVersion,
      revision: item.revision,
    }]),
);

for (const project of manifest.automated_projects) {
  const target = browserTargets[project.engine];
  if (!target) throw new Error(`missing installed browser target: ${project.engine}`);
  if (target.version !== project.browser_version ||
      target.revision !== project.browser_revision) {
    throw new Error(
      `${project.project} manifest ${project.browser_version}/${project.browser_revision} ` +
      `!= installed target ${target.version}/${target.revision}`,
    );
  }
}

const report = JSON.parse(readFileSync(resultPath, 'utf8'));
const expectedProjects = manifest.automated_projects.map((project) => project.project).sort();
const reportedProjects = (report.config?.projects || []).map((project) => project.name).sort();
if (JSON.stringify(reportedProjects) !== JSON.stringify(expectedProjects)) {
  throw new Error(
    `reported projects ${reportedProjects.join(', ') || '(none)'} ` +
    `!= matrix manifest ${expectedProjects.join(', ')}`,
  );
}

const projectResults = Object.fromEntries(expectedProjects.map((project) => [project, {
  discovered: 0,
  executed: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
}]));

const visitSuites = (suites) => {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const counts = projectResults[test.projectName];
        if (!counts) throw new Error(`unversioned project in Playwright report: ${test.projectName}`);
        counts.discovered += 1;
        const finalResult = test.results?.at(-1);
        if (!finalResult || finalResult.status === 'skipped') {
          counts.skipped += 1;
        } else {
          counts.executed += 1;
          if (finalResult.status === 'passed') counts.passed += 1;
          else counts.failed += 1;
        }
      }
    }
    visitSuites(suite.suites);
  }
};
visitSuites(report.suites);

for (const [project, counts] of Object.entries(projectResults)) {
  if (counts.executed < 1) {
    throw new Error(`matrix project executed zero tests: ${project}`);
  }
}

const matrixProjects = manifest.automated_projects
  .filter((project) => project.scope === 'device-matrix-spec')
  .map((project) => project.project);
const matrixDiscoveredCounts = new Set(
  matrixProjects.map((project) => projectResults[project].discovered),
);
const runOutcome = process.env.GATE_E_RUN_OUTCOME || 'unknown';
const reportErrors = report.errors || [];
const reportUnexpected = report.stats?.unexpected || 0;
const allExecutedTestsPassed = Object.values(projectResults).every(
  (counts) => counts.failed === 0 && counts.passed === counts.executed,
);
const boundedMatrixHasNoSkips = matrixProjects.every(
  (project) => projectResults[project].skipped === 0,
);
const testMatrixComplete = allExecutedTestsPassed && boundedMatrixHasNoSkips &&
  matrixDiscoveredCounts.size === 1 && reportErrors.length === 0 && reportUnexpected === 0;
if (runOutcome === 'success' && !testMatrixComplete) {
  throw new Error('workflow reported success but matrix result is incomplete or failed');
}
const matrixComplete = runOutcome === 'success' && testMatrixComplete;

const evidence = {
  schema_version: 1,
  matrix_id: manifest.matrix_id,
  generated_at: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY || null,
  git_sha: process.env.GITHUB_SHA || null,
  git_ref: process.env.GITHUB_REF || null,
  workflow: process.env.GITHUB_WORKFLOW || null,
  run_id: process.env.GITHUB_RUN_ID || null,
  run_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  run_outcome: runOutcome,
  runner_os: process.env.RUNNER_OS || process.platform,
  node_version: process.version,
  playwright_version: installedPlaywright,
  browser_targets: browserTargets,
  automated_projects: manifest.automated_projects,
  project_results: projectResults,
  matrix_complete: matrixComplete,
  report_error_count: reportErrors.length,
  report_unexpected_count: reportUnexpected,
  real_device_requirements: manifest.real_device_requirements,
  result_file: 'test-results/staging-e2e-results.json',
  result_file_present: true,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`Gate E matrix evidence: ${outputPath}`);
