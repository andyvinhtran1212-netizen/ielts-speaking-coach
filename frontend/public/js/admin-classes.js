/**
 * frontend/js/admin-classes.js — trang gộp "Lớp & Học viên" (GĐ 1).
 *
 * Kế hoạch: docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md
 *
 * Two views off one page, chosen by the `cohort_id` query param:
 *   - (none)          → danh sách lớp, lọc theo khoá học + trạng thái
 *   - ?cohort_id=<id> → chi tiết lớp: Sĩ số | Buổi học
 *
 * The roster cell never shows a bare number. `unactivated_count` is students on
 * the roster with no account, and they receive nothing that is assigned to them
 * — no error, no empty state, nothing on any screen (mig 177). That gap is the
 * silent failure this whole programme rests on, so it is stated on every class
 * row instead of one click deep.
 *
 * When the backend reports `rollup_failed`, counts arrive as null and the cell
 * says so. Rendering "0 học viên" for a failed query would be a claim the query
 * never earned — the same rule the access-code screens follow for
 * `association_lookup_failed`.
 */

import { usdLabel, countLabel, lastActiveLabel } from './admin-usage-util.js';

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;
const $ = (id) => document.getElementById(id);

// Shared escaper (window.WC.escapeHtml, api.js) with a local fallback so this
// module stays usable if api.js has not defined it yet.
const esc = (s) => (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml(s)
  : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const toast = (msg, kind) =>
  window.showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });

let _cohorts = [];
let _courses = [];
let _cohortId = null;
let _cohort = null;
let _lessons = [];
let _editingLessonId = null;
let _studentsLoaded = false;

// ── Shared bits ─────────────────────────────────────────────────────────────

function statusChip(c) {
  return c && c.is_active === false
    ? '<span class="adm-chip">Đã lưu trữ</span>'
    : '<span class="adm-chip is-active">Đang hoạt động</span>';
}

/**
 * Course cell. "Chưa gán khoá" is a real, common state (every class predating
 * mig 175 is in it) — which is exactly why an unreadable course must not borrow
 * that label. `course_id` set with no resolved course means the lookup failed or
 * the row is gone; printing "Chưa gán khoá" there would send the admin off to
 * assign a course that is already assigned.
 */
function courseLabel(course, courseId) {
  if (course) {
    const archived = course.is_active === false ? ' <span class="cl-muted">(đã lưu trữ)</span>' : '';
    return `<span class="adm-chip cl-course-chip">${esc(course.code)}</span> ${esc(course.name)}${archived}`;
  }
  if (courseId) return '<span class="cl-roster-unknown">Không đọc được khoá</span>';
  return '<span class="cl-muted">Chưa gán khoá</span>';
}

/**
 * Roster cell. Three distinct states, deliberately not collapsed into one:
 *   null      → the scan failed; say so rather than print a number
 *   gap > 0   → sĩ số plus the number who cannot receive anything
 *   gap === 0 → plain count
 */
function rosterCell(memberCount, unactivated) {
  if (memberCount == null) {
    return '<span class="cl-roster-unknown">Không đọc được sĩ số</span>';
  }
  const count = `<span class="cl-roster-count">${countLabel(memberCount)} học viên</span>`;
  if (!unactivated) return `<div class="cl-roster">${count}</div>`;
  return `<div class="cl-roster">${count}`
    + `<span class="cl-roster-gap">${countLabel(unactivated)} chưa kích hoạt</span></div>`;
}

/**
 * Today's calendar date in Asia/Ho_Chi_Minh, as YYYY-MM-DD.
 *
 * en-CA formats as YYYY-MM-DD, which is exactly what <input type=date> wants —
 * and going through Intl with an explicit timeZone is what makes this the
 * centre's date rather than the browser's.
 */
function todayInVietnam() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN');
}

// ── Danh sách lớp ───────────────────────────────────────────────────────────

function renderCourseFilter() {
  const sel = $('filter-course');
  const current = sel.value;
  sel.innerHTML = '<option value="">Tất cả khoá</option>'
    + _courses.map((c) => `<option value="${esc(c.id)}">${esc(courseOptionLabel(c))}</option>`).join('');
  sel.value = current;
}

