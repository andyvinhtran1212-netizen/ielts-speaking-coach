/**
 * frontend/tests/admin-dashboard-redesign.test.mjs
 *
 * Sentinels for the redesigned ops Dashboard: zero-dep SVG charts, per-tile
 * sparklines + deltas, the daily trends panel, the "Cần chú ý" strip, and
 * graceful degradation when the trends endpoint is unavailable.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let html, js, sparkSrc;
before(() => {
  html    = read('frontend/pages/admin/dashboard/index.html');
  js      = read('frontend/js/admin-dashboard.js');
  sparkSrc = read('frontend/js/charts/sparkline.js');
});


describe('charts/sparkline.js — zero-dep, pure, theme-aware', () => {
  test('exposes window.avCharts with sparkline/areaChart/periodDelta', () => {
    assert.match(sparkSrc, /window\.avCharts\s*=\s*\{[\s\S]{0,160}sparkline[\s\S]{0,160}areaChart[\s\S]{0,160}periodDelta/);
  });

  test('no chart library / React dependency (Pattern #15 lean)', () => {
    assert.ok(!/require\(|import\s+.*from|chart\.js|d3|uplot/i.test(sparkSrc));
  });

  test('theme-aware via currentColor (no hardcoded stroke colors)', () => {
    assert.match(sparkSrc, /stroke="currentColor"/);
    assert.ok(!/stroke="#[0-9a-fA-F]{3,6}"/.test(sparkSrc), 'no hardcoded stroke hex');
  });

  test('functionally returns SVG markup for sparkline + area + a P/P delta', () => {
    const require = createRequire(import.meta.url);
    const sandbox = {};
    // load the IIFE with a fake window
    const code = sparkSrc.replace('window.avCharts', 'sandbox.avCharts');
    new Function('sandbox', code)(sandbox);
    const c = sandbox.avCharts;
    assert.match(c.sparkline([1, 3, 2, 5]), /<svg class="av-spark"[\s\S]*<polyline/);
    assert.match(c.areaChart([{ value: 1 }, { value: 4 }, { value: 2 }]), /<svg class="av-area"[\s\S]*<path class="av-area__fill"/);
    const d = c.periodDelta([1, 1, 1, 1, 2, 2, 2, 2]);
    assert.equal(d.dir, 'up');
    assert.equal(d.pct, 100);
    // empty input still yields a (blank) svg, never throws
    assert.match(c.sparkline([]), /<svg class="av-spark"/);
  });
});


describe('dashboard page — tiles + sparklines + trends + attention', () => {
  test('loads the chart helper before the dashboard module', () => {
    assert.match(html, /js\/charts\/sparkline\.js/);
    const spark = html.indexOf('charts/sparkline.js');
    const dash = html.indexOf('admin-dashboard.js');
    assert.ok(spark > -1 && dash > -1 && spark < dash, 'sparkline.js must load before admin-dashboard.js');
  });

  test('six KPI tiles preserved (ids stable)', () => {
    for (const id of ['m-users', 'm-codes', 'm-visitors', 'm-practices', 'm-grading', 'm-tokens']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist`);
    }
  });

  test('sparkline + delta slots on the trend-having tiles', () => {
    for (const id of ['spark-visitors', 'spark-practices', 'spark-tokens',
                      'd-visitors', 'd-practices', 'd-tokens']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist`);
    }
  });

  test('trends panel with chart host + series tabs', () => {
    assert.match(html, /id="db-trend-chart"/);
    assert.match(html, /id="db-trend-tabs"/);
    assert.match(html, /data-series="practices"/);
    assert.match(html, /data-series="visitors"/);
    assert.match(html, /data-series="tokens"/);
  });

  test('"Cần chú ý" strip with error + writing-pending counts', () => {
    assert.match(html, /id="a-errors"/);
    assert.match(html, /id="a-writing"/);
    assert.match(html, /Cần chú ý/);
  });

  test('reuses design primitives + tokens; no non-existent --av-color-error', () => {
    assert.match(html, /admin-components\.css/);          // design-system layer
    const live = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/--av-color-error/.test(live), 'the banner must use --av-error, not the non-existent --av-color-error');
    assert.match(html, /\.db-banner[\s\S]{0,200}var\(--av-error\)/);
  });
});


describe('dashboard JS — dual fetch + graceful degradation', () => {
  test('fetches BOTH overview and trends endpoints', () => {
    assert.match(js, /\/admin\/dashboard\/overview\?visitors_window=/);
    assert.match(js, /\/admin\/dashboard\/trends\?days=/);
  });

  test('trends fetch is best-effort — its failure does not block the tiles', () => {
    // overview + trends are awaited in separate try/catch blocks.
    assert.match(js, /catch[\s\S]{0,400}renderChart\(/);
    assert.match(js, /renderOverview\(/);
  });

  test('renders sparklines, deltas, chart, and attention counts', () => {
    assert.match(js, /renderSpark\(/);
    assert.match(js, /renderDelta\(/);
    assert.match(js, /renderChart\(/);
    assert.match(js, /a-errors/);
    assert.match(js, /a-writing/);
  });

  test('trend tab switch re-renders without re-fetching (uses cached series)', () => {
    assert.match(js, /db-trend-tabs[\s\S]{0,300}renderChart\(/);
    assert.match(js, /_trends\b/);
  });
});
