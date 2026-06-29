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
let _cohorts = [];        // active cohorts for the "Tạo + gán mã" cohort select
let _genCtx = null;       // { userId } while the generate-and-assign modal is open
// merge-codes PR-2 — sort across BOTH user + code criteria. For a user with
// N active codes, code_type/status reflect their NEWEST active code (the
// backend code_summary is built newest-first), so sorting "by code" uses it.
let _sort = { field: 'created_at', order: 'desc' };

function _sortVal(u, f) {
  switch (f) {
    case 'display_name': return (u.display_name || '').toLowerCase();
    case 'role':         return (u.role || '').toLowerCase();
    case 'cohort_name':  return (u.cohort_name || '').toLowerCase();
    case 'code_type':    return ((u.code_summary || {}).code_type || '').toLowerCase();
    case 'code_status':  return (u.code_summary || {}).has_active_code ? 0 : 1;  // active first
    case 'created_at':
    default:             return u.created_at || '';
  }
}

function compareUsers(a, b) {
  const dir = _sort.order === 'asc' ? 1 : -1;
  const av = _sortVal(a, _sort.field);
  const bv = _sortVal(b, _sort.field);
  if (av < bv) return -1 * dir;
  if (av > bv) return 1 * dir;
  return 0;   // stable sort → ties keep prior (created-desc) order
}

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
  showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });
}

function roleChip(role) {
  const r = (role || 'student').toLowerCase();
  const cls = r === 'admin' ? 'is-admin' : r === 'instructor' ? 'is-instructor' : '';
  return `<span class="usr-chip ${cls}">${escapeHtml(r)}</span>`;
}

