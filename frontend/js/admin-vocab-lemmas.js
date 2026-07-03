/**
 * frontend/js/admin-vocab-lemmas.js — Sprint 12.6.
 *
 * Lemma override admin UI. Backed by Migration 063 + the
 * services/lemmatizer.py reload_overrides() hook so saves are hot —
 * no service restart needed.
 *
 * Wired endpoints (new in Sprint 12.6 — routers/admin.py):
 *   GET    /admin/vocab/lemmas/overrides?search=&offset=&limit=
 *   POST   /admin/vocab/lemmas/overrides
 *   DELETE /admin/vocab/lemmas/overrides/{id}
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

let _rows = [];

function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
  } catch { return iso; }
}

function showBanner(msg, kind) {
  showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });
}

async function loadList() {
  $('lem-loading').hidden = false;
  const search = ($('search').value || '').trim();
  try {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('limit', 200);
    const res = await api.get('/admin/vocab/lemmas/overrides?' + params.toString());
    _rows = res.items || [];
    renderTable();
    $('lem-table-wrap').hidden = _rows.length === 0;
    $('lem-empty').hidden = _rows.length !== 0;
  } catch (e) {
    showBanner('Không tải được danh sách: ' + (e && e.message || 'lỗi'), 'error');
  } finally {
    $('lem-loading').hidden = true;
  }
}

function renderTable() {
  const tbody = $('lem-tbody');
  tbody.innerHTML = _rows.map((r) => `
    <tr data-id="${escapeHtml(r.id)}">
      <td><span class="lem-word">${escapeHtml(r.original_word || '')}</span></td>
      <td><span class="lem-arrow">→</span></td>
      <td><span class="lem-word">${escapeHtml(r.lemma || '')}</span></td>
      <td>${escapeHtml(r.pos_tag || '—')}</td>
      <td style="font-size: var(--av-fs-xs); color: var(--av-text-secondary);">${escapeHtml(r.notes || '')}</td>
      <td>${fmtDate(r.created_at)}</td>
      <td><button class="btn-danger" data-id="${escapeHtml(r.id)}" type="button">Xoá</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('button.btn-danger').forEach((btn) => {
    btn.addEventListener('click', () => deleteOverride(btn.getAttribute('data-id')));
  });
}

function openModal() {
  $('m-word').value = '';
  $('m-lemma').value = '';
  $('m-pos').value = '';
  $('m-notes').value = '';
  $('modal-error').hidden = true;
  $('modal-backdrop').hidden = false;
  setTimeout(() => $('m-word').focus(), 50);
}

function closeModal() {
  $('modal-backdrop').hidden = true;
}

async function submitOverride() {
  const word = ($('m-word').value || '').trim();
  const lemma = ($('m-lemma').value || '').trim();
  const pos = $('m-pos').value || null;
  const notes = ($('m-notes').value || '').trim() || null;

  if (!word || !lemma) {
    const e = $('modal-error');
    e.textContent = 'Original word + lemma không được trống.';
    e.hidden = false;
    return;
  }

  try {
    await api.post('/admin/vocab/lemmas/overrides', {
      original_word: word,
      lemma,
      pos_tag: pos,
      notes,
    });
    closeModal();
    showBanner('Đã thêm override.', 'success');
    loadList();
  } catch (e) {
    const errEl = $('modal-error');
    errEl.textContent = (e && e.message) || 'Lưu thất bại.';
    errEl.hidden = false;
  }
}

async function deleteOverride(id) {
  if (!confirm('Xoá override này? Lemmatizer sẽ fallback về spaCy.')) return;
  try {
    await api.delete('/admin/vocab/lemmas/overrides/' + encodeURIComponent(id));
    showBanner('Đã xoá.', 'success');
    loadList();
  } catch (e) {
    showBanner('Xoá thất bại: ' + (e && e.message || 'lỗi'), 'error');
  }
}

function wire() {
  $('btn-search').addEventListener('click', () => loadList());
  $('search').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') loadList(); });
  $('btn-add').addEventListener('click', openModal);
  $('btn-cancel').addEventListener('click', closeModal);
  $('btn-submit').addEventListener('click', submitOverride);
  $('modal-backdrop').addEventListener('click', (ev) => {
    if (ev.target.id === 'modal-backdrop') closeModal();
  });
  loadList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
