// PC-J597: the only module that imports the Sentry SDK. instrumentation-client
// loads it with import(), so it is its own chunk, fetched only when a DSN is
// built in; named re-exports keep replay/feedback out of that chunk.
// @sentry/browser, not @sentry/nextjs: the nextjs client init always bundles
// Next's Pages Router (next/router → structuredClone, Safari 15.4), which the
// iOS 15 floor in tooling/legacy-browser-scan.mjs rejects.
export { browserTracingIntegration, captureException, init } from '@sentry/browser';
