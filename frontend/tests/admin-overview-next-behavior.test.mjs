import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chartPoints,
  finiteNumber,
  formatTokens,
  normalizeOpsPayload,
  normalizeOverviewPayload,
  normalizeTrendsPayload,
  periodDelta,
  safeActivityLink,
} from '../lib/admin-overview-model.mjs';
import {
  buildLegacyRetirementRedirects,
  discoverLegacyHtmlPaths,
} from '../tooling/gate-f-retirement-redirects.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-overview)', 'admin', 'page.tsx');
const BEHAVIOR = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const LAYOUT = read('app', '(authed-admin-overview)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-overview.css');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const BROWSER_FLOW = read('tooling', 'verify-admin-overview-flow.mjs');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const ADMIN_STUB = read('public', 'admin.html');
const RETIREMENT_REDIRECTS = buildLegacyRetirementRedirects(
  discoverLegacyHtmlPaths(join(ROOT, 'public')),
  { permanent: false },
);

describe('/admin — native overview ownership', () => {
  test('owns the canonical route behind the backend-owned admin gate', () => {
    assert.match(PAGE, /function AdminOverviewPage/);
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="overview">/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'index.html')));
    assert.match(CHROME, /section: 'overview'[^\n]+href: '\/admin'/);
    assert.match(CHROME, /<a href="\/admin" class="brand">/);
    assert.doesNotMatch(CHROME, /href: '\/pages\/admin\/index\.html'/);
    assert.match(ADMIN_STUB, /window\.location\.replace\('\/admin'\)/);
    assert.ok(RETIREMENT_REDIRECTS.some((entry) => (
      entry.source === '/pages/admin/dashboard/index.html'
        && entry.destination === '/admin'
        && entry.permanent === false
    )));
  });

  test('loads the measured admin cascade and width-safe slotted layout', () => {
    for (const stylesheet of [
      'admin-surface.css', 'admin-components.css', 'admin-buttons.css',
      'admin-status.css', 'admin-hub.css', 'admin-overview.css',
    ]) {
      assert.ok(LAYOUT.includes(stylesheet), `missing ${stylesheet}`);
    }
    assert.match(LAYOUT, /chrome="admin"/);
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    assert.match(CSS, /calc\(100vw - 328px\)/);
    assert.match(CSS, /aver-admin-chrome\[data-collapsed="1"\] > \.overview-shell/);
    assert.match(CSS, /@media \(max-width: 768px\)/);
    assert.match(CSS, /calc\(100vw - 32px\)/);
    assert.match(CSS, /\.overview-shell \[hidden\] \{ display: none !important; \}/);
  });

  test('records native ownership and the rollback target in the route ledger', () => {
    assert.match(LEDGER, /`\/admin`[^\n]+authed-admin-overview[^\n]+native React ownership/);
    assert.match(LEDGER, /`\/pages\/admin\/index\.html` remains rollback target/);
  });
});

