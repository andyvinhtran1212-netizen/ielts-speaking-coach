import { init } from '@sentry/nextjs';
import { sentryServerOptions } from './lib/sentry-server.mjs';

const options = sentryServerOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.AVER_SENTRY_ENVIRONMENT,
  release: process.env.AVER_SENTRY_RELEASE,
});

if (options) init(options);
