#!/usr/bin/env node
// Generates frontend/js/runtime-config.js — the single public runtime
// configuration shared by legacy pages and (later) Next.js. See
// docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md §7.1 / ADR-006.
//
// Resolution:
//   no VERCEL_ENV (local/manual)  → UNCONFIGURED (all null): consumers keep
//                                   their legacy behavior (hostname inference)
//   VERCEL_ENV=production         → production origins
//   VERCEL_ENV=preview|development→ staging origins — NEVER production
//   AVER_API_BASE / AVER_SUPABASE_URL / AVER_SUPABASE_ANON_KEY /
//   AVER_ENVIRONMENT              → explicit per-field overrides
//
// FAIL-CLOSED: a non-production Vercel build that resolves to any production
// origin aborts the build (preview must have zero production egress).
//
// The per-environment origins live in runtime-origins.mjs, shared with the
// Content-Security-Policy builder so connect-src always matches this output.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRODUCTION_ORIGIN_MARKERS, resolveRuntimeOrigins } from './runtime-origins.mjs';

const vercelEnv = process.env.VERCEL_ENV || '';

const config = {
  ...resolveRuntimeOrigins(process.env),
  release: process.env.VERCEL_GIT_COMMIT_SHA || null,
  gitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
  // Opt-in only after backend CORS/schema rollout and privacy/load verification.
  coreOperationCorrelationEnabled: process.env.AVER_CORE_OPERATION_CORRELATION_ENABLED === 'true',
  // Separate strict admission protocol; requires 247–250, capture enrollment
  // and backend flag. Never infer activation from optional observation flags.
  writingAdmissionEnabled: process.env.AVER_WRITING_ADMISSION_ENABLED === 'true',
};

if (vercelEnv && vercelEnv !== 'production') {
  const leaked = PRODUCTION_ORIGIN_MARKERS.filter((m) =>
    [config.apiBase, config.supabaseUrl].some((v) => v && v.includes(m)),
  );
  if (leaked.length) {
    console.error(
      `runtime-config: REFUSING to build — VERCEL_ENV=${vercelEnv} resolved to ` +
      `production origin(s): ${leaked.join(', ')}. Preview/staging must have ` +
      'zero production egress (plan §7.1 / Gate A).',
    );
    process.exit(1);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = process.env.AVER_RUNTIME_CONFIG_OUT ||
  path.join(__dirname, '..', 'public', 'js', 'runtime-config.js');

const banner =
  '// GENERATED FILE — do not edit by hand.\n' +
  '// Source: frontend/tooling/generate-runtime-config.mjs (plan §7.1 / ADR-006).\n' +
  '// The committed copy is the UNCONFIGURED default (all null → consumers keep\n' +
  '// legacy behavior). Vercel builds overwrite it per environment.\n';

writeFileSync(outPath, banner + 'window.__AVER_RUNTIME_CONFIG__ = Object.freeze(' +
  JSON.stringify(config, null, 2) + ');\n');
console.log(`runtime-config: wrote ${outPath} (environment=${config.environment})`);
