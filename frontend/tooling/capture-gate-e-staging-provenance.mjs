import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from './supabase-session.mjs';

const AUDITOR_FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TESTED_ROOT = path.resolve(
  process.env.GATE_E_TESTED_ROOT || path.dirname(AUDITOR_FRONTEND),
);
const TESTED_FRONTEND = path.join(TESTED_ROOT, 'frontend');
const outputPath = path.join(TESTED_FRONTEND, 'test-results', 'gate-e-staging-provenance.json');
const stagingOrigin = 'https://staging.averlearning.com';
const expectedApi = 'https://ielts-speaking-coach-staging.up.railway.app';
const expectedSupabase = 'https://zjphffoujxkpltixsbzj.supabase.co';
const adminEmail = 'e2e-admin-smoke@staging-e2e.averlearning.com';
const bypass = process.env.STAGING_BYPASS || '';
const password = process.env.E2E_PASSWORD || '';
const shaPattern = /^[a-f0-9]{40}$/;

const field = (source, name) => {
  const match = source.match(new RegExp(`"${name}"\\s*:\\s*(null|"([^"]*)")`));
  return match && match[1] !== 'null' ? match[2] : null;
};

const evidence = {
  schema_version: 1,
  captured_at: new Date().toISOString(),
  staging_origin: stagingOrigin,
  ok: false,
  runtime_environment: null,
  frontend_release: null,
  frontend_git_ref: null,
  api_base: null,
  backend_release: null,
  error: null,
};

try {
  if (!bypass) throw new Error('staging-bypass-missing');
  if (!password) throw new Error('e2e-password-missing');

  // The Vercel bypass credential is sent only to the canonical staging
  // origin. The URL is deliberately not configurable by workflow input.
  const runtime = await fetch(`${stagingOrigin}/js/runtime-config.js`, {
    headers: { 'x-vercel-protection-bypass': bypass },
    signal: AbortSignal.timeout(20000),
  });
  if (!runtime.ok) throw new Error(`runtime-config-http-${runtime.status}`);
  const runtimeSource = await runtime.text();
  evidence.runtime_environment = field(runtimeSource, 'environment');
  evidence.frontend_release = field(runtimeSource, 'release');
  evidence.frontend_git_ref = field(runtimeSource, 'gitRef');
  evidence.api_base = field(runtimeSource, 'apiBase');
  const supabaseUrl = field(runtimeSource, 'supabaseUrl');
  const supabaseAnonKey = field(runtimeSource, 'supabaseAnonKey');

  if (evidence.runtime_environment !== 'staging' || evidence.api_base !== expectedApi ||
      supabaseUrl !== expectedSupabase || !supabaseAnonKey) {
    throw new Error('runtime-config-environment-or-origin-mismatch');
  }

  // `/health/runtime` preserves the existing admin-only release policy. The
  // synthetic admin password/token remain process inputs and are never copied
  // into the evidence artifact.
  const session = await signIn({
    supabaseUrl,
    anonKey: supabaseAnonKey,
    email: adminEmail,
    password,
  });
  const runtimeHealth = await fetch(`${expectedApi}/health/runtime`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!runtimeHealth.ok) throw new Error(`backend-runtime-health-http-${runtimeHealth.status}`);
  const runtimeHealthBody = await runtimeHealth.json();
  evidence.backend_release = runtimeHealthBody.git_sha || null;

  evidence.ok = shaPattern.test(evidence.frontend_release || '') &&
    shaPattern.test(evidence.backend_release || '');
  if (!evidence.ok) evidence.error = 'release-provenance-incomplete';
} catch (error) {
  let message = String(error?.message || error);
  for (const secret of [bypass, password]) {
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  evidence.error = message;
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`Gate E staging provenance: ${evidence.ok ? 'OK' : 'INVALID'}`);
if (process.env.GATE_E_PROVENANCE_REQUIRED === 'true' && !evidence.ok) {
  process.exitCode = 1;
}
