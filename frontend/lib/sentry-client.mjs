// PC-J597: browser error reporting (@sentry/browser via lib/sentry-sdk.mjs).
//
// Off unless NEXT_PUBLIC_SENTRY_DSN is built in: otherwise the SDK chunk is
// never requested. When on: no replay, no feedback widget, no default PII, low
// trace sampling, no trace headers on any request (the API's CORS allowlist has
// no sentry-trace/baggage), and every event is scrubbed before it is sent — no
// user, cookies, request body or query string, only the User-Agent header, and
// URLs, e-mail addresses, UUIDs and credentials removed from every string.
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

export function scrubText(text) {
  return text
    .replace(URL_QUERY, '$1')
    .replace(PATH_QUERY, '$1$2')
    .replace(SHARE_PATH, '$1[redacted]')
    .replace(JWT, '[jwt]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(EMAIL, '[email]')
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
  };
}

/**
 * Load the SDK and initialise it, only when a DSN is built in. A failed chunk
 * load is reported to the console, never thrown into page startup.
 */
export function initSentryClient(config, loadSdk) {
  const options = sentryClientOptions(config);
  if (!options) return Promise.resolve(false);
  return Promise.resolve()
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
      return true;
    })
    .catch((error) => {
      console.warn('[sentry] not initialised:', error && error.name ? error.name : 'error');
      return false;
    });
}