describe('/admin — lifecycle and contract behavior', () => {
  test('loads all three canonical read endpoints with a stale-response guard', () => {
    assert.match(BEHAVIOR, /\/admin\/dashboard\/overview\?visitors_window=/);
    assert.match(BEHAVIOR, /\/admin\/dashboard\/trends\?days=/);
    assert.match(BEHAVIOR, /window\.api\.get<unknown>\('\/admin\/overview'\)/);
    assert.doesNotMatch(BEHAVIOR, /Promise\.allSettled/);
    assert.match(BEHAVIOR, /const opsRequest = window\.api\.get/);
    assert.match(BEHAVIOR, /void trendsRequest\s*\.then/);
    assert.match(BEHAVIOR, /requestId !== opsSequence\.current/);
    assert.match(BEHAVIOR, /requestId !== contentSequence\.current/);
    assert.match(BEHAVIOR, /loadedWindow\.current === windowDays/);
    assert.match(BEHAVIOR, /void loadOps\(windowDays, 'windowed'\)/);
    assert.match(BEHAVIOR, /href=\{`\/admin\/system\/ai-usage\?days=\$\{windowDays\}`\}/);
    assert.doesNotMatch(BEHAVIOR, /href="\/pages\/admin\/system\/ai-usage\.html"/);
  });

  test('is account-keyed, visibility-aware and cleans timers/listeners', () => {
    assert.match(BEHAVIOR, /loadedAccount\.current !== profile\.id/);
    assert.match(BEHAVIOR, /visibilitychange/);
    assert.match(BEHAVIOR, /Date\.now\(\) - lastContentAt\.current >= REFRESH_MS/);
    assert.match(BEHAVIOR, /clearInterval\(timer\)/);
    assert.match(BEHAVIOR, /removeEventListener\('visibilitychange'/);
  });

  test('keeps trends best-effort and failures visible without unsafe HTML injection', () => {
    assert.match(BEHAVIOR, /trends fetch failed/);
    assert.match(BEHAVIOR, /setTrendsLoading\(false\)/);
    assert.match(BEHAVIOR, /seriesLoading=\{trendsLoading\}/);
    assert.match(BEHAVIOR, /setOpsError\(/);
    assert.match(BEHAVIOR, /role="alert"/);
    assert.doesNotMatch(BEHAVIOR, /dangerouslySetInnerHTML|\.innerHTML/);
    assert.match(BEHAVIOR, /safeActivityLink\(row\.link\)/);
  });

  test('uses accessible tabs and disables duplicate manual refreshes', () => {
    assert.match(BEHAVIOR, /role="tablist"/);
    assert.match(BEHAVIOR, /aria-selected=\{selected\}/);
    assert.match(BEHAVIOR, /aria-controls=\{`pane-/);
    assert.match(BEHAVIOR, /tabIndex=\{selected \? 0 : -1\}/);
    assert.match(BEHAVIOR, /function moveTabFocus/);
    assert.match(BEHAVIOR, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
    assert.match(BEHAVIOR, /aria-controls="trend-panel"/);
    assert.match(BEHAVIOR, /role="tabpanel"/);
    assert.match(BEHAVIOR, /aria-labelledby=\{`trend-tab-/);
    assert.match(BEHAVIOR, /disabled=\{anyLoading\}/);
  });

  test('gates the fixture-backed browser flow in CI', () => {
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-overview\)\/\*\*/);
    assert.match(WORKFLOW, /frontend\/public\/css\/admin-overview\.css/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-system\)\/\*\*/);
    assert.match(WORKFLOW, /frontend\/public\/css\/admin-ai-usage-next\.css/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-overview-flow\.mjs/);
    assert.match(BROWSER_FLOW, /parsed\.pathname === '\/auth\/me'/);
    assert.match(BROWSER_FLOW, /unexpectedWrites/);
    assert.match(BROWSER_FLOW, /response 7 ngày đến trễ không ghi đè/);
    assert.match(BROWSER_FLOW, /trends treo không chặn KPI/);
    assert.match(BROWSER_FLOW, /Listening hiển thị đúng tỷ lệ/);
    assert.match(BROWSER_FLOW, /Reading hiển thị đúng tỷ lệ/);
  });
});

describe('admin overview model — hostile/partial payloads', () => {
  test('normalizes partial ops payloads and clamps unsupported windows', () => {
    const value = normalizeOpsPayload({
      total_users: '12',
      distinct_visitors: { count: '9', authenticated: 4, anonymous: 5, window_days: 365 },
      tokens_called: { count: '1250', window_days: 7 },
      attention: { errors_undismissed: 2 },
    }, 90);
    assert.equal(value.totalUsers, 12);
    assert.equal(value.visitors.windowDays, 30);
    assert.equal(value.tokens.windowDays, 7);
    assert.equal(value.attention.writingPending, null);
    assert.equal(formatTokens(value.tokens.count), '1.3K');
  });

  test('rejects missing and malformed skill averages before formatting', () => {
    assert.equal(finiteNumber(null), null);
    assert.equal(finiteNumber('not-a-score'), null);
    assert.equal(finiteNumber(0.75), 0.75);
  });

  test('normalizes trend points without letting malformed values poison SVG math', () => {
    const trends = normalizeTrendsPayload({
      series: { visitors: [{ value: 1 }, { value: '3' }, { value: 'bad' }, null] },
    });
    assert.deepEqual(trends.visitors, [1, 3, 0, 0]);
    assert.equal(chartPoints(trends.visitors, 120, 28, 2).length, 4);
    assert.deepEqual(periodDelta([1, 1, 2, 2]), { pct: 100, dir: 'up' });
  });

  test('accepts only same-origin path-shaped activity links', () => {
    assert.equal(safeActivityLink('/pages/result.html?id=1'), '/pages/result.html?id=1');
    assert.equal(safeActivityLink('//evil.example/path'), null);
    assert.equal(safeActivityLink('javascript:alert(1)'), null);
    assert.equal(safeActivityLink('https://evil.example/path'), null);
    assert.equal(safeActivityLink('/\\evil.example/path'), null);
    assert.equal(safeActivityLink('/ok\nmalformed'), null);
  });

  test('filters malformed activity rows while preserving React-escaped text values', () => {
    const overview = normalizeOverviewPayload({
      recent_activity: [null, {}, { timestamp: '2026-08-12T00:00:00Z', action: '<img onerror=1>' }],
    });
    assert.equal(overview.recentActivity.length, 1);
    assert.equal(overview.recentActivity[0].action, '<img onerror=1>');
  });
});
