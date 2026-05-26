/**
 * frontend/tests/sprint-18-2-dashboard.test.mjs — Sprint 18.2 (Direction B)
 *
 * Source-scan of the new admin Dashboard page + controller + nav consolidation
 * (admin-dashboard.js is auto-running / DOM-coupled, so we pin DOM ids, the
 * endpoint contract, drill-downs, graceful NULL handling, and the nav delta).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const DASH_HTML = front('pages', 'admin', 'dashboard', 'index.html');
const DASH_JS   = front('js', 'admin-dashboard.js');
const CHROME    = front('js', 'components', 'aver-admin-chrome.js');


describe('Sprint 18.2 — dashboard page renders 6 metric cards', () => {
  for (const id of ['m-users', 'm-codes', 'm-visitors', 'm-practices', 'm-grading', 'm-cost']) {
    test(`card value slot #${id} present`, () => {
      assert.match(DASH_HTML, new RegExp(`id="${id}"`));
    });
  }
  test('controller paints all 6 slots', () => {
    for (const id of ['m-users', 'm-codes', 'm-visitors', 'm-practices', 'm-grading', 'm-cost']) {
      assert.match(DASH_JS, new RegExp(`'${id}'`));
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
  test('selector + refresh re-fetch; endpoint carries visitors_window', () => {
    assert.match(DASH_JS, /db-window'\)\.addEventListener\('change', load\)/);
    assert.match(DASH_JS, /db-refresh'\)\.addEventListener\('click', load\)/);
    assert.match(DASH_JS, /\/admin\/dashboard\/overview\?visitors_window=/);
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
    assert.match(DASH_JS, /if \(v == null\) return '—'/);
    assert.match(DASH_JS, /v == null \? '—'/);
  });
  test('no inline colour/bg in admin-dashboard.js', () => {
    assert.doesNotMatch(DASH_JS, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(DASH_JS, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(DASH_JS, /rgba\(\s*\d+\s*,/);
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
  test('Dashboard nav item added', () => {
    assert.match(CHROME, /section: 'dashboard',\s*label: 'Dashboard'/);
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
