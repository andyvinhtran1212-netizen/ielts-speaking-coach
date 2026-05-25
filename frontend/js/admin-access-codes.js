/**
 * frontend/js/admin-access-codes.js — Sprint 12.2.
 *
 * Page controller for /pages/admin/access-codes/index.html. Carves the
 * access-codes section out of admin.html monolith into a dedicated IA
 * surface backed by the Sprint 12.2 backend extensions (code_type,
 * cohort_id, notes).
 *
 * Wired endpoints:
 *   GET    /admin/access-codes
 *   POST   /admin/access-codes/generate
 *   PATCH  /admin/access-codes/{id}     (toggle is_active)
 *   DELETE /admin/access-codes/{id}     (soft revoke)
 *   GET    /admin/cohorts?is_active=true  (cohort dropdown source)
 *
 * Filter+pagination is client-side over the full list for now; admin
 * access-code rosters are small (<1000) so a single fetch is fine.
 * If/when the count grows past that, switch to server-side pagination
 * via ?limit + ?offset.
 */

import { quotaLabel, codeMatchesSearch, compareCodesBy } from './admin-codes-util.js';

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;

const $  = (id) => document.getElementById(id);
const fmt = (v) => v == null || v === '' ? '—' : String(v);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let _allCodes = [];
let _cohorts = [];
let _search = '';
let _sort = { field: 'created_at', order: 'desc' };  // Sprint 17.1 sortable columns

// Sprint 17.1 — assigned-users cell: email + per-user quota. Renders the canonical
// account mapping the API already returns, the lookup-failure warning, and the
// "no users" placeholder. Class-based only (Pattern #26).
function assignedCell(c) {
  if (c.association_lookup_failed) return '<span class="ac-warn">⚠ lookup failed</span>';
  const users = c.assigned_users || [];
  if (!users.length) return '<span class="ac-muted">Chưa gán</span>';
  return users.map((u) => {
    const email = u.email ? esc(u.email) : '(không rõ)';
    const q = quotaLabel(u.quota);
    const qHtml = q ? ` <span class="ac-quota">${esc(q)}</span>` : '';
    return `<div class="ac-user">${email}${qHtml}</div>`;
  }).join('');
}

function showBanner(msg, kind) {
  const el = $('status-banner');
  el.textContent = msg;
  el.classList.remove('is-success', 'is-error');
  el.classList.add(kind === 'error' ? 'is-error' : 'is-success');
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

function chipForType(t) {
  const label = { mass: 'Đại trà', direct: 'Trực tiếp', staff: 'Nhân viên' }[t] || t;
  const cls = t === 'direct' ? 'ac-chip is-direct' : 'ac-chip';
  return `<span class="${cls}">${label}</span>`;
}

function chipForStatus(row) {
  if (row.is_revoked) return '<span class="ac-chip">Đã thu hồi</span>';
  if (row.is_active === false) return '<span class="ac-chip">Đã khóa</span>';
  return '<span class="ac-chip is-direct">Hoạt động</span>';
}

function rowMatchesFilters(row, f) {
  if (f.type && row.code_type !== f.type) return false;
  if (f.status === 'active' && (row.is_revoked || row.is_active === false)) return false;
  if (f.status === 'revoked' && !row.is_revoked) return false;
  if (f.cohort && row.cohort_id !== f.cohort) return false;
  return true;
}

function renderTable() {
  const tbody = $('codes-tbody');
  const f = {
    type:   $('filter-type').value,
    status: $('filter-status').value,
    cohort: $('filter-cohort').value,
  };
  const rows = _allCodes
    .filter((c) => rowMatchesFilters(c, f))
    .filter((c) => codeMatchesSearch(c, _search))
    .sort(compareCodesBy(_sort.field, _sort.order));

  $('codes-loading').hidden = true;
  if (!rows.length) {
    $('codes-empty').hidden = false;
    $('codes-table-wrap').hidden = true;
    return;
  }
  $('codes-empty').hidden = true;
  $('codes-table-wrap').hidden = false;

  tbody.innerHTML = rows.map((c) => {
    const expires = c.expires_at ? new Date(c.expires_at).toLocaleDateString('vi-VN') : '—';
    const created = c.created_at ? new Date(c.created_at).toLocaleDateString('vi-VN') : '—';
    const limit = c.session_limit == null ? '∞' : String(c.session_limit);
    const cohort = c.cohort_name ? `<span class="ac-chip is-direct">${c.cohort_name}</span>` : '—';
    const revokeBtn = (c.is_revoked || c.is_active === false)
      ? ''
      : `<button class="btn-danger" data-action="revoke" data-id="${c.id}">Thu hồi</button>`;
    return `
      <tr>
        <td class="code-cell">${c.code}</td>
        <td>${chipForType(c.code_type || 'mass')}</td>
        <td>${cohort}</td>
        <td>${assignedCell(c)}</td>
        <td>${chipForStatus(c)}</td>
        <td>${limit}</td>
        <td>${expires}</td>
        <td>${created}</td>
        <td>${fmt(c.notes)}</td>
        <td>${revokeBtn}</td>
      </tr>
    `;
  }).join('');
}

async function loadCohorts() {
  try {
    const r = await api.get('/admin/cohorts?is_active=true');
    _cohorts = (r && r.cohorts) || [];
  } catch (err) {
    _cohorts = [];
    console.warn('[access-codes] cohort fetch failed:', err);
  }
  const opts = '<option value="">Tất cả</option>'
    + _cohorts.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  $('filter-cohort').innerHTML = opts;
  $('m-cohort').innerHTML = '<option value="">— Chọn lớp —</option>'
    + _cohorts.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
}

async function loadCodes() {
  $('codes-loading').hidden = false;
  $('codes-table-wrap').hidden = true;
  $('codes-empty').hidden = true;
  try {
    const r = await api.get('/admin/access-codes');
    _allCodes = Array.isArray(r) ? r : [];
  } catch (err) {
    _allCodes = [];
    showBanner('Không tải được danh sách mã: ' + (err.message || err), 'error');
  }
  renderTable();
}

// ── Create modal ────────────────────────────────────────────────────

function openModal() {
  $('modal-error').hidden = true;
  $('m-count').value = '1';
  $('m-limit').value = '';
  $('m-expires').value = '';
  $('m-notes').value = '';
  // Default radio = mass; cohort row hidden.
  document.querySelectorAll('input[name="m-type"]').forEach((r) => {
    r.checked = r.value === 'mass';
  });
  $('m-cohort-row').hidden = true;
  $('m-cohort').value = '';
  // Default permissions: all checked, others unchecked.
  $('m-perms').querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = cb.value === 'all';
  });
  $('modal-backdrop').hidden = false;
}

