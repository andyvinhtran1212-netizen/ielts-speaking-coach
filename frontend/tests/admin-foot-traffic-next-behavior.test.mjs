import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  dateInputToIso,
  defaultTrafficDates,
  formatTrafficCount,
  normalizeFootTrafficPayload,
} from '../lib/admin-foot-traffic-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-foot-traffic)', 'admin', 'foot-traffic', 'admin-foot-traffic.tsx');
const PAGE = read('app', '(authed-admin-foot-traffic)', 'admin', 'foot-traffic', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-foot-traffic)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-foot-traffic-next.css');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const VERCEL = read('vercel.json');

describe('/admin/foot-traffic native contract', () => {
  test('owns the admin route and only reads the canonical endpoint', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /active="foot-traffic"/);
    assert.match(CLIENT, /\/admin\/analytics\/foot-traffic\?\$\{params\}/);
    assert.doesNotMatch(CLIENT, /window\.api\.(post|put|patch|delete)/);
    assert.match(CLIENT, /snapshot\?\.key === currentKey/);
    assert.match(CLIENT, /const targetKey = makeKey\(from, to, routeFilter\)/);
    assert.match(CLIENT, /if \(targetKey === currentKey\) void load/);
    assert.match(CLIENT, /nextFrom > defaults\.to/);
    assert.match(CLIENT, /type="date" max=\{defaults\.to\}/);
    assert.match(LAYOUT, /admin-foot-traffic-next\.css/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-foot-traffic\)\/\*\*/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-foot-traffic-flow\.mjs/);
  });

  test('canonical overview link is native and responsive rows are cards', () => {
    assert.match(OVERVIEW, /href="\/admin\/foot-traffic"/);
    assert.doesNotMatch(OVERVIEW, /pages\/admin\/foot-traffic\/index\.html/);
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /\.aft-table td::before\{content:attr\(data-label\)/);
    assert.match(CLIENT, /role="region" aria-label="Bảng trang xem nhiều nhất" tabIndex=\{0\}/);
    assert.doesNotMatch(VERCEL, /admin\/foot-traffic/);
  });
});

describe('foot traffic payload truth', () => {
  test('normalizes complete data and excludes malformed chart rows', () => {
    const payload = normalizeFootTrafficPayload({
      data_status: 'complete', truncated: false,
      date_from: '2026-08-01T00:00:00Z', date_to: '2026-08-12T23:59:59.999Z',
      snapshot_to: '2026-08-12T08:00:00Z', effective_to: '2026-08-12T07:59:55Z', route: null,
      total_views: 12, unique_visitors: 3, anonymous_hits: 4,
      top_pages: [{ path: '/home', views: 8 }, { path: '', views: 4 }],
      daily: [{ date: '2026-08-02', views: 7 }, { date: 'bad', views: 5 }, { date: '2026-08-01', views: 5 }],
    });
    assert.ok(payload);
    assert.deepEqual(payload.topPages, [{ path: '/home', views: 8 }]);
    assert.deepEqual(payload.daily.map((row) => row.date), ['2026-08-01', '2026-08-02']);
    assert.equal(payload.malformedCount, 2);
  });

  test('unavailable metrics stay unknown and partial totals are lower bounds', () => {
    const unavailable = normalizeFootTrafficPayload({
      data_status: 'unavailable', truncated: false, snapshot_to: '2026-08-12T08:00:00Z', effective_to: '2026-08-12T07:59:55Z',
      total_views: null, unique_visitors: null, anonymous_hits: null, top_pages: [], daily: [],
    });
    assert.ok(unavailable);
    assert.equal(formatTrafficCount(unavailable.totalViews), '—');
    assert.equal(formatTrafficCount(2350, true), '≥ 2.350');
    assert.equal(normalizeFootTrafficPayload({ truncated: false, total_views: 0, unique_visitors: 0, anonymous_hits: 0, top_pages: [], daily: [] }), null);
    assert.equal(normalizeFootTrafficPayload({ data_status: 'unavailable', total_views: 0, unique_visitors: 0, anonymous_hits: 0, top_pages: [], daily: [] }), null);
  });

  test('date conversion includes the whole end day and defaults to 30 calendar days', () => {
    assert.equal(dateInputToIso('2026-08-12'), '2026-08-12T00:00:00.000Z');
    assert.equal(dateInputToIso('2026-08-12', true), '2026-08-12T23:59:59.999Z');
    assert.deepEqual(defaultTrafficDates(new Date('2026-08-12T12:00:00Z')), { from: '2026-07-14', to: '2026-08-12' });
  });
});
