import { httpIntegration, init } from '@sentry/nextjs';
import { sentryServerOptions } from './lib/sentry-server.mjs';

const options = sentryServerOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.AVER_SENTRY_ENVIRONMENT,
  release: process.env.AVER_SENTRY_RELEASE,
});

if (options) init({
  ...options,
  enableOpenTelemetrySetup: false,
  includeLocalVariables: false,
  // Next supplies request context via onRequestError. ProcessSession and the
  // default Http (sessions on) would add session envelopes, which bypass the
  // event scrubber. Source context is free text too; stack locations suffice.
  // Http is re-added for per-request isolation only: without it a warm worker
  // shares one scope, so request A's fetch breadcrumbs land on request B's
  // error (PC-J677 R2 P2-1). No sessions, spans or request bodies.
  integrations: (defaults) => [
    ...defaults.filter(({ name }) => !['ProcessSession', 'Http', 'ContextLines', 'LocalVariables'].includes(name)),
    httpIntegration({ sessions: false, spans: false, disableIncomingRequestSpans: true, maxRequestBodySize: 'none' }),
  ],
});
