import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateSpeakingRealDeviceEvidencePair,
  validateSpeakingRealDeviceWorkflowRun,
} from './gate-e-speaking-real-device-evidence-lib.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(
  path.join(FRONTEND, 'tooling', 'gate-e-speaking-device-matrix.json'),
  'utf8',
));
const files = process.argv.slice(2);
const repository = process.env.GITHUB_REPOSITORY || '';
const token = process.env.GITHUB_TOKEN || '';
const outputPath = path.resolve(
  process.env.GATE_E_PAIR_OUTPUT || 'test-results/gate-e-speaking-real-device-pair.json',
);

if (files.length !== 2) {
  console.error('usage: node tooling/verify-gate-e-speaking-real-device-pair.mjs <safari.json> <ios.json>');
  process.exit(2);
}

async function githubRun(runId) {
  if (repository !== 'andyvinhtran1212-netizen/ielts-speaking-coach') {
    throw new Error('github-repository-mismatch');
  }
  if (!token) throw new Error('github-token-missing');
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`github-run-http-${response.status}`);
  return response.json();
}

let result;
try {
  const evidence = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const pair = validateSpeakingRealDeviceEvidencePair(
    manifest,
    evidence,
    process.env.GATE_E_EXPECTED_SOURCE_SHA || '',
  );
  const runChecks = [];
  if (pair.ok) {
    for (const item of evidence) {
      const run = await githubRun(item.workflow.run_id);
      const checked = validateSpeakingRealDeviceWorkflowRun(item, run);
      runChecks.push({ requirement_id: item.requirement_id, ...checked });
    }
  }
  const runErrors = runChecks.flatMap((item) =>
    item.errors.map((error) => `${item.requirement_id}:${error}`));
  result = {
    ...pair,
    ok: pair.ok && runErrors.length === 0,
    errors: [...pair.errors, ...runErrors],
    github_runs_verified: runChecks.length === 2 && runErrors.length === 0,
  };
} catch (error) {
  const message = String(error?.message || error || 'pair-verification-failed');
  result = {
    ok: false,
    errors: [/^[a-z0-9-]+$/.test(message) ? message : 'pair-verification-failed'],
    source_sha: null,
    workflow_run_ids: [],
    github_runs_verified: false,
  };
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
