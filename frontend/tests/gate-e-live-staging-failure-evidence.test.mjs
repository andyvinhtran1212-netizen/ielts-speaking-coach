import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERIFIER = path.join(
  FRONTEND,
  'tooling',
  'verify-gate-e-live-staging-failure-evidence.mjs',
);
const SHA = 'a'.repeat(40);
const UUIDS = {
  session_id: '11111111-1111-4111-8111-111111111111',
  question_id: '22222222-2222-4222-8222-222222222222',
  backend_response_id: '33333333-3333-4333-8333-333333333333',
  client_response_id: '33333333-3333-4333-8333-333333333333',
  canonical_response_id: '33333333-3333-4333-8333-333333333333',
};

function validEvidence(overrides = {}) {
  return {
    schema_version: 1,
    evidence_id: 'gate-e-live-staging-speaking-ambiguous-commit-v1',
    captured_at: new Date().toISOString(),
    source_sha: SHA,
    git_ref: 'staging',
    staging_origin: 'https://staging.averlearning.com',
    backend_origin: 'https://ielts-speaking-coach-staging.up.railway.app',
    frontend_route: '/practice/session',
    request_method: 'POST',
    ...UUIDS,
    backend_commit_status: 200,
    client_reconciled: true,
    upload_attempts: 1,
    reconcile_reads: 1,
    production_egress: [],
    page_errors: [],
    ...overrides,
  };
}

function verify(evidence, { sourceSha = SHA } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gate-e-live-staging-'));
  const resultDir = path.join(root, 'frontend', 'test-results');
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(
    path.join(resultDir, 'gate-e-live-staging-failure-injection.json'),
    `${JSON.stringify(evidence)}\n`,
  );
  const run = spawnSync(process.execPath, [VERIFIER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GATE_E_TESTED_ROOT: root,
      GATE_E_SOURCE_SHA: sourceSha,
    },
  });
  rmSync(root, { recursive: true, force: true });
  return run;
}

describe('Gate E live-staging failure evidence verifier', () => {
  test('accepts one committed POST reconciled to the same canonical row', () => {
    const run = verify(validEvidence());
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Gate E live-staging failure evidence: OK/);
  });

  test('fails closed on replay, identity mismatch, production egress or secrets', () => {
    const run = verify(validEvidence({
      upload_attempts: 2,
      canonical_response_id: '44444444-4444-4444-8444-444444444444',
      production_egress: ['https://ielts-speaking-coach-production.up.railway.app'],
      access_token: 'must-never-be-serialized',
    }));
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /upload-replay-detected/);
    assert.match(run.stderr, /response-identity-mismatch/);
    assert.match(run.stderr, /production-egress-detected/);
    assert.match(run.stderr, /forbidden-field:access_token/);
  });

  test('rejects stale evidence and a source SHA mismatch', () => {
    const run = verify(validEvidence({
      captured_at: '2026-01-01T00:00:00.000Z',
    }), { sourceSha: 'b'.repeat(40) });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /source-sha-mismatch/);
    assert.match(run.stderr, /evidence-stale-or-future/);
  });
});
