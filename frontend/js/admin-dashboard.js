/**
 * frontend/js/admin-dashboard.js — Sprint 18.2 (Direction B)
 *
 * Drives the admin Dashboard: fetches GET /admin/dashboard/overview and paints
 * 6 ops metric cards. The distinct-visitors window selector (7/30/90) + the
 * "Làm mới" button re-fetch. Pattern #29: a NULL metric renders as "—" (the
 * endpoint already degrades gracefully per sub-query), and a whole-request
 * failure shows a banner without throwing.
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

// NULL metric → "—" placeholder (graceful degradation, not a crash).
const dash = (v) => (v == null ? '—' : v);

function fmtInt(v) {
  if (v == null) return '—';
  try { return Number(v).toLocaleString('vi-VN'); } catch { return String(v); }
}

function fmtCost(v) {
  if (v == null) return '—';
  return '$' + Number(v).toFixed(2);
}

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

function render(data) {
  $('m-users').textContent = fmtInt(data.total_users);
  $('m-codes').textContent = fmtInt(data.active_codes);

  const dv = data.distinct_visitors || {};
  $('m-visitors').textContent = fmtInt(dv.count);
  if (dv.window_days != null) $('m-visitors-window').textContent = dv.window_days;

  $('m-practices').textContent = fmtInt(data.total_practices);
  $('m-grading').textContent = dash(data.grading_minutes);
  $('m-cost').textContent = fmtCost(data.monthly_cost_usd);

  if (data.computed_at) {
    let when = data.computed_at;
    try { when = new Date(data.computed_at).toLocaleString('vi-VN'); } catch { /* keep iso */ }
    $('db-updated').textContent = 'Cập nhật lúc ' + when;
  }
}

async function load() {
  clearBanner();
  const win = ($('db-window') && $('db-window').value) || '30';
  try {
    const data = await api.get('/admin/dashboard/overview?visitors_window=' + encodeURIComponent(win));
    render(data || {});
  } catch (e) {
    showBanner('Không tải được số liệu: ' + ((e && e.message) || 'lỗi'));
  }
}

function wire() {
  if ($('db-window')) $('db-window').addEventListener('change', load);
  if ($('db-refresh')) $('db-refresh').addEventListener('click', load);
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
