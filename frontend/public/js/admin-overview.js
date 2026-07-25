/**
 * frontend/js/admin-overview.js — Sprint 12.4.
 *
 * Controller for the Tổng quan admin landing. Fetches one cross-module
 * aggregate from `GET /admin/overview` (cached 5min server-side) and
 * paints 4 stat tiles + 5 skill cards + 20-row activity feed.
 *
 * Refresh strategy:
 *   - Manual: "Tải lại" button → immediate refetch.
 *   - Auto: every 5 minutes while the tab is visible.
 *     `visibilitychange` pauses the interval so a backgrounded tab
 *     doesn't burn requests; on `visible` we refetch immediately if the
 *     last fetch was ≥5min ago.
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
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const REFRESH_MS = 5 * 60 * 1000;
let _lastFetchAt = 0;
let _autoTimer = null;

function fmtTimestamp(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit',
    });
  } catch { return iso; }
}

function fmtRelative(then) {
  if (!then) return '—';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'vừa cập nhật';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `Cập nhật ${mins} phút trước`;
  const hrs = Math.floor(mins / 60);
  return `Cập nhật ${hrs} giờ trước`;
}

function setValue(selector, value, fallback) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (value == null || (typeof value === 'number' && isNaN(value))) {
    el.textContent = fallback != null ? fallback : '—';
  } else {
    el.textContent = String(value);
  }
}

function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderStats(data) {
  const s = data.students || {};
  setValue('[data-value="students-total"]', s.total);
  setValue('[data-delta="students-30d"]',
    s.active_30d != null ? `${s.active_30d} hoạt động trong 30 ngày` : null);
  setValue('[data-value="students-active-7d"]', s.active_7d);
  setValue('[data-delta="students-active-30d"]',
    s.active_30d != null ? `${s.active_30d} trong 30 ngày` : null);

  const e = data.errors || {};
  setValue('[data-value="errors-undismissed"]', e.undismissed);
  setValue('[data-delta="errors-24h"]',
    e.last_24h != null ? `${e.last_24h} trong 24h qua` : null);
  const errTile = document.querySelector('[data-tile="errors-undismissed"]');
  if (errTile) {
    if (e.undismissed > 0) errTile.classList.add('is-warning');
    else                   errTile.classList.remove('is-warning');
  }

  const ac = data.access_codes || {};
  setValue('[data-value="access-codes-active"]', ac.active);
  const mix = ac.by_type || {};
  setValue('[data-delta="access-codes-mix"]',
    `Đại trà ${mix.mass || 0} · Trực tiếp ${mix.direct || 0} · NV ${mix.staff || 0}`);
}

function renderSkills(data) {
  const skills = data.skills || {};

  // Speaking
  setValue('[data-skill-7d="speaking"]', skills.speaking?.sessions_7d);
  setValue('[data-skill-total="speaking"]', skills.speaking?.sessions_total);
  setValue('[data-skill-extra="speaking"]',
    skills.speaking?.avg_band_7d != null ? skills.speaking.avg_band_7d.toFixed(1) : '—');

  // Writing
  setValue('[data-skill-7d="writing"]', skills.writing?.essays_7d);
  setValue('[data-skill-total="writing"]', skills.writing?.essays_total);
  setValue('[data-skill-extra="writing"]', skills.writing?.feedback_pending);

  // Listening
  setValue('[data-skill-7d="listening"]', skills.listening?.attempts_7d);
  setValue('[data-skill-total="listening"]', skills.listening?.attempts_total);
  // avg_score_7d là % đúng 0..1 (audit 2026-07-17 — nguồn listening_test_attempts,
  // score thô không so được giữa các cỡ đề) → render dạng %.
  setValue('[data-skill-extra="listening"]',
    skills.listening?.avg_score_7d != null ? Math.round(skills.listening.avg_score_7d * 100) + '%' : '—');
  setValue('[data-skill-dict="listening"]', skills.listening?.dictation_7d);

  // Vocab
  setValue('[data-skill-7d="vocab"]', skills.vocab?.due_review_today);
  setValue('[data-skill-total="vocab"]', skills.vocab?.words_total);

  // Grammar
  setValue('[data-skill-7d="grammar"]', skills.grammar?.articles_viewed_7d);
}

function renderActivity(data) {
  const rows = (data.recent_activity || []).filter((r) => r && r.timestamp);
  const loading = $('activity-loading');
  const empty = $('activity-empty');
  const container = $('activity-rows');

  if (!rows.length) {
    loading.hidden = true;
    empty.hidden = false;
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  const html = rows.map((r) => {
    const skillCls = r.skill === 'speaking' ? 'is-speaking'
                   : r.skill === 'writing'  ? 'is-writing'
                   : r.skill === 'listening' ? 'is-listening'
                   : '';
    const skillLabel = r.skill || '—';
    const scoreText = r.score != null
      ? (typeof r.score === 'number' ? r.score.toFixed(1) : escapeHtml(r.score))
      : '—';
    const user = r.user_email
      ? escapeHtml(r.user_email)
      : (r.user_id ? '<code>' + escapeHtml(String(r.user_id).slice(0, 8)) + '…</code>' : 'anon');
    const action = escapeHtml(r.action || 'Hoạt động');
    const ts = fmtTimestamp(r.timestamp);
    const cls = r.link ? 'activity-row' : 'activity-row is-static';
    const tag = r.link
      ? `<a class="${cls}" href="${escapeHtml(r.link)}">`
      : `<div class="${cls}">`;
    const close = r.link ? '</a>' : '</div>';
    return `${tag}
      <span class="ts">${ts}</span>
      <span>
        <span class="skill-chip ${skillCls}">${escapeHtml(skillLabel)}</span>
        <span>${action} · ${user}</span>
      </span>
      <span class="score">${scoreText}</span>
    ${close}`;
  }).join('');

  loading.hidden = true;
  empty.hidden = true;
  container.hidden = false;
  container.innerHTML = html;
}

async function fetchAndRender() {
  try {
    const data = await api.get('/admin/overview');
    _lastFetchAt = Date.now();
    renderStats(data);
    renderSkills(data);
    renderActivity(data);
    updateRefreshLabel();
  } catch (err) {
    console.error('[admin-overview] fetch failed:', err);
    const empty = $('activity-empty');
    if (empty) {
      empty.textContent = 'Không tải được dữ liệu: ' + (err.message || err);
      empty.hidden = false;
      $('activity-loading').hidden = true;
    }
  }
}

function updateRefreshLabel() {
  const el = $('last-refresh');
  if (el) el.textContent = fmtRelative(_lastFetchAt);
}

function startAutoRefresh() {
  if (_autoTimer) clearInterval(_autoTimer);
  _autoTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchAndRender();
    }
  }, REFRESH_MS);
}

function stopAutoRefresh() {
  if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
}

function bind() {
  $('btn-refresh').addEventListener('click', fetchAndRender);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Refresh on focus if it's been ≥5min since last fetch.
      if (Date.now() - _lastFetchAt >= REFRESH_MS) fetchAndRender();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  // Keep the relative-time label fresh every 30s without re-fetching data.
  setInterval(updateRefreshLabel, 30_000);
}

async function main() {
  bind();
  await fetchAndRender();
  startAutoRefresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
