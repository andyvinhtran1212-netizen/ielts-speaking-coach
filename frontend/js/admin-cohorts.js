/**
 * frontend/js/admin-cohorts.js — Sprint 17.3 (Direction C)
 *
 * Cohort/class management (replaces the Phase-B placeholder). Two views off one page:
 *   - default        → cohort list (create / archive / view members)
 *   - ?cohort_id=<id> → cohort detail: member roster (CODE-DERIVED — the cohort's
 *                       active code assignees, via GET /admin/cohorts/{id}/members)
 * Member add/remove is deferred to Sprint 17.5 (= issuing/reassigning a code).
 * Class-based styling only (Pattern #26); reuses Sprint 17.2 usage formatters.
 */

import { usdLabel, countLabel, lastActiveLabel } from './admin-usage-util.js';

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let _cohorts = [];
let _cohortId = null;

function statusChip(c) {
  return c.is_active === false
    ? '<span class="adm-chip">Đã lưu trữ</span>'
    : '<span class="adm-chip is-active">Hoạt động</span>';
}

function showBanner(msg, kind) {
  const el = $('co-banner');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('is-error', kind === 'error');
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

// ── List view ────────────────────────────────────────────────────────────────

function renderList() {
  const f = $('cohort-filter-status').value;
  const rows = _cohorts.filter((c) => {
    if (f === 'active') return c.is_active !== false;
    if (f === 'archived') return c.is_active === false;
    return true;
  });
  $('cohorts-loading').hidden = true;
  if (!rows.length) {
    $('cohorts-empty').hidden = false;
    $('cohorts-table-wrap').hidden = true;
    return;
  }
  $('cohorts-empty').hidden = true;
  $('cohorts-table-wrap').hidden = false;
  $('cohorts-tbody').innerHTML = rows.map((c) => {
    const created = c.created_at ? new Date(c.created_at).toLocaleDateString('vi-VN') : '—';
    const archived = c.is_active === false;
    const toggle = archived
      ? `<button class="adm-btn-secondary" data-action="restore" data-id="${c.id}">Khôi phục</button>`
      : `<button class="adm-btn-secondary" data-action="archive" data-id="${c.id}">Lưu trữ</button>`;
    return `<tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c.code_prefix) || '—'}</td>
      <td>${statusChip(c)}</td>
      <td>${created}</td>
      <td><a class="adm-btn-secondary" href="/pages/admin/cohorts/index.html?cohort_id=${c.id}">Xem thành viên</a> ${toggle}</td>
    </tr>`;
  }).join('');
}

async function loadCohorts() {
  try {
    const r = await api.get('/admin/cohorts');   // no is_active filter → all
    _cohorts = (r && r.cohorts) || [];
  } catch (err) {
    _cohorts = [];
    showBanner('Không tải được danh sách lớp: ' + (err.message || err), 'error');
  }
  renderList();
}

async function setActive(cohortId, isActive) {
  try {
    await api.patch('/admin/cohorts/' + cohortId, { is_active: isActive });
    showBanner(isActive ? 'Đã khôi phục lớp.' : 'Đã lưu trữ lớp.', 'success');
    await loadCohorts();
  } catch (err) {
    showBanner('Không cập nhật được: ' + (err.message || err), 'error');
  }
}

function openCreate() {
  $('cc-error').hidden = true;
  $('cc-name').value = ''; $('cc-prefix').value = ''; $('cc-desc').value = '';
  $('cohort-modal-backdrop').hidden = false;
}
function closeCreate() { $('cohort-modal-backdrop').hidden = true; }

async function submitCreate() {
  const name = $('cc-name').value.trim();
  if (!name) {
    $('cc-error').textContent = 'Tên lớp là bắt buộc.';
    $('cc-error').hidden = false;
    return;
  }
  $('btn-cc-submit').disabled = true;
  try {
    await api.post('/admin/cohorts', {
      name,
      code_prefix: $('cc-prefix').value.trim() || null,
      description: $('cc-desc').value.trim() || null,
    });
    closeCreate();
    showBanner('Đã tạo lớp.', 'success');
    await loadCohorts();
  } catch (err) {
    $('cc-error').textContent = 'Không tạo được lớp: ' + (err.message || err);
    $('cc-error').hidden = false;
  } finally {
    $('btn-cc-submit').disabled = false;
  }
}

// ── Detail view (member roster) ────────────────────────────────────────────────

async function loadDetail(cohortId) {
  let data;
  try {
    data = await api.get('/admin/cohorts/' + encodeURIComponent(cohortId) + '/members');
  } catch (err) {
    $('members-loading').textContent = 'Không tải được thành viên: ' + (err.message || err);
    return;
  }
  _cohortId = cohortId;
  const c = data.cohort || {};
  $('cohort-detail-title').textContent = c.name || 'Lớp';
  $('cohort-detail-meta').innerHTML =
    `${statusChip(c)} <span class="co-meta">${esc(c.description || '')}</span>`
    + `<span class="co-meta">· ${countLabel(data.member_count)} thành viên</span>`;
  $('members-loading').hidden = true;
  $('members-empty').hidden = (data.members || []).length > 0;
  const members = data.members || [];
  $('members-table-wrap').hidden = members.length === 0;
  $('members-tbody').innerHTML = members.map((m) => {
    const who = m.email ? esc(m.email) : '(không rõ)';
    const name = m.name ? `<div class="u-name">${esc(m.name)}</div>` : '';
    return `<tr>
      <td>${name}<div class="u-email">${who}</div></td>
      <td class="u-num">${countLabel(m.sessions)}</td>
      <td>${esc(lastActiveLabel(m.last_active))}</td>
      <td class="u-num">${esc(usdLabel(m.ai_cost_usd))}</td>
      <td class="code-cell">${esc(m.code) || '—'}</td>
      <td><button class="adm-btn-secondary" data-action="remove-member" data-user="${esc(m.user_id)}">Xóa khỏi lớp</button></td>
    </tr>`;
  }).join('');
}

// ── Member add / remove (Sprint 17.5) ───────────────────────────────────────────

// Sprint 18.1 — the add-member picker is a user dropdown (was a raw UUID
// text input). Lazy-loaded + cached the first time the modal opens.
let _usersLoaded = false;

async function populateUserDropdown() {
  const sel = $('am-user');
  if (_usersLoaded) return;
  try {
    const users = (await api.get('/admin/users')) || [];
    const opts = users
      .map((u) => {
        const label = u.display_name ? `${u.display_name} (${u.email || '—'})` : (u.email || u.id);
        return `<option value="${esc(u.id)}">${esc(label)}</option>`;
      })
      .join('');
    sel.innerHTML = '<option value="">— Chọn người dùng —</option>' + opts;
    _usersLoaded = true;
  } catch (err) {
    sel.innerHTML = '<option value="">Không tải được danh sách người dùng</option>';
  }
}

function openAddMember() {
  $('am-error').hidden = true;
  $('am-user').value = '';
  $('am-reason').value = '';
  $('addmember-backdrop').hidden = false;
  populateUserDropdown();
}
function closeAddMember() { $('addmember-backdrop').hidden = true; }

async function submitAddMember() {
  const user_id = $('am-user').value.trim();
  if (!user_id) {
    $('am-error').textContent = 'Cần chọn học viên từ danh sách.';
    $('am-error').hidden = false;
    return;
  }
  $('btn-am-submit').disabled = true;
  try {
    const r = await api.post('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/members',
      { user_id, reason: $('am-reason').value.trim() || null });
    closeAddMember();
    showBanner('Đã thêm học viên (cấp mã ' + (r.new_code || '') + ').', 'success');
    loadDetail(_cohortId);
  } catch (err) {
    $('am-error').textContent = 'Không thêm được học viên: ' + (err.message || err);
    $('am-error').hidden = false;
  } finally {
    $('btn-am-submit').disabled = false;
  }
}

async function removeMember(userId) {
  if (!confirm('Xóa học viên này khỏi lớp? Các mã của lớp gắn với họ sẽ bị vô hiệu.')) return;
  try {
    await api.delete('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/members/' + encodeURIComponent(userId));
    showBanner('Đã xóa học viên khỏi lớp.', 'success');
    loadDetail(_cohortId);
  } catch (err) {
    showBanner('Không xóa được: ' + (err.message || err), 'error');
  }
}

function bindDetail() {
  $('btn-add-member').addEventListener('click', openAddMember);
  $('btn-am-cancel').addEventListener('click', closeAddMember);
  $('btn-am-submit').addEventListener('click', submitAddMember);
  $('addmember-backdrop').addEventListener('click', (e) => {
    if (e.target === $('addmember-backdrop')) closeAddMember();
  });
  $('members-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="remove-member"]');
    if (btn) removeMember(btn.dataset.user);
  });
}

function bindList() {
  $('btn-create-cohort').addEventListener('click', openCreate);
  $('btn-cc-cancel').addEventListener('click', closeCreate);
  $('btn-cc-submit').addEventListener('click', submitCreate);
  $('cohort-modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('cohort-modal-backdrop')) closeCreate();
  });
  $('cohort-filter-status').addEventListener('change', renderList);
  $('cohorts-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'archive') setActive(btn.dataset.id, false);
    if (btn.dataset.action === 'restore') setActive(btn.dataset.id, true);
  });
}

function main() {
  const cohortId = new URLSearchParams(window.location.search).get('cohort_id');
  if (cohortId) {
    $('view-list').hidden = true;
    $('view-detail').hidden = false;
    bindDetail();
    loadDetail(cohortId);
  } else {
    $('view-detail').hidden = true;
    $('view-list').hidden = false;
    bindList();
    loadCohorts();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
