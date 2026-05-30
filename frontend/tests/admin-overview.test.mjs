/**
 * frontend/tests/admin-overview.test.mjs — Sprint 12.4.
 *
 * Pins the Tổng quan landing redesign at /pages/admin/index.html and
 * the controller at /js/admin-overview.js. Sentinel-string match
 * against static source — catches:
 *
 *   - Chrome embed regression
 *   - Top 4 stat tiles missing one of the canonical metrics
 *   - 5 skill cards missing one of the skill data-attributes
 *   - Activity feed container missing
 *   - Refresh button + auto-refresh wiring lost
 *   - Click-through navigation on error + access-codes tiles
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const HTML = read('pages', 'admin', 'index.html');
const JS   = read('js', 'admin-overview.js');


describe('Sprint 12.4 — Tổng quan landing chrome embed', () => {
  it('uses <aver-admin-chrome active="overview">', () => {
    assert.match(HTML, /<aver-admin-chrome\s+active=["']overview["']/);
  });
  it('loads aver-admin-chrome.js as a module', () => {
    assert.match(HTML, /<script\s+type="module"\s+src="\/js\/components\/aver-admin-chrome\.js"/);
  });
  it('loads error-reporter.js so the landing reports its own bugs', () => {
    assert.match(HTML, /<script\s+src="\/js\/error-reporter\.js"/);
  });
  it('loads admin-overview.js as the page controller', () => {
    assert.match(HTML, /<script\s+type="module"\s+src="\/js\/admin-overview\.js"/);
  });
});


describe('Sprint 12.4 — 4 stat tiles', () => {
  const tiles = [
    { id: 'students-total',      value: 'students-total' },
    { id: 'students-active',     value: 'students-active-7d' },
    { id: 'errors-undismissed',  value: 'errors-undismissed' },
    { id: 'access-codes',        value: 'access-codes-active' },
  ];
  for (const t of tiles) {
    it(`stat tile "${t.id}" with [data-value="${t.value}"]`, () => {
      assert.match(HTML, new RegExp(`data-tile="${t.id}"`));
      assert.match(HTML, new RegExp(`data-value="${t.value}"`));
    });
  }

  it('errors tile is clickable → /admin/error-logs', () => {
    assert.match(
      HTML,
      /data-tile="errors-undismissed"\s+href="\/pages\/admin\/error-logs\/index\.html"/,
    );
  });

  it('access-codes tile is clickable → /admin/access-codes', () => {
    assert.match(
      HTML,
      /data-tile="access-codes"\s+href="\/pages\/admin\/access-codes\/index\.html"/,
    );
  });
});


describe('Sprint 12.4 — 5 skill cards', () => {
  const skills = ['speaking', 'writing', 'listening', 'vocab', 'grammar'];
  for (const s of skills) {
    it(`skill card "${s}" exists with [data-skill="${s}"]`, () => {
      assert.match(HTML, new RegExp(`data-skill="${s}"`));
    });
    it(`skill "${s}" has 7-day stat slot`, () => {
      assert.match(HTML, new RegExp(`data-skill-7d="${s}"`));
    });
  }

  it('all 5 skill cards link to their hubs (no is-placeholder remaining)', () => {
    // Sprint 12.7 graduated Grammar — every skill card is now LIVE.
    // design-fix-2 B4: skill cards reuse the shared .admin-hub-card primitive.
    assert.match(HTML, /href="\/pages\/admin\/speaking\/index\.html"[^>]*class="admin-hub-card"\s+data-skill="speaking"/);
    assert.match(HTML, /href="\/pages\/admin\/writing\/index\.html"[^>]*class="admin-hub-card"\s+data-skill="writing"/);
    assert.match(HTML, /href="\/pages\/admin\/listening\/index\.html"[^>]*class="admin-hub-card"\s+data-skill="listening"/);
    assert.match(HTML, /href="\/pages\/admin\/vocab\/index\.html"[^>]*class="admin-hub-card"\s+data-skill="vocab"/);
    assert.match(HTML, /href="\/pages\/admin\/grammar\/index\.html"[^>]*class="admin-hub-card"\s+data-skill="grammar"/);
  });

  it('no skill card carries is-placeholder anymore', () => {
    // The placeholder roster (Sprint 12.4 — Vocab/Grammar/Speaking)
    // was cleared by 12.5/12.6/12.7. Any remaining `is-placeholder`
    // must be on a non-skill surface; pin that no `data-skill=` card
    // still wears the class.
    assert.doesNotMatch(HTML, /class="admin-hub-card is-placeholder"\s+data-skill=/);
  });
});


describe('Sprint 12.4 — recent activity feed', () => {
  it('container present with loading + empty + rows slots', () => {
    assert.match(HTML, /id="activity-loading"/);
    assert.match(HTML, /id="activity-empty"/);
    assert.match(HTML, /id="activity-rows"/);
  });
  it('section title "Hoạt động gần đây"', () => {
    assert.match(HTML, /Hoạt động gần đây/);
  });
});


describe('Sprint 12.4 — refresh + relative-time label', () => {
  it('refresh button present', () => {
    assert.match(HTML, /id="btn-refresh"/);
    assert.match(HTML, /Tải lại/);
  });
  it('last-refresh label slot present', () => {
    assert.match(HTML, /id="last-refresh"/);
  });
});


describe('Sprint 12.4 — admin-overview.js controller', () => {
  it('GETs /admin/overview', () => {
    assert.match(JS, /api\.get\(['"]\/admin\/overview['"]\)/);
  });
  it('auto-refreshes every 5 minutes', () => {
    assert.match(JS, /REFRESH_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
    assert.match(JS, /setInterval/);
  });
  it('pauses on visibilitychange when hidden', () => {
    assert.match(JS, /visibilitychange/);
    assert.match(JS, /stopAutoRefresh/);
  });
  it('refreshes on focus when stale (≥5min)', () => {
    assert.match(JS, /Date\.now\(\)\s*-\s*_lastFetchAt\s*>=\s*REFRESH_MS/);
  });
  it('escapes HTML in DB-sourced text (defense in depth)', () => {
    assert.match(JS, /function\s+escapeHtml/);
    assert.match(JS, /&amp;/);
    assert.match(JS, /&lt;/);
  });
  it('VN-locale formatting on timestamps + relative phrases', () => {
    assert.match(JS, /toLocaleString\(['"]vi-VN['"]/);
    assert.match(JS, /Cập nhật/);
  });
  it('warning class applied when undismissed errors > 0', () => {
    assert.match(JS, /is-warning/);
  });
});
