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

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;
const $ = (id) => document.getElementById(id);

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
  $('top-loading').hidden = false;
  $('saved-loading').hidden = false;
  $('zero-loading').hidden = false;
  $('gan-error').hidden = true;
  try {
    const data = await api.get('/admin/grammar/analytics?days=' + days);
    setStat('views_total',    data.views_total);
    setStat('views_recent',   data.views_recent);
    setStat('saves_total',    data.saves_total);
    setStat('zero_view_total', data.zero_view_total);
    setStat('articles_total', data.articles_total);

    const hint = document.querySelector('[data-stat="window-hint"]');
    if (hint) hint.textContent = 'Last ' + days + ' days';

    // Highlight the zero-view tile if there are gaps
    const zeroTile = $('gan-zero-tile');
    if (zeroTile) {
      zeroTile.classList.toggle('is-warn', (data.zero_view_total || 0) > 0);
    }

    renderTopViewed(data.top_viewed || []);
    renderTopSaved(data.top_saved || []);
    renderZeroView(data.zero_view_slugs || []);
  } catch (e) {
    $('gan-error').textContent = 'Không tải được analytics: ' + (e && e.message || 'lỗi');
    $('gan-error').hidden = false;
  }
}

function renderTopViewed(rows) {
  const tbody = $('top-tbody');
  $('top-loading').hidden = true;
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
  $('btn-refresh').addEventListener('click', () => load());
  $('gan-days').addEventListener('change', () => load());
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