function courseOptionLabel(c) {
  return `${c.code} — ${c.name}` + (c.is_active === false ? ' (đã lưu trữ)' : '');
}

/**
 * Options for the edit form's course picker.
 *
 * If the class points at a course this list does not contain — archived, or the
 * course fetch failed — a plain render leaves NO option selected, the select
 * falls back to the empty first entry, and saving an unrelated field (renaming
 * the class) posts `course_id: null`, quietly detaching the class from its
 * course. So an unresolved id gets its own selected option and survives the
 * round-trip untouched.
 */
function renderCourseOptions(selectedId) {
  const known = _courses.some((c) => c.id === selectedId);
  const orphan = (selectedId && !known)
    ? `<option value="${esc(selectedId)}" selected>Khoá hiện tại (không đọc được tên)</option>`
    : '';
  $('cf-course').innerHTML = '<option value="">Chưa gán khoá</option>'
    + orphan
    + _courses.map((c) => {
      const sel = c.id === selectedId ? ' selected' : '';
      return `<option value="${esc(c.id)}"${sel}>${esc(courseOptionLabel(c))}</option>`;
    }).join('');
}

function renderList() {
  const status = $('filter-status').value;
  const courseId = $('filter-course').value;

  const rows = _cohorts.filter((c) => {
    if (status === 'active' && c.is_active === false) return false;
    if (status === 'archived' && c.is_active !== false) return false;
    if (courseId && c.course_id !== courseId) return false;
    return true;
  });

  $('list-loading').hidden = true;

  if (!rows.length) {
    // The empty state names the filter that produced it, so the admin is not
    // left wondering whether there are no classes or none matching.
    $('list-empty').textContent = (_cohorts.length && (courseId || status !== 'all'))
      ? 'Không có lớp nào khớp bộ lọc. Đổi khoá học hoặc trạng thái để xem thêm.'
      : 'Chưa có lớp nào. Tạo lớp đầu tiên để bắt đầu.';
    $('list-empty').hidden = false;
    $('list-table-wrap').hidden = true;
    return;
  }

  $('list-empty').hidden = true;
  $('list-table-wrap').hidden = false;
  $('list-tbody').innerHTML = rows.map((c) => {
    const archived = c.is_active === false;
    const toggle = archived
      ? `<button class="adm-btn-secondary" data-action="restore" data-id="${esc(c.id)}">Khôi phục</button>`
      : `<button class="adm-btn-secondary" data-action="archive" data-id="${esc(c.id)}">Lưu trữ</button>`;
    return `<tr>
      <td><a class="cl-link" href="/pages/admin/classes/index.html?cohort_id=${encodeURIComponent(c.id)}">${esc(c.name)}</a></td>
      <td>${courseLabel(c.course, c.course_id)}</td>
      <td>${rosterCell(c.member_count, c.unactivated_count)}</td>
      <td class="code-cell">${esc(c.code_prefix) || '—'}</td>
      <td>${statusChip(c)}</td>
      <td>${toggle}</td>
    </tr>`;
  }).join('');
}

async function loadCourses() {
  try {
    // All courses, not only active ones. A class may still reference an
    // archived course, and leaving it out of the picker makes an unrelated edit
    // post course_id: null and detach the class from its history.
    const r = await api.get('/admin/courses');
    _courses = (r && r.courses) || [];
  } catch (err) {
    _courses = [];
    toast('Không tải được danh sách khoá học: ' + (err.message || err), 'error');
  }
}

async function loadCohorts() {
  try {
    // with_rollup=true is what makes the roster counts appear; it is opt-in so
    // the five cohort-PICKER callers of this endpoint don't pay for a full
    // student scan they never render. No is_active filter → archived included.
    const r = await api.get('/admin/cohorts?with_rollup=true');
    _cohorts = (r && r.cohorts) || [];
    // Surfaced, not swallowed: without this the admin reads "Không đọc được sĩ
    // số" on every row with no idea why.
    if (r && r.rollup_failed) {
      toast('Không đọc được sĩ số các lớp. Số liệu sĩ số đang tạm thiếu.', 'error');
    }
  } catch (err) {
    _cohorts = [];
    toast('Không tải được danh sách lớp: ' + (err.message || err), 'error');
  }
  renderList();
}

