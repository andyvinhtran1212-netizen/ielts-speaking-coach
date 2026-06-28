/**
 * admin-listening-tests-list.js — Sprint 13.4 (DEBT-ADMIN-LISTENING-AUTHORING 6/N).
 *
 * Drives /pages/admin/listening/tests.html — the admin browser for
 * Cambridge IELTS test bundles. Fetches GET /admin/listening/tests with
 * status filter + search-by-test-id and paginates 20-per-page. Each row
 * exposes "Mở test" + "Xem 4 sections" links and (Sprint 13.5) publish
 * actions land here too.
 */

// Sprint 13.4.1 hotfix — bootstrap supabase at module load (see
// admin-listening-convert.js for the same fix + reasoning).
const SUPABASE_URL  = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();


const STATE = {
  page:   1,
  limit:  20,
  total:  0,
  status: 'all',
  search: '',
};


// ── DOM bootstrap ───────────────────────────────────────────────────────────


function init() {
  document.getElementById('tl-status').addEventListener('change', (e) => {
    STATE.status = e.target.value;
    STATE.page = 1;
    fetchTests();
  });

  const searchInput = document.getElementById('tl-search');
  let searchTimer = null;
  searchInput.addEventListener('input', (e) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      STATE.search = e.target.value.trim();
      STATE.page = 1;
      fetchTests();
    }, 300);
  });

  document.getElementById('tl-prev').addEventListener('click', () => {
    if (STATE.page > 1) { STATE.page -= 1; fetchTests(); }
  });
  document.getElementById('tl-next').addEventListener('click', () => {
    if (STATE.page * STATE.limit < STATE.total) { STATE.page += 1; fetchTests(); }
  });

  // Phase B — delegated publish/archive/restore on the rows.
  document.getElementById('tl-tbody').addEventListener('click', (e) => {
    const b = e.target.closest('.tl-status-btn');
    if (b) changeStatus(b.dataset.id, b.dataset.status);
  });

  fetchTests();
}


// ── Fetch + render ──────────────────────────────────────────────────────────


async function fetchTests() {
  setLoading(true);
  hideError();

  const offset = (STATE.page - 1) * STATE.limit;
  const qs = new URLSearchParams({
    status: STATE.status,
    search: STATE.search,
    limit:  String(STATE.limit),
    offset: String(offset),
  });

  try {
    const res = await window.api.get(`/admin/listening/tests?${qs.toString()}`);
    STATE.total = res.total || 0;
    renderRows(res.items || []);
    renderPagination();
  } catch (e) {
    showError(e.message || 'Không tải được danh sách test.');
    renderRows([]);
  } finally {
    setLoading(false);
  }
}


function renderRows(items) {
  const tbody = document.getElementById('tl-tbody');
  const tableWrap = document.getElementById('tl-table-wrap');
  const emptyEl = document.getElementById('tl-empty');

  if (!items.length) {
    tbody.innerHTML = '';
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  tableWrap.hidden = false;

  tbody.innerHTML = items.map((t) => {
    const accent = (t.accent_profile || []).join(', ') || '—';
    const audioReady = t.audio_ready_count !== undefined ? t.audio_ready_count : 0;
    const sectionCount = t.section_count !== undefined ? t.section_count : 0;
    const detailHref = `/pages/admin/listening/tests-detail.html?id=${encodeURIComponent(t.id)}`;
    return `
      <tr>
        <td class="tl-mono">${escapeHtml(t.test_id)}</td>
        <td>${escapeHtml(t.title || '')}</td>
        <td>${t.band_target !== null && t.band_target !== undefined ? escapeHtml(String(t.band_target)) : '—'}</td>
        <td>${escapeHtml(accent)}</td>
        <td>${sectionCount}/4</td>
        <td>${audioReady}/4</td>
        <td><span class="tl-chip is-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
        <td class="tl-mono">${escapeHtml((t.created_at || '').slice(0, 10))}</td>
        <td>
          <span class="tl-actions">
            <a href="${detailHref}">Mở test</a>
            <a href="/pages/admin/listening/index.html?test_id=${encodeURIComponent(t.id)}">4 sections</a>
            ${statusActions(t)}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}


// Phase B — publish/archive transitions per row (PATCH /tests/{id}/status),
// replacing the manual SQL. draft → Publish/Archive ; published → Archive ;
// archived → Khôi phục (→ draft). The button carries the target id + status.
function statusActions(t) {
  const btn = (status, label) =>
    `<button type="button" class="tl-status-btn" data-id="${escapeHtml(t.id)}" data-status="${status}">${label}</button>`;
  if (t.status === 'draft')     return btn('published', 'Publish') + btn('archived', 'Archive');
  if (t.status === 'published') return btn('archived', 'Archive');
  if (t.status === 'archived')  return btn('draft', 'Khôi phục');
  return '';
}


async function changeStatus(id, status) {
  if (status === 'archived' && !window.confirm('Archive bản này? Học sinh sẽ không còn thấy nó.')) return;
  hideError();
  try {
    await window.api.patch(`/admin/listening/tests/${encodeURIComponent(id)}/status`, { status });
    fetchTests();   // refetch canonical state — no optimistic divergence (CLAUDE.md)
  } catch (e) {
    showError(e.message || 'Không đổi được trạng thái.');
  }
}


function renderPagination() {
  const pager = document.getElementById('tl-pagination');
  const info  = document.getElementById('tl-pagination-info');
  const prev  = document.getElementById('tl-prev');
  const next  = document.getElementById('tl-next');

  if (!STATE.total) {
    pager.hidden = true;
    return;
  }
  pager.hidden = false;
  const start = (STATE.page - 1) * STATE.limit + 1;
  const end   = Math.min(STATE.page * STATE.limit, STATE.total);
  info.textContent = `${start}–${end} / ${STATE.total}`;
  prev.disabled = STATE.page <= 1;
  next.disabled = STATE.page * STATE.limit >= STATE.total;
}


// ── Helpers ────────────────────────────────────────────────────────────────


function setLoading(busy) {
  document.getElementById('tl-pagination').hidden = busy;
}


function showError(msg) {
  const el = document.getElementById('tl-error');
  el.textContent = msg;
  el.hidden = false;
}


function hideError() {
  document.getElementById('tl-error').hidden = true;
}


function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
