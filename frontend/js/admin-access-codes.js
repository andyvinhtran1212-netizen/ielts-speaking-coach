// @ts-check
/** @typedef {import('../types/api').components['schemas']['AccessCodeOut']} AccessCodeOut */
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

// Pilot: `$` returns `any` so DOM element-property access (.value/.checked/etc.)
// isn't type-checked — the pilot's goal is API-SHAPE drift-catch, not DOM typing
// (typing every getElementById to its concrete element subtype is the bulk of
// per-module cost; out of scope here — see tsconfig.json//strict note).
const $  = /** @type {(id: string) => any} */ ((id) => document.getElementById(id));
/** @param {*} v */
const fmt = (v) => v == null || v === '' ? '—' : String(v);
/** @param {*} s */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** @type {AccessCodeOut[]} */
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
    // Per-user revoke: deactivate this user's assignment. Only for a real
    // active assignment (removable) — a legacy used_by fallback row has no
    // assignment to deactivate. Calls DELETE /access-codes/{id}/users/{uid},
    // which (post read-path fix) cuts the user's access immediately.
    // (The old per-user "Đổi"/reassign button was dropped — permissions are now
    // edited per-code via the "Sửa quyền" action in the actions column.)
    const remove = u.removable
      ? ` <button class="ac-link ac-link-danger" data-action="remove-user" data-code="${c.id}" data-user="${esc(u.user_id)}" data-email="${esc(u.email || '')}">Gỡ</button>`
      : '';
    return `<div class="ac-user">${email}${qHtml}${remove}</div>`;
  }).join('');
}

function showBanner(msg, kind) {
  showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });
}

function chipForType(t) {
  const label = { mass: 'Đại trà', direct: 'Trực tiếp', staff: 'Nhân viên' }[t] || t;
  // Type chip: canonical .adm-chip (the old `ac-chip` had no CSS rule — audit
  // row 3). `is-direct` stays a TYPE modifier (teal) on .adm-chip.
  const cls = t === 'direct' ? 'adm-chip is-direct' : 'adm-chip';
  return `<span class="${cls}">${label}</span>`;
}

function chipForStatus(row) {
  // Status uses the .adm-status-pill primitive with state modifiers, not the
  // type chip — `is-direct` was being overloaded for the active state (audit
  // row 4). Now: revoked → error, locked → inactive, active → teal.
  if (row.is_revoked) return '<span class="adm-status-pill is-revoked">Đã thu hồi</span>';
  if (row.is_active === false) return '<span class="adm-status-pill is-inactive">Đã khóa</span>';
  return '<span class="adm-status-pill is-active">Hoạt động</span>';
}

function rowMatchesFilters(row, f) {
  if (f.type && row.code_type !== f.type) return false;
  // Revoked codes are hidden from the default ("Tất cả") view — they clutter
  // the active roster — but remain reachable via the explicit "Đã thu hồi"
  // filter for audit. DB row + audit + statusRank are untouched (display only).
  if (!f.status && row.is_revoked) return false;
  if (f.status === 'active' && (row.is_revoked || row.is_active === false)) return false;
  if (f.status === 'revoked' && !row.is_revoked) return false;
  if (f.cohort && row.cohort_id !== f.cohort) return false;
  return true;
}

