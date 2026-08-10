/**
 * frontend/js/listening-tests-list.js — Sprint 13.5
 *
 * Student-facing tests-list controller. Calls GET /api/listening/tests
 * (published + audio-ready only) and renders a card grid with per-user
 * stats: submitted attempts drive completion while total attempts remain a
 * separate activity count.
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
  // `readyState` LUON la chuoi trong trinh duyet that. Vang no nghia la ta dang
  // o mot `document` GIA (bo test dung stub toi gian) — khi do giu nguyen hanh
  // vi cu: chi dang ky listener, dung tu chay. Chay ngay o do se keo ca than
  // boot vao moi truong khong co DOM that; da lam 5 test chet o lan dau.
  if (typeof document.readyState !== 'string' || document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
    return;
  }
  fn();
}

const $ = (id) => document.getElementById(id);

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  grid:    $('lt-grid'),
  library: $('lt-library'),
  summary: $('lt-summary'),
};

let TESTS = [];
let ACTIVE_FILTER = 'all';

function showState(name) {
  VIEWS.loading.hidden = name !== 'loading';
  VIEWS.empty.hidden   = name !== 'empty';
  VIEWS.error.hidden   = name !== 'error';
  VIEWS.library.hidden = name !== 'grid';
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

function hasSubmittedAttempt(t) {
  return (t.user_submitted_attempt_count || 0) > 0;
}

function renderCard(t) {
  const attempted = hasSubmittedAttempt(t);
  const best      = t.user_best_score;
  const ctaLabel  = attempted ? 'Làm lại' : 'Bắt đầu test';
  const themes    = (t.themes && typeof t.themes === 'object')
    ? Object.values(t.themes).filter(Boolean).slice(0, 3).join(' · ')
    : '';
  const statsBits = [];
  if (best != null) {
    statsBits.push(`<span>Điểm tốt nhất <strong>${esc(best)}/40</strong></span>`);
  }
  if ((t.user_attempt_count || 0) > 0) {
    statsBits.push(`<span><strong>${esc(t.user_attempt_count)}</strong> lượt làm</span>`);
  } else {
    statsBits.push('<span>Chưa làm</span>');
  }
  return `
    <article class="lt-card" data-test-id="${esc(t.id)}" data-status="${attempted ? 'done' : 'new'}">
      <div class="lt-card__head">
        <div class="lt-card-code">${esc(t.test_id || 'FULL TEST')}</div>
        <span class="lt-card-status${attempted ? ' is-done' : ''}">${attempted ? 'Đã làm' : 'Chưa làm'}</span>
      </div>
      <h3 class="lt-card-title">${esc(t.title || 'Untitled test')}</h3>
      <div class="lt-card-facts" aria-label="Cấu trúc đề thi">
        <span>4 sections</span><span>40 câu</span><span>~30 phút</span>
        ${t.band_target ? `<span>Band ${esc(t.band_target)}</span>` : ''}
      </div>
      ${themes ? `<p class="lt-card-theme">${esc(themes)}</p>` : ''}
      <div class="lt-card-stats">${statsBits.join('')}</div>
      <div class="lt-card-actions">
        <a class="lt-card-cta" href="/pages/listening-test.html?id=${encodeURIComponent(t.id)}&from=full">${ctaLabel} <span aria-hidden="true">→</span></a>
        <a class="lt-card-cta secondary" href="/pages/listening-test-dictation.html?test_id=${encodeURIComponent(t.id)}">Chép chính tả</a>
      </div>
    </article>
  `;
}

function filteredTests() {
  if (ACTIVE_FILTER === 'all') return TESTS;
  return TESTS.filter((t) => {
    const attempted = hasSubmittedAttempt(t);
    return ACTIVE_FILTER === 'done' ? attempted : !attempted;
  });
}

function renderLibrary() {
  const items = filteredTests();
  VIEWS.grid.innerHTML = items.map(renderCard).join('');
  $('lt-visible-count').textContent = `${items.length} đề thi`;
  if (!items.length) {
    VIEWS.grid.innerHTML = '<p class="lt-filter-empty">Không có đề nào trong nhóm này.</p>';
  }
}

function renderSummary() {
  $('lt-total-count').textContent = String(TESTS.length);
  VIEWS.summary.hidden = false;
}

function wireFilters() {
  document.querySelectorAll('.lt-filter__button').forEach((button) => {
    button.addEventListener('click', () => {
      ACTIVE_FILTER = button.dataset.filter || 'all';
      document.querySelectorAll('.lt-filter__button').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      renderLibrary();
    });
  });
}

async function load() {
  showState('loading');
  try {
    // Full Tests library EXCLUDES mini tests (they have their own page). Explicit
    // so it can't regress if the endpoint default ever changes.
    const items = await fetchAllTests('full', (p) => window.api.get(p));
    if (!items.length) {
      showState('empty');
      return;
    }
    TESTS = items;
    renderSummary();
    renderLibrary();
    showState('grid');
  } catch (e) {
    showError(`Không tải được danh sách tests: ${(e && e.message) || e}`);
  }
}

__averOnReady(function () {
  wireFilters();
  load();
});
