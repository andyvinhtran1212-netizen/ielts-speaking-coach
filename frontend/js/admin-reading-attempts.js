/**
 * frontend/js/admin-reading-attempts.js — reading-access-tracking Part C.
 *
 * Admin "Reading — Lượt làm bài" dashboard.
 *   • GET /admin/dashboard/reading-attempts?days=N → KPI tiles + skill bars +
 *     band distribution + per-test usage + recent attempts.
 * Reuses the ops-dashboard plumbing (window select, monotonic race-guard,
 * manual refresh, Pattern #29 banner). Distributions render as token-clean
 * CSS bars (data is categorical, not a time series).
 *
 * Honesty + privacy:
 *   • Authenticated distinct users are EXACT; anonymous sources are APPROXIMATE
 *     (salted-IP-hash dedupe limit, #370) — labelled "xấp xỉ".
 *   • The salted anon_src hash is NEVER returned by the backend, so it never
 *     reaches this view; anonymous rows render as "Ẩn danh", never an IP.
 * XSS-safe: every interpolated value is escaped before innerHTML.
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

const SKILL_LABEL = {
  skimming: 'Đọc lướt', scanning: 'Định vị', detail: 'Chi tiết', main_idea: 'Ý chính',
  inference: 'Suy luận', vocabulary_in_context: 'Từ vựng', reference_cohesion: 'Liên kết',
  writer_view_TFNG: 'Quan điểm (T/F/NG)',
};

function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const dash = (v) => (v == null ? '—' : v);
function fmtInt(v) {
  if (v == null) return '—';
  try { return Number(v).toLocaleString('vi-VN'); } catch { return String(v); }
}
function fmtWhen(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('vi-VN'); } catch { return iso; }
}

let _reqId = 0;   // monotonic — drops stale responses on rapid window switches

function showBanner(msg) {
  showToast(msg, 'error', { persist: true });
}
function clearBanner() {
  clearToasts();
}

function setLoading(on) {
  document.querySelectorAll('.db-card--windowed').forEach((c) => c.classList.toggle('is-loading', on));
  const btn = $('rd-refresh'); if (btn) btn.disabled = on;
}

function renderTotals(d) {
  const t = d.totals || {};
  $('rd-total-alltime').textContent = fmtInt(t.submitted_all_time);
  $('rd-total-window').textContent = fmtInt(t.submitted_window);
  // Auth-vs-anonymous split — honest units (auth exact distinct; anon attempts).
  $('rd-split').textContent =
    fmtInt(t.auth_attempts) + ' đăng nhập · ' + fmtInt(t.anon_attempts) + ' ẩn danh';
  $('rd-auth-users').textContent = fmtInt(t.auth_distinct_users);
  $('rd-anon-sources').textContent = '≈ ' + fmtInt(t.anon_distinct_sources);

  const ts = d.time_stats || {};
  $('rd-time-avg').textContent = ts.avg_minutes == null ? '—' : ts.avg_minutes + ' phút';
  $('rd-time-sub').textContent = (ts.median_minutes == null)
    ? '' : 'trung vị ' + ts.median_minutes + ' phút · ' + fmtInt(ts.count) + ' lượt có giờ';

  const win = d.window_days;
  if (win != null) document.querySelectorAll('.rd-window-lbl').forEach((el) => { el.textContent = win; });

  // Truncation note — never imply full coverage on a sampled window.
  const tr = $('rd-trunc');
  if (tr) {
    if (t.truncated) {
      tr.textContent = 'Cửa sổ này có nhiều lượt hơn giới hạn xử lý — số liệu phân bố là MẪU (xấp xỉ).';
      tr.hidden = false;
    } else { tr.hidden = true; }
  }
}

function renderBars(hostId, items, opts) {
  const host = $(hostId);
  if (!host) return;
  if (!items.length) { host.innerHTML = '<div class="rd-empty">Chưa có dữ liệu.</div>'; return; }
  const max = Math.max(1, ...items.map((i) => i.value));
  host.innerHTML = items.map((i) => {
    const pct = Math.round((i.value / max) * 100);
    const weak = opts && opts.weakKeys && opts.weakKeys.has(i.key);
    return '<div class="rd-bar' + (weak ? ' is-weak' : '') + '">' +
      '<span class="rd-bar__label" title="' + escapeHtml(i.label) + '">' + escapeHtml(i.label) + '</span>' +
      '<span class="rd-bar__track"><span class="rd-bar__fill" style="width:' + pct + '%"></span></span>' +
      '<span class="rd-bar__val">' + escapeHtml(i.valLabel) + '</span>' +
    '</div>';
  }).join('');
}

function renderSkills(d) {
  const skills = d.skill_performance || [];
  // Weakest two (lowest accuracy, with data) flagged red — the actionable cue.
  const weakKeys = new Set(
    skills.filter((s) => s.accuracy != null).slice(0, 2).map((s) => s.skill_tag));
  const items = skills.map((s) => ({
    key: s.skill_tag,
    label: SKILL_LABEL[s.skill_tag] || s.skill_tag,
    value: s.accuracy == null ? 0 : Math.round(s.accuracy * 100),
    valLabel: (s.accuracy == null ? '—' : Math.round(s.accuracy * 100) + '%') +
      ' (' + fmtInt(s.correct) + '/' + fmtInt(s.total) + ')',
  }));
  renderBars('rd-skills', items, { weakKeys });
}

function renderBands(d) {
  const items = (d.band_distribution || []).map((b) => ({
    key: String(b.band),
    label: 'Band ' + b.band,
    value: b.count,
    valLabel: fmtInt(b.count),
  }));
  renderBars('rd-bands', items, null);
}

function renderPerTest(d) {
  const rows = d.per_test || [];
  const tbody = $('rd-pertest');
  const empty = $('rd-pertest-empty');
  if (!rows.length) { tbody.innerHTML = ''; if (empty) empty.hidden = false; return; }
  if (empty) empty.hidden = true;
  tbody.innerHTML = rows.map((p) =>
    '<tr>' +
      '<td>' + escapeHtml(p.title) + '</td>' +
      '<td class="num">' + fmtInt(p.attempts) + '</td>' +
      '<td class="num">' + fmtInt(p.auth) + '</td>' +
      '<td class="num">' + fmtInt(p.anon) + '</td>' +
      '<td class="num">' + (p.avg_band == null ? '—' : escapeHtml(p.avg_band)) + '</td>' +
    '</tr>'
  ).join('');
}

function renderRecent(d) {
  const rows = d.recent || [];
  const tbody = $('rd-recent');
  const empty = $('rd-recent-empty');
  if (!rows.length) { tbody.innerHTML = ''; if (empty) empty.hidden = false; return; }
  if (empty) empty.hidden = true;
  tbody.innerHTML = rows.map((r) => {
    const pill = r.is_anonymous
      ? '<span class="rd-pill rd-pill--anon">Ẩn danh</span>'
      : '<span class="rd-pill rd-pill--auth">' + escapeHtml(r.who) + '</span>';
    return '<tr>' +
      '<td>' + escapeHtml(fmtWhen(r.submitted_at)) + '</td>' +
      '<td>' + escapeHtml(r.test_title) + '</td>' +
      '<td>' + pill + '</td>' +
      '<td class="num">' + (r.band == null ? '—' : escapeHtml(r.band)) + '</td>' +
      '<td class="num">' + (r.time_minutes == null ? '—' : escapeHtml(r.time_minutes) + ' ph') + '</td>' +
    '</tr>';
  }).join('');
}

function render(d) {
  renderTotals(d);
  renderSkills(d);
  renderBands(d);
  renderPerTest(d);
  renderRecent(d);
  if (d.computed_at) $('rd-updated').textContent = 'Cập nhật lúc ' + fmtWhen(d.computed_at);
}

async function load() {
  clearBanner();
  const myId = ++_reqId;
  const win = ($('rd-window') && $('rd-window').value) || '30';
  setLoading(true);
  try {
    const d = await api.get('/admin/dashboard/reading-attempts?days=' + encodeURIComponent(win));
    if (myId !== _reqId) return;   // superseded — drop
    render(d || {});
  } catch (e) {
    if (myId !== _reqId) return;
    showBanner('Không tải được số liệu: ' + ((e && e.message) || 'lỗi'));
  } finally {
    if (myId === _reqId) setLoading(false);
  }
}

function wire() {
  if ($('rd-window')) $('rd-window').addEventListener('change', load);
  if ($('rd-refresh')) $('rd-refresh').addEventListener('click', load);
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
