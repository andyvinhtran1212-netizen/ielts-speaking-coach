/**
 * foot-traffic-truncated-banner.test.mjs — DEBT-2026-07-22-G (frontend half).
 *
 * The backend read is paged now, but it still carries a MAX_ROWS ceiling and
 * reports `truncated: true` when it bites. That flag is worthless if nothing
 * renders it — the original defect was never the cap itself, it was a capped
 * number presenting itself as a complete one ("TỔNG LƯỢT XEM 1000" over a
 * window that actually held 2350 views).
 *
 * Runs the Next payload model and pins the Next banner.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// LEGACYJS-0075 W4a — admin-foot-traffic.js is retired. The Next owner renders
// the banner from the normalized payload; the backend sets data_status
// "partial" whenever it sets truncated (backend/routers/admin.py foot_traffic).
const tsx = read('frontend/app/(authed-admin)/(foot-traffic)/admin/foot-traffic/admin-foot-traffic.tsx');
const html = read('frontend/pages/admin/foot-traffic/index.html');
const M = await import(path.join(REPO, 'frontend/lib/admin-foot-traffic-model.mjs'));

const base = {
  data_status: 'complete', total_views: 2350, unique_visitors: 37, anonymous_hits: 4,
  snapshot_to: '2026-06-02T00:00:00Z', effective_to: '2026-06-02T00:00:00Z',
  top_pages: [{ path: '/home', views: 1200 }], daily: [{ date: '2026-06-01', views: 10 }],
};

describe('DEBT-G — the truncation flag is actually rendered', () => {
  test('partial/truncated → warning banner says the numbers are incomplete', () => {
    const payload = M.normalizeFootTrafficPayload({ ...base, data_status: 'partial', truncated: true });
    assert.equal(payload.status, 'partial');
    assert.equal(payload.truncated, true);
    assert.match(tsx, /const partial = payload\?\.status === 'partial'/);
    assert.match(tsx, /\{partial && <div className="aft-banner is-warning" role="status">[^\n]*chưa đầy đủ[^\n]*thu hẹp khoảng ngày/);
    assert.equal(M.formatTrafficCount(payload.totalViews, true), `≥ ${(2350).toLocaleString('vi-VN')}`);
  });

  test('complete → no banner, numbers stand on their own', () => {
    const payload = M.normalizeFootTrafficPayload({ ...base, truncated: false });
    assert.equal(payload.status, 'complete');
    assert.equal(payload.truncated, false);
    assert.equal(M.formatTrafficCount(payload.totalViews, false), (2350).toLocaleString('vi-VN'));
  });

  test('a response with no data_status (older cache) is rejected, not shown as complete', () => {
    const { data_status: _omit, ...older } = base;
    assert.equal(M.normalizeFootTrafficPayload(older), null);
  });

  test('the banner element exists on the retired page fixture (ADR-005)', () => {
    assert.match(html, /id="ft-truncated"[^>]*hidden/);
    assert.match(html, /role="status"/);
  });
});
