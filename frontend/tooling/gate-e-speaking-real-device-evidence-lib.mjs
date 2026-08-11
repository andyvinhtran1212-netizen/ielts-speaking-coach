const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000;

const cleanText = (value) => String(value || '').trim();

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

export function parseJsonInput(value, field) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    throw new Error(`${field}-json-invalid`);
  }
}

export function validateSpeakingRealDeviceEvidence({
  manifest,
  input,
  provenance,
  canonicalSession,
  workflow,
  now = Date.now(),
}) {
  const errors = [];
  const requirementId = cleanText(input.requirement_id);
  const requirement = (manifest.real_device_requirements || [])
    .find((item) => item.id === requirementId);
  const sourceSha = cleanText(input.source_sha);
  const sessionId = cleanText(input.canonical_session_id);
  const observedAt = cleanText(input.observed_at);
  const observedAtMs = Date.parse(observedAt);
  const maxAgeHours = Number(manifest.real_device_evidence?.max_attestation_age_hours || 12);
  const maxSessionAgeHours = Number(manifest.real_device_evidence?.max_session_age_hours || 3);

  if (!requirement) errors.push('requirement-unknown');
  if (!SHA.test(sourceSha)) errors.push('source-sha-invalid');
  if (cleanText(input.observed_platform) !== cleanText(requirement?.platform)) {
    errors.push('platform-mismatch');
  }
  if (cleanText(input.observed_browser) !== cleanText(requirement?.browser)) {
    errors.push('browser-mismatch');
  }
  if (!cleanText(input.device_model) || cleanText(input.device_model).length > 120) {
    errors.push('device-model-invalid');
  }
  if (!cleanText(input.operator) || cleanText(input.operator).length > 80) {
    errors.push('operator-invalid');
  }
  if (!Number.isFinite(observedAtMs)) {
    errors.push('observed-at-invalid');
  } else {
    if (observedAtMs > now + MAX_FUTURE_DRIFT_MS) errors.push('observed-at-in-future');
    if (observedAtMs < now - maxAgeHours * 60 * 60 * 1000) errors.push('observed-at-stale');
  }

  const requiredScopes = requirement?.required_scope || [];
  if (!exactKeys(input.scope_results, requiredScopes)) {
    errors.push('scope-set-mismatch');
  } else if (requiredScopes.some((scope) => input.scope_results[scope] !== 'passed')) {
    errors.push('scope-not-passed');
  }
  if (!Array.isArray(input.console_errors)) {
    errors.push('console-errors-invalid');
  } else if (input.console_errors.length) {
    errors.push('console-errors-present');
  }
  if (!Array.isArray(input.network_failures)) {
    errors.push('network-failures-invalid');
  } else if (input.network_failures.length) {
    errors.push('network-failures-present');
  }

  if (!provenance?.ok) errors.push('staging-provenance-invalid');
  if (provenance?.staging_origin !== 'https://staging.averlearning.com') {
    errors.push('staging-origin-mismatch');
  }
  if (provenance?.frontend_release !== sourceSha) errors.push('frontend-release-mismatch');
  if (provenance?.backend_release !== sourceSha) errors.push('backend-release-mismatch');
  if (provenance?.frontend_git_ref !== 'staging') errors.push('frontend-ref-mismatch');
  if (provenance?.backend_git_branch !== 'staging') errors.push('backend-ref-mismatch');
  if (provenance?.runtime_environment !== 'staging' ||
      provenance?.backend_environment_name !== 'staging') {
    errors.push('environment-mismatch');
  }

  if (!UUID.test(sessionId)) errors.push('canonical-session-id-invalid');
  if (canonicalSession?.id !== sessionId) errors.push('canonical-session-id-mismatch');
  const sessionStartedAtMs = Date.parse(cleanText(canonicalSession?.started_at));
  if (!Number.isFinite(sessionStartedAtMs)) {
    errors.push('canonical-session-start-invalid');
  } else if (Number.isFinite(observedAtMs) &&
      (sessionStartedAtMs > observedAtMs + MAX_FUTURE_DRIFT_MS ||
       sessionStartedAtMs < observedAtMs - maxSessionAgeHours * 60 * 60 * 1000)) {
    errors.push('canonical-session-time-mismatch');
  }
  if (!Number.isInteger(canonicalSession?.persisted_response_count) ||
      canonicalSession.persisted_response_count < 1) {
    errors.push('canonical-response-missing');
  }
  if (!cleanText(canonicalSession?.mode)) errors.push('canonical-mode-missing');
  if (![1, 2, 3].includes(Number(canonicalSession?.part))) errors.push('canonical-part-invalid');
  if (!cleanText(canonicalSession?.status)) errors.push('canonical-status-missing');

  if (!cleanText(workflow?.actor)) errors.push('workflow-actor-missing');
  if (workflow?.repository !== 'andyvinhtran1212-netizen/ielts-speaking-coach') {
    errors.push('workflow-repository-mismatch');
  }
  if (workflow?.name !== 'Speaking Gate E real-device evidence') {
    errors.push('workflow-name-mismatch');
  }
  if (!/^\d+$/.test(cleanText(workflow?.run_id))) errors.push('workflow-run-id-invalid');
  if (String(workflow?.run_attempt || '') !== '1') errors.push('workflow-rerun-not-eligible');
  if (workflow?.git_ref !== 'refs/heads/staging') errors.push('workflow-ref-mismatch');

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    evidence: ok ? {
      schema_version: 1,
      matrix_id: manifest.matrix_id,
      requirement_id: requirementId,
      status: 'complete',
      evidence_class: 'manual-real-device',
      source_sha: sourceSha,
      source_branch: 'staging',
      staging_origin: provenance.staging_origin,
      route: manifest.route,
      coexistence_route: manifest.coexistence_route,
      observed_platform: cleanText(input.observed_platform),
      observed_browser: cleanText(input.observed_browser),
      device_model: cleanText(input.device_model),
      operator: cleanText(input.operator),
      attested_by: cleanText(workflow.actor),
      observed_at: new Date(observedAtMs).toISOString(),
      captured_at: new Date(now).toISOString(),
      canonical_session: canonicalSession,
      scope_results: input.scope_results,
      console_errors: [],
      network_failures: [],
      provenance: {
        frontend_release: provenance.frontend_release,
        frontend_git_ref: provenance.frontend_git_ref,
        backend_release: provenance.backend_release,
        backend_git_branch: provenance.backend_git_branch,
        backend_environment_name: provenance.backend_environment_name,
      },
      workflow: {
        repository: cleanText(workflow.repository),
        name: cleanText(workflow.name),
        run_id: cleanText(workflow.run_id),
        run_attempt: 1,
        git_ref: workflow.git_ref,
      },
    } : null,
  };
}

