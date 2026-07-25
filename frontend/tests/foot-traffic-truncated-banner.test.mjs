/**
 * foot-traffic-truncated-banner.test.mjs — DEBT-2026-07-22-G (frontend half).
 *
 * The backend read is paged now, but it still carries a MAX_ROWS ceiling and
 * reports `truncated: true` when it bites. That flag is worthless if nothing
 * renders it — the original defect was never the cap itself, it was a capped
 * number presenting itself as a complete one ("TỔNG LƯỢT XEM 1000" over a
 * window that actually held 2350 views).
 *
 * Runs the real render() against a stub DOM.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const js = read('frontend/js/admin-foot-traffic.js');
const html = read('frontend/pages/admin/foot-traffic/index.html');

function runRender(data) {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { id, hidden: false, textContent: '', innerHTML: '' });
    return els.get(id);
  };
  const src = js.slice(js.indexOf('function render(data)'), js.indexOf('function main()'));
  const fn = new Function('$', 'esc', src + '\nreturn render;')(el, (s) => String(s));
  fn(data);
  return els;
}

const base = {
  total_views: 2350, unique_visitors: 37, anonymous_hits: 4,
  top_pages: [{ path: '/home', views: 1200 }], daily: [{ date: '2026-06-01', views: 10 }],
};

describe('DEBT-G — the truncation flag is actually rendered', () => {
  test('truncated:true → banner visible and says the numbers are incomplete', () => {
    const els = runRender({ ...base, truncated: true });
    const banner = els.get('ft-truncated');
    assert.equal(banner.hidden, false);
    assert.match(banner.textContent, /CHƯA đầy đủ/);
    assert.match(banner.textContent, /thu hẹp khoảng ngày/);
  });

  test('truncated:false → banner hidden, numbers stand on their own', () => {
    const els = runRender({ ...base, truncated: false });
    assert.equal(els.get('ft-truncated').hidden, true);
    assert.equal(els.get('ft-total').textContent, '2350');
  });

  test('a response with no truncated field (older cache) → banner hidden', () => {
    const els = runRender(base);
    assert.equal(els.get('ft-truncated').hidden, true);
  });

  test('the banner element exists on the page', () => {
    assert.match(html, /id="ft-truncated"[^>]*hidden/);
    assert.match(html, /role="status"/);
  });
});
