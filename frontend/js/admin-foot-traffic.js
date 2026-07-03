/**
 * frontend/js/admin-foot-traffic.js — Sprint 17.4 (Direction D)
 *
 * Admin foot-traffic dashboard. Reads GET /admin/analytics/foot-traffic
 * (default last 30 days) and renders summary cards + top-pages table + a
 * lightweight pure-CSS daily bar chart (no charting library). Date range is
 * client-side (re-fetch). Class-based styling; the only inline style is the
 * dynamic bar height (layout, not colour) — Pattern #26.
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;
const $ = (id) => document.getElementById(id);
// C4: delegate to the shared escaper (window.WC.escapeHtml, api.js).
const esc = (s) => (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml(s)
  : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function load() {
  const params = new URLSearchParams();
  const from = $('ft-from').value;
  const to = $('ft-to').value;
  if (from) params.set('date_from', new Date(from).toISOString());
  if (to) params.set('date_to', new Date(to).toISOString());
  const qs = params.toString();

  $('ft-loading').hidden = false;
  let data = null;
  try {
    data = await api.get('/admin/analytics/foot-traffic' + (qs ? '?' + qs : ''));
  } catch (err) {
    console.warn('[foot-traffic] fetch failed:', err && err.message);
  }
  $('ft-loading').hidden = true;
  render(data);
}

function render(data) {
  if (!data) {
    $('ft-empty').hidden = false;
    $('ft-body').hidden = true;
    return;
  }
  $('ft-empty').hidden = true;
  $('ft-body').hidden = false;

  $('ft-total').textContent = String(data.total_views || 0);
  $('ft-unique').textContent = String(data.unique_visitors || 0);
  $('ft-anon').textContent = String(data.anonymous_hits || 0);

  const pages = data.top_pages || [];
  $('ft-pages-tbody').innerHTML = pages.length
    ? pages.map((p) => `<tr><td class="code-cell">${esc(p.path)}</td><td class="u-num">${p.views}</td></tr>`).join('')
    : '<tr><td colspan="2" class="ft-muted">Chưa có dữ liệu</td></tr>';

  const daily = data.daily || [];
  const max = Math.max(1, ...daily.map((d) => d.views || 0));
  $('ft-chart').innerHTML = daily.length
    ? daily.map((d) => {
        const pct = Math.round((d.views / max) * 100);
        return `<div class="ft-bar" title="${esc(d.date)}: ${d.views}">`
          + `<div class="ft-bar-fill" style="height:${pct}%"></div>`
          + `<span class="ft-bar-label">${esc(String(d.date).slice(5))}</span></div>`;
      }).join('')
    : '<p class="ft-muted">Chưa có lượt xem nào trong khoảng thời gian này.</p>';
}

function main() {
  $('btn-ft-apply').addEventListener('click', load);
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