async function setActive(cohortId, isActive) {
  try {
    await api.patch('/admin/cohorts/' + encodeURIComponent(cohortId), { is_active: isActive });
    toast(isActive ? 'Đã khôi phục lớp.' : 'Đã lưu trữ lớp.');
    await loadCohorts();
  } catch (err) {
    toast('Không cập nhật được lớp: ' + (err.message || err), 'error');
  }
}

// ── Tạo / sửa lớp ───────────────────────────────────────────────────────────

let _editingCohortId = null;

function openCohortModal(cohort) {
  _editingCohortId = cohort ? cohort.id : null;
  $('cohort-modal-title').textContent = cohort ? 'Sửa thông tin lớp' : 'Tạo lớp';
  $('cf-name').value = cohort ? (cohort.name || '') : '';
  $('cf-prefix').value = cohort ? (cohort.code_prefix || '') : '';
  $('cf-desc').value = cohort ? (cohort.description || '') : '';
  renderCourseOptions(cohort ? cohort.course_id : null);
  $('cf-error').hidden = true;
  $('cohort-modal').hidden = false;
  $('cf-name').focus();
}

function closeCohortModal() { $('cohort-modal').hidden = true; }

async function submitCohort() {
  const name = $('cf-name').value.trim();
  if (!name) {
    $('cf-error').textContent = 'Nhập tên lớp để tiếp tục.';
    $('cf-error').hidden = false;
    return;
  }
  const body = {
    name,
    // Empty select means "no course" — sent as null so PATCH clears an existing
    // one instead of silently keeping it.
    course_id: $('cf-course').value || null,
    code_prefix: $('cf-prefix').value.trim() || null,
    description: $('cf-desc').value.trim() || null,
  };

  $('btn-cf-submit').disabled = true;
  try {
    if (_editingCohortId) {
      await api.patch('/admin/cohorts/' + encodeURIComponent(_editingCohortId), body);
      toast('Đã lưu thông tin lớp.');
      closeCohortModal();
      await loadDetail(_editingCohortId);
    } else {
      await api.post('/admin/cohorts', body);
      toast('Đã tạo lớp.');
      closeCohortModal();
      await loadCohorts();
    }
  } catch (err) {
    $('cf-error').textContent = 'Không lưu được lớp: ' + (err.message || err);
    $('cf-error').hidden = false;
  } finally {
    $('btn-cf-submit').disabled = false;
  }
}

// ── Chi tiết lớp: sĩ số ─────────────────────────────────────────────────────

async function loadDetail(cohortId) {
  _cohortId = cohortId;
  $('roster-loading').hidden = false;

  let data;
  try {
    data = await api.get('/admin/cohorts/' + encodeURIComponent(cohortId) + '/members');
  } catch (err) {
    $('roster-loading').hidden = true;
    $('detail-banner').textContent = 'Không tải được sĩ số: ' + (err.message || err);
    $('detail-banner').hidden = false;
    return;
  }
  $('roster-loading').hidden = true;
  $('detail-banner').hidden = true;

  _cohort = data.cohort || {};
  const members = data.members || [];
  const unactivated = members.filter((m) => !m.user_id).length;

  $('detail-title').textContent = _cohort.name || 'Lớp';
  document.title = `${_cohort.name || 'Lớp'} · Lớp & Học viên · Admin`;

  const course = _courses.find((c) => c.id === _cohort.course_id) || null;
  $('detail-meta').innerHTML = [
    statusChip(_cohort),
    courseLabel(course, _cohort.course_id),
    _cohort.description ? esc(_cohort.description) : '',
  ].filter(Boolean).join('<span class="cl-muted">·</span>');

  $('roster-summary').innerHTML = unactivated
    ? `${countLabel(members.length)} học viên · <span class="cl-roster-gap">${countLabel(unactivated)} chưa kích hoạt, sẽ không nhận được bài giao</span>`
    : `${countLabel(members.length)} học viên`;

  $('roster-empty').hidden = members.length > 0;
  $('roster-table-wrap').hidden = members.length === 0;
  $('roster-tbody').innerHTML = members.map((m) => {
    const account = m.user_id
      ? '<div class="cl-lesson-sub">Đã kích hoạt</div>'
      : '<div class="cl-roster-gap">Chưa kích hoạt</div>';
    return `<tr>
      <td><div>${esc(m.name) || '—'}</div>${account}</td>
      <td class="code-cell">${esc(m.student_code) || '—'}</td>
      <td>${countLabel(m.sessions)}</td>
      <td>${esc(lastActiveLabel(m.last_active))}</td>
      <td>${esc(usdLabel(m.ai_cost_usd))}</td>
      <td><button class="adm-btn-secondary" data-action="remove-member" data-student="${esc(m.student_id)}">Gỡ khỏi lớp</button></td>
    </tr>`;
  }).join('');
}

