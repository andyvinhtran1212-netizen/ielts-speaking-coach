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
// All values below are PUBLIC (they ship to every browser today).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROD = {
  environment: 'production',
  apiBase: 'https://ielts-speaking-coach-production.up.railway.app',
  supabaseUrl: 'https://huwsmtubwulikhlmcirx.supabase.co',
  supabaseAnonKey: 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao',
};

// NOTE (review 2026-07-13): generated *.vercel.app preview URLs are NOT in
// the backend CORS allowlist (only *.averlearning.com subdomains are) — API
// calls from such previews fail in the browser BY DESIGN: plan §7.1 limits
// random PR previews to public/read-only checks and forbids wildcard
// *.vercel.app CORS. The authenticated preview surface is the fixed staging
// host staging.averlearning.com (branch `staging`), which passes CORS today.
const STAGING = {
  environment: 'staging',
  apiBase: 'https://ielts-speaking-coach-staging.up.railway.app',
  supabaseUrl: 'https://zjphffoujxkpltixsbzj.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqcGhmZm91anhrcGx0aXhzYnpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMTA5ODUsImV4cCI6MjA5MjU4Njk4NX0.A8CSIWH-_p8baHBSGDaNJ2kWyQVgZOLlSX3dD1lOuGU',
};

const UNCONFIGURED = {
  environment: null,
  apiBase: null,
  supabaseUrl: null,
  supabaseAnonKey: null,
};

const PRODUCTION_ORIGIN_MARKERS = [
  'ielts-speaking-coach-production.up.railway.app',
  'huwsmtubwulikhlmcirx',
];

const vercelEnv = process.env.VERCEL_ENV || '';
const base =
  vercelEnv === 'production' ? PROD :
  vercelEnv ? STAGING :
  UNCONFIGURED;

const config = {
  ...base,
  ...(process.env.AVER_ENVIRONMENT ? { environment: process.env.AVER_ENVIRONMENT } : {}),
  ...(process.env.AVER_API_BASE ? { apiBase: process.env.AVER_API_BASE } : {}),
  ...(process.env.AVER_SUPABASE_URL ? { supabaseUrl: process.env.AVER_SUPABASE_URL } : {}),
  ...(process.env.AVER_SUPABASE_ANON_KEY ? { supabaseAnonKey: process.env.AVER_SUPABASE_ANON_KEY } : {}),
  release: process.env.VERCEL_GIT_COMMIT_SHA || null,
  gitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
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
