// PC-J597: browser Sentry is off without a DSN and scrubs every event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  filterSentryBreadcrumb,
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
  assert.equal(options.beforeBreadcrumb, filterSentryBreadcrumb);
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

// PC-J601 C1: the exact strings from the SA probe (/workspace/qa/pr2232/scrub_probe.txt).
test('Postgres row dumps and key values are redacted (SA probe strings)', () => {
  assert.equal(scrubText(`Failing row contains (${USER_ID}, Nguyen Van A, 0901234567, a@b.com).`),
    'Failing row contains [redacted]');
  assert.equal(scrubText('Failing row contains (uuid:666ff6ccaa5b, Nguyen Van A, 0901234567, [email]).'),
    'Failing row contains [redacted]');
  assert.equal(scrubText('DETAIL: Key (phone)=(0901234567) already exists.'),
    'DETAIL: Key (phone)=[redacted]');
  assert.equal(scrubText('GET https://x.supabase.co/rest/v1/t failed'), 'GET https://x.supabase.co/rest/v1/t failed');
  // Values containing ")" / "." / newlines, truncated messages, other DETAIL forms.
  // Redaction runs to the end of the string: an embedded ")." or ") already exists"
  // cannot be told apart from the real end of the dump.
  for (const [input, expected] of [
    [`{"details":"Failing row contains (1, Tran (B). x, 0901234567).","code":"23514"}`,
      '{"details":"Failing row contains [redacted]'],
    ['Failing row contains (x, Nguyen (A), line1\nline2 0901234567', 'Failing row contains [redacted]'],
    ['Key (lower(email::text))=(a@b.com) already exists.', 'Key (lower(email::text))=[redacted]'],
    ['Key (user_id)=(Nguyen) is not present in table "users".', 'Key (user_id)=[redacted]'],
    ['Key (a)=(1) conflicts with existing key (a)=(0901234567).', 'Key (a)=[redacted]'],
    ['Key (phone)=(090 (x) 1234', 'Key (phone)=[redacted]'],
    // PR #2234 R1 (CR P2-1 / Codex): truncated dumps with an embedded terminator
    ['Failing row contains (1, Tran (B). x, 0901234567', 'Failing row contains [redacted]'],
    ['Key (name)=(Tran (B) already exists, 0901234567', 'Key (name)=[redacted]'],
    ['Key (note)=(see (a). Nguyen 0901234567', 'Key (note)=[redacted]'],
  ]) {
    assert.equal(scrubText(input), expected, input);
  }
  const event = scrubSentryEvent({ exception: { values: [{ type: 'Error', value: 'Failing row contains (Nguyen Van A, 0901234567).' }] } });
  assert.equal(event.exception.values[0].value, 'Failing row contains [redacted]');
});

// PC-J625: the SA probe of PR #2234 R4 (/workspace/qa/pr2234/probes.txt), lines that passed
// through unredacted at d350ddb47; same expectations as backend/tests/test_sentry_setup.py.
test('dump tokens in any case and spacing, and bare VN phone numbers, are redacted', () => {
  for (const [input, expected] of [
    ['key (phone)=(0901234567) already exists.', 'key (phone)=[redacted]'],
    ['Key  (phone)=(0901234567) already exists.', 'Key  (phone)=[redacted]'],
    ['Failing row contains(Nguyen Van A, 0901234567)', 'Failing row contains[redacted]'],
    ['Failing  row contains (Nguyen Van A, 0901234567)', 'Failing  row contains [redacted]'],
    ['Key (phone) = (0901234567)', 'Key (phone) = [redacted]'],
    ['Learner Nguyễn Văn A phone +84901234567 said: my transcript here',
      'Learner Nguyễn Văn A phone [redacted] said: my transcript here'],
    ['FAILING ROW CONTAINS (Nguyen Van A)', 'FAILING ROW CONTAINS [redacted]'],
    ['DETAIL:\tKEY\n(phone)\n=\n(0901234567)', 'DETAIL:\tKEY\n(phone)\n=\n[redacted]'],
    ['call 0901234567 now', 'call [redacted] now'],
    ['sdt:0912345678, 84901234567; (+840901234567)', 'sdt:[redacted], [redacted]; ([redacted])'],
    ['0901234567\n0912345678', '[redacted]\n[redacted]'],
    // Not phone numbers: a longer digit run, digits inside an id, a 9-digit number, a UUID.
    ['ts 1730701234567 n 090123456789012', 'ts 1730701234567 n 090123456789012'],
    ['req-0901234567 job_0901234567 v0901234567x', 'req-0901234567 job_0901234567 v0901234567x'],
    ['count 090123456', 'count 090123456'],
    ['id 11111111-2222-4333-8444-090123456789', 'id [uuid]'],
  ]) {
    assert.equal(scrubText(input), expected, input);
  }
  const event = scrubSentryEvent({ exception: { values: [{ type: 'Error', value: 'Learner Nguyễn Văn A phone +84901234567' }] } });
  assert.equal(event.exception.values[0].value, 'Learner Nguyễn Văn A phone [redacted]');
});

// PC-J644: SA retest #2247 found separated phones outside row dumps.
test('VN phones with separators are redacted; dates and ids are preserved', () => {
  for (const phone of [
    '+84 90 123 4567', '090-123-4567', '090.123.4567',
    '84 90 123 4567', '090 123 4567', '+84-90.123 4567',
  ]) {
    assert.equal(scrubText(phone), '[redacted]', phone);
    const text = `call ${phone} now`;
    assert.equal(scrubText(text), 'call [redacted] now', phone);
    const event = scrubSentryEvent({ exception: { values: [{ type: 'Error', value: text }] } });
    assert.equal(event.exception.values[0].value, 'call [redacted] now', phone);
  }
  for (const text of ['order 2026-11-04', 'user_0901234567']) {
    assert.equal(scrubText(text), text);
  }
});

// PC-J601 C2: console.* text is free-form (API error bodies, learner input).
test('console breadcrumbs are dropped; other breadcrumbs are kept', () => {
  assert.equal(filterSentryBreadcrumb({ category: 'console', level: 'error', message: 'Nguyen Van A 0901234567' }), null);
  const fetchCrumb = { category: 'fetch', data: { url: 'https://api.example/x' } };
  assert.equal(filterSentryBreadcrumb(fetchCrumb), fetchCrumb);
  const navigation = { category: 'navigation', data: { from: '/a', to: '/b' } };
  assert.equal(filterSentryBreadcrumb(navigation), navigation);
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