async function populateStudentPicker() {
  if (_studentsLoaded) return;
  const sel = $('mf-student');
  try {
    const res = await api.get('/admin/students?limit=200');
    const students = Array.isArray(res) ? res : (res.students || res.items || []);
    sel.innerHTML = '<option value="">— Chọn học viên —</option>'
      + students.map((s) => {
        const label = s.full_name ? `${s.full_name} (${s.student_code || '—'})` : (s.student_code || s.id);
        return `<option value="${esc(s.id)}">${esc(label)}</option>`;
      }).join('');
    _studentsLoaded = true;
  } catch {
    sel.innerHTML = '<option value="">Không tải được danh sách học viên</option>';
  }
}

function openMemberModal() {
  $('mf-error').hidden = true;
  $('mf-student').value = '';
  $('member-modal').hidden = false;
  populateStudentPicker();
}
function closeMemberModal() { $('member-modal').hidden = true; }

async function submitMember() {
  const student_id = $('mf-student').value.trim();
  if (!student_id) {
    $('mf-error').textContent = 'Chọn một học viên từ danh sách.';
    $('mf-error').hidden = false;
    return;
  }
  $('btn-mf-submit').disabled = true;
  try {
    await api.post('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/students', { student_id });
    closeMemberModal();
    toast('Đã thêm học viên vào lớp.');
    await loadDetail(_cohortId);
  } catch (err) {
    $('mf-error').textContent = 'Không thêm được học viên: ' + (err.message || err);
    $('mf-error').hidden = false;
  } finally {
    $('btn-mf-submit').disabled = false;
  }
}

function removeMember(studentId) {
  window.confirmDanger({
    title: 'Gỡ khỏi lớp',
    body: 'Gỡ học viên này khỏi lớp? Mã đăng nhập của họ không thay đổi.',
    confirmLabel: 'Gỡ khỏi lớp',
    onConfirm: async () => {
      try {
        await api.delete('/admin/cohorts/' + encodeURIComponent(_cohortId)
          + '/students/' + encodeURIComponent(studentId));
        toast('Đã gỡ học viên khỏi lớp.');
        await loadDetail(_cohortId);
      } catch (err) {
        toast('Không gỡ được học viên: ' + (err.message || err), 'error');
      }
    },
  });
}

// ── Chi tiết lớp: buổi học ──────────────────────────────────────────────────

function renderLessons() {
  $('lessons-loading').hidden = true;
  $('lessons-empty').hidden = _lessons.length > 0;
  $('lessons-list').innerHTML = _lessons.map((l) => {
    const no = l.lesson_no != null ? `Buổi ${esc(l.lesson_no)}` : '';
    const date = fmtDate(l.lesson_date);
    const sub = [date, l.is_published ? 'Đã đăng' : 'Chưa đăng'].filter(Boolean).join(' · ');
    const files = (Array.isArray(l.attachments) ? l.attachments : []).map((a) =>
      `<a class="adm-chip" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.label)}</a>`
    ).join('');
    return `<article class="cl-lesson">
      <div class="cl-lesson-no">${no}</div>
      <div class="cl-lesson-main">
        <p class="cl-lesson-title">${esc(l.title)}</p>
        <p class="cl-lesson-sub">${esc(sub)}</p>
        ${l.body_md ? `<p class="cl-lesson-body">${esc(l.body_md)}</p>` : ''}
        ${files ? `<div class="cl-lesson-files">${files}</div>` : ''}
      </div>
      <div class="cl-lesson-actions">
        <button class="adm-btn-secondary" data-action="edit-lesson" data-id="${esc(l.id)}">Sửa</button>
        <button class="adm-btn-secondary" data-action="delete-lesson" data-id="${esc(l.id)}">Xoá</button>
      </div>
    </article>`;
  }).join('');
}

