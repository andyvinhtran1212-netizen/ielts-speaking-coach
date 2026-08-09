import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceStreak,
  selectPreviousWorkflowRun,
  verifyFrozenFiles,
} from './gate-e-streak-lib.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const manifest = readJson(path.join(FRONTEND, 'tooling', 'gate-e-critical-suite.json'));
const metadataPath = path.join(FRONTEND, 'test-results', 'gate-e-device-matrix-evidence.json');
const provenancePath = path.join(FRONTEND, 'test-results', 'gate-e-staging-provenance.json');
const reportPath = path.join(FRONTEND, 'test-results', 'staging-e2e-results.json');
const statePath = path.join(FRONTEND, '.gate-e-streak-state', 'ledger.json');
const artifactPath = path.join(FRONTEND, 'test-results', 'gate-e-streak-ledger.json');

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
    });
    if (!response.ok) return { verified: false };
    const payload = await response.json();
    return selectPreviousWorkflowRun(
      payload.workflow_runs,
      currentRunId,
      currentRunNumber,
    );
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
  frozenFileErrors: verifyFrozenFiles(ROOT, manifest),
  previousWorkflowRun: await fetchPreviousWorkflowRun(metadata.run_id, metadata.run_number),
});

mkdirSync(path.dirname(statePath), { recursive: true });
mkdirSync(path.dirname(artifactPath), { recursive: true });
const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
writeFileSync(statePath, serialized, 'utf8');
writeFileSync(artifactPath, serialized, 'utf8');
console.log(
  `Gate E critical streak: ${ledger.streak_count}/${ledger.target_consecutive_clean_runs}; ` +
  `eligible=${ledger.gate_e_evidence_eligible}`,
);
