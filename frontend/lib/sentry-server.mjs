// Runtime-neutral privacy rules are shared with the browser. This module never
// imports its lazy browser SDK and is only reached from server instrumentation.
import { filterSentryBreadcrumb, scrubSentryEvent } from './sentry-client.mjs';

// Server fetches carry learner input in the query (grammar search q=...). The
// SDK puts it in breadcrumb data fields (http.query, http.fragment), not the
// url, so the text scrubber never sees it: drop every query/fragment field and
// cut data.url at ?/#, whatever the integration config (PC-J677 P1-1).
const QUERY_DATA_KEY = /query|fragment/i;
const URL_SUFFIX = /[?#][\s\S]*/;
// A percent-encoded e-mail (learner%40example.com, also double-encoded %2540)
// has no literal "@" for the shared EMAIL pattern.
const ENCODED_EMAIL = /[A-Za-z0-9._%+-]+%(?:25)*40[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function stripBreadcrumbQuery(breadcrumb) {
  const data = breadcrumb.data;
  if (!data || typeof data !== 'object') return breadcrumb;
  const kept = Object.fromEntries(Object.entries(data).filter(([key]) => !QUERY_DATA_KEY.test(key)));
  if (typeof kept.url === 'string') kept.url = kept.url.replace(URL_SUFFIX, '');
  return { ...breadcrumb, data: kept };
}

function redactEncodedEmails(value) {
  if (typeof value === 'string') return value.replace(ENCODED_EMAIL, '[email]');
  if (Array.isArray(value)) return value.map(redactEncodedEmails);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactEncodedEmails(item)]));
  }
  return value;
}

// Match backend/services/sentry_setup.py: free-text logs are allowed only from
// the audited "main" logger. Console breadcrumbs remain disabled in both SDKs.
export function filterSentryServerBreadcrumb(breadcrumb) {
  if (breadcrumb?.type === 'log' && breadcrumb.category !== 'main') return null;
  const kept = filterSentryBreadcrumb(breadcrumb);
  return kept ? stripBreadcrumbQuery(kept) : kept;
}

export function scrubSentryServerEvent(event) {
  try {
    const scrubbed = scrubSentryEvent(event);
    if (scrubbed?.logger && scrubbed.logger !== 'main') return null;
    if (scrubbed?.breadcrumbs) {
      scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(filterSentryServerBreadcrumb).filter(Boolean);
    }
    return redactEncodedEmails(scrubbed);
  } catch {
    return null;
  }
}

export function sentryServerOptions({ dsn, environment, release } = {}) {
  const value = typeof dsn === 'string' ? dsn.trim() : '';
  if (!value) return null;
  return {
    dsn: value,
    environment: environment || 'development',
    ...(release ? { release } : {}),
    sendDefaultPii: false,
    // Tracing off, not sampled at 0: a rate of 0 still enables spans, and a
    // sampled incoming sentry-trace header then ships them without beforeSend
    // (PC-J677 R3 P1-1). null also stops SENTRY_TRACES_SAMPLE_RATE re-enabling
    // it (the SDK reads that env only when the option is undefined).
    tracesSampleRate: null,
    tracePropagationTargets: [],
    enableLogs: false,
    // Fetch/http integrations then record no query string at all.
    dataCollection: { urlQueryParams: false },
    beforeSend: scrubSentryServerEvent,
    beforeBreadcrumb: filterSentryServerBreadcrumb,
  };
}