async function loadLessons() {
  $('lessons-loading').hidden = false;
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/lessons');
    _lessons = (r && r.lessons) || [];
  } catch (err) {
    _lessons = [];
    toast('Không tải được buổi học: ' + (err.message || err), 'error');
  }
  renderLessons();
}

function attachmentRow(label, url) {
  const wrap = document.createElement('div');
  wrap.className = 'cl-attach-row';
  const l = document.createElement('input');
  l.type = 'text'; l.placeholder = 'Tên tài liệu'; l.value = label || '';
  l.setAttribute('aria-label', 'Tên tài liệu');
  const u = document.createElement('input');
  u.type = 'url'; u.placeholder = 'https://…'; u.value = url || '';
  u.setAttribute('aria-label', 'Đường dẫn tài liệu');
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'adm-btn-secondary'; del.textContent = 'Xoá';
  del.addEventListener('click', () => wrap.remove());
  wrap.append(l, u, del);
  return wrap;
}

function readAttachments() {
  // Both fields required per row: a label with no URL is not a link, and a URL
  // with no label renders as an unnamed chip. Half-filled rows are dropped
  // rather than saved as something the student cannot use.
  return Array.from($('lf-attachments').querySelectorAll('.cl-attach-row'))
    .map((row) => {
      const [l, u] = row.querySelectorAll('input');
      return { label: l.value.trim(), url: u.value.trim() };
    })
    .filter((a) => a.label && a.url);
}

function openLessonModal(lesson) {
  _editingLessonId = lesson ? lesson.id : null;
  $('lesson-modal-title').textContent = lesson ? 'Sửa buổi học' : 'Thêm buổi học';
  $('lf-no').value = lesson && lesson.lesson_no != null ? lesson.lesson_no : '';
  $('lf-date').value = lesson && lesson.lesson_date ? lesson.lesson_date : '';
  $('lf-title').value = lesson ? (lesson.title || '') : '';
  $('lf-body').value = lesson ? (lesson.body_md || '') : '';
  $('lf-published').checked = !!(lesson && lesson.is_published);

  const box = $('lf-attachments');
  box.innerHTML = '';
  const files = lesson && Array.isArray(lesson.attachments) ? lesson.attachments : [];
  files.forEach((a) => box.appendChild(attachmentRow(a.label, a.url)));

  $('lf-error').hidden = true;
  $('lesson-modal').hidden = false;
  $('lf-title').focus();
}

function closeLessonModal() { $('lesson-modal').hidden = true; }

async function submitLesson() {
  const title = $('lf-title').value.trim();
  if (!title) {
    $('lf-error').textContent = 'Nhập tiêu đề buổi học để tiếp tục.';
    $('lf-error').hidden = false;
    return;
  }
  const noRaw = $('lf-no').value.trim();
  const body = {
    title,
    lesson_no: noRaw ? Number(noRaw) : null,
    lesson_date: $('lf-date').value || null,
    body_md: $('lf-body').value.trim() || null,
    attachments: readAttachments(),
    is_published: $('lf-published').checked,
  };

  $('btn-lf-submit').disabled = true;
  const base = '/admin/cohorts/' + encodeURIComponent(_cohortId) + '/lessons';
  try {
    if (_editingLessonId) {
      await api.patch(base + '/' + encodeURIComponent(_editingLessonId), body);
      toast('Đã lưu buổi học.');
    } else {
      await api.post(base, body);
      toast('Đã thêm buổi học.');
    }
    closeLessonModal();
    await loadLessons();
  } catch (err) {
    $('lf-error').textContent = 'Không lưu được buổi học: ' + (err.message || err);
    $('lf-error').hidden = false;
  } finally {
    $('btn-lf-submit').disabled = false;
  }
}

function deleteLesson(lessonId) {
  const lesson = _lessons.find((l) => l.id === lessonId);
  window.confirmDanger({
    title: 'Xoá buổi học',
    body: `Xoá "${(lesson && lesson.title) || 'buổi học này'}"? Bài tập đã gắn vào buổi này vẫn giữ nguyên.`,
    confirmLabel: 'Xoá buổi học',
    onConfirm: async () => {
      try {
        await api.delete('/admin/cohorts/' + encodeURIComponent(_cohortId)
          + '/lessons/' + encodeURIComponent(lessonId));
        toast('Đã xoá buổi học.');
        await loadLessons();
      } catch (err) {
        toast('Không xoá được buổi học: ' + (err.message || err), 'error');
      }
    },
  });
}

