// C-04 — API base the landing page falls back to when runtime-config.js did
// not supply one (the committed/local config has apiBase=null, or the script
// failed to load).
//
// Only the fixed, known hosts map to an API; every other host (random
// *.vercel.app previews, LAN IPs, perf proxies) stays fail-closed with null so
// a non-production page never guesses the production API. The staging site
// maps to the STAGING API, never production. Values mirror
// tooling/runtime-origins.mjs; tests/landing-api-base.test.mjs keeps them in step.

export const LANDING_FALLBACK_API_BASES = Object.freeze({
  localhost: 'http://localhost:8000',
  '127.0.0.1': 'http://localhost:8000',
  'staging.averlearning.com': 'https://ielts-speaking-coach-staging.up.railway.app',
  'averlearning.com': 'https://ielts-speaking-coach-production.up.railway.app',
  'www.averlearning.com': 'https://ielts-speaking-coach-production.up.railway.app',
});

/** Fallback API base for a known landing host, else null (fail-closed). */
export function fallbackApiBase(hostname) {
  const host = String(hostname || '').toLowerCase();
  return Object.hasOwn(LANDING_FALLBACK_API_BASES, host)
    ? LANDING_FALLBACK_API_BASES[host]
    : null;
}
