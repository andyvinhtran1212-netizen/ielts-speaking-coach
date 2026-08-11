import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatWindow,
  humanizeError,
  normalizeErrorRow,
  normalizeLogsPayload,
  normalizeMigrationPayload,
  normalizeRollbackPayload,
  normalizeStatsPayload,
} from '../lib/admin-error-logs-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-error-logs)', 'admin', 'error-logs', 'page.tsx');
const BEHAVIOR = read('app', '(authed-admin-error-logs)', 'admin', 'error-logs', 'admin-error-logs.tsx');
const LAYOUT = read('app', '(authed-admin-error-logs)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-error-logs-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const BROWSER_FLOW = read('tooling', 'verify-admin-error-logs-flow.mjs');

describe('/admin/error-logs — native ownership', () => {
  test('uses the backend-owned admin gate and keeps the rollback artifact', () => {
    assert.match(PAGE, /function AdminErrorLogsPage/);
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="error-logs">/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'error-logs', 'index.html')));
    assert.match(CHROME, /section: 'error-logs'[^\n]+href: '\/admin\/error-logs'/);
    assert.doesNotMatch(CHROME, /section: 'error-logs'[^\n]+href: '\/pages\/admin\/error-logs/);
    assert.equal((OVERVIEW.match(/href="\/admin\/error-logs"/g) || []).length, 2);
  });

  test('loads the native admin cascade and width-safe slotted layout', () => {
    for (const stylesheet of [
      'admin-surface.css', 'admin-components.css', 'admin-buttons.css',
      'admin-status.css', 'admin-error-logs-next.css',
    ]) assert.ok(LAYOUT.includes(stylesheet), `missing ${stylesheet}`);
    assert.match(LAYOUT, /chrome="admin"/);
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    assert.match(CSS, /calc\(100vw - 328px\)/);
    assert.match(CSS, /aver-admin-chrome\[data-collapsed="1"\] > \.el-shell/);
    assert.match(CSS, /@media \(max-width: 768px\)/);
    assert.match(CSS, /calc\(100vw - 32px\)/);
    assert.match(CSS, /\.el-table-scroll[^}]+overflow-x: auto/s);
  });

  test('records native ownership and rollback in the route ledger', () => {
    assert.match(LEDGER, /`\/admin\/error-logs`[^\n]+authed-admin-error-logs[^\n]+native React ownership/);
    assert.match(LEDGER, /`\/pages\/admin\/error-logs\/index\.html` remains rollback target/);
    assert.match(LEDGER, /server `limit\/offset` pagination/);
  });
});

