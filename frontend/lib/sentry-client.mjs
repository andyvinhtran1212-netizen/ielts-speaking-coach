// PC-J597: browser error reporting (@sentry/browser via lib/sentry-sdk.mjs).
//
// Off unless NEXT_PUBLIC_SENTRY_DSN is built in: otherwise the SDK chunk is
// never requested. When on: no replay, no feedback widget, no default PII, low
// trace sampling, no trace headers on any request (the API's CORS allowlist has
// no sentry-trace/baggage), and every event is scrubbed before it is sent — no
// user, cookies, request body or query string, only the User-Agent header, and
// URLs, e-mail addresses, Vietnamese phone numbers, UUIDs, credentials and
// Postgres row/key values removed from every string. Console breadcrumbs are dropped: console.* lines carry free
// text (API error bodies, learner input) the patterns cannot recognise
// (PC-J601 C2).
// connect-src lists the DSN origin (tooling/content-security-policy.mjs).

export const TRACES_SAMPLE_RATE = 0.05;
const ALLOWED_HEADERS = new Set(['user-agent']);
const DROPPED_INTEGRATIONS = /replay|feedback/i;

const URL_QUERY = /(\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s?#'"<>]*)[?#][^\s'"<>]*/g;
const PATH_QUERY = /(^|[\s'"(])(\/[^\s?#'"<>]*)[?#][^\s'"<>]*/g;
const SHARE_PATH = /(\/test\/share\/)[^/?#\s'"<>]+/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
// Same rule as backend services/sentry_setup.py: a value may contain ")." or
// ") already exists" and the message may be truncated, so redact from a
// Postgres row dump / key value to the end of the string, in any case and
// spacing (PC-J625).
const FAILING_ROW = /(Failing\s*row\s*contains\s*)\([\s\S]*/gi;
const KEY_VALUE = /(Key\s*\([\s\S]*?\)\s*=\s*)\([\s\S]*/gi;
// A bare Vietnamese phone number, with optional whitespace, dots or hyphens
// between digits, not inside a longer id (same rule as the backend, PC-J644).
// The prefix is captured: no lookbehind for older Safari. Names in
// free text are not recognised.
const VN_PHONE = /(^|[^0-9A-Za-z_-])(?:\+?84|0)(?:[\s.-]?\d){9,10}(?![0-9A-Za-z_]|-[0-9A-Za-z])/g;

// Shared with boundary reporting so an early React failure waits for the lazy
// SDK initialisation. No DSN (or a failed load) leaves reporting disabled.
let clientReady = Promise.resolve(null);

export function captureException(error, context) {
  return clientReady.then((Sentry) => Sentry?.captureException(error, context));
}

export function scrubText(text) {
  return text
    .replace(FAILING_ROW, '$1[redacted]')
    .replace(KEY_VALUE, '$1[redacted]')
    .replace(URL_QUERY, '$1')
    .replace(PATH_QUERY, '$1$2')
    .replace(SHARE_PATH, '$1[redacted]')
    .replace(JWT, '[jwt]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(EMAIL, '[email]')
    .replace(VN_PHONE, '$1[redacted]')
    .replace(UUID, '[uuid]');
}

function scrub(value) {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  }
  return value;
}

/** beforeSend / beforeSendTransaction. Returns null (drop) if scrubbing fails. */
export function scrubSentryEvent(event) {
  try {
    const copy = { ...event };
    delete copy.user;
    if (copy.request && typeof copy.request === 'object') {
      const { cookies, data, query_string: query, env, headers, ...request } = copy.request;
      if (headers && typeof headers === 'object') {
        request.headers = Object.fromEntries(
          Object.entries(headers).filter(([name]) => ALLOWED_HEADERS.has(name.toLowerCase())));
      }
      copy.request = request;
    }
    return scrub(copy);
  } catch {
    return null;
  }
}

/** beforeBreadcrumb: drop console breadcrumbs, keep the rest (scrubbed with the event). */
export function filterSentryBreadcrumb(breadcrumb) {
  return breadcrumb && breadcrumb.category === 'console' ? null : breadcrumb;
}

/** Sentry.init options for this build, or null when no DSN is built in. */
export function sentryClientOptions({ dsn, environment, release } = {}) {
  const value = typeof dsn === 'string' ? dsn.trim() : '';
  if (!value) return null;
  return {
    dsn: value,
    environment: environment || 'development',
    ...(release ? { release } : {}),
    sendDefaultPii: false,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    tracePropagationTargets: [],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent,
    beforeBreadcrumb: filterSentryBreadcrumb,
  };
}

/**
 * Load the SDK and initialise it, only when a DSN is built in. A failed chunk
 * load is reported to the console, never thrown into page startup.
 */
export function initSentryClient(config, loadSdk) {
  const options = sentryClientOptions(config);
  if (!options) {
    clientReady = Promise.resolve(null);
    return Promise.resolve(false);
  }
  clientReady = Promise.resolve()
    .then(loadSdk)
    .then((Sentry) => {
      const extra = typeof Sentry.browserTracingIntegration === 'function' ? [Sentry.browserTracingIntegration()] : [];
      Sentry.init({
        ...options,
        integrations: (defaults) => [
          ...defaults.filter((integration) => !DROPPED_INTEGRATIONS.test(integration.name)),
          ...extra,
        ],
      });
      return Sentry;
    })
    .catch((error) => {
      console.warn('[sentry] not initialised:', error && error.name ? error.name : 'error');
      return null;
    });
  return clientReady.then((Sentry) => Sentry !== null);
}
