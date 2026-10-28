// Public browser origins per deployment — the single resolution shared by the
// runtime-config generator (what the browser is told to call) and the
// Content-Security-Policy builder (what the browser is allowed to call).
// Keeping both on one function is what stops the CSP connect-src from drifting
// away from the API/Supabase origins actually shipped in runtime-config.js.
//
// Resolution (plan §7.1 / ADR-006):
//   no VERCEL_ENV (local/manual)  → UNCONFIGURED (all null): consumers keep
//                                   their legacy behavior (hostname inference)
//   VERCEL_ENV=production         → production origins
//   VERCEL_ENV=preview|development→ staging origins — NEVER production
//   AVER_API_BASE / AVER_SUPABASE_URL / AVER_SUPABASE_ANON_KEY /
//   AVER_ENVIRONMENT              → explicit per-field overrides
//
// All values below are PUBLIC (they ship to every browser today).

export const PROD = Object.freeze({
  environment: 'production',
  apiBase: 'https://ielts-speaking-coach-production.up.railway.app',
  supabaseUrl: 'https://huwsmtubwulikhlmcirx.supabase.co',
  supabaseAnonKey: 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao',
});

// NOTE (review 2026-07-13): generated *.vercel.app preview URLs are NOT in
// the backend CORS allowlist (an exact list in backend/main.py) — API
// calls from such previews fail in the browser BY DESIGN: plan §7.1 limits
// random PR previews to public/read-only checks and forbids wildcard
// *.vercel.app CORS. The authenticated preview surface is the fixed staging
// host staging.averlearning.com (branch `staging`), which passes CORS today.
export const STAGING = Object.freeze({
  environment: 'staging',
  apiBase: 'https://ielts-speaking-coach-staging.up.railway.app',
  supabaseUrl: 'https://zjphffoujxkpltixsbzj.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqcGhmZm91anhrcGx0aXhzYnpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMTA5ODUsImV4cCI6MjA5MjU4Njk4NX0.A8CSIWH-_p8baHBSGDaNJ2kWyQVgZOLlSX3dD1lOuGU',
});

export const UNCONFIGURED = Object.freeze({
  environment: null,
  apiBase: null,
  supabaseUrl: null,
  supabaseAnonKey: null,
});

export const PRODUCTION_ORIGIN_MARKERS = Object.freeze([
  'ielts-speaking-coach-production.up.railway.app',
  'huwsmtubwulikhlmcirx',
]);

/** Environment + API/Supabase values the browser receives for this build. */
export function resolveRuntimeOrigins(env = process.env) {
  const vercelEnv = env.VERCEL_ENV || '';
  const base =
    vercelEnv === 'production' ? PROD :
    vercelEnv ? STAGING :
    UNCONFIGURED;
  return {
    ...base,
    ...(env.AVER_ENVIRONMENT ? { environment: env.AVER_ENVIRONMENT } : {}),
    ...(env.AVER_API_BASE ? { apiBase: env.AVER_API_BASE } : {}),
    ...(env.AVER_SUPABASE_URL ? { supabaseUrl: env.AVER_SUPABASE_URL } : {}),
    ...(env.AVER_SUPABASE_ANON_KEY ? { supabaseAnonKey: env.AVER_SUPABASE_ANON_KEY } : {}),
  };
}
