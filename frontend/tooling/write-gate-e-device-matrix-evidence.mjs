import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(FRONTEND, 'tooling', 'gate-e-device-matrix.json');
const lockPath = path.join(FRONTEND, 'package-lock.json');
const browsersPath = path.join(FRONTEND, 'node_modules', 'playwright-core', 'browsers.json');
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

let browserTargets = null;
if (existsSync(browsersPath)) {
  const browsers = JSON.parse(readFileSync(browsersPath, 'utf8')).browsers || [];
  browserTargets = Object.fromEntries(
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
}

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
  run_outcome: process.env.GATE_E_RUN_OUTCOME || 'unknown',
  runner_os: process.env.RUNNER_OS || process.platform,
  node_version: process.version,
  playwright_version: installedPlaywright,
  browser_targets: browserTargets,
  automated_projects: manifest.automated_projects,
  real_device_requirements: manifest.real_device_requirements,
  result_file: 'test-results/staging-e2e-results.json',
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`Gate E matrix evidence: ${outputPath}`);
