/**
 * rollback-exposure-line.test.mjs — DEBT-2026-07-22-F (frontend half).
 *
 * §12.3 sets a two-part exposure floor per cutover: elapsed days AND N real
 * interactions. The rollback panel only ever rendered rates, so the volume half
 * had no surface — for five days of the Pilot-1 soak the daily log tracked days
 * and never interactions, because there was nothing to read.
 *
 * Backend now returns `window_views_total`, `window_minutes_requested` and
 * `window_clamped`. LEGACYJS-0075 W4b: the legacy _exposureLine() in
 * admin-error-logs.js is deleted; these pin the Next <ExposureLine> on
 * /admin/error-logs and run normalizeRollbackPayload/formatWindow from
 * lib/admin-error-logs-model.mjs, so a clamped window is still impossible to
 * mistake for a granted one.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatWindow, normalizeRollbackPayload } from '../lib/admin-error-logs-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(
  join(__dirname, '..', 'app', '(authed-admin)', '(error-logs)', 'admin', 'error-logs', 'admin-error-logs.tsx'), 'utf8');
const LINE = PAGE.slice(PAGE.indexOf('function ExposureLine('), PAGE.indexOf('export function AdminErrorLogs'));
const HTML = readFileSync(
  join(__dirname, '..', 'pages', 'admin', 'error-logs', 'index.html'), 'utf8');

const EXP = (over = {}) => ({
  window_minutes: 43200, window_minutes_requested: 43200, window_clamped: false,
  windows: { table_max: 129600 },
  exposure: {
    evaluated_implementation: 'next', evaluated_views: 108,
    by_implementation: { next: 108, legacy: 0, untagged: 0 },
    all_views: 108, exact: true, window_minutes: 43200,
  },
  ...over,
});

describe('DEBT-F — cumulative exposure is shown', () => {
  test('30-day window renders the interaction count and the span', () => {
    const m = normalizeRollbackPayload(EXP());
    assert.equal(m.exposure.evaluated_views, 108);
    assert.equal(formatWindow(m.windowMinutes), '30 ngày');
    assert.equal(m.windowClamped, false);
    assert.match(LINE, /\{String\(exposure\.evaluated_views\)\} lượt xem trong \{formatWindow\(metrics\.windowMinutes\)\}/);
    assert.match(LINE, /vế số-lượng của sàn §12\.3/);
    assert.match(LINE, /\{metrics\.windowClamped && \(/, 'the clamp note only renders for a clamped window');
  });

  test('sub-day windows read in hours / minutes, not fractional days', () => {
    assert.equal(formatWindow(30), '30 phút');
    assert.equal(formatWindow(1440), '1 ngày');
    assert.equal(formatWindow(120), '2 giờ');
  });

  test('a clamped window is called out with BOTH numbers', () => {
    // The live failure: 2880/6833/11531/43200 all silently became 1440.
    const m = normalizeRollbackPayload(EXP({ window_minutes: 1440, window_minutes_requested: 43200, window_clamped: true }));
    assert.equal(m.windowClamped, true);
    assert.equal(m.requestedWindowMinutes, 43200);
    assert.equal(m.windowMinutes, 1440);
    assert.match(LINE, /Cửa sổ bị cắt:<\/strong> yêu cầu \{metrics\.requestedWindowMinutes\} phút,\s*thực tế tính \{metrics\.windowMinutes\} phút/);
    assert.match(LINE, /Con số dưới đây không thuộc cửa sổ đã yêu cầu/);
  });

  test('a response without the field renders nothing (no NaN, no "undefined")', () => {
    assert.equal(normalizeRollbackPayload({ window_minutes: 30 }).exposure, null);
    assert.equal(normalizeRollbackPayload(null).exposure, null);
    assert.match(LINE, /if \(!exposure \|\| exposure\.evaluated_views == null\) return null;/);
  });
});

describe('DEBT-F — exposure is cohort-scoped (review #823)', () => {
  test('the headline number is the EVALUATED cohort, not the sum', () => {
    // A window spanning a cutover: 500 legacy views must not satisfy the floor
    // for code that only served 12.
    assert.match(LINE, /Phơi nhiễm luỹ kế \(\{String\(exposure\.evaluated_implementation \|\| 'next'\)\}\)/);
    assert.doesNotMatch(LINE, /all_views/, 'the mixed total must not be the gate number');
    assert.match(LINE, /\['legacy', 'untagged'\]/);
    assert.match(LINE, /Không tính vào sàn: \$\{others\}/);
  });

  test('a non-exact count is shown as a LOWER BOUND, never as a total', () => {
    assert.match(LINE, /\{exposure\.exact \? '' : 'ít nhất '\}/);
    assert.match(LINE, /exposure\.exact \? '' : '\. Đếm chính xác không chạy được — đây là cận dưới\.'/);
    assert.match(LINE, /el-note\$\{exposure\.exact \? '' : ' is-warning'\}/);
  });
});

describe('DEBT-F — the long windows are actually selectable', () => {
  test('the window picker offers 7 and 30 days', () => {
    assert.match(PAGE, /<option value="10080">7 ngày<\/option>/);
    assert.match(PAGE, /<option value="43200">30 ngày<\/option>/);
    assert.match(HTML, /<option value="10080">7 ngày<\/option>/);   // retired fixture (ADR-005)
    assert.match(HTML, /<option value="43200">30 ngày<\/option>/);
  });
  test('the short frozen windows are still there', () => {
    assert.match(PAGE, /<option value="30">30 phút<\/option><option value="1440">24 giờ<\/option>/);
    assert.match(HTML, /<option value="30" selected>30 phút<\/option>/);
    assert.match(HTML, /<option value="1440">24 giờ<\/option>/);
  });
  test('the panel renders the exposure line', () => {
    assert.match(PAGE, /<ExposureLine metrics=\{rollback\} \/>/);
  });
});
