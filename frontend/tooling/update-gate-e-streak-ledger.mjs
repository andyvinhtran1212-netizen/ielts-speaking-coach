import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceStreak,
  selectPreviousWorkflowRun,
  selectWorkflowJobConclusion,
  verifyFrozenDirs,
  verifyFrozenFiles,
} from './gate-e-streak-lib.mjs';

const AUDITOR_FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TESTED_ROOT = path.resolve(
  process.env.GATE_E_TESTED_ROOT || path.dirname(AUDITOR_FRONTEND),
);
const TESTED_FRONTEND = path.join(TESTED_ROOT, 'frontend');
const STATE_ROOT = path.resolve(
  process.env.GATE_E_STATE_ROOT || path.join(TESTED_ROOT, '.gate-e-streak-state'),
);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const manifest = readJson(path.join(AUDITOR_FRONTEND, 'tooling', 'gate-e-critical-suite.json'));
const metadataPath = path.join(TESTED_FRONTEND, 'test-results', 'gate-e-device-matrix-evidence.json');
const provenancePath = path.join(TESTED_FRONTEND, 'test-results', 'gate-e-staging-provenance.json');
const reportPath = path.join(TESTED_FRONTEND, 'test-results', 'staging-e2e-results.json');
const statePath = path.join(STATE_ROOT, 'ledger.json');
const artifactPath = path.join(TESTED_FRONTEND, 'test-results', 'gate-e-streak-ledger.json');

const safeRead = (file) => existsSync(file) ? readJson(file) : null;

async function fetchPreviousWorkflowRun(currentRunId, currentRunNumber) {
  const token = process.env.GITHUB_TOKEN || '';
  const repository = process.env.GITHUB_REPOSITORY || '';
  if (!token || !repository || !currentRunId || !currentRunNumber) return { verified: false };

  try {
    const url = new URL(
      `https://api.github.com/repos/${repository}/actions/workflows/staging-e2e.yml/runs`,
    );
    url.searchParams.set('per_page', '100');
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return { verified: false };
    const payload = await response.json();
    const previous = selectPreviousWorkflowRun(
      payload.workflow_runs,
      currentRunId,
      currentRunNumber,
    );
    if (!previous.verified || !previous.previous_run_id) return previous;

    const jobsUrl = new URL(
      `https://api.github.com/repos/${repository}/actions/runs/${previous.previous_run_id}/jobs`,
    );
    jobsUrl.searchParams.set('filter', 'latest');
    jobsUrl.searchParams.set('per_page', '100');
    const jobsResponse = await fetch(jobsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!jobsResponse.ok) return { verified: false };
    const selectedJob = selectWorkflowJobConclusion((await jobsResponse.json()).jobs);
    return selectedJob.verified
      ? { ...selectedJob, previous_run_id: previous.previous_run_id }
      : { verified: false };
  } catch {
    return { verified: false };
  }
}

const metadata = safeRead(metadataPath) || {};
const ledger = advanceStreak({
  previous: safeRead(statePath),
  metadata,
  provenance: safeRead(provenancePath),
  report: safeRead(reportPath),
  manifest,
  frozenFileErrors: [
    ...verifyFrozenFiles(TESTED_ROOT, manifest),
    ...verifyFrozenDirs(TESTED_ROOT, manifest),
  ],
  previousWorkflowRun: await fetchPreviousWorkflowRun(metadata.run_id, metadata.run_number),
});

mkdirSync(path.dirname(statePath), { recursive: true });
mkdirSync(path.dirname(artifactPath), { recursive: true });
const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
writeFileSync(statePath, serialized, 'utf8');
writeFileSync(artifactPath, serialized, 'utf8');
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `clean=${ledger.entries.at(-1)?.clean === true ? 'true' : 'false'}\n`,
    'utf8',
  );
}
console.log(
  `Gate E critical streak: ${ledger.streak_count}/${ledger.target_consecutive_clean_runs}; ` +
  `eligible=${ledger.gate_e_evidence_eligible}`,
);