describe('/admin/error-logs — canonical behavior', () => {
  test('reads every canonical operational endpoint and uses server pagination', () => {
    for (const endpoint of [
      '/admin/error-logs/stats', '/admin/error-logs/migration-stats',
      '/admin/error-logs?', '/admin/error-logs/rollback-metrics?',
    ]) assert.ok(BEHAVIOR.includes(endpoint), `missing ${endpoint}`);
    assert.match(BEHAVIOR, /limit: String\(PAGE_SIZE\), offset: String\(nextOffset\)/);
    assert.match(BEHAVIOR, /dismissed.*level.*source/s);
    assert.match(BEHAVIOR, /setOffset\(offset \+ PAGE_SIZE\)/);
  });

  test('preserves dismiss, undo and exception-path dogfood mutations with duplicate guards', () => {
    assert.match(BEHAVIOR, /\$\{encodeURIComponent\(id\)\}\/\$\{action\}/);
    assert.match(BEHAVIOR, /pendingRows\.has\(id\)/);
    assert.match(BEHAVIOR, /\/admin\/error-logs\/test\?error_type=exception/);
    assert.match(BEHAVIOR, /setHideNoise\(false\)/);
    assert.match(BEHAVIOR, /setTimeout\(\(\) =>/);
    assert.match(BEHAVIOR, /clearTimeout\(testTimer\.current\)/);
  });

  test('suppresses stale responses and exposes failures without HTML injection', () => {
    for (const sequence of ['logsSequence', 'statsSequence', 'migrationSequence', 'rollbackSequence']) {
      assert.match(BEHAVIOR, new RegExp(`requestId === ${sequence}\\.current|requestId !== ${sequence}\\.current`));
    }
    assert.match(BEHAVIOR, /role="alert"/);
    assert.doesNotMatch(BEHAVIOR, /dangerouslySetInnerHTML|\.innerHTML/);
    assert.match(BEHAVIOR, /JSON\.stringify\(row\.extra, null, 2\)/);
  });

  test('keeps table disclosure, filters and loading actions accessible', () => {
    assert.match(BEHAVIOR, /aria-expanded=\{isExpanded\}/);
    assert.match(BEHAVIOR, /aria-controls=\{`detail-/);
    assert.match(BEHAVIOR, /aria-busy=\{statsLoading/);
    assert.match(BEHAVIOR, /disabled=\{anyLoading\}/);
    assert.match(BEHAVIOR, /aria-label="Phân trang báo lỗi"/);
  });

  test('gates a fixture-backed browser contract in CI', () => {
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-error-logs\)\/\*\*/);
    assert.match(WORKFLOW, /frontend\/public\/css\/admin-error-logs-next\.css/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-error-logs-flow\.mjs/);
    assert.match(BROWSER_FLOW, /parsed\.pathname === '\/auth\/me'/);
    assert.match(BROWSER_FLOW, /unexpectedWrites/);
    assert.match(BROWSER_FLOW, /dismiss.*undismiss/s);
  });
});

describe('admin error-log model — hostile and partial payloads', () => {
  test('drops rows without canonical ids and normalizes list metadata', () => {
    assert.equal(normalizeErrorRow({ message: 'missing id' }), null);
    const payload = normalizeLogsPayload({
      items: [null, { id: 'one', level: 'critical', source: 'strange', message: 42 }],
      limit: '50', offset: '100',
    });
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].level, 'error');
    assert.equal(payload.items[0].source, 'backend');
    assert.equal(payload.limit, 50);
    assert.equal(payload.offset, 100);
  });

  test('does not invent zero for missing stats', () => {
    assert.deepEqual(normalizeStatsPayload({ total: '9', last_24h: null }), {
      total: 9, undismissed: null, last24h: null, last7d: null,
    });
  });

  test('normalizes migration and rollback envelopes without trusting nested arrays', () => {
    const migration = normalizeMigrationPayload({ rows: [{ implementation: 'next', total: '3', by_level: { error: '2', bad: 'x' } }] });
    assert.deepEqual(migration.rows[0].byLevel, [['error', '2']]);
    const rollback = normalizeRollbackPayload({ route: '/grammar', match: 'prefix', window_minutes: '10080', implementations: { next: { page_views: 3 } } });
    assert.equal(rollback.match, 'prefix');
    assert.equal(rollback.windowMinutes, 10080);
    assert.equal(formatWindow(10080), '7 ngày');
  });

  test('preserves production-tested humanisation for DB, frontend, noise and gateway rows', () => {
    const db = humanizeError({ source: 'backend', message: "{'message': 'null value in column \"prompt_version\" violates not-null constraint', 'code': '23502'}" });
    assert.equal(db.category, 'CSDL');
    assert.match(db.summary, /prompt_version/);
    const frontend = humanizeError({ source: 'frontend', message: "Cannot read properties of null (reading 'essay')" });
    assert.equal(frontend.category, 'Giao diện');
    const noise = humanizeError({ source: 'backend', message: 'Test exception from /admin/error-logs/test endpoint' });
    assert.equal(noise.noise, true);
    const gateway = humanizeError({ source: 'backend', message: "{'message': 'JSON could not be generated', 'code': 555, 'details': \"b'Internal server error.'\"}" });
    assert.equal(gateway.category, 'Mạng');
    assert.match(gateway.summary, /HTTP 555/);
  });
});
