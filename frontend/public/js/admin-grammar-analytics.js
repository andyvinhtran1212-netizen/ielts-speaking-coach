/**
 * frontend/js/admin-grammar-analytics.js — Sprint 12.7.
 *
 * Renders aggregate stats for the Grammar Wiki:
 *   - 4 stat tiles (total views, recent views, total saves, zero-view count)
 *   - Top 20 articles by views
 *   - Top 5 articles by saves
 *   - Zero-view articles (content gap signal)
 *
 * Wired endpoint (new in Sprint 12.7):
 *   GET /admin/grammar/analytics?days=N
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
let loadSequence = 0;
let lastSnapshot = null;

function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setStat(key, val) {
  document.querySelectorAll(`[data-stat="${key}"]`).forEach((el) => {
    el.textContent = val == null ? '—' : String(val);
  });
}

async function load() {
  const days = parseInt($('gan-days').value, 10) || 7;
  const requestId = ++loadSequence;
  $('top-loading').hidden = false;
  $('saved-loading').hidden = false;
  $('zero-loading').hidden = false;
  $('gan-error').hidden = true;
  try {
    const data = await api.get('/admin/grammar/analytics?days=' + days);
    if (requestId !== loadSequence) return;
    lastSnapshot = { days, data };
    const status = data.analytics_status || {};
    setStat('views_total',    data.views_total);
    setStat('views_recent',   data.active_view_records_recent);
    setStat('saves_total',    data.saves_total);
    setStat('zero_view_total', data.zero_view_total);
    setStat('articles_total', data.articles_total);

    const hint = document.querySelector('[data-stat="window-hint"]');
    if (hint) hint.textContent = 'Học viên × article có lần xem cuối trong ' + days + ' ngày';

    // Highlight the zero-view tile if there are gaps
    const zeroTile = $('gan-zero-tile');
    if (zeroTile) {
      zeroTile.classList.toggle('is-warn', (data.zero_view_total || 0) > 0);
    }

    renderTopViewed(status.views === 'complete' ? (data.top_viewed || []) : null);
    renderTopSaved(status.saves === 'complete' ? (data.top_saved || []) : null);
    renderZeroView(status.views === 'complete' ? (data.zero_view_slugs || []) : null);
  } catch (e) {
    if (requestId !== loadSequence) return;
    $('top-loading').hidden = true;
    $('saved-loading').hidden = true;
    $('zero-loading').hidden = true;
    $('gan-error').textContent = 'Không tải được analytics: ' + (e && e.message || 'lỗi');
    $('gan-error').hidden = false;
    if (!lastSnapshot || lastSnapshot.days !== days) {
      setStat('views_total', null); setStat('views_recent', null); setStat('saves_total', null);
      setStat('zero_view_total', null); setStat('articles_total', null);
      renderTopViewed(null); renderTopSaved(null); renderZeroView(null);
    }
  }
}

function renderTopViewed(rows) {
  const tbody = $('top-tbody');
  $('top-loading').hidden = true;
  if (rows == null) {
    $('top-empty').textContent = 'Nguồn views không khả dụng — không đồng nghĩa với 0.';
    $('top-empty').hidden = false;
    $('top-wrap').hidden = true;
    return;
  }
  if (!rows.length) {
    $('top-empty').hidden = false;
    $('top-wrap').hidden = true;
    return;
  }
  $('top-wrap').hidden = false;
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td class="gan-num">${i + 1}</td>
      <td>${escapeHtml(r.title || r.slug)}</td>
      <td><span class="gan-chip">${escapeHtml(r.category || '—')}</span></td>
      <td class="gan-num">${r.count}</td>
    </tr>
  `).join('');
  $('top-empty').hidden = true;
}

function renderTopSaved(rows) {
  const tbody = $('saved-tbody');
  $('saved-loading').hidden = true;
  if (rows == null) {
    $('saved-empty').textContent = 'Nguồn saves không khả dụng — không đồng nghĩa với 0.';
    $('saved-empty').hidden = false;
    $('saved-wrap').hidden = true;
    return;
  }
  if (!rows.length) {
    $('saved-empty').hidden = false;
    $('saved-wrap').hidden = true;
    return;
  }
  $('saved-wrap').hidden = false;
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td class="gan-num">${i + 1}</td>
      <td>${escapeHtml(r.title || r.slug)}</td>
      <td><span class="gan-chip">${escapeHtml(r.category || '—')}</span></td>
      <td class="gan-num">${r.count}</td>
    </tr>
  `).join('');
  $('saved-empty').hidden = true;
}

function renderZeroView(rows) {
  const tbody = $('zero-tbody');
  $('zero-loading').hidden = true;
  if (rows == null) {
    $('zero-empty').textContent = 'Không thể xác định content gaps khi nguồn views không khả dụng.';
    $('zero-empty').hidden = false;
    $('zero-wrap').hidden = true;
    return;
  }
  if (!rows.length) {
    $('zero-empty').hidden = false;
    $('zero-wrap').hidden = true;
    return;
  }
  $('zero-wrap').hidden = false;
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td><code style="font-family: var(--av-font-mono); font-size: var(--av-fs-xs);">${escapeHtml(r.slug)}</code></td>
      <td>${escapeHtml(r.title || '—')}</td>
      <td><span class="gan-chip">${escapeHtml(r.category || '—')}</span></td>
    </tr>
  `).join('');
  $('zero-empty').hidden = true;
}

function wire() {
  const urlDays = parseInt(new URLSearchParams(window.location.search).get('days'), 10);
  if ([7, 14, 30, 90].includes(urlDays)) $('gan-days').value = String(urlDays);
  $('btn-refresh').addEventListener('click', () => load());
  $('gan-days').addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('days', $('gan-days').value);
    history.replaceState(null, '', url.pathname + url.search);
    load();
  });
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
