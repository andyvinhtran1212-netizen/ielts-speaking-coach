/**
 * frontend/tests/sprint-18-2-dashboard.test.mjs — Sprint 18.2 (Direction B)
 *
 * Source-scan of the new admin Dashboard page + controller + nav consolidation
 * (the retired page fixture keeps its DOM-id and drill-down pins; the endpoint
 * contract and NULL handling are pinned on the Next overview owner).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

// dashboard-consolidation — the ops Dashboard was merged INTO Tổng quan; its
// markup (KPI tiles, trends, "Cần chú ý") now lives on the unified index page.
const DASH_HTML = front('pages', 'admin', 'index.html');
// LEGACYJS-0075 W4a — admin-dashboard.js is retired; the Next Tổng quan owner
// paints the tiles now.
const DASH_TSX  = front('app', '(authed-admin)', '(overview)', 'admin', 'admin-overview.tsx');
const MODEL     = await import(join(__dirname, '..', 'lib', 'admin-overview-model.mjs'));
const CHROME    = front('js', 'components', 'aver-admin-chrome.js');


describe('Sprint 18.2 — dashboard page renders 6 metric cards', () => {
  for (const id of ['m-users', 'm-codes', 'm-visitors', 'm-practices', 'm-grading', 'm-tokens']) {
    test(`card value slot #${id} present`, () => {
      assert.match(DASH_HTML, new RegExp(`id="${id}"`));
    });
  }
  test('Next owner paints all 6 metric cards', () => {
    for (const value of ['ops?.totalUsers', 'ops?.activeCodes', 'ops?.visitors?.count', 'ops?.totalPractices', 'ops?.gradingMinutes', 'ops?.tokens?.count']) {
      assert.ok(DASH_TSX.includes(`(${value})}`), `${value} must be rendered`);
    }
  });
});

describe('Sprint 18.2 — visitors window selector', () => {
  test('selector offers 7/30/90 with 30 default', () => {
    assert.match(DASH_HTML, /id="db-window"/);
    assert.match(DASH_HTML, /value="7"/);
    assert.match(DASH_HTML, /value="30"\s+selected/);
    assert.match(DASH_HTML, /value="90"/);
  });
  test('selector + refresh re-fetch immediately; endpoint carries visitors_window', () => {
    // dashboard-tweaks: window switch reloads only the windowed tiles ('windowed'),
    // refresh reloads everything ('all'); both call load() immediately.
    assert.match(DASH_TSX, /<option value=\{7\}>7 ngày<\/option>[\s\S]{0,80}value=\{30\}[\s\S]{0,80}value=\{90\}/);
    assert.match(DASH_TSX, /void loadOps\(windowDays, 'windowed'\)/);
    assert.match(DASH_TSX, /onClick=\{\(\) => loadAll\('all'\)\}/);
    assert.match(DASH_TSX, /getAdminDashboardOverview\(days\)/);
  });
});

describe('Sprint 18.2 — drill-down links to detail pages', () => {
  for (const href of [
    '/pages/admin/users/index.html',
    '/pages/admin/access-codes/index.html',
    '/pages/admin/foot-traffic/index.html',
    '/pages/admin/usage/index.html',
    '/pages/admin/system/ai-usage.html',
  ]) {
    test(`drill-down to ${href}`, () => {
      assert.match(DASH_HTML, new RegExp(`href="${href.replace(/\//g, '\\/')}"`));
    });
  }
});

describe('Sprint 18.2 — graceful NULL + Pattern #26', () => {
  test('NULL metric renders as "—" placeholder', () => {
    assert.equal(MODEL.formatInteger(null), '—');
    assert.equal(MODEL.formatTokens(undefined), '—');
    assert.match(DASH_TSX, /value=\{formatInteger\(ops\?\.totalUsers\)\}/);
    assert.match(DASH_TSX, /value=\{formatTokens\(ops\?\.tokens\?\.count\)\}/);
  });
  test('no inline colour/bg in the Next overview owner', () => {
    assert.doesNotMatch(DASH_TSX, /style=\{\{[^}]*color/);
    assert.doesNotMatch(DASH_TSX, /style=\{\{[^}]*background/);
    assert.doesNotMatch(DASH_TSX, /rgba\(\s*\d+\s*,/);
  });
});

describe('Sprint 18.2 — Pattern #25 av-* tokens, both themes', () => {
  test('page styles use av-* tokens', () => {
    assert.match(DASH_HTML, /--av-surface-card/);
    assert.match(DASH_HTML, /--av-text-primary/);
  });
  test('no hardcoded hex colour values in the page styles (theme-safe)', () => {
    assert.doesNotMatch(DASH_HTML, /:\s*#[0-9a-fA-F]{3,6}\b/);
  });
});

describe('Sprint 18.2 — nav consolidation (3 removed, 1 added)', () => {
  // dashboard-consolidation — the ops Dashboard was merged INTO Tổng quan, so
  // the separate 'dashboard' nav item is gone; its reading-attempts drill-down
  // now hangs off the 'overview' entry.
  test('ops Dashboard consolidated into Tổng quan (no separate nav item)', () => {
    assert.doesNotMatch(CHROME, /section: 'dashboard',\s*label: 'Dashboard'/);
    assert.match(CHROME, /section: 'overview',\s*label: 'Tổng quan'[\s\S]*?reading-attempts/);
  });
  test('Usage logs / Lưu lượng / Hệ thống nav items removed', () => {
    assert.doesNotMatch(CHROME, /section: 'usage',\s*label: 'Usage logs'/);
    assert.doesNotMatch(CHROME, /section: 'foot-traffic', label: 'Lưu lượng'/);
    assert.doesNotMatch(CHROME, /section: 'system',\s*label: 'Hệ thống'/);
  });
  test('removed sections stay in VALID_ACTIVE for deep links; dashboard added', () => {
    assert.match(CHROME, /VALID_ACTIVE = \[[\s\S]*?'dashboard'[\s\S]*?\]/);
    assert.match(CHROME, /VALID_ACTIVE = \[[\s\S]*?'usage'[\s\S]*?'foot-traffic'[\s\S]*?'system'[\s\S]*?\]/);
  });
  test('Sprint 18.1 "Lớp & Học viên" fold preserved (no regression)', () => {
    assert.match(CHROME, /label: 'Lớp & Học viên'/);
  });
});
