// PC-J677: execute the Next hooks/configs and the real SDK with an in-memory
// transport. All DSNs and private values below are synthetic test fixtures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { scrubSentryEvent } from '../lib/sentry-client.mjs';
import * as server from '../lib/sentry-server.mjs';

const require = createRequire(import.meta.url);
const DSN = 'https://publickey@o42.ingest.us.sentry.io/7';
const enabled = { NEXT_PUBLIC_SENTRY_DSN: DSN, AVER_SENTRY_ENVIRONMENT: 'staging', AVER_SENTRY_RELEASE: 'j677' };

function loadTs(filename, env, modules = {}) {
  const source = readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'process', compiled)((name) => {
    assert.ok(Object.hasOwn(modules, name), `unexpected module load: ${name}`);
    return modules[name];
  }, exports, { env });
  return exports;
}

test('missing/blank DSN: register and onRequestError do not load any SDK or config', async () => {
  for (const dsn of [undefined, '', '   ']) {
    assert.equal(server.sentryServerOptions({ dsn }), null);
    for (const runtime of ['nodejs', 'edge']) {
      const env = { NEXT_PUBLIC_SENTRY_DSN: dsn, NEXT_RUNTIME: runtime };
      const hooks = loadTs('instrumentation.ts', env);
      await hooks.register();
      await hooks.onRequestError(new Error('disabled'), {}, {});
      for (const file of ['sentry.server.config.ts', 'sentry.edge.config.ts']) {
        loadTs(file, env, {
          '@sentry/nextjs': { init() { assert.fail('disabled init'); } },
          './lib/sentry-server.mjs': server,
        });
      }
    }
  }
});

test('register selects only its runtime config; unsupported runtimes load neither', async () => {
  for (const runtime of ['nodejs', 'edge', undefined]) {
    const loaded = [];
    const modules = {};
    for (const name of ['./sentry.server.config', './sentry.edge.config']) {
      Object.defineProperty(modules, name, { get() { loaded.push(name); return {}; } });
    }
    await loadTs('instrumentation.ts', { ...enabled, NEXT_RUNTIME: runtime }, modules).register();
    assert.deepEqual(loaded, runtime === 'nodejs' ? ['./sentry.server.config'] : runtime === 'edge' ? ['./sentry.edge.config'] : []);
  }
});

test('node and edge configs share privacy hooks, existing tags and error-only options', () => {
  for (const file of ['sentry.server.config.ts', 'sentry.edge.config.ts']) {
    const inits = [];
    loadTs(file, enabled, {
      '@sentry/nextjs': { init: (options) => inits.push(options) },
      './lib/sentry-server.mjs': server,
    });
    assert.equal(inits.length, 1);
    const options = inits[0];
    assert.equal(options.dsn, DSN);
    assert.equal(options.environment, 'staging');
    assert.equal(options.release, 'j677');
    assert.equal(options.sendDefaultPii, false);
    assert.equal(options.tracesSampleRate, 0);
    assert.deepEqual(options.tracePropagationTargets, []);
    assert.equal(options.enableLogs, false);
    assert.deepEqual(options.dataCollection, { urlQueryParams: false });
    assert.equal(options.beforeSend, server.scrubSentryServerEvent);
    assert.equal(options.beforeBreadcrumb, server.filterSentryServerBreadcrumb);
    if (file === 'sentry.server.config.ts') {
      assert.equal(options.enableOpenTelemetrySetup, false);
      assert.equal(options.includeLocalVariables, false);
      assert.deepEqual(options.integrations(['ProcessSession', 'Http', 'ContextLines', 'LocalVariables', 'RequestData'].map((name) => ({ name }))), [{ name: 'RequestData' }]);
    }
  }
});

test('server preserves shared scrubbing and the audited main logger allowlist', () => {
  const event = {
    logger: 'main', message: 'call 0912345678 Bearer SYNTHETIC_TOKEN',
    user: { email: 'learner@example.com' },
    request: { url: 'https://example.test/api?token=SECRET', data: 'essay', cookies: 'COOKIE', headers: { Cookie: 'COOKIE' } },
  };
  assert.deepEqual(server.scrubSentryServerEvent(event), scrubSentryEvent(event));
  assert.equal(server.scrubSentryServerEvent({ ...event, logger: 'unreviewed' }), null);
  const breadcrumbs = [
    { category: 'console', message: 'private input' },
    { type: 'log', category: 'unreviewed', message: 'private input' },
    { type: 'log', category: 'main', message: 'call 0912345678' },
  ];
  assert.deepEqual(server.scrubSentryServerEvent({ breadcrumbs }).breadcrumbs, [
    { type: 'log', category: 'main', message: 'call [redacted]' },
  ]);
  for (const crumb of breadcrumbs.slice(0, 2)) assert.equal(server.filterSentryServerBreadcrumb(crumb), null);
  assert.equal(server.filterSentryServerBreadcrumb(breadcrumbs[2]), breadcrumbs[2]);
  const broken = { get message() { throw new Error('scrub failure'); } };
  assert.equal(server.scrubSentryServerEvent(broken), null);
});

