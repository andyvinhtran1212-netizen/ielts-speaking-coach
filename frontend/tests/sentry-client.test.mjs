// PC-J597: browser Sentry is off without a DSN and scrubs every event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initSentryClient,
  scrubSentryEvent,
  scrubText,
  sentryClientOptions,
  TRACES_SAMPLE_RATE,
} from '../lib/sentry-client.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DSN = 'https://publickey@o42.ingest.us.sentry.io/7';
const USER_ID = '11111111-2222-4333-8444-555555555555';

test('no DSN: no options, and the SDK chunk is never loaded', async () => {
  for (const dsn of [undefined, '', '   ']) {
    assert.equal(sentryClientOptions({ dsn }), null);
    let loads = 0;
    assert.equal(await initSentryClient({ dsn }, () => { loads += 1; return {}; }), false);
    assert.equal(loads, 0);
  }
});

test('with a DSN: no PII, no replay or feedback, low sampling, no trace headers', async () => {
  const options = sentryClientOptions({ dsn: ` ${DSN} `, environment: 'staging', release: 'abc' });
  assert.equal(options.dsn, DSN);
  assert.equal(options.environment, 'staging');
  assert.equal(options.release, 'abc');
  assert.equal(options.sendDefaultPii, false);
  assert.ok(options.tracesSampleRate > 0 && options.tracesSampleRate <= 0.05);
  assert.equal(options.tracesSampleRate, TRACES_SAMPLE_RATE);
  assert.deepEqual(options.tracePropagationTargets, []);
  assert.equal(options.replaysSessionSampleRate, 0);
  assert.equal(options.replaysOnErrorSampleRate, 0);
  assert.equal(options.beforeSend, scrubSentryEvent);
  assert.equal(options.beforeSendTransaction, scrubSentryEvent);
  assert.equal(sentryClientOptions({ dsn: DSN }).environment, 'development');

  const inits = [];
  const sdk = { init: (o) => inits.push(o), browserTracingIntegration: () => ({ name: 'BrowserTracing' }) };
  assert.equal(await initSentryClient({ dsn: DSN, environment: 'staging' }, async () => sdk), true);
  assert.equal(inits.length, 1);
  assert.equal(inits[0].dsn, DSN);
  assert.equal(inits[0].beforeSend, scrubSentryEvent);
  const kept = inits[0].integrations([
    { name: 'GlobalHandlers' }, { name: 'Replay' }, { name: 'ReplayCanvas' }, { name: 'Feedback' }, { name: 'Dedupe' },
  ]).map((integration) => integration.name);
  assert.deepEqual(kept, ['GlobalHandlers', 'Dedupe', 'BrowserTracing']);
});

test('a failed SDK chunk load is not thrown into page startup', async () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.equal(await initSentryClient({ dsn: DSN }, () => Promise.reject(new TypeError('chunk'))), false);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, ['[sentry] not initialised: TypeError']);
});

test('scrubbing removes user, cookies, body, query strings and all but the User-Agent header', () => {
  const event = scrubSentryEvent({
    user: { id: USER_ID, email: 'learner@example.com', ip_address: '1.2.3.4' },
    request: {
      url: 'https://staging.averlearning.com/reading/exam/session?share=SHARETOKEN#x',
      query_string: 'share=SHARETOKEN',
      cookies: { sb: 'COOKIEVAL' },
      data: { essay: 'my essay' },
      headers: { 'User-Agent': 'ua', Referer: 'https://staging.averlearning.com/login?code=OAUTHCODE', Cookie: 'sb=COOKIEVAL' },
    },
    exception: { values: [{ type: 'Error', value: `fetch https://api.example/api/reading/test/share/SHARETOKEN/boot?x=1 failed for learner@example.com ${USER_ID}` }] },
    breadcrumbs: [
      { category: 'navigation', data: { from: '/login?code=OAUTHCODE', to: `/practice/session?session_id=${USER_ID}` } },
      { category: 'fetch', data: { url: 'https://db.supabase.co/rest/v1/users?email=eq.learner%40example.com' } },
      { category: 'console', message: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2ln Bearer AUTHTOKEN' },
    ],
  });
  assert.equal(event.user, undefined);
  assert.deepEqual(event.request, {
    url: 'https://staging.averlearning.com/reading/exam/session',
    headers: { 'User-Agent': 'ua' },
  });
  const blob = JSON.stringify(event);
  for (const secret of ['SHARETOKEN', 'COOKIEVAL', 'my essay', 'OAUTHCODE', 'learner@example.com', 'learner%40example.com',
    USER_ID, 'eyJhbGci', 'AUTHTOKEN', '1.2.3.4']) {
    assert.ok(!blob.includes(secret), secret);
  }
  assert.deepEqual(event.breadcrumbs[0].data, { from: '/login', to: '/practice/session' });
  assert.equal(event.breadcrumbs[1].data.url, 'https://db.supabase.co/rest/v1/users');
  assert.equal(scrubText(`user ${USER_ID} a@b.co`), 'user [uuid] [email]');
});

test('an event that cannot be scrubbed is dropped, not sent raw', () => {
  const event = { request: { headers: {} } };
  Object.defineProperty(event.request, 'url', { enumerable: true, get() { throw new Error('boom'); } });
  assert.equal(scrubSentryEvent(event), null);
});

test('instrumentation-client loads the SDK lazily from the built-in DSN, after the polyfills', () => {
  const source = readFileSync(path.join(ROOT, 'instrumentation-client.ts'), 'utf8');
  assert.match(source, /process\.env\.NEXT_PUBLIC_SENTRY_DSN/);
  assert.match(source, /\(\) => import\('\.\/lib\/sentry-sdk\.mjs'\)/);
  assert.doesNotMatch(source, /@sentry\//);
  assert.ok(source.indexOf("import './lib/polyfills/legacy-safari.js'") < source.indexOf('initSentryClient'));
  // Named re-exports only, so the lazy chunk carries no replay/feedback code.
  const sdk = readFileSync(path.join(ROOT, 'lib/sentry-sdk.mjs'), 'utf8');
  assert.match(sdk, /^export \{ browserTracingIntegration, init \} from '@sentry\/browser';$/m);
  const code = sdk.split('\n').filter((line) => !line.startsWith('//')).join('\n');
  assert.doesNotMatch(code, /export \*|import\(|^import /m);
  // No build plugin: withSentryConfig would add source map upload and tunnel routes.
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8'), /withSentryConfig|@sentry/);
});