// ── Chi tiết lớp: bài tập (GĐ 2) ────────────────────────────────────────────

let _homework = [];
let _homeworkLoaded = false;

/**
 * Deadline cell. The rule is 19:00 giờ Việt Nam and the server stores it as an
 * aware timestamp, so rendering it in the reader's own locale is correct: an
 * admin abroad sees their local equivalent of the same instant, not a number
 * that silently means something else.
 */
function dueLabel(dueAt) {
  if (!dueAt) return '<span class="cl-muted">Không hạn</span>';
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return '<span class="cl-roster-unknown">Hạn không đọc được</span>';
  const text = d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const overdue = d.getTime() < Date.now();
  return overdue ? `<span class="cl-muted">${esc(text)}</span>` : esc(text);
}

/**
 * Submission cell. "Chưa nộp" past the deadline is the number the whole feature
 * exists to surface, so it gets the warning treatment; before the deadline the
 * same students are simply not due yet and must not be styled as a problem.
 */
function progressCell(p) {
  if (!p) return '<span class="cl-roster-unknown">Không đọc được</span>';
  const parts = [`<span class="cl-roster-count">${countLabel(p.submitted)}/${countLabel(p.assigned)} đã nộp</span>`];
  if (p.late) parts.push(`<span class="cl-lesson-sub">${countLabel(p.late)} nộp trễ</span>`);
  if (p.missing) parts.push(`<span class="cl-roster-gap">${countLabel(p.missing)} chưa nộp, đã quá hạn</span>`);
  return `<div class="cl-roster">${parts.join('')}</div>`;
}

function renderHomework() {
  $('homework-loading').hidden = true;
  $('homework-empty').hidden = _homework.length > 0;
  $('homework-table-wrap').hidden = _homework.length === 0;
  $('homework-tbody').innerHTML = _homework.map((a) => {
    const cfg = a.content_config || {};
    const sub = [cfg.topic, cfg.mode, cfg.part ? `Part ${cfg.part}` : ''].filter(Boolean).join(' · ');
    const p = a.progress || {};
    // Deleting a give that students have answered would erase the record that
    // the work was asked for and done, so the button is not offered.
    const canDelete = !p.submitted;
    const del = canDelete
      ? `<button class="adm-btn-secondary" data-action="delete-homework" data-id="${esc(a.id)}">Xoá</button>`
      : '<span class="cl-lesson-sub">Đã có bài nộp</span>';
    return `<tr>
      <td><div>${esc(a.title)}</div><div class="cl-lesson-sub">${esc(sub)}</div></td>
      <td>${dueLabel(a.due_at)}</td>
      <td>${progressCell(a.progress)}</td>
      <td>${del}</td>
    </tr>`;
  }).join('');
}

async function loadHomework() {
  $('homework-loading').hidden = false;
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/assignments');
    _homework = (r && r.assignments) || [];
  } catch (err) {
    _homework = [];
    toast('Không tải được bài giao: ' + (err.message || err), 'error');
  }
  renderHomework();
}

function openHomeworkModal() {
  $('hf-title').value = '';
  $('hf-topic').value = '';
  $('hf-mode').value = 'practice';
  $('hf-part').value = '1';
  $('hf-instructions').value = '';
  // Default the deadline to today — the centre gives a task each day, so today
  // at 19:00 is the answer nearly every time.
  //
  // "Today" means today IN VIETNAM, not in the admin's browser. getFullYear() /
  // getMonth() / getDate() read the browser's zone, so an admin abroad at the
  // day boundary would default to the wrong date; the server would then
  // correctly compose 19:00 Vietnam time for a day that is already past, and the
  // give would be overdue the moment it was created. Same rule as the deadline
  // itself: the date is a Vietnam wall-clock fact.
  $('hf-due').value = todayInVietnam();
  $('hf-error').hidden = true;
  $('hf-warning').hidden = true;
  $('homework-modal').hidden = false;
  $('hf-title').focus();
}