test('server breadcrumbs lose query/fragment fields and url suffixes; encoded e-mails are redacted', () => {
  const crumb = {
    type: 'http', category: 'http',
    data: {
      url: 'https://api.example.test/grammar/search?q=learner%40example.com#PRIVATE_FRAGMENT',
      'http.method': 'GET', status_code: 500,
      'http.query': 'q=learner%40example.com', 'http.fragment': 'PRIVATE_FRAGMENT',
      'url.query': '?q=PRIVATE_TEXT', 'url.fragment': '#PRIVATE_FRAGMENT',
    },
  };
  const expected = { type: 'http', category: 'http', data: { url: 'https://api.example.test/grammar/search', 'http.method': 'GET', status_code: 500 } };
  assert.deepEqual(server.filterSentryServerBreadcrumb(crumb), expected);
  assert.equal(crumb.data['http.query'], 'q=learner%40example.com', 'input breadcrumb is not mutated');
  assert.deepEqual(server.filterSentryServerBreadcrumb({ category: 'fetch', data: { url: 'grammar/search?q=x' } }).data, { url: 'grammar/search' });
  const event = server.scrubSentryServerEvent({
    message: 'lookup learner%40example.com and LEARNER%2540Example.COM failed',
    breadcrumbs: [crumb, { category: 'http', message: 'q=learner%40example.com' }],
  });
  assert.equal(event.message, 'lookup [email] and [email] failed');
  assert.deepEqual(event.breadcrumbs, [expected, { category: 'http', message: 'q=[email]' }]);
});

