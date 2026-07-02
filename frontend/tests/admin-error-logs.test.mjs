/**
 * frontend/tests/admin-error-logs.test.mjs — Sprint 12.3.
 *
 * Pins the admin Báo lỗi surface at /pages/admin/error-logs/index.html
 * and the controller at /js/admin-error-logs.js. Sentinel-string match
 * against static source — catches:
 *
 *   - Page no longer embeds <aver-admin-chrome active="error-logs">
 *   - Stats grid missing a card (Tổng / Chưa xử lý / 24h / 7d)
 *   - Filter bar missing one of the 3 filters
 *   - Test-error button missing
 *   - Controller missing dismiss/undismiss/refresh wiring
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const HTML = read('pages', 'admin', 'error-logs', 'index.html');
const JS   = read('js', 'admin-error-logs.js');


describe('Sprint 12.3 — error-logs page chrome embed', () => {
  it('uses <aver-admin-chrome active="error-logs">', () => {
    assert.match(HTML, /<aver-admin-chrome\s+active="error-logs"/);
  });
  it('loads aver-admin-chrome.js as a module', () => {
    assert.match(HTML, /<script\s+type="module"\s+src="\/js\/components\/aver-admin-chrome\.js"/);
  });
  it('loads error-reporter.js so the page itself reports its own bugs', () => {
    assert.match(HTML, /<script\s+src="\/js\/error-reporter\.js"/);
  });
  it('loads admin-error-logs.js as the page controller', () => {
    assert.match(HTML, /<script\s+type="module"\s+src="\/js\/admin-error-logs\.js"/);
  });
});


describe('Sprint 12.3 — stats grid (4 cards)', () => {
  it('Tổng số card with data-stat="total"', () => {
    assert.match(HTML, /Tổng số[\s\S]*?data-stat="total"/);
  });
  it('Chưa xử lý card with data-stat="undismissed"', () => {
    assert.match(HTML, /Chưa xử lý[\s\S]*?data-stat="undismissed"/);
  });
  it('24h card with data-stat="last_24h"', () => {
    assert.match(HTML, /data-stat="last_24h"/);
  });
  it('7d card with data-stat="last_7d"', () => {
    assert.match(HTML, /data-stat="last_7d"/);
  });
});


describe('Sprint 12.3 — filter bar (3 dropdowns)', () => {
  it('filter-dismissed defaults to Chưa xử lý (the high-signal default)', () => {
    assert.match(HTML, /id="filter-dismissed"/);
    assert.match(HTML, /<option\s+value="false"\s+selected>Chưa xử lý<\/option>/);
  });
  it('filter-level with error/warning/info', () => {
    assert.match(HTML, /id="filter-level"/);
    assert.match(HTML, /<option\s+value="error">error<\/option>/);
    assert.match(HTML, /<option\s+value="warning">warning<\/option>/);
    assert.match(HTML, /<option\s+value="info">info<\/option>/);
  });
  it('filter-source with frontend/backend', () => {
    assert.match(HTML, /id="filter-source"/);
    assert.match(HTML, /<option\s+value="frontend">Frontend<\/option>/);
    assert.match(HTML, /<option\s+value="backend">Backend<\/option>/);
  });
});


describe('Sprint 12.3 — table + empty state', () => {
  const expected = ['Thời gian', 'Mức độ', 'Nguồn', 'Thông báo', 'URL', 'User', 'Trạng thái'];
  for (const h of expected) {
    it(`table header "${h}" present`, () => {
      assert.ok(HTML.includes(`<th>${h}</th>`), `Missing <th>${h}</th>`);
    });
  }
  it('empty-state copy mentions "tin tốt 🎉"', () => {
    assert.match(HTML, /tin tốt 🎉/);
  });
});


describe('Sprint 12.3 — admin-error-logs.js controller', () => {
  it('GETs /admin/error-logs/stats for the 4 cards', () => {
    assert.match(JS, /\/admin\/error-logs\/stats/);
  });
  it('GETs /admin/error-logs with query params for the table', () => {
    assert.match(JS, /api\.get\(['"]\/admin\/error-logs\?/);
  });
  it('POSTs dismiss endpoint for triage', () => {
    assert.match(JS, /\/admin\/error-logs\/['"]\s*\+\s*\w+\s*\+\s*['"]\/dismiss/);
  });
  it('POSTs undismiss endpoint', () => {
    assert.match(JS, /\/undismiss/);
  });
  it('POSTs test-error endpoint with error_type', () => {
    assert.match(JS, /\/admin\/error-logs\/test\?error_type=/);
  });
  it('escapes HTML in DB-sourced text (defense in depth)', () => {
    assert.match(JS, /function\s+escapeHtml/);
    assert.match(JS, /&amp;/);
    assert.match(JS, /&lt;/);
  });
  it('uses VN locale time formatting', () => {
    assert.match(JS, /toLocaleString\(['"]vi-VN['"]/);
  });
});

describe('2026-07-02 — noise filter + humanize', () => {
  it('HTML has the default-on "Ẩn nhiễu" checkbox', () => {
    assert.match(HTML, /id="filter-hide-noise"[^>]*checked/);
  });
  it('renderTable filters noise rows when the checkbox is checked', () => {
    assert.match(JS, /filter-hide-noise'\)\s*&&\s*\$\('filter-hide-noise'\)\.checked/);
    assert.match(JS, /_rows\.filter\(\(r\)\s*=>\s*!humanizeError\(r\)\.noise\)/);
  });
  it('generateTestError un-hides noise so the dogfood row stays visible', () => {
    // Pin the P2 fix: the "Tạo lỗi test" row is noise; the helper must clear the
    // hide-noise filter or the generated row is hidden by the default-on filter.
    const fn = JS.slice(JS.indexOf('async function generateTestError'),
                        JS.indexOf('function bind()'));
    assert.match(fn, /filter-hide-noise/);
    assert.match(fn, /\.checked\s*=\s*false/);
  });
  it('humanizeError categorises DB, third-party, and test entries', () => {
    assert.match(JS, /function humanizeError/);
    assert.match(JS, /Bên thứ 3/);
    assert.match(JS, /category:\s*'CSDL'/);
    assert.match(JS, /Thử nghiệm/);
  });
});