function closeModal() {
  $('modal-backdrop').hidden = true;
}

function selectedType() {
  const checked = document.querySelector('input[name="m-type"]:checked');
  return checked ? checked.value : 'mass';
}

function selectedPerms() {
  return Array.from($('m-perms').querySelectorAll('input[type="checkbox"]:checked'))
    .map((cb) => cb.value);
}

async function submitCreate() {
  const count = parseInt($('m-count').value, 10) || 1;
  const code_type = selectedType();
  const cohort_id = $('m-cohort').value || null;
  const permissions = selectedPerms();
  const limit = $('m-limit').value ? parseInt($('m-limit').value, 10) : null;
  const expires_raw = $('m-expires').value;
  const notes = $('m-notes').value.trim() || null;

  // Client-side guard so the user gets immediate feedback before the
  // server returns 422.
  if (code_type === 'direct' && !cohort_id) {
    $('modal-error').textContent = 'Mã trực tiếp bắt buộc phải chọn lớp.';
    $('modal-error').classList.add('is-error');
    $('modal-error').hidden = false;
    return;
  }
  if (code_type !== 'direct' && cohort_id) {
    // Defensive: cohort_id only allowed for direct codes.
    // Should not happen via UI (we hide the row) but pin anyway.
    $('modal-error').textContent = 'Chỉ mã Trực tiếp mới được gán lớp.';
    $('modal-error').classList.add('is-error');
    $('modal-error').hidden = false;
    return;
  }
  if (!permissions.length) {
    $('modal-error').textContent = 'Phải chọn ít nhất một quyền.';
    $('modal-error').classList.add('is-error');
    $('modal-error').hidden = false;
    return;
  }

  const body = {
    count,
    permissions,
    code_type,
    cohort_id,
    notes,
    session_limit: limit,
    expires_at: expires_raw ? new Date(expires_raw).toISOString() : null,
  };

  $('btn-submit').disabled = true;
  try {
    const r = await api.post('/admin/access-codes/generate', body);
    closeModal();
    showBanner(`Đã tạo ${r.created || count} mã.`, 'success');
    await loadCodes();
  } catch (err) {
    $('modal-error').textContent = 'Không tạo được mã: ' + (err.message || err);
    $('modal-error').classList.add('is-error');
    $('modal-error').hidden = false;
  } finally {
    $('btn-submit').disabled = false;
  }
}

async function revokeCode(codeId) {
  if (!confirm('Thu hồi mã này? Hành động này không thể khôi phục.')) return;
  try {
    await api.delete('/admin/access-codes/' + codeId);
    showBanner('Đã thu hồi mã.', 'success');
    await loadCodes();
  } catch (err) {
    showBanner('Không thu hồi được: ' + (err.message || err), 'error');
  }
}

// ── Wire it up ──────────────────────────────────────────────────────

function bind() {
  $('btn-create').addEventListener('click', openModal);
  $('btn-cancel').addEventListener('click', closeModal);
  $('btn-submit').addEventListener('click', submitCreate);
  // Backdrop click outside the modal card closes (but not clicks inside the card).
  $('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('modal-backdrop')) closeModal();
  });
  document.querySelectorAll('input[name="m-type"]').forEach((r) => {
    r.addEventListener('change', () => {
      const t = selectedType();
      $('m-cohort-row').hidden = (t !== 'direct');
      if (t !== 'direct') $('m-cohort').value = '';
    });
  });
  ['filter-type', 'filter-status', 'filter-cohort'].forEach((id) => {
    $(id).addEventListener('change', renderTable);
  });
  // Sprint 17.1 — client-side search (code + assigned email).
  const searchEl = $('search-input');
  if (searchEl) searchEl.addEventListener('input', () => { _search = searchEl.value; renderTable(); });
  // Sprint 17.1 — sortable column headers (created_at | expires_at | status).
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      _sort = { field, order: (_sort.field === field && _sort.order === 'desc') ? 'asc' : 'desc' };
      renderTable();
    });
  });
  $('codes-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'revoke') revokeCode(btn.dataset.id);
  });
}

async function main() {
  bind();
  await loadCohorts();
  await loadCodes();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
