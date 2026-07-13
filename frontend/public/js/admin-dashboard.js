/**
 * frontend/js/admin-dashboard.js — admin ops Dashboard.
 *
 *   • GET /admin/dashboard/overview  → KPI tiles + "Cần chú ý" counts
 *   • GET /admin/dashboard/trends    → per-tile sparklines + deltas + chart
 * Charts are zero-dep inline SVG (js/charts/sparkline.js → window.avCharts).
 *
 * dashboard-tweaks:
 *   1. All-time tiles (users, codes, practices, grading) keep their value on a
 *      window switch — only the WINDOWED tiles (visitors, tokens) + chart show a
 *      loading shimmer and update, so the all-time numbers never look "affected
 *      by the window".
 *   2. "Token đã gọi" replaces the cost tile — total AI tokens (prompt+completion)
 *      across all agents, windowed by the selector, formatted K/M/B.
 *   3. The window <select> + "Làm mới" re-fetch immediately with a loading state;
 *      a monotonic request id drops stale responses so rapid switches can't race
 *      or freeze the UI.
 * Pattern #29: a NULL metric renders "—"; a whole-request failure shows a banner;
 * the trends fetch is best-effort (tiles still render without it).
 */

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
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
// Compact token formatting: 1234 → "1.2K", 3.4e6 → "3.4M", 1.2e9 → "1.2B".
function fmtTokens(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  const unit = (val, suffix) => (val.toFixed(1).replace(/\.0$/, '') + suffix);
  if (n >= 1e9) return unit(n / 1e9, 'B');
  if (n >= 1e6) return unit(n / 1e6, 'M');
  if (n >= 1e3) return unit(n / 1e3, 'K');
  return String(n);
}

let _trends = null;
let _activeSeries = 'practices';
let _reqId = 0;   // monotonic — drops stale responses (Item 3 race guard)

function showBanner(msg) {
  showToast(msg, 'error', { persist: true });
}
function clearBanner() {
  clearToasts();
}

// scope: 'windowed' → only the windowed value-tiles + chart; 'all' → every tile.
function setLoading(on, scope) {
  const sel = scope === 'all' ? '.db-card' : '.db-card--windowed';
  document.querySelectorAll(sel).forEach((c) => c.classList.toggle('is-loading', on));
  const chart = $('db-trend-chart');
  if (chart) chart.classList.toggle('is-loading', on);
  const btn = $('db-refresh');
  if (btn) btn.disabled = on;
}

function renderOverview(data) {
  $('m-users').textContent = fmtInt(data.total_users);
  $('m-codes').textContent = fmtInt(data.active_codes);
  $('m-practices').textContent = fmtInt(data.total_practices);
  $('m-grading').textContent = dash(data.grading_minutes);

  const dv = data.distinct_visitors || {};
  $('m-visitors').textContent = fmtInt(dv.count);
  // viewers-anonymous: auth-vs-anonymous split. Honest units — authenticated is
  // distinct users; anonymous is page-view hits (no dedup id available).
  const vsplit = $('m-visitors-split');
  if (vsplit) {
    vsplit.textContent = (dv.authenticated == null && dv.anonymous == null)
      ? ''
      : fmtInt(dv.authenticated) + ' đăng nhập · ' + fmtInt(dv.anonymous) + ' lượt ẩn danh';
  }

  const tok = data.tokens_called || {};
  $('m-tokens').textContent = fmtTokens(tok.count);

  // Both windowed tiles share the active window in their label.
  const win = (dv.window_days != null) ? dv.window_days
            : (tok.window_days != null ? tok.window_days : null);
  if (win != null) document.querySelectorAll('.m-window').forEach((el) => { el.textContent = win; });

  const attn = data.attention || {};
  $('a-errors').textContent = fmtInt(attn.errors_undismissed);
  $('a-writing').textContent = fmtInt(attn.writing_pending);

  if (data.computed_at) {
    let when = data.computed_at;
    try { when = new Date(data.computed_at).toLocaleString('vi-VN'); } catch { /* keep iso */ }
    $('db-updated').textContent = 'Cập nhật lúc ' + when;
  }
}

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
  renderSpark('spark-visitors', series.visitors);
  renderSpark('spark-practices', series.practices);
  renderSpark('spark-tokens', series.tokens);
  renderDelta('d-visitors', series.visitors);
  renderDelta('d-practices', series.practices);
  renderDelta('d-tokens', series.tokens);
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
  document.querySelectorAll('.db-trend-tab').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-series') === key);
  });
}

// scope: 'windowed' (window switch — all-time tiles stay put) or 'all' (refresh/init).
async function load(scope) {
  scope = scope || 'all';
  clearBanner();
  const myId = ++_reqId;
  const win = ($('db-window') && $('db-window').value) || '30';
  setLoading(true, scope);

  try {
    const data = await api.get('/admin/dashboard/overview?visitors_window=' + encodeURIComponent(win));
    if (myId !== _reqId) return;   // superseded by a newer request — drop
    renderOverview(data || {});
  } catch (e) {
    if (myId !== _reqId) return;
    showBanner('Không tải được số liệu: ' + ((e && e.message) || 'lỗi'));
  }

  try {
    const trends = await api.get('/admin/dashboard/trends?days=' + encodeURIComponent(win));
    if (myId !== _reqId) return;
    renderTrends(trends || {});
  } catch (e) {
    if (myId !== _reqId) return;
    renderChart(_activeSeries);   // best-effort — tiles already rendered
  }

  if (myId === _reqId) setLoading(false, scope);
}

function wire() {
  // Window switch → immediate re-fetch; only the windowed tiles + chart reload.
  if ($('db-window')) $('db-window').addEventListener('change', () => load('windowed'));
  if ($('db-refresh')) $('db-refresh').addEventListener('click', () => load('all'));
  const tabs = $('db-trend-tabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.db-trend-tab');
      if (btn) renderChart(btn.getAttribute('data-series'));   // local — no fetch
    });
  }
  load('all');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
