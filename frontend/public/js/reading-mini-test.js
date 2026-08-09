

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
/**
 * frontend/js/reading-mini-test.js — Reading mini test (1-passage L3 test) library.
 *
 * Browse published L3 tests (GET /api/reading/test). Card → deep-link to
 * /pages/reading-exam.html?test_id=<id>. Mirrors reading-vocab.js /
 * reading-skill.js but the L3-defining facts are different (parts, total
 * questions, time limit, IELTS band target rather than skill_focus).
 */

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const STATE = { items: [] };

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  grid:    $('rv-grid'),
  result:  $('rv-result-count'),
  total:   $('rv-total-count'),
  duration: $('rv-duration-count'),
  reset:   $('clear-filters'),
};

function showState(name) {
  VIEWS.loading.hidden = name !== 'loading';
  VIEWS.empty.hidden   = name !== 'empty';
  VIEWS.error.hidden   = name !== 'error';
  VIEWS.grid.hidden    = name !== 'ready';
}
function showError(msg) {
  VIEWS.error.textContent = msg;
  if (VIEWS.result) VIEWS.result.textContent = 'Không thể tải danh sách';
  showState('error');
}

function revealActiveLibraryTab() {
  const nav = document.querySelector?.('.rv-libnav');
  const active = nav?.querySelector('.rv-libnav__link.is-active');
  if (!nav || !active) return;
  nav.scrollLeft = Math.max(0, active.offsetLeft - ((nav.clientWidth - active.clientWidth) / 2));
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

const MODULE_LABEL = {
  academic: 'Academic',
  general_training: 'General Training',
};

async function load() {
  showState('loading');
  const module = ($('filter-module').value || '').trim();
  VIEWS.result.textContent = 'Đang cập nhật danh sách…';
  VIEWS.reset.hidden = !module;
  const qs = new URLSearchParams();
  if (module) qs.set('module', module);
  qs.set('limit', '50');
  // Mini Tests library shows ONLY mini tests (the test_type='mini' flag). Explicit
  // so it can't regress if the endpoint default ever changes.
  qs.set('test_type', 'mini');

  try {
    const res = await window.api.get(`/api/reading/test?${qs.toString()}`);
    STATE.items = (res && res.items) || [];
    renderSummary();
    if (!STATE.items.length) { showState('empty'); return; }
    render();
    showState('ready');
  } catch (e) {
    showError('Không tải được danh sách bài thi. ' + (e && e.message ? e.message : ''));
  }
}

function renderSummary() {
  const count = STATE.items.length;
  const durationCounts = new Map();
  STATE.items.forEach((t) => {
    const duration = Number(t.time_limit_minutes);
    if (duration > 0) durationCounts.set(duration, (durationCounts.get(duration) || 0) + 1);
  });
  const popularDuration = [...durationCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  VIEWS.total.textContent = String(count);
  VIEWS.duration.textContent = popularDuration ? `${popularDuration[0]} phút` : '—';
  VIEWS.result.textContent = `${count} mini test`;
}

function render() {
  const grid = VIEWS.grid;
  grid.innerHTML = '';
  STATE.items.forEach((t) => {
    const a = document.createElement('a');
    a.className = 'rv-card';
    a.href = `/pages/reading-exam.html?test_id=${encodeURIComponent(t.test_id)}&from=mini`;   // stamp the origin: reading-exam serves BOTH libraries
    const title = t.title || 'Mini Test';
    a.setAttribute('aria-label', `Bắt đầu mini test ${title}`);
    const moduleLabel = MODULE_LABEL[t.module] || t.module || '';
    const parts = t.passage_count || 1;
    const totalQs = t.total_questions || '—';
    const minutes = t.time_limit_minutes || '—';
    a.innerHTML = `
      <div class="rv-card__top">
        <span class="rv-card__code">${escapeHtml(t.test_id || 'MINI TEST')}</span>
        ${moduleLabel ? `<span class="rv-pill is-brand">${escapeHtml(moduleLabel)}</span>` : ''}
      </div>
      <h3>${escapeHtml(title)}</h3>
      <div class="rv-card__facts" aria-label="Cấu trúc mini test">
        <span><strong>${escapeHtml(parts)}</strong> đoạn văn</span>
        <span><strong>${escapeHtml(totalQs)}</strong> câu hỏi</span>
        <span><strong>${escapeHtml(minutes)}</strong> phút</span>
      </div>
      <div class="rv-card__footer">
        <span class="rv-card__code">${t.band_target ? `MỤC TIÊU BAND ${escapeHtml(t.band_target)}` : 'FOCUSED PRACTICE'}</span>
        <span class="rv-card__cta">Bắt đầu mini test <span aria-hidden="true">→</span></span>
      </div>`;
    grid.appendChild(a);
  });
}

if (typeof document !== 'undefined') {
  __averOnReady(() => {
    revealActiveLibraryTab();
    load();
    $('filter-module').addEventListener('change', load);
    VIEWS.reset.addEventListener('click', () => {
      $('filter-module').value = '';
      load();
    });
  });
}
