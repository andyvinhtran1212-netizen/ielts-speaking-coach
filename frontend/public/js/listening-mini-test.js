/**
 * frontend/js/listening-tests-list.js — Sprint 13.5
 *
 * Listening mini-test list controller (graded 1-section tests). GET /api/listening/tests?test_type=mini
 * (published + audio-ready only) and renders a card grid with per-user
 * stats: best score + attempt count drive the "Bắt đầu" vs "Làm lại" CTA.
 *
 * Card click opens /pages/listening-test.html?id=<uuid> — the player
 * page handles attempt creation + run.
 */

const SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

import { fetchAllTests } from './listening-list-paging.js';


// Module nay co the duoc NAP MUON: tren ban Next, `LegacyModule` chen the
// <script> trong useEffect, tuc SAU khi React hydrate — ma luc do
// `DOMContentLoaded` DA BAN. Mot listener dang ky sau do khong bao gio chay,
// nen trang KHONG BAO GIO boot. Do la loi cong G1 bat duoc o
// /listening/skills va /reading/vocab (PR #1004).
//
// Tren ban legacy the <script> van nam san trong HTML nen `readyState` con la
// 'loading' — nhanh cu chay y nguyen, khong doi hanh vi.
function __averOnReady(fn) {
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

const $ = (id) => document.getElementById(id);

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  grid:    $('lt-grid'),
};

function showState(name) {
  VIEWS.loading.hidden = name !== 'loading';
  VIEWS.empty.hidden   = name !== 'empty';
  VIEWS.error.hidden   = name !== 'error';
  VIEWS.grid.hidden    = name !== 'grid';
}
function showError(msg) {
  VIEWS.error.textContent = msg;
  showState('error');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCard(t) {
  const attempted = (t.user_attempt_count || 0) > 0;
  const best      = t.user_best_score;
  const ctaLabel  = attempted ? 'Làm lại' : 'Bắt đầu test';
  const ctaClass  = attempted ? 'lt-card-cta secondary' : 'lt-card-cta';
  const themes    = (t.themes && typeof t.themes === 'object')
    ? Object.values(t.themes).filter(Boolean).slice(0, 3).join(' · ')
    : '';
  const bandTarget = t.band_target ? `Band ${esc(t.band_target)}` : '';
  const meta = [bandTarget, themes].filter(Boolean).join(' · ');
  const statsBits = [];
  if (best != null) {
    statsBits.push(`<span>Điểm tốt nhất: <strong>${esc(best)}/40</strong></span>`);
  }
  if (attempted) {
    statsBits.push(`<span>Đã làm: <strong>${esc(t.user_attempt_count)}</strong> lần</span>`);
  } else {
    statsBits.push('<span>Chưa làm</span>');
  }
  return `
    <article class="lt-card" data-test-id="${esc(t.id)}">
      <div class="lt-card-meta">${esc(t.test_id || '')}</div>
      <div class="lt-card-title">${esc(t.title || 'Untitled test')}</div>
      ${meta ? `<div class="lt-card-meta" style="text-transform:none;letter-spacing:0;">${esc(meta)}</div>` : ''}
      <div class="lt-card-stats">${statsBits.join('')}</div>
      <div class="lt-card-actions" style="display:flex; gap:var(--av-space-2); flex-wrap:wrap;">
        <a class="${ctaClass}" href="/pages/listening-test.html?id=${encodeURIComponent(t.id)}&from=mini">${ctaLabel}</a>
        <a class="lt-card-cta secondary" href="/pages/listening-test-dictation.html?test_id=${encodeURIComponent(t.id)}">✍️ Chép chính tả</a>
      </div>
    </article>
  `;
}

async function load() {
  showState('loading');
  try {
    // Mini Tests library shows ONLY mini tests (test_type=mini). Reuses the SAME
    // player (listening-test.html?id) + review as a full test — just 1 section.
    // Paged for the same reason as the Full Tests list: the landing badge
    // reports the whole published count, so this page must render all of it.
    const items = await fetchAllTests('mini', (path) => window.api.get(path));
    if (!items.length) {
      showState('empty');
      return;
    }
    VIEWS.grid.innerHTML = items.map(renderCard).join('');
    showState('grid');
  } catch (e) {
    showError(`Không tải được danh sách tests: ${(e && e.message) || e}`);
  }
}

__averOnReady(load);
