import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from './supabase-session.mjs';
import {
  parseJsonInput,
  validateSpeakingRealDeviceEvidence,
} from './gate-e-speaking-real-device-evidence-lib.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(
  path.join(FRONTEND, 'tooling', 'gate-e-speaking-device-matrix.json'),
  'utf8',
));
const provenancePath = path.join(FRONTEND, 'test-results', 'gate-e-staging-provenance.json');
const outputPath = path.join(
  FRONTEND,
  'test-results',
  'gate-e-speaking-real-device-evidence.json',
);
const stagingOrigin = 'https://staging.averlearning.com';
const expectedApi = 'https://ielts-speaking-coach-staging.up.railway.app';
const expectedSupabase = 'https://zjphffoujxkpltixsbzj.supabase.co';
const studentEmail = 'e2e-student-smoke@staging-e2e.averlearning.com';
const bypass = process.env.STAGING_BYPASS || '';
const password = process.env.E2E_PASSWORD || '';

const field = (source, name) => {
  const match = source.match(new RegExp(`"${name}"\\s*:\\s*(null|"([^"]*)")`));
  return match && match[1] !== 'null' ? match[2] : null;
};

function errorCode(error) {
  const message = String(error?.message || error || 'unknown-error');
  if (/^[a-z0-9-]+$/.test(message)) return message;
  const http = message.match(/^(canonical-session-http-\d{3})$/);
  return http ? http[1] : 'real-device-evidence-capture-failed';
}

async function canonicalSession(sessionId) {
  if (!bypass) throw new Error('staging-bypass-missing');
  if (!password) throw new Error('e2e-password-missing');
  const runtime = await fetch(`${stagingOrigin}/js/runtime-config.js`, {
    headers: { 'x-vercel-protection-bypass': bypass },
    signal: AbortSignal.timeout(20_000),
  });
  if (!runtime.ok) throw new Error(`runtime-config-http-${runtime.status}`);
  const runtimeSource = await runtime.text();
  const supabaseUrl = field(runtimeSource, 'supabaseUrl');
  const anonKey = field(runtimeSource, 'supabaseAnonKey');
  const apiBase = field(runtimeSource, 'apiBase');
  if (supabaseUrl !== expectedSupabase || apiBase !== expectedApi || !anonKey) {
    throw new Error('runtime-config-environment-or-origin-mismatch');
  }

  const session = await signIn({
    supabaseUrl,
    anonKey,
    email: studentEmail,
    password,
  });
  const response = await fetch(`${apiBase}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`canonical-session-http-${response.status}`);
  const body = await response.json();
  const responseCount = Array.isArray(body.responses) ? body.responses.length : 0;
  const receiptCount = Array.isArray(body.response_receipts) ? body.response_receipts.length : 0;
  return {
    id: body.id || body.session_id || null,
    mode: body.mode || null,
    part: body.part ?? null,
    status: body.status || null,
    started_at: body.started_at || null,
    persisted_response_count: Math.max(responseCount, receiptCount),
  };
}

let artifact;
let exitCode = 0;
try {
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  const input = {
    requirement_id: process.env.GATE_E_REQUIREMENT_ID,
    source_sha: process.env.GATE_E_SOURCE_SHA,
    observed_platform: process.env.GATE_E_OBSERVED_PLATFORM,
    observed_browser: process.env.GATE_E_OBSERVED_BROWSER,
    device_model: process.env.GATE_E_DEVICE_MODEL,
    operator: process.env.GATE_E_OPERATOR,
    observed_at: process.env.GATE_E_OBSERVED_AT,
    canonical_session_id: process.env.GATE_E_CANONICAL_SESSION_ID,
    scope_results: parseJsonInput(process.env.GATE_E_SCOPE_RESULTS_JSON, 'scope-results'),
    console_errors: parseJsonInput(process.env.GATE_E_CONSOLE_ERRORS_JSON, 'console-errors'),
    network_failures: parseJsonInput(process.env.GATE_E_NETWORK_FAILURES_JSON, 'network-failures'),
  };
  const canonical = await canonicalSession(input.canonical_session_id);
  const result = validateSpeakingRealDeviceEvidence({
    manifest,
    input,
    provenance,
    canonicalSession: canonical,
    workflow: {
      actor: process.env.GITHUB_ACTOR,
      repository: process.env.GITHUB_REPOSITORY,
      name: process.env.GITHUB_WORKFLOW,
      run_id: process.env.GITHUB_RUN_ID,
      run_attempt: process.env.GITHUB_RUN_ATTEMPT,
      git_ref: process.env.GITHUB_REF,
    },
  });
  if (!result.ok) {
    artifact = {
      schema_version: 1,
      matrix_id: manifest.matrix_id,
      requirement_id: input.requirement_id || null,
      status: 'invalid',
      errors: result.errors,
    };
    exitCode = 1;
  } else {
    artifact = result.evidence;
  }
} catch (error) {
  artifact = {
    schema_version: 1,
    matrix_id: manifest.matrix_id,
    requirement_id: process.env.GATE_E_REQUIREMENT_ID || null,
    status: 'invalid',
    errors: [errorCode(error)],
  };
  exitCode = 1;
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(`Speaking real-device evidence: ${artifact.status.toUpperCase()}`);
if (exitCode && process.env.GATE_E_REAL_DEVICE_REQUIRED === 'true') process.exitCode = exitCode;
