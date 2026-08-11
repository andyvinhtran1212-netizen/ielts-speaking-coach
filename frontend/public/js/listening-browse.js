/**
 * frontend/js/listening-browse.js — Sprint 11.5
 * (DEBT-LISTENING-MODULE 5/5).
 *
 * Content browser. Fetches paginated GET /api/listening/content with
 * accent / cefr / section filters, renders one card per content row
 * with deep-links to /pages/listening-{dictation,gist,tf,mcq}.html?content_id=...
 */

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

import { fetchAllPages } from './listening-list-paging.js';


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

const STATE = {
  items: [],
};

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  grid:    $('content-grid'),
};


function showState(name) {
  VIEWS.loading.hidden = name !== 'loading';
  VIEWS.empty.hidden   = name !== 'empty';
  VIEWS.error.hidden   = name !== 'error';
  VIEWS.grid.hidden    = name !== 'ready';
}
function showError(msg) { VIEWS.error.textContent = msg; showState('error'); }


function getFilters() {
  return {
    accent_tag:    ($('filter-accent').value || '').trim(),
    cefr_level:    ($('filter-cefr').value || '').trim(),
    ielts_section: ($('filter-section').value || '').trim(),
  };
}


async function load() {
  showState('loading');
  const f = getFilters();
  const qs = new URLSearchParams();
  if (f.accent_tag) qs.set('accent_tag', f.accent_tag);
  if (f.cefr_level) qs.set('cefr_level', f.cefr_level);
  if (f.ielts_section) qs.set('ielts_section', f.ielts_section);
  try {
    // Paged: the landing badge reports every published row, so stopping at the
    // first page would promise more than this list shows.
    STATE.items = await fetchAllPages((limit, offset) => {
      qs.set('limit', String(limit));
      qs.set('offset', String(offset));
      return `/api/listening/content?${qs.toString()}`;
    }, (path) => window.api.get(path));
    if (!STATE.items.length) { showState('empty'); return; }
    render();
    showState('ready');
  } catch (e) {
    showError('Không tải được danh sách bài nghe. Vui lòng thử lại.');
  }
}


/* Exercise-mode → link. A mode page needs a published exercise for THIS
   content row; without one it renders "Bài này chưa có dạng ...". The card
   used to offer all four unconditionally, so most links dead-ended. The
   backend now reports `available_modes` per row and we render only those. */
const MODE_LINKS = {
  dictation:  { label: 'Chép chính tả', page: '/pages/listening-dictation.html' },
  gist:       { label: 'Ý chính',       page: '/pages/listening-gist.html' },
  true_false: { label: 'Đúng/Sai',      page: '/pages/listening-tf.html' },
  mcq:        { label: 'Trắc nghiệm',   page: '/pages/listening-mcq.html' },
};

export function modeLinksHtml(item) {
  const cid = encodeURIComponent(item && item.id ? item.id : '');
  // Only an explicit array is canonical. Null means the exercise-table lookup
  // failed; a missing/malformed field is also an unreadable contract, not
  // proof that this content genuinely has no modes.
  if (!item || !Array.isArray(item.available_modes)) {
    return '<span class="mode-empty">⚠ Không đọc được danh sách dạng luyện</span>';
  }
  const modes = Array.isArray(item && item.available_modes) ? item.available_modes : [];
  const links = Object.keys(MODE_LINKS)
    .filter((m) => modes.includes(m))
    .map((m) => `<a class="mode-link" href="${MODE_LINKS[m].page}?content_id=${cid}">`
      + `${escapeHtml(MODE_LINKS[m].label)}</a>`);
  return links.length
    ? links.join('')
    : '<span class="mode-empty">Chưa có dạng luyện nào cho bài này</span>';
}

function render() {
  const grid = VIEWS.grid;
  grid.innerHTML = '';
  STATE.items.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'content-card';
    const mins = Math.round((c.audio_duration_seconds || 0) / 60);
    const pills = [
      c.accent_tag ? `<span class="meta-pill">${escapeHtml(c.accent_tag)}</span>` : '',
      c.cefr_level ? `<span class="meta-pill is-brand">${escapeHtml(c.cefr_level)}</span>` : '',
      c.ielts_section ? `<span class="meta-pill">Section ${c.ielts_section}</span>` : '',
      mins > 0 ? `<span class="meta-pill">${mins}p</span>` : '',
    ].join('');

    card.innerHTML = `
      <h3>${escapeHtml(c.title || 'Bài nghe')}</h3>
      <div class="desc">${escapeHtml(c.description || '')}</div>
      <div class="meta-row">${pills}</div>
      <div class="mode-links">${modeLinksHtml(c)}</div>
    `;
    grid.appendChild(card);
  });
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


if (typeof document !== 'undefined') {
  __averOnReady(() => {
    load();
    ['filter-accent', 'filter-cefr', 'filter-section'].forEach((id) => {
      $(id).addEventListener('change', load);
    });
  });
}
