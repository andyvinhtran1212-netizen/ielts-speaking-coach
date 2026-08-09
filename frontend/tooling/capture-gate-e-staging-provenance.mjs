import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputPath = path.resolve(FRONTEND, 'test-results/gate-e-staging-provenance.json');
const stagingBase = process.env.STAGING_BASE_URL || 'https://staging.averlearning.com';
const bypass = process.env.STAGING_BYPASS || '';
const expectedApi = 'https://ielts-speaking-coach-staging.up.railway.app';
const shaPattern = /^[a-f0-9]{40}$/;

const field = (source, name) => {
  const match = source.match(new RegExp(`"${name}"\\s*:\\s*(null|"([^"]*)")`));
  return match && match[1] !== 'null' ? match[2] : null;
};

const evidence = {
  schema_version: 1,
  captured_at: new Date().toISOString(),
  staging_origin: stagingBase,
  ok: false,
  runtime_environment: null,
  frontend_release: null,
  frontend_git_ref: null,
  api_base: null,
  backend_release: null,
  backend_git_branch: null,
  backend_version: null,
  error: null,
};

try {
  if (!bypass) throw new Error('staging-bypass-missing');
  const runtime = await fetch(`${stagingBase}/js/runtime-config.js`, {
    headers: { 'x-vercel-protection-bypass': bypass },
  });
  if (!runtime.ok) throw new Error(`runtime-config-http-${runtime.status}`);
  const runtimeSource = await runtime.text();
  evidence.runtime_environment = field(runtimeSource, 'environment');
  evidence.frontend_release = field(runtimeSource, 'release');
  evidence.frontend_git_ref = field(runtimeSource, 'gitRef');
  evidence.api_base = field(runtimeSource, 'apiBase');

  const health = await fetch(`${expectedApi}/health`);
  if (!health.ok) throw new Error(`backend-health-http-${health.status}`);
  const healthBody = await health.json();
  evidence.backend_release = healthBody.release || null;
  evidence.backend_git_branch = healthBody.git_branch || null;
  evidence.backend_version = healthBody.version || null;

  evidence.ok = evidence.runtime_environment === 'staging' &&
    evidence.api_base === expectedApi &&
    shaPattern.test(evidence.frontend_release || '') &&
    shaPattern.test(evidence.backend_release || '');
  if (!evidence.ok) evidence.error = 'release-provenance-incomplete-or-mismatched-environment';
} catch (error) {
  const message = String(error?.message || error);
  evidence.error = bypass ? message.replaceAll(bypass, '[redacted]') : message;
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`Gate E staging provenance: ${evidence.ok ? 'OK' : 'INVALID'}`);
