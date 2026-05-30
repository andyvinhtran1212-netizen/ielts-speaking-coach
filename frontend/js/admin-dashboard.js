/**
 * frontend/js/admin-dashboard.js — admin-dashboard-redesign.
 *
 * Drives the ops Dashboard:
 *   • GET /admin/dashboard/overview  → 6 KPI tiles + "Cần chú ý" counts
 *   • GET /admin/dashboard/trends    → per-tile sparklines + deltas + the
 *                                      daily trends chart
 * Charts are zero-dep inline SVG (js/charts/sparkline.js → window.avCharts).
 * Pattern #29: a NULL metric renders "—"; a whole-request failure shows a
 * banner; and the trends endpoint degrades gracefully (if it 404s — e.g.
 * before the backend deploys — the tiles still render, just without
 * sparklines/chart). The window selector + "Làm mới" re-fetch both.
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
const charts = () => window.avCharts || {};

const dash = (v) => (v == null ? '—' : v);
function fmtInt(v) {
  if (v == null) return '—';
  try { return Number(v).toLocaleString('vi-VN'); } catch { return String(v); }
}
function fmtCost(v) {
  if (v == null) return '—';
  return '$' + Number(v).toFixed(2);
}

// Latest trend series payload, kept so the chart tab switch can re-render
// without re-fetching.
let _trends = null;
let _activeSeries = 'practices';

function showBanner(msg) {
  const el = $('db-banner');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}
function clearBanner() {
  const el = $('db-banner');
  if (el) el.hidden = true;
}

function renderOverview(data) {
  $('m-users').textContent = fmtInt(data.total_users);
  $('m-codes').textContent = fmtInt(data.active_codes);

  const dv = data.distinct_visitors || {};
  $('m-visitors').textContent = fmtInt(dv.count);
  if (dv.window_days != null) $('m-visitors-window').textContent = dv.window_days;

  $('m-practices').textContent = fmtInt(data.total_practices);
  $('m-grading').textContent = dash(data.grading_minutes);
  $('m-cost').textContent = fmtCost(data.monthly_cost_usd);

  const attn = data.attention || {};
  $('a-errors').textContent = fmtInt(attn.errors_undismissed);
  $('a-writing').textContent = fmtInt(attn.writing_pending);

  if (data.computed_at) {
    let when = data.computed_at;
    try { when = new Date(data.computed_at).toLocaleString('vi-VN'); } catch { /* keep iso */ }
    $('db-updated').textContent = 'Cập nhật lúc ' + when;
  }
}

// Per-tile delta chip from a daily series (recent half vs prior half).
function renderDelta(id, series) {
  const el = $(id);
  if (!el) return;
  const d = charts().periodDelta ? charts().periodDelta(series) : null;
  if (!d) { el.hidden = true; return; }
  el.classList.remove('is-up', 'is-down', 'is-flat');
  el.classList.add('is-' + d.dir);
  const arrow = d.dir === 'up' ? '▲' : (d.dir === 'down' ? '▼' : '→');
  el.textContent = arrow + (d.pct == null ? '' : ' ' + Math.abs(d.pct) + '%');
  el.hidden = false;
}

function renderSpark(hostId, series) {
  const host = $(hostId);
  if (!host || !charts().sparkline) return;
  host.innerHTML = charts().sparkline(series || []);
}

function renderTrends(trends) {
  _trends = trends;
  const series = (trends && trends.series) || {};
  // Sparklines + deltas on the trend-having tiles.
  renderSpark('spark-visitors', series.visitors);
  renderSpark('spark-practices', series.practices);
  renderSpark('spark-cost', series.cost_usd);
  renderDelta('d-visitors', series.visitors);
  renderDelta('d-practices', series.practices);
  renderDelta('d-cost', series.cost_usd);
  renderChart(_activeSeries);
}

function renderChart(key) {
  _activeSeries = key;
  const host = $('db-trend-chart');
  if (!host) return;
  const series = (_trends && _trends.series && _trends.series[key]) || null;
  if (!series || !series.length || !charts().areaChart) {
    host.innerHTML = '<div class="db-trends__empty">Chưa có dữ liệu xu hướng.</div>';
    return;
  }
  host.innerHTML = charts().areaChart(series);
  // Reflect the active tab.
  document.querySelectorAll('.db-trend-tab').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-series') === key);
  });
}

async function load() {
  clearBanner();
  const win = ($('db-window') && $('db-window').value) || '30';
  // Overview is the critical fetch; trends is best-effort (graceful).
  try {
    const data = await api.get('/admin/dashboard/overview?visitors_window=' + encodeURIComponent(win));
    renderOverview(data || {});
  } catch (e) {
    showBanner('Không tải được số liệu: ' + ((e && e.message) || 'lỗi'));
  }
  try {
    const trends = await api.get('/admin/dashboard/trends?days=' + encodeURIComponent(win));
    renderTrends(trends || {});
  } catch (e) {
    // Degrade silently — tiles already rendered; just clear the chart loader.
    renderChart(_activeSeries);
  }
}

function wire() {
  if ($('db-window')) $('db-window').addEventListener('change', load);
  if ($('db-refresh')) $('db-refresh').addEventListener('click', load);
  const tabs = $('db-trend-tabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.db-trend-tab');
      if (btn) renderChart(btn.getAttribute('data-series'));
    });
  }
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
