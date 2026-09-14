import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildNextVitalsPayload } from '../lib/next-vitals-model.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('native Web Vitals keeps the existing backend envelope and normalized metric fields', () => {
  const base = {
    path: '/grammar',
    release: 'abc123',
    loadedAt: 1000,
    now: 2500,
    userAgent: 'browser',
  };
  assert.deepEqual(buildNextVitalsPayload({ id: 'lcp-1', name: 'LCP', value: 1234.6 }, base), {
    event_name: 'web_vitals',
    event_data: {
      path: '/grammar',
      implementation: 'next',
      release: 'abc123',
      doc_release: 'abc123',
      loaded_at: 1000,
      age_ms: 1500,
      ua: 'browser',
      metric_id: 'lcp-1',
      metric_name: 'LCP',
      lcp: 1235,
    },
  });
  assert.equal(
    buildNextVitalsPayload({ id: 'cls-1', name: 'CLS', value: 0.12349 }, base).event_data.cls,
    0.123,
  );
  assert.equal(
    buildNextVitalsPayload({ id: 'inp-1', name: 'INP', value: 81.8 }, base).event_data.inp,
    82,
  );
});

test('native Web Vitals rejects malformed/unknown data and bounds identifying dimensions', () => {
  assert.equal(buildNextVitalsPayload({ name: 'custom', value: 12 }, {}), null);
  assert.equal(buildNextVitalsPayload({ name: 'LCP', value: Number.NaN }, {}), null);
  assert.equal(buildNextVitalsPayload({ name: 'LCP', value: null }, {}), null);
  const payload = buildNextVitalsPayload(
    { id: 'x'.repeat(200), name: 'TTFB', value: 10 },
    { path: '/', loadedAt: 200, now: 100, userAgent: 'u'.repeat(400) },
  );
  assert.equal(payload.event_data.metric_id.length, 128);
  assert.equal(payload.event_data.ua.length, 300);
  assert.equal(payload.event_data.age_ms, 0);
});

test('client collector pins the initial pathname and keeps telemetry fail-soft', () => {
  const source = readFileSync(path.join(FRONTEND, 'components', 'next-web-vitals.tsx'), 'utf8');
  assert.match(source, /initialPath\.current = window\.location\.pathname/);
  assert.match(source, /path: initialPath\.current \|\| window\.location\.pathname/);
  assert.doesNotMatch(source, /usePathname/, 'root collector must not make every route URL-dynamic');
  assert.match(source, /keepalive: true/);
  assert.match(source, /\.catch\(\(\) => undefined\)/);
});