function closeHomeworkModal() { $('homework-modal').hidden = true; }

async function submitHomework() {
  const title = $('hf-title').value.trim();
  const topic = $('hf-topic').value.trim();
  if (!title || !topic) {
    $('hf-error').textContent = 'Nhập tên bài giao và chủ đề để tiếp tục.';
    $('hf-error').hidden = false;
    return;
  }

  $('btn-hf-submit').disabled = true;
  try {
    const r = await api.post(
      '/admin/cohorts/' + encodeURIComponent(_cohortId) + '/assignments',
      {
        skill: 'speaking',
        title,
        topic,
        mode: $('hf-mode').value,
        part: Number($('hf-part').value),
        due_date: $('hf-due').value || null,
        instructions: $('hf-instructions').value.trim() || null,
      },
    );

    closeHomeworkModal();
    // Students with no account receive nothing — silently. Say so on the way
    // out, or the teacher reads them as simply not having done the work.
    if (r && r.unactivated_count) {
      toast(
        `Đã giao cho ${r.student_count} học viên. ${r.unactivated_count} bạn chưa kích hoạt tài khoản `
        + 'nên sẽ không nhận được bài.',
        'error',
      );
    } else {
      toast(`Đã giao bài cho ${(r && r.student_count) || 0} học viên.`);
    }
    await loadHomework();
  } catch (err) {
    $('hf-error').textContent = 'Không giao được bài: ' + (err.message || err);
    $('hf-error').hidden = false;
  } finally {
    $('btn-hf-submit').disabled = false;
  }
}

function deleteHomework(assignmentId) {
  const a = _homework.find((x) => x.id === assignmentId);
  window.confirmDanger({
    title: 'Xoá bài giao',
    body: `Xoá "${(a && a.title) || 'bài giao này'}"? Chưa có ai nộp nên không mất bài làm nào.`,
    confirmLabel: 'Xoá bài giao',
    onConfirm: async () => {
      try {
        await api.delete('/admin/cohorts/' + encodeURIComponent(_cohortId)
          + '/assignments/' + encodeURIComponent(assignmentId));
        toast('Đã xoá bài giao.');
        await loadHomework();
      } catch (err) {
        toast('Không xoá được bài giao: ' + (err.message || err), 'error');
      }
    },
  });
}

// ── Sub-tabs ────────────────────────────────────────────────────────────────

let _lessonsLoaded = false;

function showPanel(name) {
  const PANELS = ['roster', 'lessons', 'homework'];
  for (const p of PANELS) {
    const on = p === name;
    $('tab-' + p).classList.toggle('is-active', on);
    // aria-current marks the active tab for assistive tech; the class alone is
    // only a colour change.
    $('tab-' + p).setAttribute('aria-current', on ? 'page' : 'false');
    $('panel-' + p).hidden = !on;
  }
  // Each panel fetches on first open only — opening the class must not fire
  // three requests for two tabs the admin may never look at.
  if (name === 'lessons' && !_lessonsLoaded) {
    _lessonsLoaded = true;
    loadLessons();
  }
  if (name === 'homework' && !_homeworkLoaded) {
    _homeworkLoaded = true;
    loadHomework();
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function bindModalBackdrop(id, close) {
  $(id).addEventListener('click', (e) => { if (e.target === $(id)) close(); });
}

function bindList() {
  $('btn-create-cohort').addEventListener('click', () => openCohortModal(null));
  $('filter-status').addEventListener('change', renderList);
  $('filter-course').addEventListener('change', renderList);
  $('list-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'archive') setActive(btn.dataset.id, false);
    if (btn.dataset.action === 'restore') setActive(btn.dataset.id, true);
  });
}

function bindDetail() {
  $('btn-edit-cohort').addEventListener('click', () => openCohortModal(_cohort));
  $('btn-add-member').addEventListener('click', openMemberModal);
  $('btn-mf-cancel').addEventListener('click', closeMemberModal);
  $('btn-mf-submit').addEventListener('click', submitMember);
  bindModalBackdrop('member-modal', closeMemberModal);

  $('roster-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="remove-member"]');
    if (btn) removeMember(btn.dataset.student);
  });

  $('tab-roster').addEventListener('click', () => showPanel('roster'));
  $('tab-lessons').addEventListener('click', () => showPanel('lessons'));
  $('tab-homework').addEventListener('click', () => showPanel('homework'));

  $('btn-add-homework').addEventListener('click', openHomeworkModal);
  $('btn-hf-cancel').addEventListener('click', closeHomeworkModal);
  $('btn-hf-submit').addEventListener('click', submitHomework);
  bindModalBackdrop('homework-modal', closeHomeworkModal);
  $('homework-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="delete-homework"]');
    if (btn) deleteHomework(btn.dataset.id);
  });

  $('btn-add-lesson').addEventListener('click', () => openLessonModal(null));
  $('btn-lf-cancel').addEventListener('click', closeLessonModal);
  $('btn-lf-submit').addEventListener('click', submitLesson);
  $('btn-lf-add-file').addEventListener('click', () =>
    $('lf-attachments').appendChild(attachmentRow('', '')));
  bindModalBackdrop('lesson-modal', closeLessonModal);

  $('lessons-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit-lesson') {
      const lesson = _lessons.find((l) => l.id === btn.dataset.id);
      if (lesson) openLessonModal(lesson);
    }
    if (btn.dataset.action === 'delete-lesson') deleteLesson(btn.dataset.id);
  });
}