// Server-side grammar search sends learner text in q= (lib/grammar-api.ts).
// Run a real Node fetch through the SDK's NodeFetch instrumentation, then
// capture an error: the transport must carry the breadcrumb without any query.
// The second run drops dataCollection to prove the breadcrumb filter alone holds.
for (const [label, override] of [['configured', {}], ['without dataCollection', { dataCollection: undefined }]]) {
  test(`real server fetch breadcrumb (${label}) sends no query, fragment, e-mail or learner text`, async () => {
    const Sentry = require('@sentry/nextjs');
    const envelopes = [];
    const raw = [];
    let client;
    Sentry.getIsolationScope().clearBreadcrumbs();
    Sentry.getCurrentScope().clearBreadcrumbs();
    const httpServer = createServer((request, response) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{}');
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${httpServer.address().port}`;
    loadTs('sentry.server.config.ts', enabled, {
      '@sentry/nextjs': { init: (options) => {
        client = Sentry.init({
          ...options,
          ...override,
          // Spy on what the SDK recorded before our filter ran.
          beforeBreadcrumb: (crumb, hint) => { raw.push(structuredClone(crumb)); return options.beforeBreadcrumb(crumb, hint); },
          transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }),
        });
      } },
      './lib/sentry-server.mjs': server,
    });
    const hooks = loadTs('instrumentation.ts', { ...enabled, NEXT_RUNTIME: 'nodejs' }, { '@sentry/nextjs': Sentry });
    try {
      assert.ok(client.getIntegrationByName('NodeFetch'), 'NodeFetch integration stays enabled');
      const q = encodeURIComponent('learner@example.com PRIVATE_ESSAY_TEXT');
      const response = await fetch(`${origin}/api/grammar/search?q=${q}&limit=5#PRIVATE_FRAGMENT`);
      assert.equal(response.status, 500);
      await response.text();
      await hooks.onRequestError(new Error('grammar search failed'),
        { path: '/grammar/search', method: 'GET', headers: {} },
        { routerKind: 'App Router', routePath: '/grammar/search', routeType: 'render', renderSource: 'react-server-components' });
      assert.equal(await Sentry.flush(2000), true);
      const events = envelopes.flatMap(([, items]) => items.filter(([header]) => header.type === 'event').map(([, event]) => event));
      assert.equal(events.length, 1);
      const fetchCrumbs = (events[0].breadcrumbs || []).filter((crumb) => crumb.category === 'http');
      assert.equal(fetchCrumbs.length, 1, 'the real fetch produced a breadcrumb');
      const rawData = raw.find((crumb) => crumb.category === 'http')?.data ?? {};
      const rawQuery = Object.entries(rawData).find(([key]) => /query/i.test(key))?.[1];
      // dataCollection stops the SDK recording the query; without it the SDK
      // records it (proving the filter, not the SDK, removed it below).
      if (label === 'configured') assert.equal(rawQuery, undefined);
      else assert.match(rawQuery, /learner%40example\.com/);
      assert.equal(fetchCrumbs[0].data.url, `${origin}/api/grammar/search`);
      assert.equal(fetchCrumbs[0].data.status_code, 500);
      assert.deepEqual(Object.keys(fetchCrumbs[0].data).filter((key) => /query|fragment/i.test(key)), []);
      const payload = JSON.stringify(envelopes);
      for (const privateValue of ['learner', '%40', 'example.com', 'PRIVATE_ESSAY_TEXT', 'limit=5', 'PRIVATE_FRAGMENT', q]) {
        assert.ok(!payload.includes(privateValue), `transport leaked ${privateValue}`);
      }
    } finally {
      await client.close(2000);
      Sentry.setCurrentClient(undefined);
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });
}

test('route handler and RSC errors invoke captureRequestError once and transport only scrubbed events', async () => {
  const Sentry = require('@sentry/nextjs');
  const envelopes = [];
  let captureCalls = 0;
  let client;
  loadTs('sentry.server.config.ts', enabled, {
    '@sentry/nextjs': { init: (options) => {
      client = Sentry.init({
        ...options,
        transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }),
      });
    } },
    './lib/sentry-server.mjs': server,
  });
  const hooks = loadTs('instrumentation.ts', { ...enabled, NEXT_RUNTIME: 'nodejs' }, {
    '@sentry/nextjs': { captureRequestError: (...args) => { captureCalls += 1; return Sentry.captureRequestError(...args); } },
  });
  try {
    assert.equal(client.getOptions().enableOpenTelemetrySetup, false);
    assert.equal(client.traceProvider, undefined);
    for (const routeType of ['route', 'render']) {
      Sentry.setUser({ email: 'learner@example.com', ip_address: '192.0.2.5' });
      Sentry.addBreadcrumb({ category: 'console', message: 'PRIVATE_CONSOLE_INPUT' });
      Sentry.addBreadcrumb({ type: 'log', category: 'unreviewed', message: 'PRIVATE_LOG_INPUT' });
      const args = [
        new Error(`${routeType}: 0912345678 +84 912 345 678 learner@example.com Bearer SYNTHETIC_TOKEN Failing row contains (PRIVATE_ROW)`),
        { path: '/j677?token=QUERY_SECRET', method: 'GET', headers: { 'user-agent': 'J677 mock', cookie: 'COOKIE_SECRET', authorization: 'Bearer HEADER_SECRET' } },
        { routerKind: 'App Router', routePath: '/j677', routeType, ...(routeType === 'render' ? { renderSource: 'react-server-components' } : {}) },
      ];
      const previous = captureCalls;
      await hooks.onRequestError(...args);
      assert.equal(captureCalls, previous + 1);
      assert.equal(await Sentry.flush(2000), true);
    }
    const events = envelopes.flatMap(([, items]) => items.filter(([header]) => header.type === 'event').map(([, event]) => event));
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.contexts.nextjs.route_type), ['route', 'render']);
    for (const event of events) {
      assert.equal(event.user, undefined);
      assert.equal(event.contexts.nextjs.request_path, '/j677');
      assert.equal(event.exception.values[0].mechanism.type, 'auto.function.nextjs.on_request_error');
      assert.match(event.exception.values[0].value, /\[redacted\]/);
      assert.equal(event.environment, 'staging');
      assert.equal(event.release, 'j677');
    }
    const payload = JSON.stringify(envelopes);
    for (const privateValue of ['0912345678', '+84 912 345 678', 'learner@example.com', 'SYNTHETIC_TOKEN', 'PRIVATE_ROW', 'QUERY_SECRET', 'COOKIE_SECRET', 'HEADER_SECRET', 'PRIVATE_CONSOLE_INPUT', 'PRIVATE_LOG_INPUT', '192.0.2.5']) {
      function findPaths(value, path = '') {
        if (typeof value === 'string') return value.includes(privateValue) ? [path] : [];
        return value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => findPaths(item, `${path}.${key}`)) : [];
      }
      assert.ok(!payload.includes(privateValue), `transport leaked ${privateValue} at ${findPaths(envelopes)}`);
    }
    assert.ok(envelopes.every(([, items]) => items.every(([header]) => header.type === 'event')));
  } finally {
    await client.close(2000);
    Sentry.setCurrentClient(undefined);
    Sentry.setUser(null);
  }
});

test('real edge SDK export sends one scrubbed error and no telemetry envelopes', () => {
  const script = `
    import assert from 'node:assert/strict';
    import * as Sentry from '@sentry/nextjs';
    import { sentryServerOptions } from './lib/sentry-server.mjs';
    const envelopes = [];
    Sentry.init({
      ...sentryServerOptions({ dsn: ${JSON.stringify(DSN)} }),
      transport: () => ({ send: async (event) => { envelopes.push(event); return { statusCode: 200 }; }, flush: async () => true }),
    });
    try {
      Sentry.captureRequestError(new Error('edge 0912345678 Bearer FAKE_TOKEN'),
        { path: '/edge?token=SECRET', method: 'GET', headers: { cookie: 'PRIVATE_COOKIE' } },
        { routerKind: 'App Router', routePath: '/edge', routeType: 'route' });
      assert.equal(await Sentry.flush(2000), true);
      assert.equal(envelopes.length, 1);
      assert.deepEqual(envelopes.flatMap(([, items]) => items.map(([header]) => header.type)), ['event']);
      assert.doesNotMatch(JSON.stringify(envelopes), /0912345678|FAKE_TOKEN|SECRET|PRIVATE_COOKIE/);
      assert.match(envelopes[0][1][0][1].exception.values[0].value, /\\[redacted\\]/);
    } finally {
      await Sentry.close(2000);
    }
  `;
  const result = spawnSync(process.execPath, ['--conditions=edge', '--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
