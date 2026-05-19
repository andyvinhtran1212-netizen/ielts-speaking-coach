/**
 * frontend/js/admin-users.js — Sprint 12.8.
 *
 * Users management page. Lists Supabase Auth users with role + activity,
 * supports filter by role + search by email/display_name, and lets admins
 * change a user's role inline.
 *
 * Wired endpoints:
 *   GET   /admin/users                       — list (existing since Sprint 6)
 *   PATCH /admin/users/{user_id}/role        — change role (NEW in Sprint 12.8)
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

const ROLES = ['admin', 'instructor', 'student'];
let _all = [];

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('vi-VN', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
  } catch { return iso; }
}

function showBanner(msg, kind) {
  const el = $('status-banner');
  if (!el) return;
  el.className = 'usr-banner is-' + (kind === 'error' ? 'error' : 'success');
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

function roleChip(role) {
  const r = (role || 'student').toLowerCase();
  const cls = r === 'admin' ? 'is-admin' : r === 'instructor' ? 'is-instructor' : '';
  return `<span class="usr-chip ${cls}">${escapeHtml(r)}</span>`;
}

async function loadList() {
  $('usr-loading').hidden = false;
  $('usr-empty').hidden = true;
  $('usr-table-wrap').hidden = true;
  try {
    _all = (await api.get('/admin/users')) || [];
    if (!Array.isArray(_all)) _all = [];
    applyFilters();
  } catch (e) {
    showBanner('Không tải được users: ' + (e && e.message || 'lỗi'), 'error');
  } finally {
    $('usr-loading').hidden = true;
  }
}

function applyFilters() {
  const roleFilter = $('usr-role').value;
  const search = ($('usr-search').value || '').trim().toLowerCase();
  const rows = _all.filter((u) => {
    if (roleFilter && (u.role || '') !== roleFilter) return false;
    if (search) {
      const hay = ((u.email || '') + ' ' + (u.display_name || '')).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  render(rows);
}

function render(rows) {
  if (!rows.length) {
    $('usr-empty').hidden = false;
    $('usr-table-wrap').hidden = true;
    return;
  }
  $('usr-empty').hidden = true;
  $('usr-table-wrap').hidden = false;
  const tbody = $('usr-tbody');
  tbody.innerHTML = rows.map((u) => `
    <tr data-id="${escapeHtml(u.id)}">
      <td>${escapeHtml(u.display_name || '—')}</td>
      <td>${escapeHtml(u.email || '—')}</td>
      <td>${roleChip(u.role)}</td>
      <td style="font-family: var(--av-font-mono); text-align: center;">${u.sessions_today || 0}</td>
      <td>${u.is_active === false
            ? '<span class="usr-chip is-inactive">inactive</span>'
            : '<span class="usr-chip">active</span>'}</td>
      <td><span class="usr-mono">${fmtDate(u.created_at)}</span></td>
      <td>
        <select class="usr-role-select" data-id="${escapeHtml(u.id)}" data-current="${escapeHtml(u.role || 'student')}">
          ${ROLES.map((r) => `<option value="${r}" ${(u.role || 'student') === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('select.usr-role-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const id = sel.getAttribute('data-id');
      const previous = sel.getAttribute('data-current');
      const next = sel.value;
      if (next === previous) return;
      changeRole(id, next, previous, sel);
    });
  });
}

async function changeRole(userId, role, previous, selectEl) {
  if (!confirm(`Đổi role thành "${role}"?`)) {
    selectEl.value = previous;
    return;
  }
  try {
    await api.patch('/admin/users/' + encodeURIComponent(userId) + '/role', { role });
    showBanner(`Đã cập nhật role thành ${role}.`, 'success');
    selectEl.setAttribute('data-current', role);
    // Update local cache so subsequent filter operations see the new role.
    const row = _all.find((u) => u.id === userId);
    if (row) row.role = role;
    // Re-render the chip column without reloading.
    const tr = selectEl.closest('tr');
    if (tr) {
      const chipCell = tr.children[2];
      if (chipCell) chipCell.innerHTML = roleChip(role);
    }
  } catch (e) {
    showBanner('Đổi role thất bại: ' + (e && e.message || 'lỗi'), 'error');
    selectEl.value = previous;
  }
}

function wire() {
  $('usr-role').addEventListener('change', applyFilters);
  $('usr-search').addEventListener('input', applyFilters);
  $('btn-reset').addEventListener('click', () => {
    $('usr-role').value = '';
    $('usr-search').value = '';
    applyFilters();
  });
  loadList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
