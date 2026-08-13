import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(FRONTEND, relativePath), 'utf8'));
const manifest = readJson('tooling/gate-e-writing-device-matrix.json');
const lock = readJson('package-lock.json');
const browsers = readJson('node_modules/playwright-core/browsers.json').browsers || [];
const installedPlaywright = lock.packages?.['node_modules/@playwright/test']?.version;
const configuredRunnerImage = process.env.GATE_E_RUNNER_IMAGE;

if (configuredRunnerImage && configuredRunnerImage !== manifest.ci_runner) {
  throw new Error(`Writing matrix runner ${configuredRunnerImage} != manifest ${manifest.ci_runner}`);
}
if (manifest.playwright_version !== installedPlaywright) {
  throw new Error(`Writing matrix Playwright ${manifest.playwright_version} != lockfile ${installedPlaywright}`);
}
const runnerImage = manifest.ci_runner;
const targets = Object.fromEntries(
  browsers
    .filter((item) => item.name === 'chromium' || item.name === 'webkit')
    .map((item) => [item.name, {
      version: item.browserVersion,
      revision: item.revisionOverrides?.[runnerImage] || item.revision,
    }]),
);
for (const project of manifest.automated_projects) {
  const target = targets[project.engine];
  if (!target) throw new Error(`Writing matrix target missing: ${project.engine}`);
  if (target.version !== project.browser_version || target.revision !== project.browser_revision) {
    throw new Error(
      `${project.project} manifest ${project.browser_version}/${project.browser_revision} ` +
      `!= Playwright target ${target.version}/${target.revision}`,
    );
  }
}
console.log(`Writing Gate E matrix pins verified: ${manifest.matrix_id}`);
