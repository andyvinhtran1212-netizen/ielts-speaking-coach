import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDITOR_FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TESTED_ROOT = path.resolve(
  process.env.GATE_E_TESTED_ROOT || path.dirname(AUDITOR_FRONTEND),
);
const evidencePath = path.join(
  TESTED_ROOT,
  'frontend',
  'test-results',
  'gate-e-live-staging-failure-injection.json',
);
const expectedSourceSha = process.env.GATE_E_SOURCE_SHA || '';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readEvidence() {
  if (!existsSync(evidencePath)) throw new Error('live-staging-evidence-missing');
  try {
    return JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch {
    throw new Error('live-staging-evidence-invalid-json');
  }
}

export function validateLiveStagingFailureEvidence(evidence, sourceSha, now = Date.now()) {
  const errors = [];
  if (!SHA_PATTERN.test(sourceSha)) errors.push('expected-source-sha-invalid');
  if (evidence?.schema_version !== 1) errors.push('schema-version-invalid');
  if (evidence?.evidence_id !== 'gate-e-live-staging-speaking-ambiguous-commit-v1') {
    errors.push('evidence-id-invalid');
  }
  if (evidence?.source_sha !== sourceSha) errors.push('source-sha-mismatch');
  if (evidence?.git_ref !== 'staging') errors.push('git-ref-invalid');
  if (evidence?.staging_origin !== 'https://staging.averlearning.com') {
    errors.push('staging-origin-invalid');
  }
  if (evidence?.backend_origin !== 'https://ielts-speaking-coach-staging.up.railway.app') {
    errors.push('backend-origin-invalid');
  }
  if (evidence?.frontend_route !== '/practice/session') errors.push('frontend-route-invalid');
  if (evidence?.request_method !== 'POST') errors.push('request-method-invalid');
  for (const field of ['session_id', 'question_id', 'backend_response_id', 'client_response_id', 'canonical_response_id']) {
    if (!UUID_PATTERN.test(String(evidence?.[field] || ''))) errors.push(`${field}-invalid`);
  }
  if (evidence?.backend_commit_status !== 200) errors.push('backend-commit-status-invalid');
  if (evidence?.client_reconciled !== true) errors.push('client-reconciliation-missing');
  if (evidence?.upload_attempts !== 1) errors.push('upload-replay-detected');
  if (!Number.isInteger(evidence?.reconcile_reads) || evidence.reconcile_reads < 1) {
    errors.push('canonical-reconcile-read-missing');
  }
  if (evidence?.backend_response_id !== evidence?.client_response_id
      || evidence?.backend_response_id !== evidence?.canonical_response_id) {
    errors.push('response-identity-mismatch');
  }
  if (!Array.isArray(evidence?.production_egress) || evidence.production_egress.length !== 0) {
    errors.push('production-egress-detected');
  }
  if (!Array.isArray(evidence?.page_errors) || evidence.page_errors.length !== 0) {
    errors.push('browser-errors-detected');
  }

  const capturedAt = Date.parse(String(evidence?.captured_at || ''));
  if (!Number.isFinite(capturedAt)) {
    errors.push('captured-at-invalid');
  // The evidence test may run near the start of the 20-minute staging suite;
  // leave verifier/setup margin without accepting an artifact from an older
  // workflow execution.
  } else if (capturedAt > now + 60_000 || now - capturedAt > 30 * 60_000) {
    errors.push('evidence-stale-or-future');
  }

  // Artifacts are public to repository collaborators. Fail closed if a future
  // edit accidentally serializes any authentication material.
  const serialized = JSON.stringify(evidence);
  for (const forbidden of [
    'access_token', 'refresh_token', 'authorization', 'e2e_password',
    'staging_bypass', 'audio_file', 'transcript',
  ]) {
    if (serialized.toLowerCase().includes(forbidden)) errors.push(`forbidden-field:${forbidden}`);
  }
  return errors;
}

let evidence;
let errors;
try {
  evidence = readEvidence();
  errors = validateLiveStagingFailureEvidence(evidence, expectedSourceSha);
} catch (error) {
  errors = [String(error?.message || error)];
}

if (errors.length) {
  for (const error of errors) console.error(`Gate E live-staging failure evidence: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Gate E live-staging failure evidence: OK (${evidence.evidence_id}; `
      + `POST=${evidence.upload_attempts}, GET=${evidence.reconcile_reads})`,
  );
}