function bindShared() {
  $('btn-cf-cancel').addEventListener('click', closeCohortModal);
  $('btn-cf-submit').addEventListener('click', submitCohort);
  bindModalBackdrop('cohort-modal', closeCohortModal);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeCohortModal(); closeMemberModal(); closeLessonModal(); closeHomeworkModal();
  });
}

/**
 * GĐ 1b — the Học viên panel is initialised on FIRST activation of its tab, not
 * on page load. It fetches /admin/students and /admin/cohorts; the Lớp tab must
 * not pay for requests it never renders (the same reason the roster rollup is
 * opt-in server-side).
 */
let _studentsPanelStarted = false;

function startStudentsPanel() {
  if (_studentsPanelStarted) return;
  const panel = window.AdminStudentsPanel;
  if (!panel || typeof panel.init !== 'function') {
    // Fail loudly rather than leaving an empty tab that looks like "no students".
    $('panel-students').hidden = false;
    toast('Không tải được bảng Học viên. Tải lại trang để thử lại.', 'error');
    return;
  }
  _studentsPanelStarted = true;
  panel.init();
}

/** Top-level tab: 'classes' (danh sách/chi tiết lớp) or 'students'. */
function showTab(name) {
  const students = name === 'students';
  $('tab-classes').classList.toggle('is-active', !students);
  $('tab-students').classList.toggle('is-active', students);
  $('tab-classes').setAttribute('aria-current', students ? 'false' : 'page');
  $('tab-students').setAttribute('aria-current', students ? 'page' : 'false');
  $('panel-students').hidden = !students;

  // The sidebar child highlight comes from the host element's `subsection`
  // attribute, which is static in the markup. Both tabs are now one page, so
  // without this the sidebar keeps marking "Lớp" while the Học viên tab is open.
  // <aver-admin-chrome> observes the attribute, so setting it re-renders.
  const chrome = document.querySelector('aver-admin-chrome');
  if (chrome) chrome.setAttribute('subsection', students ? 'students' : 'classes');
  if (students) {
    $('view-list').hidden = true;
    $('view-detail').hidden = true;
    startStudentsPanel();
  }
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const cohortId = params.get('cohort_id');
  bindShared();

  // A class deep-link wins over ?tab= — arriving at a specific class must show
  // that class, whatever tab the link also carried.
  if (!cohortId && params.get('tab') === 'students') {
    showTab('students');
    return;
  }
  showTab('classes');

  // Courses are needed by both views (filter + course chip), so they load first
  // and the rest renders against a populated list rather than flashing "Chưa
  // gán khoá" on classes that do have one.
  await loadCourses();

  if (cohortId) {
    $('view-list').hidden = true;
    $('view-detail').hidden = false;
    bindDetail();
    showPanel('roster');
    await loadDetail(cohortId);
  } else {
    $('view-detail').hidden = true;
    $('view-list').hidden = false;
    renderCourseFilter();
    bindList();
    await loadCohorts();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
