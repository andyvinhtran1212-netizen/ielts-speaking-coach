import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  filterUsageRows,
  formatUsageCost,
  formatUsageCount,
  normalizeCodeUsagePayload,
  normalizeUsageUsersPayload,
  sortUsageRows,
  summarizeUsageRows,
} from '../lib/admin-usage-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-usage)', 'admin', 'usage', 'admin-usage.tsx');
const PAGE = read('app', '(authed-admin-usage)', 'admin', 'usage', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-usage)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-usage-next.css');
const CODES = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-access-codes-panel.tsx');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/admin/usage native contract', () => {
  test('owns the route behind backend-owned admin auth and remains read-only', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /active="usage"/);
    assert.match(CLIENT, /'\/admin\/usage\/users'/);
    assert.match(CLIENT, /`\/admin\/access-codes\/\$\{encodeURIComponent\(codeId\)\}\/usage`/);
    assert.doesNotMatch(CLIENT, /window\.api\.(post|put|patch|delete)/);
    assert.match(CLIENT, /snapshot\?\.key === scopeKey/);
    assert.match(CLIENT, /setSnapshot\(\{ key: scopeKey/);
    assert.doesNotMatch(CLIENT, /setError\(messageOf/);
    assert.match(LAYOUT, /admin-usage-next\.css/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-usage\)\/\*\*/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-usage-flow\.mjs/);
  });

  test('all canonical entry points use the native URL while rollback HTML remains available', () => {
    assert.match(CODES, /href=\{`\/admin\/usage\?code_id=/);
    assert.doesNotMatch(CODES, /pages\/admin\/usage\/index\.html/);
    assert.match(OVERVIEW, /href="\/admin\/usage"/);
    assert.doesNotMatch(OVERVIEW, /pages\/admin\/usage\/index\.html/);
  });

  test('search and sorting stay URL-addressable, and mobile rows become cards', () => {
    assert.match(CLIENT, /url\.searchParams\.set\('q'/);
    assert.match(CLIENT, /url\.searchParams\.set\('sort'/);
    assert.match(CLIENT, /window\.history\.replaceState/);
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /\.aus-table td::before\{content:attr\(data-label\)/);
    assert.match(CLIENT, /className="aus-mobile-label">Tổng phiên/);
    assert.match(CSS, /\.aus-mobile-label\{position:absolute;width:1px/);
  });
});

describe('admin usage payload truth', () => {
  const users = normalizeUsageUsersPayload([
    { user_id: 'u1', name: 'An', email: 'a@example.com', role: 'student', sessions: 3, last_active: '2026-08-12T08:00:00Z', ai_cost_usd: 0.25 },
    { user_id: 'u2', name: 'Bình', sessions: null, last_active: null, ai_cost_usd: null },
    { user_id: 'u1', sessions: 9, last_active: null, ai_cost_usd: 1 },
    { user_id: '', sessions: 1, last_active: null, ai_cost_usd: 0 },
  ]);

  test('keeps degraded metrics unknown and excludes duplicate/malformed identities', () => {
    assert.ok(users);
    assert.equal(users.rows.length, 2);
    assert.equal(users.malformedCount, 2);
    assert.deepEqual(summarizeUsageRows(users.rows), { users: 2, activeUsers: null, sessions: null, aiCostUsd: null, degradedRows: 1 });
    assert.equal(formatUsageCount(null), '—');
    assert.equal(formatUsageCost(null), '—');
  });

  test('filters identities and sorts unknown metrics last', () => {
    assert.deepEqual(filterUsageRows(users.rows, 'a@example').map((row) => row.userId), ['u1']);
    assert.deepEqual(sortUsageRows(users.rows, 'sessions').map((row) => row.userId), ['u1', 'u2']);
  });

  test('validates code identity and preserves null aggregate metrics', () => {
    const payload = normalizeCodeUsagePayload({
      code: { id: 'c1', code: 'ABC', session_limit: null, code_type: 'mass', cohort_id: null },
      assigned_users: [{ user_id: 'u1', sessions: null, last_active: null, ai_cost_usd: 0.5 }],
      aggregate: { assigned_user_count: 1, total_sessions: null, total_ai_cost_usd: 0.5 },
    });
    assert.ok(payload);
    assert.equal(payload.aggregate.totalSessions, null);
    assert.equal(payload.aggregate.totalAiCostUsd, 0.5);
    assert.equal(normalizeCodeUsagePayload({ code: {}, assigned_users: [], aggregate: {} }), null);
  });
});
