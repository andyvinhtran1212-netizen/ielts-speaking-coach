/**
 * frontend/js/admin-cohorts.js — Sprint 17.3 (Direction C)
 *
 * Cohort/class management (replaces the Phase-B placeholder). Two views off one page:
 *   - default        → cohort list (create / archive / view members)
 *   - ?cohort_id=<id> → cohort detail: CLASS ROSTER (WF-1 — students WHERE
 *                       cohort_id=id, the source of truth writing fan-out +
 *                       grade-matrix read, via GET /admin/cohorts/{id}/members)
 * Add/remove assign an EXISTING student to the roster (POST/DELETE
 * /admin/cohorts/{id}/students — sets/clears students.cohort_id, no code issued;
 * entitlement/codes are a separate concern). Reuses 17.2 usage formatters.
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
// C4: delegate to the shared escaper (window.WC.escapeHtml, api.js).
const esc = (s) => (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml(s)
  : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let _cohorts = [];
let _cohortId = null;

function statusChip(c) {
  return c.is_active === false
    ? '<span class="adm-chip">Đã lưu trữ</span>'
    : '<span class="adm-chip is-active">Hoạt động</span>';
}

function showBanner(msg, kind) {
  showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });
}

// ── List view ────────────────────────────────────────────────────────────────

function renderList() {
  const f = $('cohort-filter-status').value;
  const rows = _cohorts.filter((c) => {
    if (f === 'active') return c.is_active !== false;
    if (f === 'archived') return c.is_active === false;
    return true;
  });
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
  $('members-empty').hidden = (data.members || []).length > 0;
  const members = data.members || [];
  $('members-table-wrap').hidden = members.length === 0;
  // WF-1: roster row = a student (students.cohort_id). Usage columns are
  // zero for students who haven't activated (no linked user). The status
  // sub-line replaces the old per-user code (entitlement is separate now).
  $('members-tbody').innerHTML = members.map((m) => {
    const name = m.name ? `<div class="u-name">${esc(m.name)}</div>` : '';
    const status = m.user_id
      ? '<div class="u-email">Đã kích hoạt</div>'
      : '<div class="u-email">Chưa kích hoạt</div>';
    return `<tr>
      <td>${name}${status}</td>
      <td class="u-num">${countLabel(m.sessions)}</td>
      <td>${esc(lastActiveLabel(m.last_active))}</td>
      <td class="u-num">${esc(usdLabel(m.ai_cost_usd))}</td>
      <td class="code-cell">${esc(m.student_code) || '—'}</td>
      <td><button class="adm-btn-secondary" data-action="remove-member" data-student="${esc(m.student_id)}">Xóa khỏi lớp</button></td>
    </tr>`;
  }).join('');
}

// ── Member add / remove (Sprint 17.5) ───────────────────────────────────────────

// WF-1 — the add-member picker lists STUDENTS (roster = students.cohort_id).
// Assigning sets students.cohort_id; it does NOT issue any access code
// (entitlement is a separate concern). Lazy-loaded + cached on first open.
let _studentsLoaded = false;

async function populateStudentDropdown() {
  const sel = $('am-user');
  if (_studentsLoaded) return;
  try {
    const res = await api.get('/admin/students?limit=200');
    const students = Array.isArray(res) ? res : (res.students || res.items || []);
    const opts = students
      .map((s) => {
        const label = s.full_name ? `${s.full_name} (${s.student_code || '—'})` : (s.student_code || s.id);
        return `<option value="${esc(s.id)}">${esc(label)}</option>`;
      })
      .join('');
    sel.innerHTML = '<option value="">— Chọn học viên —</option>' + opts;
    _studentsLoaded = true;
  } catch (err) {
    sel.innerHTML = '<option value="">Không tải được danh sách học viên</option>';
  }
}

function openAddMember() {
  $('am-error').hidden = true;
  $('am-user').value = '';
  $('addmember-backdrop').hidden = false;
  populateStudentDropdown();
}
function closeAddMember() { $('addmember-backdrop').hidden = true; }

async function submitAddMember() {
  const student_id = $('am-user').value.trim();
  if (!student_id) {
    $('am-error').textContent = 'Cần chọn học viên từ danh sách.';
    $('am-error').hidden = false;
    return;
  }
  $('btn-am-submit').disabled = true;
  try {
    await api.post('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/students',
      { student_id });
    closeAddMember();
    showBanner('Đã thêm học viên vào lớp.', 'success');
    loadDetail(_cohortId);
  } catch (err) {
    $('am-error').textContent = 'Không thêm được học viên: ' + (err.message || err);
    $('am-error').hidden = false;
  } finally {
    $('btn-am-submit').disabled = false;
  }
}

function removeMember(studentId) {
  confirmDanger({
    title: 'Gỡ khỏi lớp',
    body: 'Xóa học viên này khỏi lớp? (Không ảnh hưởng mã đăng nhập của họ.)',
    confirmLabel: 'Gỡ khỏi lớp',
    onConfirm: async () => {
      try {
        await api.delete('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/students/' + encodeURIComponent(studentId));
        showBanner('Đã xóa học viên khỏi lớp.', 'success');
        loadDetail(_cohortId);
      } catch (err) {
        showBanner('Không xóa được: ' + (err.message || err), 'error');
      }
    },
  });
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
    if (btn) removeMember(btn.dataset.student);
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
