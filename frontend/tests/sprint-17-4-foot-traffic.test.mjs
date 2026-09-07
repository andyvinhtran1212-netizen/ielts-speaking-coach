/**
 * frontend/tests/sprint-17-4-foot-traffic.test.mjs — Sprint 17.4 (Direction D)
 *
 * Source-scan of the page-view beacon, its install sites, the admin dashboard
 * controller, and the nav entry. Both modules are auto-running / DOM-coupled, so
 * this pins wiring + Pattern #26 (no inline colour/bg) rather than executing them.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const BEACON = front('js', 'analytics-beacon.js');
const DASH = front('js', 'admin-foot-traffic.js');
const CHROME = front('js', 'components', 'aver-admin-chrome.js');
const PAGE_VIEW_BRIDGE = front('components', 'next-page-view-beacon.tsx');
const AUTHED_SHELL = front('components', 'authed-shell.tsx');
const PUBLIC_CONTENT = front('app', '(public-content)', 'layout.tsx');
const PUBLIC_AUTH = front('app', '(public-auth)', 'layout.tsx');
const MARKETING = front('app', '(marketing)', 'landing-behavior.tsx');


describe('Sprint 17.4 — page-view beacon', () => {
  test('fires a page_view via api.post on load', () => {
    assert.match(BEACON, /event_name:\s*'page_view'/);
    assert.match(BEACON, /window\.api\.post\('\/api\/analytics\/events'/);
    assert.match(BEACON, /DOMContentLoaded/);
  });
  test('captures path + referrer + viewport', () => {
    assert.match(BEACON, /var path = location\.pathname/);
    assert.match(BEACON, /path:\s*path/);
    assert.match(BEACON, /referrer/);
    assert.match(BEACON, /vw:/);
  });
  test('exposes a pathname-deduplicated emitter for App Router navigation', () => {
    assert.match(BEACON, /window\.aver\.trackPageView = fire/);
    assert.match(BEACON, /_lastPageViewPath === path/);
    assert.match(BEACON, /_lastPageViewPath = path/);
    assert.match(PAGE_VIEW_BRIDGE, /usePathname\(\)/);
    assert.match(PAGE_VIEW_BRIDGE, /\[pathname, scriptReady\]/);
  });
  test('silent on failure (Pattern #29): guards window.api + swallows errors', () => {
    assert.match(BEACON, /typeof window\.api\.post === 'function'/);
    assert.match(BEACON, /\.catch\(function\s*\(\)\s*\{/);
  });
  test('Pattern #26 — no inline colour/bg/hex', () => {
    assert.doesNotMatch(BEACON, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(BEACON, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(BEACON, /#[0-9a-fA-F]{3,6}\b/);
  });
});

describe('Sprint 17.4 — beacon installed on core journey pages', () => {
  for (const page of [
    ['pages', 'home.html'], ['pages', 'speaking.html'], ['pages', 'result.html'],
  ]) {
    test(`installed on ${page.join('/')}`, () => {
      assert.match(front(...page), /analytics-beacon\.js/);
    });
  }
});

describe('Sprint 17.4 — beacon installed on native route families', () => {
  test('authenticated, public-content and public-auth layouts load the shared beacon', () => {
    for (const source of [AUTHED_SHELL, PUBLIC_CONTENT, PUBLIC_AUTH]) {
      assert.match(source, /<NextPageViewBeacon \/>/);
    }
    assert.match(PAGE_VIEW_BRIDGE, /<Script[\s\S]*?src="\/js\/analytics-beacon\.js"[\s\S]*?strategy="afterInteractive"/);
  });

  test('lean marketing route records the same page_view contract directly', () => {
    assert.match(MARKETING, /event_name:\s*'page_view'/);
    assert.match(MARKETING, /path:\s*location\.pathname/);
    assert.match(MARKETING, /\/api\/analytics\/events/);
  });
});

describe('Sprint 17.4 — admin foot-traffic dashboard', () => {
  test('fetches the aggregation endpoint', () => {
    assert.match(DASH, /\/admin\/analytics\/foot-traffic/);
  });
  test('renders summary cards + top pages + daily chart', () => {
    assert.match(DASH, /ft-total/);
    assert.match(DASH, /ft-unique/);
    assert.match(DASH, /ft-anon/);
    assert.match(DASH, /ft-pages-tbody/);
    assert.match(DASH, /ft-chart/);
  });
  test('escapes path; bar height is the only inline style (no colour/bg)', () => {
    assert.match(DASH, /esc\(p\.path\)/);
    assert.doesNotMatch(DASH, /style\s*=\s*["'`][^"'`]*color\s*:/);
    assert.doesNotMatch(DASH, /style\s*=\s*["'`][^"'`]*background/);
  });
});

describe('Sprint 17.4 — nav', () => {
  // Sprint 18.2 folded "Lưu lượng" into the Dashboard as a drill-down: the
  // standalone nav item is gone, but the section stays in VALID_ACTIVE so the
  // foot-traffic page still resolves (deep link + dashboard "Xem chi tiết").
  test('foot-traffic stays in VALID_ACTIVE for drill-down resolution', () => {
    assert.match(CHROME, /VALID_ACTIVE = \[[\s\S]*?'foot-traffic'[\s\S]*?\]/);
  });
});
