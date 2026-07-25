/**
 * rollback-exposure-line.test.mjs — DEBT-2026-07-22-F (frontend half).
 *
 * §12.3 sets a two-part exposure floor per cutover: elapsed days AND N real
 * interactions. The rollback panel only ever rendered rates, so the volume half
 * had no surface — for five days of the Pilot-1 soak the daily log tracked days
 * and never interactions, because there was nothing to read.
 *
 * Backend now returns `window_views_total`, `window_minutes_requested` and
 * `window_clamped`. These run the real _exposureLine() to pin that a clamped
 * window is impossible to mistake for a granted one.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(__dirname, '..', 'js', 'admin-error-logs.js'), 'utf8');
const HTML = readFileSync(
  join(__dirname, '..', 'pages', 'admin', 'error-logs', 'index.html'), 'utf8');

function load() {
  const noop = () => {};
  const ctx = vm.createContext({
    window: { api: { base: '' }, initSupabase: noop, getSupabase: () => null },
    document: { readyState: 'loading', addEventListener: noop, getElementById: () => null },
    console: { error: noop, warn: noop, log: noop },
    Set, String, JSON, Math, Date, Promise, setTimeout, clearTimeout, Number,
  });
  vm.runInContext(SOURCE, ctx);
  return ctx._exposureLine;
}
const E = load();

describe('DEBT-F — cumulative exposure is shown', () => {
  test('30-day window renders the interaction count and the span', () => {
    const out = E({ window_minutes: 43200, window_minutes_requested: 43200,
                    window_clamped: false, window_views_total: 108,
                    windows: { table_max: 129600 } });
    assert.match(out, /108/);
    assert.match(out, /30 ngày/);
    assert.match(out, /§12\.3/);
    assert.ok(!/bị cắt/.test(out), 'a granted window must not claim it was clamped');
  });

  test('sub-day windows read in hours / minutes, not fractional days', () => {
    assert.match(E({ window_minutes: 30, window_views_total: 4, windows: {} }), /30 phút/);
    assert.match(E({ window_minutes: 1440, window_views_total: 9, windows: {} }), /1 ngày/);
    assert.match(E({ window_minutes: 120, window_views_total: 9, windows: {} }), /2 giờ/);
  });

  test('a clamped window is called out with BOTH numbers', () => {
    // The live failure: 2880/6833/11531/43200 all silently became 1440.
    const out = E({ window_minutes: 1440, window_minutes_requested: 43200,
                    window_clamped: true, window_views_total: 14,
                    windows: { table_max: 129600 } });
    assert.match(out, /bị cắt/);
    assert.match(out, /43200/);      // what was asked for
    assert.match(out, /1440/);       // what was actually measured
    assert.match(out, /KHÔNG phải của cửa sổ bạn hỏi/);
  });

  test('a response without the field renders nothing (no NaN, no "undefined")', () => {
    assert.equal(E({ window_minutes: 30 }), '');
    assert.equal(E(null), '');
  });
});

describe('DEBT-F — the long windows are actually selectable', () => {
  test('the window picker offers 7 and 30 days', () => {
    assert.match(HTML, /<option value="10080">7 ngày<\/option>/);
    assert.match(HTML, /<option value="43200">30 ngày<\/option>/);
  });
  test('the short frozen windows are still there', () => {
    assert.match(HTML, /<option value="30" selected>30 phút<\/option>/);
    assert.match(HTML, /<option value="1440">24 giờ<\/option>/);
  });
  test('the panel renders the exposure line', () => {
    assert.match(SOURCE, /_exposureLine\(r\) \+\s*\n\s*_verdictLine/);
  });
});