// a11y — mirror the real sort state onto aria-sort. Scoped to `.ac-sortable`
// so it never touches the user-tab headers that share this page. Reflective
// only: reads _sort, changes no sort logic.
function reflectSort() {
  document.querySelectorAll('th.ac-sortable[data-sort]').forEach((/** @type {any} */ th) => {
    const f = th.dataset.sort;
    th.setAttribute('aria-sort',
      _sort.field === f ? (_sort.order === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}

function renderTable() {
  const tbody = $('codes-tbody');
  reflectSort();
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
    const cohort = c.cohort_name ? `<span class="adm-chip is-direct">${c.cohort_name}</span>` : '—';
    const revokeBtn = (c.is_revoked || c.is_active === false)
      ? ''
      : `<button class="adm-btn-danger adm-btn-sm" data-action="revoke" data-id="${c.id}">Thu hồi</button>`;
    // Sprint 17.2 — drill into this code's usage rollup.
    const usageLink = `<a class="adm-btn-secondary adm-btn-sm" href="/pages/admin/usage/index.html?code_id=${c.id}">Hoạt động</a>`;
    // Sprint 17.5 — refill: issue a fresh mirrored code for the code's user.
    const refillBtn = (c.is_revoked || c.is_active === false)
      ? ''
      : `<button class="adm-btn-secondary adm-btn-sm" data-action="refill" data-id="${c.id}">Cấp mã mới</button>`;
    // Sửa quyền (per-code): edit this code's permissions + session_limit. Applies
    // to ALL users of the code; propagates live (read by every gate since
    // #441/#442). openEditPerms looks the row up in _allCodes by id (perms,
    // limit, per-user usage), so the button only needs the id.
    const editPermsBtn = (c.is_revoked || c.is_active === false)
      ? ''
      : `<button class="adm-btn-secondary adm-btn-sm" data-action="edit-perms" data-id="${c.id}">Sửa quyền</button>`;
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
        <td><div class="adm-action-group">${usageLink}${editPermsBtn}${refillBtn}${revokeBtn}</div></td>
      </tr>
    `;
  }).join('');
}

async function loadCohorts() {
  try {
    const r = /** @type {any} */ (await api.get('/admin/cohorts?is_active=true'));
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

// `silent` = refetch canonical state and re-render WITHOUT the "Đang tải" flash
// or hiding the table. Used after a mutation (Gỡ / Thu hồi / Sửa quyền) so the
// affected row updates in place from backend truth — no full-page reload, no
// optimistic local state that could diverge (CLAUDE.md). The initial load uses
// silent=false to show the loading state.
async function loadCodes(silent) {
  if (!silent) {
    $('codes-empty').hidden = true;
  }
  try {
    // Typed call-site: tsc checks every c.assigned_users / c.cohort_name access
    // below against AccessCodeOut → a BE field rename (regenerated api.d.ts)
    // becomes a typecheck error HERE, not a silent prod break.
    const r = /** @type {AccessCodeOut[]} */ (await api.get('/admin/access-codes'));
    _allCodes = Array.isArray(r) ? r : [];
  } catch (err) {
    if (!silent) _allCodes = [];
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
  document.querySelectorAll('input[name="m-type"]').forEach((/** @type {any} */ r) => {
    r.checked = r.value === 'mass';
  });
  $('m-cohort-row').hidden = true;
  $('m-cohort').value = '';
  // Default permissions: all checked, others unchecked.
  $('m-perms').querySelectorAll('input[type="checkbox"]').forEach((/** @type {any} */ cb) => {
    cb.checked = cb.value === 'all';
  });
  $('modal-backdrop').hidden = false;
}

function closeModal() {
  $('modal-backdrop').hidden = true;
}

function selectedType() {
  const checked = /** @type {any} */ (document.querySelector('input[name="m-type"]:checked'));
  return checked ? checked.value : 'mass';
}

function selectedPerms() {
  return Array.from($('m-perms').querySelectorAll('input[type="checkbox"]:checked'))
    .map((/** @type {any} */ cb) => cb.value);
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
    const r = /** @type {any} */ (await api.post('/admin/access-codes/generate', body));
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

function revokeCode(codeId) {
  confirmDanger({
    title: 'Thu hồi mã',
    body: 'Thu hồi mã này? Hành động này không thể khôi phục.',
    confirmLabel: 'Thu hồi',
    onConfirm: async () => {
      try {
        await api.delete('/admin/access-codes/' + codeId);
        showBanner('Đã thu hồi mã.', 'success');
        await loadCodes(true);  // silent refetch → row shows revoked in place
      } catch (err) {
        showBanner('Không thu hồi được: ' + (err.message || err), 'error');
      }
    },
  });
}

// Per-user revoke: deactivate one user's assignment to a code. The user loses
// access immediately (read-path fix #442 suppresses the legacy used_by
// fallback once an assignment row exists). Never clears used_by/is_used.
function removeUser(codeId, userId, email) {
  const who = email || 'người dùng này';
  confirmDanger({
    title: 'Gỡ khỏi mã',
    body: 'Gỡ ' + who + ' khỏi mã? Họ sẽ mất quyền truy cập ngay.',
    confirmLabel: 'Gỡ khỏi mã',
    onConfirm: async () => {
      try {
        await api.delete(
          '/admin/access-codes/' + codeId + '/users/' + encodeURIComponent(userId),
        );
        // The list endpoint no longer re-synthesizes a removed user as a legacy
        // redeemer (admin.py fallback fix), so loadCodes() drops them from the
        // active list — making the removal visible, not just the loss of a link.
        showBanner('Đã gỡ ' + who + ' khỏi mã. Quyền truy cập bị thu hồi ngay.', 'success');
        await loadCodes(true);  // silent refetch → user drops from the row in place
      } catch (err) {
        showBanner('Không gỡ được ' + who + ': ' + (err.message || err), 'error');
      }
    },
  });
}

// ── Sửa quyền (per-code) + refill ───────────────────────────────────────────
// Replaces the Sprint 17.5 per-user reassign ("Đổi"). Andy: reassign not needed
// — admins edit the code's permissions instead, which apply to ALL users of the
// code and propagate live (PATCH code.permissions, read by every gate post
// #441/#442). Never touches used_*/session_limit — permissions array only.

let _editPermsCtx = null;  // { codeId, code }

function openEditPerms(codeId) {
  const code = _allCodes.find((c) => String(c.id) === String(codeId));
  if (!code) return;
  _editPermsCtx = { codeId, code: code.code };
  $('ep-code-label').textContent = code.code || '';
  $('ep-error').hidden = true;
  // Pre-check the boxes to the code's current permissions.
  const current = Array.isArray(code.permissions) ? code.permissions : [];
  document.querySelectorAll('#ep-perms input[type="checkbox"]').forEach((/** @type {any} */ cb) => {
    cb.checked = current.includes(cb.value);
  });
  // session_limit (empty input = unlimited / NULL).
  $('ep-limit').value = (code.session_limit == null) ? '' : String(code.session_limit);
  // Per-user usage (read-only): đã dùng / limit / còn lại, from the list payload.
  const users = (code.assigned_users || []).filter((u) => u.quota);
  if (users.length) {
    $('ep-usage').innerHTML = users.map((u) => {
      const q = /** @type {any} */ (u.quota || {});
      const email = u.email ? esc(u.email) : '(không rõ)';
      const lim = (q.limit == null) ? '∞' : String(q.limit);
      const rem = (q.remaining == null) ? '∞' : String(q.remaining);
      return `<div class="ep-usage-row">${email}: đã dùng <strong>${q.used == null ? 0 : q.used}</strong> / ${lim} (còn ${rem})</div>`;
    }).join('');
    $('ep-usage-wrap').hidden = false;
  } else {
    $('ep-usage').innerHTML = '';
    $('ep-usage-wrap').hidden = true;
  }
  $('editperms-backdrop').hidden = false;
}
function closeEditPerms() { $('editperms-backdrop').hidden = true; }

function _selectedEditPerms() {
  return Array.from(document.querySelectorAll('#ep-perms input[type="checkbox"]:checked'))
    .map((/** @type {any} */ cb) => cb.value);
}

async function submitEditPerms() {
  const permissions = _selectedEditPerms();
  if (!permissions.length) {
    $('ep-error').textContent = 'Phải chọn ít nhất một quyền.';
    $('ep-error').hidden = false;
    return;
  }
  // session_limit: empty = unlimited (NULL); otherwise a positive integer.
  const limitRaw = $('ep-limit').value.trim();
  const session_limit = limitRaw === '' ? null : parseInt(limitRaw, 10);
  if (limitRaw !== '' && (!Number.isInteger(session_limit) || session_limit < 1)) {
    $('ep-error').textContent = 'Giới hạn lượt phải là số nguyên ≥ 1 (hoặc để trống = không giới hạn).';
    $('ep-error').hidden = false;
    return;
  }
  $('btn-ep-submit').disabled = true;
  try {
    // PATCH permissions + session_limit only — never touches used_*/used_by.
    await api.patch('/admin/access-codes/' + _editPermsCtx.codeId, { permissions, session_limit });
    closeEditPerms();
    showBanner('Đã cập nhật quyền cho mã ' + (_editPermsCtx.code || '') +
               '. Áp dụng cho tất cả người dùng của mã ngay.', 'success');
    await loadCodes(true);  // silent refetch → row reflects new perms in place
  } catch (err) {
    $('ep-error').textContent = 'Không lưu được quyền: ' + (err.message || err);
    $('ep-error').hidden = false;
  } finally {
    $('btn-ep-submit').disabled = false;
  }
}

async function refillCode(codeId) {
  if (!confirm('Cấp một mã mới (sao chép quyền/lớp/giới hạn) cho người dùng hiện tại của mã này?')) return;
  try {
    const r = /** @type {any} */ (await api.post('/admin/access-codes/' + codeId + '/refill', {}));
    showBanner('Đã cấp mã mới: ' + (r.new_code || ''), 'success');
    await loadCodes();
  } catch (err) {
    showBanner('Không cấp được mã mới: ' + (err.message || err), 'error');
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
  document.querySelectorAll('th[data-sort]').forEach((/** @type {any} */ th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      _sort = { field, order: (_sort.field === field && _sort.order === 'desc') ? 'asc' : 'desc' };
      renderTable();
    });
  });
  // a11y — keyboard activation for the code-tab sortable headers (scoped to
  // .ac-sortable; reuses the click path above). Enter / Space to sort.
  document.querySelectorAll('th.ac-sortable[data-sort]').forEach((/** @type {any} */ th) => {
    th.addEventListener('keydown', (/** @type {any} */ e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
    });
  });
  $('codes-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'revoke') revokeCode(btn.dataset.id);
    if (btn.dataset.action === 'refill') refillCode(btn.dataset.id);
    if (btn.dataset.action === 'edit-perms') openEditPerms(btn.dataset.id);
    if (btn.dataset.action === 'remove-user') removeUser(btn.dataset.code, btn.dataset.user, btn.dataset.email);
  });
  // Sửa quyền (per-code) modal.
  $('btn-ep-cancel').addEventListener('click', closeEditPerms);
  $('btn-ep-submit').addEventListener('click', submitEditPerms);
  $('editperms-backdrop').addEventListener('click', (e) => {
    if (e.target === $('editperms-backdrop')) closeEditPerms();
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
