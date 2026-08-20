

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
 * frontend/js/reading-vocab.js — Sprint 20.2 L1 Vocab Reading library.
 *
 * Browse published L1 passages (GET /api/reading/vocab), render cards,
 * filter by difficulty / topic tag, deep-link to the passage page
 * (/reading/vocab/{slug}). The direct HTML detail remains the rollback route.
 */

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 24;
const STATE = {
  items: [], tagsSeeded: false, offset: 0, total: 0, loadMoreError: false,
};

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  grid:    $('rv-grid'),
  result:  $('rv-result-count'),
  total:   $('rv-total-count'),
  reset:   $('clear-filters'),
};

function showState(name) {
  VIEWS.loading.hidden = name !== 'loading';
  VIEWS.empty.hidden   = name !== 'empty';
  VIEWS.error.hidden   = name !== 'error';
  VIEWS.grid.hidden    = name !== 'ready';
  const more = $('rv-load-more');
  if (more) more.hidden = name !== 'ready';
}
function showError(msg) {
  VIEWS.error.textContent = msg;
  if (VIEWS.result) VIEWS.result.textContent = 'Không thể tải danh sách';
  showState('error');
}

function ensureLoadMore() {
  let wrap = $('rv-load-more');
  if (wrap) return wrap;
  wrap = document.createElement('div');
  wrap.id = 'rv-load-more';
  wrap.className = 'rv-load-more';
  wrap.hidden = true;
  wrap.innerHTML = '<p role="alert" hidden>Chưa tải được trang tiếp theo.</p>' +
    '<button type="button">Xem thêm</button>';
  VIEWS.grid.insertAdjacentElement('afterend', wrap);
  wrap.querySelector('button').addEventListener('click', () => {
    if (!STATE.loadMoreError) STATE.offset += PAGE_SIZE;
    load({ append: true });
  });
  return wrap;
}

function renderLoadMore({ loading = false } = {}) {
  const wrap = ensureLoadMore();
  const alert = wrap.querySelector('[role="alert"]');
  const button = wrap.querySelector('button');
  const hasMore = STATE.items.length < STATE.total;
  wrap.hidden = !hasMore;
  alert.hidden = !STATE.loadMoreError;
  button.disabled = loading;
  button.textContent = loading
    ? 'Đang tải…'
    : STATE.loadMoreError
      ? 'Thử lại'
      : `Xem thêm (${STATE.items.length}/${STATE.total})`;
}

function revealActiveLibraryTab() {
  const nav = document.querySelector?.('.rv-libnav');
  const active = nav?.querySelector('.rv-libnav__link.is-active');
  if (!nav || !active) return;
  nav.scrollLeft = Math.max(0, active.offsetLeft - ((nav.clientWidth - active.clientWidth) / 2));
}

const DIFFICULTY_LABEL = {
  foundation: 'Foundation',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
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

async function load({ append = false } = {}) {
  if (!append) {
    STATE.offset = 0;
    STATE.items = [];
    showState('loading');
  } else {
    renderLoadMore({ loading: true });
  }
  STATE.loadMoreError = false;
  const difficulty = ($('filter-difficulty').value || '').trim();
  const tag = ($('filter-tag').value || '').trim();
  VIEWS.result.textContent = 'Đang cập nhật danh sách…';
  VIEWS.reset.hidden = !(difficulty || tag);
  const qs = new URLSearchParams();
  if (difficulty) qs.set('difficulty', difficulty);
  if (tag) qs.set('tag', tag);
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', String(STATE.offset));

  try {
    const res = await window.api.get(`/api/reading/vocab?${qs.toString()}`);
    const incoming = (res && Array.isArray(res.items)) ? res.items : [];
    STATE.items = (append ? STATE.items.concat(incoming) : incoming)
      .filter((item, index, all) =>
        all.findIndex((candidate) => candidate.slug === item.slug) === index);
    STATE.total = (typeof res?.total === 'number' && Number.isFinite(res.total) && res.total >= 0)
      ? res.total
      : STATE.offset + incoming.length;
    seedTagFilter();
    renderSummary(res);
    if (!STATE.items.length) { showState('empty'); return; }
    render();
    showState('ready');
    renderLoadMore();
  } catch (e) {
    if (append) {
      STATE.loadMoreError = true;
      showState('ready');
      renderLoadMore();
    } else {
      showError('Không tải được thư viện. ' + (e && e.message ? e.message : ''));
    }
  }
}

function renderSummary(res) {
  const shown = STATE.items.length;
  const total = STATE.total;
  VIEWS.total.textContent = String(total);
  VIEWS.result.textContent = total > shown
    ? `${total} bài đọc phù hợp · đang hiển thị ${shown}`
    : `${total} bài đọc phù hợp`;
}

// Populate the topic-tag dropdown once, from whatever the first load returns.
function seedTagFilter() {
  if (STATE.tagsSeeded) return;
  const tags = new Set();
  STATE.items.forEach((p) => (p.topic_tags || []).forEach((t) => tags.add(t)));
  if (!tags.size) return;
  const sel = $('filter-tag');
  [...tags].sort().forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    sel.appendChild(opt);
  });
  STATE.tagsSeeded = true;
}

function render() {
  const grid = VIEWS.grid;
  grid.innerHTML = '';
  STATE.items.forEach((p) => {
    const a = document.createElement('a');
    a.className = 'rv-card';
    a.href = `/reading/vocab/${encodeURIComponent(p.slug)}`;
    const title = p.title || 'Bài đọc';
    a.setAttribute('aria-label', `Đọc bài ${title}`);
    const difficulty = DIFFICULTY_LABEL[p.difficulty_level] || p.difficulty_level || 'Mọi trình độ';
    const pills = [
      (p.topic_tags || []).slice(0, 2).map((t) => `<span class="rv-pill">${escapeHtml(t)}</span>`).join(''),
      p.word_count ? `<span class="rv-pill">${escapeHtml(p.word_count)} từ</span>` : '',
    ].join('');
    a.innerHTML = `
      <div class="rv-card__top">
        <span class="rv-card__type">TỪ VỰNG TRONG NGỮ CẢNH</span>
        ${p.estimated_minutes ? `<span class="rv-card__time">${escapeHtml(p.estimated_minutes)} PHÚT</span>` : ''}
      </div>
      <h3>${escapeHtml(title)}</h3>
      <p class="rv-card__excerpt">${escapeHtml(p.excerpt || '')}</p>
      <div class="rv-meta">${pills}</div>
      <div class="rv-card__footer">
        <span class="rv-pill is-brand">${escapeHtml(difficulty)}</span>
        <span class="rv-card__cta">Đọc &amp; tra từ <span aria-hidden="true">→</span></span>
      </div>`;
    grid.appendChild(a);
  });
}

if (typeof document !== 'undefined') {
  __averOnReady(() => {
    revealActiveLibraryTab();
    load();
    ['filter-difficulty', 'filter-tag'].forEach((id) => {
      $(id).addEventListener('change', load);
    });
    VIEWS.reset.addEventListener('click', () => {
      $('filter-difficulty').value = '';
      $('filter-tag').value = '';
      load();
    });
  });
}
