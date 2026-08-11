import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseJsonInput,
  validateSpeakingRealDeviceEvidence,
  validateSpeakingRealDeviceEvidencePair,
} from '../tooling/gate-e-speaking-real-device-evidence-lib.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));
const MANIFEST = json('frontend/tooling/gate-e-speaking-device-matrix.json');
const SCHEMA = json('frontend/tooling/gate-e-speaking-real-device-evidence.schema.json');
const WORKFLOW = read('.github/workflows/speaking-real-device-evidence.yml');
const DOC = read('docs/GATE_E_SPEAKING_REAL_DEVICE_RUNBOOK_2026-08-11.md');
const SHA = 'a'.repeat(40);
const SESSION = '123e4567-e89b-42d3-a456-426614174000';
const NOW = Date.parse('2026-08-11T01:00:00Z');

function fixture(requirementId, runId = '501') {
  const requirement = MANIFEST.real_device_requirements
    .find((item) => item.id === requirementId);
  return {
    manifest: MANIFEST,
    input: {
      requirement_id: requirementId,
      source_sha: SHA,
      observed_platform: requirement.platform,
      observed_browser: requirement.browser,
      device_model: requirementId === 'safari-floor' ? 'MacBook Air M1' : 'iPhone 6s',
      operator: 'Gate E operator',
      observed_at: '2026-08-11T00:30:00Z',
      canonical_session_id: SESSION,
      scope_results: Object.fromEntries(requirement.required_scope.map((scope) => [scope, 'passed'])),
      console_errors: [],
      network_failures: [],
    },
    provenance: {
      ok: true,
      staging_origin: 'https://staging.averlearning.com',
      frontend_release: SHA,
      frontend_git_ref: 'staging',
      runtime_environment: 'staging',
      backend_release: SHA,
      backend_git_branch: 'staging',
      backend_environment_name: 'staging',
    },
    canonicalSession: {
      id: SESSION,
      mode: 'practice',
      part: 2,
      status: 'in_progress',
      started_at: '2026-08-11T00:15:00Z',
      persisted_response_count: 1,
    },
    workflow: {
      actor: 'release-operator',
      repository: 'andyvinhtran1212-netizen/ielts-speaking-coach',
      name: 'Speaking Gate E real-device evidence',
      run_id: runId,
      run_attempt: '1',
      git_ref: 'refs/heads/staging',
    },
    now: NOW,
  };
}

describe('Speaking Gate E real-device evidence validator', () => {
  test('accepts each exact physical-device row and emits secret-free canonical evidence', () => {
    for (const id of ['safari-floor', 'ios-safari-floor']) {
      const result = validateSpeakingRealDeviceEvidence(fixture(id));
      assert.equal(result.ok, true, result.errors.join(','));
      assert.equal(result.evidence.requirement_id, id);
      assert.equal(result.evidence.status, 'complete');
      assert.equal(result.evidence.source_sha, SHA);
      assert.equal(result.evidence.canonical_session.persisted_response_count, 1);
      assert.deepEqual(result.evidence.console_errors, []);
      assert.doesNotMatch(JSON.stringify(result.evidence), /token|password|transcript|feedback/i);
    }
  });

  test('rejects a partial journey, synthetic version, runtime errors and stale attestation', () => {
    const partial = fixture('safari-floor');
    delete partial.input.scope_results['route-exit-microphone-release'];
    partial.input.observed_platform = 'macOS 14';
    partial.input.console_errors = ['NotAllowedError'];
    partial.input.network_failures = ['/grade 500'];
    partial.input.observed_at = '2026-08-10T00:00:00Z';
    const result = validateSpeakingRealDeviceEvidence(partial);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      'platform-mismatch',
      'observed-at-stale',
      'scope-set-mismatch',
      'console-errors-present',
      'network-failures-present',
      'canonical-session-time-mismatch',
    ]);
  });

  test('rejects release drift, a session without persisted truth and rerun cherry-picking', () => {
    const unsafe = fixture('ios-safari-floor');
    unsafe.provenance.backend_release = 'b'.repeat(40);
    unsafe.canonicalSession.started_at = '2026-08-10T00:00:00Z';
    unsafe.canonicalSession.persisted_response_count = 0;
    unsafe.workflow.run_attempt = '2';
    const result = validateSpeakingRealDeviceEvidence(unsafe);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('backend-release-mismatch'));
    assert.ok(result.errors.includes('canonical-session-time-mismatch'));
    assert.ok(result.errors.includes('canonical-response-missing'));
    assert.ok(result.errors.includes('workflow-rerun-not-eligible'));
  });

  test('requires both distinct device artifacts from one exact staging source', () => {
    const safari = validateSpeakingRealDeviceEvidence(fixture('safari-floor', '501')).evidence;
    const ios = validateSpeakingRealDeviceEvidence(fixture('ios-safari-floor', '502')).evidence;
    assert.deepEqual(validateSpeakingRealDeviceEvidencePair([safari, ios], SHA), {
      ok: true,
      errors: [],
      source_sha: SHA,
      workflow_run_ids: ['501', '502'],
    });
    ios.source_sha = 'b'.repeat(40);
    const mismatch = validateSpeakingRealDeviceEvidencePair([safari, ios], SHA);
    assert.equal(mismatch.ok, false);
    assert.ok(mismatch.errors.includes('source-sha-pair-mismatch'));
    assert.ok(mismatch.errors.includes('expected-source-sha-mismatch'));
  });

  test('JSON inputs fail closed instead of becoming untrusted strings', () => {
    assert.deepEqual(parseJsonInput('{"a":"passed"}', 'scope-results'), { a: 'passed' });
    assert.throws(() => parseJsonInput('{', 'scope-results'), /scope-results-json-invalid/);
  });
});

describe('Speaking real-device workflow contract', () => {
  test('schema and manifest pin the manual evidence boundary', () => {
    assert.equal(SCHEMA.additionalProperties, false);
    assert.equal(SCHEMA.properties.status.const, 'complete');
    assert.equal(SCHEMA.properties.console_errors.maxItems, 0);
    assert.equal(MANIFEST.real_device_evidence.max_attestation_age_hours, 12);
    assert.equal(MANIFEST.real_device_evidence.max_session_age_hours, 3);
    assert.equal(MANIFEST.real_device_evidence.retention_days, 90);
  });

  test('workflow binds attestation to exact deployed staging provenance and canonical state', () => {
    assert.match(WORKFLOW, /ref: staging/);
    assert.match(WORKFLOW, /group: staging-e2e-shared-env/);
    assert.match(WORKFLOW, /GATE_E_SOURCE_SHA: \$\{\{ steps\.source\.outputs\.sha \}\}/);
    assert.match(WORKFLOW, /capture-gate-e-staging-provenance\.mjs/);
    assert.match(WORKFLOW, /capture-gate-e-speaking-real-device-evidence\.mjs/);
    assert.match(WORKFLOW, /GATE_E_REAL_DEVICE_REQUIRED: 'true'/);
    assert.match(WORKFLOW, /if: always\(\)[\s\S]*retention-days: 90/);
    assert.match(DOC, /không đổi\s+`route_ready` hoặc `admit_new`/);
    assert.match(DOC, /cùng một `source_sha`/);
  });
});
