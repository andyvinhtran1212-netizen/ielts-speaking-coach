// Runtime-neutral privacy rules are shared with the browser. This module never
// imports its lazy browser SDK and is only reached from server instrumentation.
import { filterSentryBreadcrumb, scrubSentryEvent } from './sentry-client.mjs';

// Match backend/services/sentry_setup.py: free-text logs are allowed only from
// the audited "main" logger. Console breadcrumbs remain disabled in both SDKs.
export function filterSentryServerBreadcrumb(breadcrumb) {
  if (breadcrumb?.type === 'log' && breadcrumb.category !== 'main') return null;
  return filterSentryBreadcrumb(breadcrumb);
}

export function scrubSentryServerEvent(event) {
  const scrubbed = scrubSentryEvent(event);
  if (scrubbed?.logger && scrubbed.logger !== 'main') return null;
  if (scrubbed?.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.filter(filterSentryServerBreadcrumb);
  }
  return scrubbed;
}

export function sentryServerOptions({ dsn, environment, release } = {}) {
  const value = typeof dsn === 'string' ? dsn.trim() : '';
  if (!value) return null;
  return {
    dsn: value,
    environment: environment || 'development',
    ...(release ? { release } : {}),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    tracePropagationTargets: [],
    enableLogs: false,
    beforeSend: scrubSentryServerEvent,
    beforeBreadcrumb: filterSentryServerBreadcrumb,
  };
}