async function loadList() {
  try {
    _all = (await api.get('/admin/users')) || [];
    if (!Array.isArray(_all)) _all = [];
    applyFilters();
  } catch (e) {
    showBanner('Không tải được users: ' + (e && e.message || 'lỗi'), 'error');
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
  rows.sort(compareUsers);
  render(rows);
  reflectSort();
}

// a11y — mirror the real sort state onto aria-sort for the sortable headers
// (purely reflective: reads _sort, changes no sort logic).
function reflectSort() {
  document.querySelectorAll('th.usr-sortable[data-sort]').forEach((th) => {
    const f = th.dataset.sort;
    th.setAttribute('aria-sort',
      _sort.field === f ? (_sort.order === 'asc' ? 'ascending' : 'descending') : 'none');
  });
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
  tbody.innerHTML = rows.map((u) => {
    const cs = u.code_summary || {};
    const codes = cs.codes || [];
    // Mã: primary (newest) code + "(+N)" badge; READ-ONLY here.
    const codeCell = codes.length
      ? `<span class="usr-code-mono">${escapeHtml(codes[0].code || '—')}</span>`
        + (codes.length > 1 ? ` <span class="usr-code-badge">(+${codes.length - 1})</span>` : '')
      : '<span class="usr-code-none">— chưa có mã</span>';
    const typeCell = cs.code_type ? escapeHtml(cs.code_type) : '—';
    const permsCell = (cs.permissions && cs.permissions.length)
      ? `<span class="usr-perms">${escapeHtml(cs.permissions.join(', '))}</span>` : '—';
    const codeStatus = cs.has_active_code
      ? '<span class="usr-chip">có mã</span>'
      : '<span class="usr-code-none">không có mã active</span>';
    // "Gỡ khỏi mã" targets the newest active code (DELETE /access-codes/{id}/users/{uid}).
    const removeBtn = (cs.has_active_code && codes[0] && codes[0].id)
      ? `<button class="ac-link ac-link-danger" data-removecode="${escapeHtml(codes[0].id)}" data-user="${escapeHtml(u.id)}">Gỡ khỏi mã</button>`
      : '';
    // "Tạo + gán mã": admin-side activation — only for accounts with NO active
    // code (mirror of the table's "không có mã active" state). A user who
    // already has an active code shows none of this (use the code tab instead).
    const genBtn = !cs.has_active_code
      ? `<button class="usr-convert-btn" data-gencode="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email || '')}">+ Tạo + gán mã</button>`
      : '';
    return `
    <tr data-id="${escapeHtml(u.id)}">
      <td>${escapeHtml(u.display_name || '—')}</td>
      <td>${escapeHtml(u.email || '—')}</td>
      <td>${codeCell}</td>
      <td>${typeCell}</td>
      <td>${permsCell}</td>
      <td>${codeStatus}</td>
      <td>${escapeHtml(u.cohort_name || '—')}</td>
      <td class="usr-role-cell">${roleChip(u.role)}</td>
      <td style="font-family: var(--av-font-mono); text-align: center;">${u.sessions_today || 0}</td>
      <td>${u.is_active === false
            ? '<span class="usr-chip is-inactive">inactive</span>'
            : '<span class="usr-chip">active</span>'}</td>
      <td><span class="usr-mono">${fmtDate(u.created_at)}</span></td>
      <td>
        <div class="usr-actions">
          <select class="usr-role-select" data-id="${escapeHtml(u.id)}" data-current="${escapeHtml(u.role || 'student')}">
            ${ROLES.map((r) => `<option value="${r}" ${(u.role || 'student') === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
          <button class="usr-convert-btn" data-convert="${escapeHtml(u.id)}"
                  data-name="${escapeHtml(u.display_name || '')}"
                  data-email="${escapeHtml(u.email || '')}">→ Học viên</button>
          ${genBtn}
          ${removeBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

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
    // Re-render the chip cell without reloading (target by class — column
    // index shifted when the merged code columns were added).
    const tr = selectEl.closest('tr');
    const chipCell = tr && tr.querySelector('.usr-role-cell');
    if (chipCell) chipCell.innerHTML = roleChip(role);
  } catch (e) {
    showBanner('Đổi role thất bại: ' + (e && e.message || 'lỗi'), 'error');
    selectEl.value = previous;
  }
}

// ── Sprint 18.1 — "Convert thành học viên" ───────────────────────────
// Links an existing auth user to a Writing-Coach roster row directly via
// POST /admin/students { user_id, student_code, full_name } (the backend
// returns 409 if the user already has a student row).
let _convertId = null;

function openConvert(userId, name, email) {
  _convertId = userId;
  const suggested = (email || '').split('@')[0] || '';
  $('cv-code').value = suggested;
  $('cv-name').value = name || email || '';
  $('convert-who').textContent = email ? `User: ${email}` : `User: ${userId}`;
  $('convert-error').hidden = true;
  $('convert-backdrop').hidden = false;
}

function closeConvert() {
  $('convert-backdrop').hidden = true;
  _convertId = null;
}

async function submitConvert() {
  const student_code = ($('cv-code').value || '').trim();
  const full_name = ($('cv-name').value || '').trim();
  if (!student_code || !full_name) {
    $('convert-error').textContent = 'Mã học viên và họ tên là bắt buộc.';
    $('convert-error').hidden = false;
    return;
  }
  $('btn-cv-submit').disabled = true;
  try {
    await api.post('/admin/students', { user_id: _convertId, student_code, full_name });
    closeConvert();
    showBanner(`Đã tạo hồ sơ học viên cho ${full_name}.`, 'success');
  } catch (e) {
    const msg = (e && e.message) || 'lỗi';
    // Backend 409 → user already a học viên.
    $('convert-error').textContent = /409|đã là học viên/.test(msg)
      ? 'Người dùng này đã là học viên.'
      : 'Không tạo được hồ sơ: ' + msg;
    $('convert-error').hidden = false;
  } finally {
    $('btn-cv-submit').disabled = false;
  }
}

// merge-codes PR-2 — per-user "Gỡ khỏi mã": deactivate this user's assignment
// to their newest active code (the same canonical endpoint the code tab uses).
// Refetch after (NOT optimistic) so the merged code columns reflect DB truth.
function removeFromCode(codeId, userId) {
  confirmDanger({
    title: 'Gỡ khỏi mã',
    body: 'Gỡ học viên này khỏi mã đang dùng? (Không xoá user; chỉ vô hiệu gán mã.)',
    confirmLabel: 'Gỡ khỏi mã',
    onConfirm: async () => {
      try {
        await api.delete('/admin/access-codes/' + encodeURIComponent(codeId)
          + '/users/' + encodeURIComponent(userId));
        showBanner('Đã gỡ khỏi mã.', 'success');
        await loadList();   // canonical refetch
      } catch (e) {
        showBanner('Gỡ khỏi mã thất bại: ' + (e && e.message || 'lỗi'), 'error');
      }
    },
  });
}

// ── "Tạo + gán mã" (admin-side activation) ───────────────────────────
// Creates ONE fresh code dedicated to a single user and assigns it server-side
// (POST /admin/access-codes/generate-and-assign) so an existing account with no
// active code is onboarded WITHOUT entering a code. Reuses the backend
// activation core; entitlement is code-derived, so we refetch (no optimistic).

async function loadCohorts() {
  try {
    const r = await api.get('/admin/cohorts?is_active=true');
    _cohorts = (r && r.cohorts) || [];
  } catch (e) {
    _cohorts = [];
    console.warn('[users] cohort fetch failed:', e);
  }
  const sel = $('ga-cohort');
  if (sel) {
    sel.innerHTML = '<option value="">— Chọn lớp —</option>'
      + _cohorts.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  }
}

function openGen(userId, email) {
  _genCtx = { userId };
  $('ga-who').textContent = email ? `User: ${email}` : `User: ${userId}`;
  $('ga-error').hidden = true;
  // Default type = mass (no cohort needed); cohort row hidden.
  document.querySelectorAll('input[name="ga-type"]').forEach((r) => { r.checked = r.value === 'mass'; });
  $('ga-cohort-row').hidden = true;
  $('ga-cohort').value = '';
  // Default permissions: "all" checked.
  $('ga-perms').querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = cb.value === 'all'; });
  $('ga-limit').value = '';
  $('ga-expires').value = '';
  $('ga-backdrop').hidden = false;
}

function closeGen() { $('ga-backdrop').hidden = true; _genCtx = null; }

function gaType() {
  const c = document.querySelector('input[name="ga-type"]:checked');
  return c ? c.value : 'mass';
}

function gaPerms() {
  return Array.from($('ga-perms').querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
}

function gaError(msg) { $('ga-error').textContent = msg; $('ga-error').hidden = false; }

async function submitGen() {
  if (!_genCtx) return;
  const code_type = gaType();
  const cohort_id = $('ga-cohort').value || null;
  const permissions = gaPerms();
  const limitRaw = ($('ga-limit').value || '').trim();
  const session_limit = limitRaw === '' ? null : parseInt(limitRaw, 10);
  const expires_raw = $('ga-expires').value;

  // Client-side guards mirror the server combo rules for instant feedback.
  if (code_type === 'direct' && !cohort_id) return gaError('Mã trực tiếp bắt buộc phải chọn lớp.');
  if (code_type !== 'direct' && cohort_id) return gaError('Chỉ mã Trực tiếp mới được gán lớp.');
  if (!permissions.length) return gaError('Phải chọn ít nhất một quyền.');
  if (limitRaw !== '' && (!Number.isInteger(session_limit) || session_limit < 1)) {
    return gaError('Giới hạn lượt phải là số nguyên ≥ 1 (hoặc để trống = không giới hạn).');
  }

  const body = {
    user_id: _genCtx.userId,
    permissions,
    code_type,
    cohort_id,
    session_limit,
    expires_at: expires_raw ? new Date(expires_raw).toISOString() : null,
  };

  $('btn-ga-submit').disabled = true;
  try {
    const r = await api.post('/admin/access-codes/generate-and-assign', body);
    closeGen();
    showBanner('Đã tạo + gán mã ' + (r && r.code || '') + ' cho người dùng.', 'success');
    await loadList();   // canonical refetch — has_active_code flips to true
  } catch (e) {
    gaError('Không tạo được mã: ' + (e && e.message || 'lỗi'));
  } finally {
    $('btn-ga-submit').disabled = false;
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
  // Convert button is rendered per-row; delegate off the tbody (rebuilt on
  // every render) so a single listener survives re-renders.
  $('usr-tbody').addEventListener('click', (e) => {
    const convertBtn = e.target.closest('button[data-convert]');
    if (convertBtn) { openConvert(convertBtn.dataset.convert, convertBtn.dataset.name, convertBtn.dataset.email); return; }
    const rmBtn = e.target.closest('button[data-removecode]');
    if (rmBtn) { removeFromCode(rmBtn.dataset.removecode, rmBtn.dataset.user); return; }
    const genCodeBtn = e.target.closest('button[data-gencode]');
    if (genCodeBtn) openGen(genCodeBtn.dataset.gencode, genCodeBtn.dataset.email);
  });
  // Sortable headers (2-criteria: user + code). Toggle dir on re-click.
  document.querySelectorAll('th.usr-sortable[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      _sort = { field, order: (_sort.field === field && _sort.order === 'desc') ? 'asc' : 'desc' };
      applyFilters();
    });
    // a11y — keyboard activation (Enter / Space) reuses the click path above.
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
    });
  });
  $('btn-cv-cancel').addEventListener('click', closeConvert);
  $('btn-cv-submit').addEventListener('click', submitConvert);
  $('convert-backdrop').addEventListener('click', (e) => {
    if (e.target === $('convert-backdrop')) closeConvert();
  });
  // "Tạo + gán mã" modal: type radios toggle the cohort row (direct ⇒ lớp).
  document.querySelectorAll('input[name="ga-type"]').forEach((r) => {
    r.addEventListener('change', () => {
      const isDirect = gaType() === 'direct';
      $('ga-cohort-row').hidden = !isDirect;
      if (!isDirect) $('ga-cohort').value = '';
    });
  });
  $('btn-ga-cancel').addEventListener('click', closeGen);
  $('btn-ga-submit').addEventListener('click', submitGen);
  $('ga-backdrop').addEventListener('click', (e) => {
    if (e.target === $('ga-backdrop')) closeGen();
  });
  loadCohorts();
  loadList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
