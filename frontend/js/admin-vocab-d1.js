/**
 * frontend/js/admin-vocab-d1.js — Sprint 12.6.
 *
 * D1 question curation (user_d1_questions table). Lets admins inspect,
 * filter, inline-edit, and soft-delete personalized D1 fill-blank
 * questions generated from each user's vocab bank.
 *
 * Wired endpoints (new in Sprint 12.6 — routers/admin.py):
 *   GET    /admin/vocab/d1-questions?source=&active=&user_id=&offset=&limit=
 *   PATCH  /admin/vocab/d1-questions/{id}
 *   DELETE /admin/vocab/d1-questions/{id}   (soft-delete via is_active=false)
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

const PAGE_LIMIT = 50;
let _offset = 0;
let _rows = [];
let _expandedId = null;

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
  } catch { return iso; }
}

function showBanner(msg, kind) {
  showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });
}

function buildQuery(extraOffset) {
  const params = new URLSearchParams();
  const source = $('d1-source').value;
  const active = $('d1-active').value;
  const userId = ($('d1-user').value || '').trim();
  if (source) params.set('source', source);
  if (active) params.set('active', active);
  if (userId) params.set('user_id', userId);
  params.set('offset', extraOffset);
  params.set('limit', PAGE_LIMIT);
  return params.toString();
}

async function loadList(append) {
  $('d1-loading').hidden = false;
  $('d1-empty').hidden = true;
  if (!append) {
    _rows = [];
    _offset = 0;
    $('d1-tbody').innerHTML = '';
  }
  try {
    const res = await api.get('/admin/vocab/d1-questions?' + buildQuery(_offset));
    const items = res.items || [];
    _rows = _rows.concat(items);
    _offset += items.length;
    renderRows();
    $('d1-table-wrap').hidden = _rows.length === 0;
    $('d1-empty').hidden = _rows.length !== 0;
    const total = res.total || 0;
    $('btn-more').hidden = _offset >= total;
  } catch (e) {
    showBanner('Không tải được danh sách: ' + (e && e.message || 'lỗi'), 'error');
  } finally {
    $('d1-loading').hidden = true;
  }
}

function sourceChip(source) {
  if (source === 'haiku' || source === 'gemini') return `<span class="d1c-chip is-haiku">${escapeHtml(source)}</span>`;
  if (source === 'fallback_evidence') return '<span class="d1c-chip is-fallback">fallback</span>';
  return `<span class="d1c-chip">${escapeHtml(source || '—')}</span>`;
}

function statusChip(isActive) {
  return isActive
    ? '<span class="d1c-chip is-haiku">active</span>'
    : '<span class="d1c-chip is-archived">archived</span>';
}

function renderRows() {
  const tbody = $('d1-tbody');
  tbody.innerHTML = _rows.map((r) => rowHtml(r)).join('');
  // Wire row click handlers
  tbody.querySelectorAll('tr.d1c-row').forEach((tr) => {
    const id = tr.getAttribute('data-id');
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, input, textarea')) return;
      toggleEdit(id);
    });
  });
  tbody.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (action === 'archive') archive(id);
      else if (action === 'unarchive') toggleActive(id, true);
      else if (action === 'save') saveEdit(id);
      else if (action === 'cancel') { _expandedId = null; renderRows(); }
    });
  });
}

function rowHtml(r) {
  const expanded = _expandedId === r.id;
  const baseRow = `
    <tr class="d1c-row${expanded ? ' is-expanded' : ''}" data-id="${escapeHtml(r.id)}">
      <td>${escapeHtml(r.headword || '—')}</td>
      <td><span class="d1c-context">${escapeHtml((r.context_sentence || '').slice(0, 120))}${(r.context_sentence || '').length > 120 ? '…' : ''}</span></td>
      <td><span class="d1c-target">${escapeHtml(r.target_answer || '')}</span></td>
      <td>${sourceChip(r.generated_by)}</td>
      <td>${r.attempt_count || 0}</td>
      <td>${statusChip(!!r.is_active)}</td>
      <td>${fmtDate(r.created_at)}</td>
      <td>${
        r.is_active
          ? `<button class="btn-danger" data-action="archive" data-id="${escapeHtml(r.id)}" type="button">Soft delete</button>`
          : `<button class="btn-ghost"  data-action="unarchive" data-id="${escapeHtml(r.id)}" type="button">Restore</button>`
      }</td>
    </tr>`;
  if (!expanded) return baseRow;
  return baseRow + `
    <tr class="d1c-edit-row" data-id="${escapeHtml(r.id)}">
      <td colspan="8">
        <div class="d1c-edit-grid">
          <div class="full">
            <label>Context sentence</label>
            <textarea id="edit-context-${escapeHtml(r.id)}">${escapeHtml(r.context_sentence || '')}</textarea>
          </div>
          <div>
            <label>Target answer</label>
            <input id="edit-target-${escapeHtml(r.id)}" type="text" value="${escapeHtml(r.target_answer || '')}" />
          </div>
          <div>
            <label>Hint</label>
            <input id="edit-hint-${escapeHtml(r.id)}" type="text" value="${escapeHtml(r.hint || '')}" />
          </div>
          <div class="full" style="font-size: var(--av-fs-xs); color: var(--av-text-muted);">
            User ID: <code>${escapeHtml(r.user_id || '—')}</code> ·
            Vocab ID: <code>${escapeHtml(r.vocabulary_id || '—')}</code> ·
            Generated: ${fmtDate(r.generated_at)}
          </div>
        </div>
        <div class="d1c-edit-actions">
          <button class="btn-primary"   data-action="save"   data-id="${escapeHtml(r.id)}" type="button">Lưu thay đổi</button>
          <button class="btn-secondary" data-action="cancel" data-id="${escapeHtml(r.id)}" type="button">Đóng</button>
        </div>
      </td>
    </tr>`;
}

function toggleEdit(id) {
  _expandedId = _expandedId === id ? null : id;
  renderRows();
}

async function saveEdit(id) {
  const payload = {
    context_sentence: $('edit-context-' + id).value.trim(),
    target_answer:    $('edit-target-' + id).value.trim(),
    hint:             $('edit-hint-' + id).value.trim(),
  };
  if (!payload.context_sentence || !payload.target_answer) {
    showBanner('Context + target không được trống.', 'error');
    return;
  }
  try {
    await api.patch('/admin/vocab/d1-questions/' + encodeURIComponent(id), payload);
    showBanner('Đã lưu thay đổi.', 'success');
    const row = _rows.find((r) => r.id === id);
    if (row) {
      row.context_sentence = payload.context_sentence;
      row.target_answer    = payload.target_answer;
      row.hint             = payload.hint;
    }
    _expandedId = null;
    renderRows();
  } catch (e) {
    showBanner('Lưu thất bại: ' + (e && e.message || 'lỗi'), 'error');
  }
}

async function archive(id) {
  if (!confirm('Soft-delete câu hỏi này? (is_active=false)')) return;
  try {
    await api.delete('/admin/vocab/d1-questions/' + encodeURIComponent(id));
    showBanner('Đã archive.', 'success');
    const row = _rows.find((r) => r.id === id);
    if (row) row.is_active = false;
    renderRows();
  } catch (e) {
    showBanner('Archive thất bại: ' + (e && e.message || 'lỗi'), 'error');
  }
}

async function toggleActive(id, makeActive) {
  try {
    await api.patch('/admin/vocab/d1-questions/' + encodeURIComponent(id), { is_active: makeActive });
    showBanner(makeActive ? 'Đã khôi phục.' : 'Đã archive.', 'success');
    const row = _rows.find((r) => r.id === id);
    if (row) row.is_active = makeActive;
    renderRows();
  } catch (e) {
    showBanner('Cập nhật thất bại: ' + (e && e.message || 'lỗi'), 'error');
  }
}

function wire() {
  $('btn-search').addEventListener('click', () => loadList(false));
  $('btn-reset').addEventListener('click', () => {
    $('d1-source').value = '';
    $('d1-active').value = 'true';
    $('d1-user').value = '';
    loadList(false);
  });
  $('btn-more').addEventListener('click', () => loadList(true));
  loadList(false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
