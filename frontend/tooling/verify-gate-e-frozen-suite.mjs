import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isReviewedSourceComparison,
  verifyFrozenDirs,
  verifyFrozenFiles,
} from './gate-e-streak-lib.mjs';

const AUDITOR_FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TESTED_ROOT = path.resolve(
  process.env.GATE_E_TESTED_ROOT || path.dirname(AUDITOR_FRONTEND),
);
const manifest = JSON.parse(
  readFileSync(path.join(AUDITOR_FRONTEND, 'tooling', 'gate-e-critical-suite.json'), 'utf8'),
);

const frozenErrors = [
  ...verifyFrozenFiles(TESTED_ROOT, manifest),
  ...verifyFrozenDirs(TESTED_ROOT, manifest),
];
const fatalErrors = [];
for (const npmConfig of ['.npmrc', 'frontend/.npmrc']) {
  if (existsSync(path.join(TESTED_ROOT, npmConfig))) {
    fatalErrors.push(`forbidden-npm-config:${npmConfig}`);
  }
}
for (const seededState of [
  '.gate-e-streak-state',
  'frontend/.gate-e-streak-state',
  'frontend/test-results',
]) {
  if (existsSync(path.join(TESTED_ROOT, seededState))) {
    fatalErrors.push(`forbidden-seeded-state:${seededState}`);
  }
}

const shaPattern = /^[a-f0-9]{40}$/;
const testedSha = process.env.GATE_E_TESTED_SHA || '';
const auditorSha = process.env.GATE_E_AUDITOR_SHA || '';
const repository = process.env.GITHUB_REPOSITORY || '';
const token = process.env.GITHUB_TOKEN || '';

async function isReviewedMainSource() {
  if (!shaPattern.test(testedSha) || !shaPattern.test(auditorSha) || !repository || !token) {
    return false;
  }
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/compare/${testedSha}...${auditorSha}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) return false;
    const payload = await response.json();
    return isReviewedSourceComparison(payload, testedSha);
  } catch {
    return false;
  }
}

if (fatalErrors.length) {
  for (const error of fatalErrors) console.error(`Gate E frozen-suite preflight: ${error}`);
  process.exitCode = 1;
} else if (frozenErrors.length && await isReviewedMainSource()) {
  for (const error of frozenErrors) console.warn(`Gate E frozen-suite preflight: ${error}`);
  console.warn(
    'Gate E frozen-suite preflight: reviewed main source; execution allowed but streak will reset',
  );
} else if (frozenErrors.length) {
  for (const error of frozenErrors) console.error(`Gate E frozen-suite preflight: ${error}`);
  console.error('Gate E frozen-suite preflight: unreviewed or unverifiable source drift');
  process.exitCode = 1;
} else {
  console.log(`Gate E frozen-suite preflight: OK (${manifest.suite_id})`);
}
