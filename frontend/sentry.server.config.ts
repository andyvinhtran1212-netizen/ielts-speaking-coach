import { init } from '@sentry/nextjs';
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
  // Next supplies request context via onRequestError. These integrations would
  // add process/request session envelopes, which bypass the event scrubber.
  // Source context is free text too; stack locations are sufficient here.
  integrations: (defaults) => defaults.filter(({ name }) => !['ProcessSession', 'Http', 'ContextLines', 'LocalVariables'].includes(name)),
});
