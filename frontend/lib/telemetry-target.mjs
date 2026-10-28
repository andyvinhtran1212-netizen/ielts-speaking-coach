// Q-89 — analytics and Web Vitals beacons never reach the PRODUCTION API from a
// local, dev or test build.
//
// An unconfigured build (no VERCEL_ENV: `next dev`, a plain local `next build`,
// the committed runtime-config.js) has apiBase=null, and api.js then infers the
// API from the hostname: every non-loopback host — staging.localhost behind a
// perf proxy, a LAN IP — falls through to the production Railway URL. A local
// perf run sent a page_view into production analytics that way.
//
// Rule: a production API target is allowed only for a production build
// (runtime-config environment / VERCEL_ENV = 'production') or a page served
// from the production site. Every other target (staging, localhost, fixtures)
// is unchanged. public/js/analytics-beacon.js carries an ES5 copy of this rule;
// tests/telemetry-target.test.mjs keeps the two in step.

export const PRODUCTION_API_HOST = 'ielts-speaking-coach-production.up.railway.app';
export const PRODUCTION_SITE_HOSTS = Object.freeze(['averlearning.com', 'www.averlearning.com']);

/** Whether a telemetry beacon may be sent to `apiBase` from this build/page. */
export function allowsTelemetryTarget(apiBase, { environment, hostname } = {}) {
  if (!apiBase) return false;
  if (!String(apiBase).includes(PRODUCTION_API_HOST)) return true;
  return environment === 'production'
    || PRODUCTION_SITE_HOSTS.includes(String(hostname || '').toLowerCase());
}
