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


describe('Sprint 17.4 — page-view beacon', () => {
  test('fires a page_view via api.post on load', () => {
    assert.match(BEACON, /event_name:\s*'page_view'/);
    assert.match(BEACON, /window\.api\.post\('\/api\/analytics\/events'/);
    assert.match(BEACON, /DOMContentLoaded/);
  });
  test('captures path + referrer + viewport', () => {
    assert.match(BEACON, /path:\s*location\.pathname/);
    assert.match(BEACON, /referrer/);
    assert.match(BEACON, /vw:/);
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
  test('foot-traffic in VALID_ACTIVE + a nav item', () => {
    assert.match(CHROME, /'foot-traffic'/);
    assert.match(CHROME, /section:\s*'foot-traffic'[\s\S]*?foot-traffic\/index\.html/);
  });
});
