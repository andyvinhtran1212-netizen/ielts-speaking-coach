import type { Instrumentation } from 'next';

// Reuse the existing DSN. Disabled reporting must not load or initialise an SDK.
export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()) return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Next invokes this for RSC, route handler and edge request failures. Await the
// import so capture is scheduled before this hook resolves in a short-lived worker.
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()) return;
  const { captureRequestError } = await import('@sentry/nextjs');
  captureRequestError(...args);
};
