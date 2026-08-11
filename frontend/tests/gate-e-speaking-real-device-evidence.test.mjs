import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseJsonInput,
  validateCompleteSpeakingRealDeviceArtifact,
  validateSpeakingRealDeviceEvidence,
  validateSpeakingRealDeviceEvidencePair,
  validateSpeakingRealDeviceWorkflowRun,
} from '../tooling/gate-e-speaking-real-device-evidence-lib.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));
const MANIFEST = json('frontend/tooling/gate-e-speaking-device-matrix.json');
const SCHEMA = json('frontend/tooling/gate-e-speaking-real-device-evidence.schema.json');
const WORKFLOW = read('.github/workflows/speaking-real-device-evidence.yml');
const PAIR_WORKFLOW = read('.github/workflows/speaking-real-device-pair.yml');
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
      observed_release_sha: SHA,
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
      auditor_sha: SHA,
      run_id: runId,
      run_attempt: '1',
      git_ref: 'refs/heads/main',
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
      assert.equal(result.evidence.observed_release_sha, SHA);
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
    unsafe.input.observed_release_sha = 'b'.repeat(40);
    unsafe.canonicalSession.started_at = '2026-08-10T00:00:00Z';
    unsafe.canonicalSession.persisted_response_count = 0;
    unsafe.workflow.run_attempt = '2';
    const result = validateSpeakingRealDeviceEvidence(unsafe);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('backend-release-mismatch'));
    assert.ok(result.errors.includes('observed-release-mismatch'));
    assert.ok(result.errors.includes('canonical-session-time-mismatch'));
    assert.ok(result.errors.includes('canonical-response-missing'));
    assert.ok(result.errors.includes('workflow-rerun-not-eligible'));
  });

  test('rejects a canonical session outside Practice Part 2', () => {
    const wrongJourney = fixture('safari-floor');
    wrongJourney.canonicalSession.mode = 'full_test';
    wrongJourney.canonicalSession.part = '2';
    const result = validateSpeakingRealDeviceEvidence(wrongJourney);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('canonical-mode-mismatch'));
    assert.ok(result.errors.includes('canonical-part-mismatch'));
  });

  test('requires both distinct device artifacts from one exact staging source', () => {
    const safari = validateSpeakingRealDeviceEvidence(fixture('safari-floor', '501')).evidence;
    const ios = validateSpeakingRealDeviceEvidence(fixture('ios-safari-floor', '502')).evidence;
    assert.deepEqual(validateSpeakingRealDeviceEvidencePair(MANIFEST, [safari, ios], SHA), {
      ok: true,
      errors: [],
      source_sha: SHA,
      workflow_run_ids: ['501', '502'],
    });
    ios.source_sha = 'b'.repeat(40);
    const mismatch = validateSpeakingRealDeviceEvidencePair(MANIFEST, [safari, ios], SHA);
    assert.equal(mismatch.ok, false);
    assert.ok(mismatch.errors.includes('source-sha-pair-mismatch'));
    assert.ok(mismatch.errors.includes('expected-source-sha-mismatch'));
  });

  test('revalidates complete artifact semantics before accepting a plausible pair', () => {
    const safari = validateSpeakingRealDeviceEvidence(fixture('safari-floor', '501')).evidence;
    const ios = validateSpeakingRealDeviceEvidence(fixture('ios-safari-floor', '502')).evidence;
    safari.scope_results['record-stop-playback'] = 'failed';
    safari.console_errors = ['NotAllowedError'];
    safari.canonical_session.persisted_response_count = 0;
    safari.workflow.untrusted_note = 'looks plausible';
    const artifact = validateCompleteSpeakingRealDeviceArtifact(MANIFEST, safari);
    assert.equal(artifact.ok, false);
    assert.ok(artifact.errors.includes('scope-not-passed'));
    assert.ok(artifact.errors.includes('console-errors-present'));
    assert.ok(artifact.errors.includes('canonical-response-missing'));
    assert.ok(artifact.errors.includes('workflow-shape-mismatch'));
    const pair = validateSpeakingRealDeviceEvidencePair(MANIFEST, [safari, ios], SHA);
    assert.equal(pair.ok, false);
    assert.ok(pair.errors.includes('safari-floor:scope-not-passed'));
    assert.ok(pair.errors.includes('safari-floor:console-errors-present'));
    assert.ok(pair.errors.includes('safari-floor:canonical-response-missing'));
    assert.ok(pair.errors.includes('safari-floor:workflow-shape-mismatch'));
  });

  test('binds each artifact to a successful immutable GitHub workflow run', () => {
    const evidence = validateSpeakingRealDeviceEvidence(fixture('safari-floor', '501')).evidence;
    const run = {
      id: 501,
      name: 'Speaking Gate E real-device evidence',
      path: '.github/workflows/speaking-real-device-evidence.yml',
      event: 'workflow_dispatch',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'main',
      head_sha: SHA,
      run_attempt: 1,
      repository: { full_name: 'andyvinhtran1212-netizen/ielts-speaking-coach' },
      actor: { login: 'release-operator' },
    };
    assert.deepEqual(validateSpeakingRealDeviceWorkflowRun(evidence, run), {
      ok: true,
      errors: [],
    });
    run.head_sha = 'b'.repeat(40);
    run.conclusion = 'failure';
    const invalid = validateSpeakingRealDeviceWorkflowRun(evidence, run);
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.includes('github-run-not-successful'));
    assert.ok(invalid.errors.includes('github-run-revision-mismatch'));
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
    assert.equal(SCHEMA.properties.canonical_session.properties.mode.const, 'practice');
    assert.equal(SCHEMA.properties.canonical_session.properties.part.const, 2);
    assert.equal(SCHEMA.properties.provenance.properties.runtime_environment.const, 'staging');
    assert.equal(SCHEMA.properties.workflow.properties.git_ref.const, 'refs/heads/main');
    assert.equal(SCHEMA.properties.console_errors.maxItems, 0);
    assert.equal(MANIFEST.real_device_evidence.max_attestation_age_hours, 12);
    assert.equal(MANIFEST.real_device_evidence.max_session_age_hours, 3);
    assert.equal(MANIFEST.real_device_evidence.retention_days, 90);
    assert.equal(
      MANIFEST.real_device_evidence.pair_workflow,
      '.github/workflows/speaking-real-device-pair.yml',
    );
  });

  test('trusted-main workflow binds attestation to deployed staging provenance and canonical state', () => {
    assert.match(WORKFLOW, /Require trusted main workflow revision/);
    assert.match(WORKFLOW, /test "\$GITHUB_REF" = refs\/heads\/main/);
    assert.match(WORKFLOW, /ref: staging/);
    assert.match(WORKFLOW, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(WORKFLOW, /path: \.gate-e-auditor/);
    assert.match(WORKFLOW, /group: staging-e2e-shared-env/);
    assert.match(WORKFLOW, /GATE_E_SOURCE_SHA: \$\{\{ steps\.source\.outputs\.sha \}\}/);
    assert.match(WORKFLOW, /GATE_E_AUDITOR_SHA: \$\{\{ steps\.auditor\.outputs\.sha \}\}/);
    assert.match(WORKFLOW, /GATE_E_OBSERVED_RELEASE_SHA: \$\{\{ inputs\.observed_release_sha \}\}/);
    assert.match(WORKFLOW, /node \.gate-e-auditor\/frontend\/tooling\/capture-gate-e-staging-provenance\.mjs/);
    assert.match(WORKFLOW, /node \.gate-e-auditor\/frontend\/tooling\/capture-gate-e-speaking-real-device-evidence\.mjs/);
    assert.match(WORKFLOW, /GATE_E_REAL_DEVICE_REQUIRED: 'true'/);
    assert.match(WORKFLOW, /Validate real-device attestation[\s\S]*if: always\(\)/);
    assert.match(WORKFLOW, /Upload validated evidence[\s\S]*if: always\(\)[\s\S]*retention-days: 90/);
    assert.match(PAIR_WORKFLOW, /Require trusted main workflow revision/);
    assert.match(PAIR_WORKFLOW, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(PAIR_WORKFLOW, /actions\/download-artifact@v5[\s\S]*run-id: \$\{\{ inputs\.safari_run_id \}\}/);
    assert.match(PAIR_WORKFLOW, /actions\/download-artifact@v5[\s\S]*run-id: \$\{\{ inputs\.ios_run_id \}\}/);
    assert.match(PAIR_WORKFLOW, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(DOC, /không đổi\s+`route_ready` hoặc `admit_new`/);
    assert.match(DOC, /cùng\s+(?:một\s+)?`source_sha`/);
  });
});