export function validateSpeakingRealDeviceEvidencePair(evidenceList, expectedSourceSha = '') {
  const errors = [];
  const items = Array.isArray(evidenceList) ? evidenceList : [];
  const expectedIds = ['ios-safari-floor', 'safari-floor'];
  const actualIds = items.map((item) => item?.requirement_id).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    errors.push('requirement-pair-mismatch');
  }
  if (items.some((item) => item?.status !== 'complete')) errors.push('evidence-not-complete');
  if (items.some((item) => item?.matrix_id !== 'gate-e-speaking-device-matrix-v1')) {
    errors.push('matrix-id-mismatch');
  }
  const sourceShas = new Set(items.map((item) => item?.source_sha));
  if (sourceShas.size !== 1 || !SHA.test(String(items[0]?.source_sha || ''))) {
    errors.push('source-sha-pair-mismatch');
  }
  if (expectedSourceSha && items.some((item) => item?.source_sha !== expectedSourceSha)) {
    errors.push('expected-source-sha-mismatch');
  }
  if (items.some((item) => item?.source_branch !== 'staging' ||
      item?.workflow?.git_ref !== 'refs/heads/staging')) {
    errors.push('staging-ref-mismatch');
  }
  if (items.some((item) => item?.provenance?.frontend_release !== item?.source_sha ||
      item?.provenance?.backend_release !== item?.source_sha)) {
    errors.push('artifact-provenance-mismatch');
  }
  const runIds = new Set(items.map((item) => item?.workflow?.run_id));
  if (runIds.size !== 2 || [...runIds].some((value) => !/^\d+$/.test(String(value || '')))) {
    errors.push('workflow-run-pair-invalid');
  }
  return {
    ok: errors.length === 0,
    errors,
    source_sha: errors.length === 0 ? items[0].source_sha : null,
    workflow_run_ids: errors.length === 0 ? [...runIds].sort() : [],
  };
}
