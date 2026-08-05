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

const VN_TZ = 'Asia/Ho_Chi_Minh';
const VN_CUTOFF_HOUR = 19;   // the centre's deadline — see compose_due_at server-side

/** Vietnam wall-clock parts of an instant, as numbers. */
function vietnamParts(at) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(at).reduce((o, x) => (o[x.type] = x.value, o), {});
  // hourCycle h23 can render midnight as "24" in some ICU versions.
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/**
 * The next date whose 19:00 deadline has NOT already passed, in Vietnam time.
 *
 * Two separate things had to be right here. The date must be Vietnam's, not the
 * browser's — an admin abroad at the day boundary would otherwise default a day
 * out. And "today" stops being a viable default once 19:00 has gone: submitting
 * the untouched form at 20:00 would create a give that is already overdue, so
 * every student is reported missing the moment it exists.
 *
 * Only the DEFAULT moves; the admin can still pick today explicitly (giving a
 * task with a deadline that has passed is a legitimate, if unusual, thing to do).
 */
function defaultDueDateVietnam(at = new Date()) {
  const { date, hour } = vietnamParts(at);
  if (hour < VN_CUTOFF_HOUR) return date;
  const next = new Date(at.getTime() + 24 * 60 * 60 * 1000);
  return vietnamParts(next).date;
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

  // Giữ lại cho hộp thoại giao bài: mở hộp thoại mà phải chờ mạng là chờ đúng
  // lúc người dùng đang vội nhất.
  _who.members = members;
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
    invalidateProgress();
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
        invalidateProgress();
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
let _homeworkError = false;
let _progress = { students: [], degraded: [] };

/**
 * Deadline cell. The rule is 19:00 giờ Việt Nam and the server stores it as an
 * aware timestamp, so rendering it in the reader's own locale is correct: an
 * admin abroad sees their local equivalent of the same instant, not a number
 * that silently means something else.
 */
/**
 * Hạn nộp dưới dạng CHỮ THUẦN, cho những chỗ tự escape.
 *
 * `dueLabel` trả về HTML (nó tô mờ hạn đã qua). Bọc kết quả đó trong esc() thì
 * người dùng đọc được nguyên thẻ `<span class="cl-muted">…</span>` — mà chỗ dính
 * lỗi này lại là trạng thái CHÍNH của bảng tổng kết (sau hạn). Tách hai hàm để
 * chỗ gọi không phải nhớ cái nào trả HTML.
 */
function dueText(dueAt) {
  if (!dueAt) return 'không hạn';
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return 'hạn không đọc được';
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

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
  // Chưa kích hoạt tài khoản là một dòng RIÊNG, không gộp vào "chưa nộp": em ấy
  // chưa từng thấy bài, nên nhắc em nộp là nhắc nhầm người. Cũng không dùng
  // .cl-roster-gap — đó là dấu "cần hỏi học viên này", còn việc ở đây là kích
  // hoạt tài khoản, thuộc về người khác.
  if (p.no_account) {
    parts.push(`<span class="cl-lesson-sub">${countLabel(p.no_account)} chưa kích hoạt tài khoản</span>`);
  }
  return `<div class="cl-roster">${parts.join('')}</div>`;
}

function renderHomework() {
  $('homework-loading').hidden = true;

  // A failed load is NOT an empty class. Rendering the normal "Chưa giao bài
  // nào" for it tells the admin something false about their own data — and the
  // toast that said otherwise has already gone. Say what happened, and offer the
  // retry, because the load latch has been released.
  if (_homeworkError) {
    $('homework-empty').hidden = false;
    $('homework-empty').innerHTML =
      'Không đọc được danh sách bài giao. '
      + '<button class="adm-btn-secondary" data-action="retry-homework" type="button">Thử lại</button>';
    $('homework-table-wrap').hidden = true;
    return;
  }

  $('homework-empty').textContent =
    'Chưa giao bài nào. Giao bài Speaking đầu tiên để học viên có việc làm hôm nay.';
  $('homework-empty').hidden = _homework.length > 0;
  $('homework-table-wrap').hidden = _homework.length === 0;
  $('homework-tbody').innerHTML = _homework.map((a) => {
    const cfg = a.content_config || {};
    const sub = a.skill === 'speaking'
      ? [cfg.topic, cfg.mode, cfg.part ? `Part ${cfg.part}` : ''].filter(Boolean).join(' · ')
      : [SKILL_LABEL[a.skill] || a.skill, cfg.test_title].filter(Boolean).join(' · ');
    const p = a.progress || {};
    // Deleting a give that students have answered would erase the record that
    // the work was asked for and done, so delete is withheld — but the give must
    // still be closable, or a cancelled task stays startable forever. Archiving
    // hides it from students and keeps every submission.
    const archived = a.status === 'archived';
    const action = archived
      ? `<button class="adm-btn-secondary" data-action="publish-homework" data-id="${esc(a.id)}">Mở lại</button>`
      : (p.submitted
        ? `<button class="adm-btn-secondary" data-action="archive-homework" data-id="${esc(a.id)}">Đóng bài</button>`
        : `<button class="adm-btn-secondary" data-action="delete-homework" data-id="${esc(a.id)}">Xoá</button>`);
    const archivedChip = archived ? ' <span class="adm-chip">Đã đóng</span>' : '';
    return `<tr>
      <td><div>${esc(a.title)}${archivedChip}</div><div class="cl-lesson-sub">${esc(sub)}</div></td>
      <td>${dueLabel(a.due_at)}</td>
      <td>${progressCell(a.progress)}</td>
      <td><button class="adm-btn-secondary" data-action="tally"
                  data-id="${esc(a.id)}">Xem ai nộp</button>
          <button class="adm-btn-secondary" data-action="backfill"
                  data-id="${esc(a.id)}"
                  title="Thêm học viên mới vào lớp vào bài này">Bù học viên</button> ${action}</td>
    </tr>`;
  }).join('');
}

/* ── Bảng tổng kết nộp bài ──────────────────────────────────────────────
 *
 * Việc của bảng này là đọc ra SỰ VẮNG MẶT. Bảng thường tô xanh cho ai đã nộp —
 * với lớp 30 em thì 26 dấu tick thành nhiễu che mất 4 chỗ trống. Ở đây đảo lại:
 * dòng đã nộp im lặng, dòng chưa nộp mang mực, và cột mép trái đọc dọc là ra
 * ngay ai thiếu mà không cần đọc chữ nào.
 */

const TALLY_WHEN = {
  'no-account': 'chưa kích hoạt',
  missing: 'không nộp',
  pending: 'chưa nộp',
};

function tallyRow(r, skill) {
  const when = r.submitted_at
    ? hhmm(r.submitted_at) + (r.status === 'late' ? ' · trễ' : '')
    : (TALLY_WHEN[r.status] || '');
  const empty = (r.score === null || r.score === undefined);
  // Chưa chấm là chưa chấm — hiện 0.0 là hiện một ĐIỂM SỐ mà không ai cho.
  // Bài course: điểm là PHẦN TRĂM, không phải band — "85.0" đọc như band 8.5
  // là nói dối. Kèm đạt/chưa từ cổng thuộc bài; số lần kiểm tra lại chỉ hiện
  // khi >0 vì đó mới là tín hiệu cần kèm cặp.
  let band;
  if (empty) band = '—';
  else if (skill === 'course') {
    // "Chưa đạt" chỉ khi ĐÃ có lượt xét trượt. Mới xong chặng 1 thì submitted_at
    // đã đóng dấu nhưng chưa ai xét gì — nói "chưa đạt" lúc ấy là kết tội một
    // bài đang làm dở.
    const state = r.passed_at ? ' ✓'
      : (r.verdicts ? ' · chưa đạt' : ' · đang làm');
    band = Math.round(Number(r.score)) + '%' + state
      + (r.retakes ? ` · KTL×${r.retakes}` : '');
  } else band = Number(r.score).toFixed(1);
  // Cờ nằm NGAY DƯỚI TÊN, không ở một bảng thứ hai: giáo viên mở danh sách này
  // để biết ai cần mình, nên "bài của em này có vấn đề" phải ở cạnh tên em ấy.
  // Mỗi cờ nói đủ ba thứ — chuyện gì, vì sao, làm gì tiếp; một chấm đỏ không
  // kèm việc phải làm sẽ bị bỏ qua sau vài lần.
  const flags = (r.flags || []).map((f) => `
      <li class="av-flag" data-sev="${esc(f.severity)}">
        <strong>${esc(f.label)}</strong>
        <span>${esc(f.why)}</span>
        <em>${esc(f.action)}</em>
      </li>`).join('');
  // Mở thẳng bài làm: nghe audio + đọc nhận xét. Chỉ hiện khi có bài THẬT để
  // mở — một liên kết dẫn tới trang trống tệ hơn không có liên kết.
  const open = (r.artifact_kind === 'session' && r.artifact_id)
    ? `<a class="av-tally__open" target="_blank" rel="noopener"
          href="/pages/admin/speaking/sessions.html?session=${esc(r.artifact_id)}"
          title="Nghe bài làm và đọc nhận xét">Nghe &amp; xem</a>`
    // Bài tập theo buổi: đọc phần TỰ LUẬN em ấy viết. Chỉ hiện khi thật sự có
    // bài — một nút mở ra "chưa nộp gì" tệ hơn không có nút.
    : (r.has_writing
        ? `<button class="av-tally__open" type="button" data-writing="${esc(r.student_id)}"
             title="Đọc bài tự luận và bản sửa">Xem tự luận</button>`
        : '');
  return `<div class="av-tally__row" data-status="${esc(r.status)}"
       ${r.flag_level ? `data-flag="${esc(r.flag_level)}"` : ''}>
    <span class="av-tally__mark" aria-hidden="true"></span>
    <span class="av-tally__name">${esc(r.name || r.student_code || '—')}</span>
    <span class="av-tally__when">${esc(when)}</span>
    <span class="av-tally__band" data-empty="${empty}">${esc(band)}</span>
    ${open}
  </div>${flags ? `<ul class="av-flags">${flags}</ul>` : ''}`;
}

function hhmm(iso) {
  // Giờ VN, không phải giờ máy admin: hạn nộp là 19:00 giờ VN, nên một giờ nộp
  // đọc theo múi giờ khác sẽ mâu thuẫn với chính cột "trễ" bên cạnh.
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(iso));
  } catch (e) { return ''; }
}

function renderTally(d) {
  const c = (d && d.counts) || {};
  const sealed = !!(d && d.sealed);
  const rows = ((d && d.students) || [])
    .map((r) => tallyRow(r, d && d.assignment && d.assignment.skill)).join('');
  const notes = [];
  if (sealed) {
    notes.push(`Chốt lúc <strong>${esc(dueText(d.assignment.due_at))}</strong>`
      + ` — ${c.missing || 0} em không nộp. Sau giờ này hệ thống không nhận bài nữa.`);
  } else {
    notes.push(`Hạn <strong>${esc(dueText(d.assignment.due_at))}</strong>.`
      + ' Danh sách còn đổi cho tới lúc đó.');
  }
  if (c.no_account) {
    // Chưa kích hoạt tài khoản thì CHƯA TỪNG thấy bài — nhắc các em ấy nộp là
    // nhắc nhầm người.
    notes.push(`${c.no_account} em chưa kích hoạt tài khoản nên chưa nhận được bài.`);
  }
  if (d && d.homework_stale) {
    notes.push('Chưa đối chiếu được bài nộp mới nhất — số có thể còn thiếu.');
  }
  if (c.flagged) {
    // ĐẾM RIÊNG, không trừ vào "đã nộp": một bài nộp rồi mà chấm hỏng vẫn là đã
    // nộp. Trộn hai con số sẽ khiến giáo viên tưởng em ấy chưa làm bài, trong
    // khi lỗi nằm ở phía hệ thống.
    notes.push(`<strong>${c.flagged} bài cần xem lại</strong> — lý do ghi ngay dưới tên.`);
  }
  return `<div class="av-tally" data-state="${sealed ? 'sealed' : 'live'}">
    <div class="av-tally__head">
      <span class="av-tally__count">${c.submitted || 0}<small>/${c.total || 0} đã nộp</small></span>
      <span class="av-tally__state">${sealed ? 'Đã chốt' : 'Đang nhận bài'}</span>
    </div>
    <div class="av-tally__rows">${rows}</div>
    <p class="av-tally__foot">${notes.join(' ')}</p>
  </div>`;
}

/**
 * Bài TỰ LUẬN của một học viên — đọc ngay trong ô bảng tổng kết đang mở.
 *
 * Vẽ CÙNG một cách học viên đang thấy (sai gạch bỏ, sửa viết đè, lý do từng
 * lỗi, đáp án mẫu): giáo viên và học viên phải nhìn cùng một bản chấm, kẻo hai
 * bên nói về hai thứ khác nhau khi ngồi lại với nhau.
 */
const CW_KIND = { grammar: 'ngữ pháp', spelling: 'chính tả' };

/**
 * `**đậm**` → <mark>, GIỐNG HỆT `md()` phía học viên.
 *
 * Nguồn đề cố ý mang nhãn markdown (`**Đáp án mẫu:**`, phần được hỏi in đậm) và
 * học viên thấy chúng đã được dựng. Escape trơn ở đây làm giáo viên đọc ra
 * `**...**` thô — hai bên nhìn hai thứ khác nhau về cùng một bản chấm, đúng thứ
 * màn này sinh ra để tránh (codex #940).
 *
 * Thoát HTML TRƯỚC rồi mới dựng thẻ: nội dung này là bài do NGƯỜI KHÁC viết,
 * đang vẽ trong trình duyệt của admin.
 */
function cwMd(x) {
  return esc(x).replace(/\*\*([^*]+)\*\*/g, '<mark>$1</mark>');
}

/** Gạch chỗ sai, viết chỗ đúng liền sau — so theo TỪ, không theo ký tự. */
function cwDiff(before, after) {
  const A = String(before || '').split(/(\s+)/);
  const B = String(after || '').split(/(\s+)/);
  let h = 0;
  while (h < A.length && h < B.length && A[h] === B[h]) h += 1;
  let t = 0;
  while (t < A.length - h && t < B.length - h
         && A[A.length - 1 - t] === B[B.length - 1 - t]) t += 1;
  const del = A.slice(h, A.length - t).join('');
  const ins = B.slice(h, B.length - t).join('');
  return esc(A.slice(0, h).join(''))
    + (del ? `<del>${esc(del)}</del>` : '')
    + (ins ? `<ins>${esc(ins)}</ins>` : '')
    + esc(A.slice(A.length - t).join(''));
}

function renderStudentWriting(d) {
  const sub = d && d.submission;
  if (!sub) {
    return '<p class="adm-hint">Học viên này chưa nộp phần tự luận.</p>';
  }
  const items = (sub.items || []).map((g, i) => {
    const ok = g.ok;
    const body = ok === null
      ? `<p class="cw-diff">${esc(g.answer)}</p>`
        + `<p class="cw-unknown">${esc(g.error || 'Chưa chấm được câu này.')}</p>`
      : ok
        ? `<p class="cw-diff">${esc(g.answer)}</p>`
          + '<p class="cw-unknown">Không có lỗi ngữ pháp hay chính tả.</p>'
        : `<p class="cw-diff">${cwDiff(g.answer, g.corrected)}</p>`
          + `<ul class="cw-issues">${(g.issues || []).map((x) => `
              <li class="cw-issue">
                <span class="cw-issue__kind">${esc(CW_KIND[x.type] || x.type || 'lỗi')}</span>
                <span><del>${esc(x.before || '')}</del> → <b>${esc(x.after || '')}</b></span>
                ${x.note ? `<span class="cw-issue__note">${esc(x.note)}</span>` : ''}
              </li>`).join('')}</ul>`;
    return `<article class="cw-item" data-ok="${String(ok)}">
      <span class="cw-item__no">Câu ${i + 1}</span>
      <p class="cw-item__ask">${cwMd(g.prompt || '')}</p>
      ${body}
      ${g.explain ? `<div class="cw-model">${cwMd(g.explain)}</div>` : ''}
    </article>`;
  }).join('');

  const when = sub.graded_at ? hhmm(sub.graded_at) : '';
  return `<div class="cw-done">${sub.clean}<small>/ ${sub.total} câu không lỗi</small></div>
    <p class="adm-hint">Chấm lúc ${esc(when)}${sub.model ? ' · ' + esc(sub.model) : ''}.
       Máy chỉ soát ngữ pháp và chính tả, không sửa cách viết.</p>
    <div class="cw-list">${items}</div>`;
}

async function openStudentWriting(assignmentId, studentId) {
  const body = $('tally-body');
  const back = body.innerHTML;          // để quay lại đúng bảng đang mở
  body.innerHTML = '<p class="adm-hint">Đang tải bài tự luận…</p>';
  try {
    const d = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/assignments/' + encodeURIComponent(assignmentId)
      + '/writing/' + encodeURIComponent(studentId));
    $('tally-modal-title').textContent =
      'Tự luận — ' + (d.student.name || d.student.code || '');
    body.innerHTML = '<button class="adm-btn-secondary" type="button" id="cw-back">'
      + '← Về bảng tổng kết</button>' + renderStudentWriting(d);
    const b = $('cw-back');
    if (b) {
      b.onclick = () => {
        body.innerHTML = back;
        $('tally-modal-title').textContent = _tallyTitle;
      };
    }
  } catch (err) {
    // Rỗng đọc ra là "em ấy chưa viết gì" — một khẳng định mà truy vấn hỏng
    // không chứng minh được.
    body.innerHTML = '<p class="adm-banner">Không đọc được bài tự luận: '
      + esc(err.message || String(err)) + '</p>';
  }
}

let _tallyAsg = null;
let _tallyTitle = '';

async function openTally(assignmentId) {
  const body = $('tally-body');
  $('tally-modal').hidden = false;
  body.innerHTML = '<p class="adm-hint">Đang tải…</p>';
  try {
    const d = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/assignments/' + encodeURIComponent(assignmentId) + '/tally');
    _tallyAsg = assignmentId;
    _tallyTitle = d.assignment.title || 'Bảng tổng kết';
    $('tally-modal-title').textContent = _tallyTitle;
    body.innerHTML = renderTally(d);
  } catch (err) {
    // Bảng rỗng đọc ra là "cả lớp chưa ai nộp" — một khẳng định mà truy vấn hỏng
    // không hề chứng minh được.
    body.innerHTML = '<p class="adm-banner">Không đọc được bảng tổng kết: '
      + esc(err.message || String(err)) + '</p>';
  }
}

async function loadHomework() {
  $('homework-loading').hidden = false;
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/assignments');
    _homework = (r && r.assignments) || [];
    _homeworkError = false;
    // The repair pass failed, so these counts are computed from a ledger known
    // to be behind. Say it — "chưa nộp" that is merely unrecorded looks exactly
    // like a student who did nothing.
    if (r && r.reconcile_failed) {
      toast('Chưa đối chiếu được bài đã nộp — số liệu bên dưới có thể thiếu. Tải lại để thử lại.', 'error');
    }
  } catch (err) {
    _homework = [];
    _homeworkError = true;
    // Release the once-only latch: without this, reopening the tab shows the
    // stale failure forever because the panel believes it has already loaded.
    _homeworkLoaded = false;
    toast('Không tải được bài giao: ' + (err.message || err), 'error');
  }
  renderHomework();
}

const SKILL_LABEL = { speaking: 'Speaking', reading: 'Reading', listening: 'Listening',
                      course: 'bài tập theo buổi' };

let _testsBySkill = {};

/** 'daily' | 'lesson' — loại bài đang chọn. */
function hfKind() {
  const el = document.querySelector('input[name="hf-kind"]:checked');
  return el ? el.value : 'daily';
}

/**
 * Loại bài quyết định NGUỒN ĐỀ và CÁCH NHẬP HẠN, nên nó đổi cả bộ mặt ô này.
 *
 * "Sau buổi học" đương nhiên là Speaking, và Part do bộ đề quyết — nên hai ô ấy
 * biến mất chứ không chỉ bị khoá. Một ô hiện ra mà không bấm được vẫn bắt người
 * ta dừng lại đọc xem vì sao.
 */
function applyHomeworkKind() {
  const lesson = hfKind() === 'lesson';
  $('hf-skill-field').hidden = lesson;
  if (lesson) $('hf-skill').value = 'speaking';

  $('hf-kind-note').textContent = lesson
    ? 'Đề lấy từ kho của khoá này, giao trọn bộ. Hạn tính bằng số ngày kể từ hôm nay.'
    : 'Đề lấy từ kho chủ đề chung. Hạn là một mốc trong ngày.';

  $('hf-due-date-field').hidden = lesson;
  $('hf-due-days-field').hidden = !lesson;
  $('hf-due-resolve').hidden = !lesson;

  // DỌN bộ chọn câu trước khi đổi nguồn.
  //
  // Hai nguồn đề dùng CHUNG một danh sách và chung `_qpick`. Không dọn thì đổi
  // từ bài theo buổi về bài hằng ngày sẽ để lại nguyên 12 câu của buổi cũ nằm
  // dưới nhãn "Câu hỏi" — và `_qpick.picked` vẫn giữ id của những câu ấy, nên
  // bấm Giao sẽ gửi id thuộc bộ đề khác. Danh sách chỉ hiện lại sau khi đúng
  // một trong hai bộ nạp đã chạy xong.
  _qpick = { items: [], picked: [], want: 1, topicId: null, part: null,
             mode: lesson ? 'subset' : 'order' };
  $('hf-qpick-field').hidden = true;
  $('hf-qpick').hidden = true;
  $('hf-qpick-list').innerHTML = '';
  $('hf-qpick-foot').innerHTML = '';

  applyHomeworkSkill();
  renderDueResolve();
}

/** Show only the fields the chosen skill actually uses. */
function applyHomeworkSkill() {
  const lesson = hfKind() === 'lesson';
  const skill = lesson ? 'speaking' : $('hf-skill').value;
  const isSpeaking = skill === 'speaking';

  const isCourse = !lesson && skill === 'course';
  $('hf-topic-field').hidden = lesson || !isSpeaking;
  $('hf-set-field').hidden = !lesson;
  $('hf-cbank-field').hidden = !isCourse;
  // Part biến mất ở bài theo buổi — nó là thuộc tính của BỘ ĐỀ. Nhưng "Kiểu
  // luyện" vẫn còn, vì đó vẫn là lựa chọn thật của giáo viên.
  $('hf-speaking-row').hidden = !isSpeaking;
  const partField = $('hf-part') && $('hf-part').closest('.adm-field');
  if (partField) partField.hidden = lesson;
  // Bài tập theo buổi không dùng thư viện đề Reading/Listening.
  $('hf-test-field').hidden = lesson || isSpeaking || isCourse;

  $('homework-modal-title').textContent = lesson
    ? 'Giao bài sau buổi học'
    : 'Giao bài ' + (SKILL_LABEL[skill] || '');

  if (lesson) loadLessonSets();
  else if (isSpeaking) loadSpeakingTopics();
  else if (isCourse) loadCourseBanks();
  else loadTests(skill);
}

let _topicsByPart = {};

/**
 * Chủ đề Speaking cho Part đang chọn, LẤY TỪ KHO ĐỀ.
 *
 * Chủ đề lớp NÀY đã được giao thì bị loại khỏi danh sách — giao lại nghĩa là bắt
 * học viên trả lời lại đúng câu đã làm. Backend vẫn kiểm lại và có chỉ số duy
 * nhất phía sau; danh sách này là để admin không phải thử-rồi-bị-từ-chối.
 */
async function loadSpeakingTopics() {
  const part = $('hf-part').value || '1';
  const sel = $('hf-topic');
  const note = $('hf-topic-note');
  const key = `p${part}`;

  const stillCurrent = () => ($('hf-skill') || {}).value === 'speaking'
    && ($('hf-part') || {}).value === part;

  if (_topicsByPart[key]) {
    sel.innerHTML = _topicsByPart[key].html;
    note.textContent = _topicsByPart[key].note;
    return;
  }
  sel.innerHTML = '<option value="">Đang tải kho đề…</option>';
  note.textContent = '';
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/speaking-topics?part=' + encodeURIComponent(part));
    if (!stillCurrent()) return;
    const items = (r && r.items) || [];
    const free = items.filter((i) => !i.already_given && i.ready);
    const html = '<option value="">— Chọn chủ đề —</option>' + free.map((i) =>
      `<option value="${esc(i.id)}">${esc(i.title)}</option>`).join('');
    const given = items.filter((i) => i.already_given).length;
    const notReady = items.filter((i) => !i.already_given && !i.ready).length;
    const bits = [];
    if (given) bits.push(`${given} chủ đề lớp này đã làm`);
    // "Chưa có bản đọc đề" là một việc admin LÀM ĐƯỢC (chạy mẻ render), khác hẳn
    // "đã giao rồi" là việc đã xong — nên phải nói tách ra.
    if (notReady) bits.push(`${notReady} chủ đề chưa có bản đọc đề`);
    _topicsByPart[key] = {
      html,
      note: bits.length ? `Đã ẩn: ${bits.join(', ')}.` : '',
    };
    sel.innerHTML = free.length ? html
      : '<option value="">Hết chủ đề giao được cho Part này</option>';
    note.textContent = _topicsByPart[key].note;
  } catch (err) {
    if (!stillCurrent()) return;
    sel.innerHTML = '<option value="">Không đọc được kho đề</option>';
  }
}

/**
 * Published papers for one skill, from the existing exam-content library.
 *
 * Only papers that are published AND not exam-only are offered. Both would hand
 * students a task that opens to an error while the ledger still counts them as
 * owing it — exam-only papers are reserved for mock sittings and answer 404 to
 * anyone without one, which is most of the Cambridge library.
 * The backend re-checks — this list is convenience, not the gate.
 */
async function loadTests(skill) {
  const sel = $('hf-test');
  // Both libraries write into the SAME select. Switching Reading → Listening
  // while the Reading request is in flight let the late response paint Reading
  // papers under a Listening heading — and submit then sent a content_id the
  // backend rejects for the wrong skill. Every write below is gated on the
  // skill still being the selected one.
  const stillCurrent = () => ($('hf-skill') || {}).value === skill;

  if (_testsBySkill[skill]) {
    sel.innerHTML = _testsBySkill[skill];
    return;
  }
  sel.innerHTML = '<option value="">Đang tải đề…</option>';
  try {
    const r = await api.get('/admin/exam-content?kind=' + encodeURIComponent(skill));
    const items = ((r && r.items) || [])
      .filter((i) => i.status === 'published' && !i.exam_only);
    // A library that failed to load must not look like a library with no papers.
    if ((r.failed_kinds || []).includes(skill)) {
      if (stillCurrent()) {
        sel.innerHTML = '<option value="">Không đọc được thư viện đề</option>';
      }
      return;
    }
    const html = '<option value="">— Chọn đề —</option>' + items.map((i) =>
      `<option value="${esc(i.id)}">${esc([i.code, i.title].filter(Boolean).join(' · '))}</option>`
    ).join('');
    // Caching is safe either way — it is keyed by skill.
    _testsBySkill[skill] = html;
    if (!stillCurrent()) return;
    sel.innerHTML = items.length ? html
      : '<option value="">Chưa có đề nào giao được</option>';
  } catch (err) {
    if (!stillCurrent()) return;
    sel.innerHTML = '<option value="">Không đọc được thư viện đề</option>';
  }
}

/* ── Chọn câu hỏi cho bài Speaking ───────────────────────────────────────
 *
 * Thứ tự chọn LÀ thông tin: Part 1 là một mạch hội thoại và backend giữ đúng
 * thứ tự bấm. Nên ô chọn chính là số thứ tự — bấm câu đầu thành 1, câu sau
 * thành 2. Ràng buộc "đúng N câu" tự đọc được, không cần bộ đếm ở chỗ khác.
 */

// `mode` quyết định ô chọn NÓI GÌ:
//   'order'  — kho chung: số trong ô là THỨ TỰ BẤM, và nó là thông tin thật
//              (giáo viên đang sắp mạch hội thoại).
//   'subset' — bộ đề của buổi: người soạn đã sắp mạch, backend luôn xếp lại
//              theo thứ tự trong bộ. Đánh số theo cú bấm ở đó sẽ là nói dối
//              về thứ mà cú bấm quyết định — nên số là số CỦA BỘ, đứng yên.
let _qpick = { items: [], picked: [], want: 1, topicId: null, part: null, mode: 'order' };
/** Nghe thử một câu. MỘT trình phát dùng chung: hai câu phát chồng lên nhau thì
 *  không nghe được câu nào, và giáo viên sẽ tưởng audio hỏng. */
let _preview = null;

function previewQuestionAudio(url, btn) {
  const wasPlaying = _preview && !_preview.paused && _preview.src === url;
  if (_preview) { _preview.pause(); _preview.currentTime = 0; }
  document.querySelectorAll('.av-qpick__play[data-playing]')
    .forEach((b) => b.removeAttribute('data-playing'));
  if (wasPlaying) return;            // bấm lại nút đang phát = dừng

  _preview = _preview || new Audio();
  _preview.src = url;
  btn.setAttribute('data-playing', 'true');
  _preview.onended = () => btn.removeAttribute('data-playing');
  _preview.onerror = () => {
    btn.removeAttribute('data-playing');
    toast('Không phát được bản đọc của câu này.', 'error');
  };
  _preview.play().catch(() => {
    btn.removeAttribute('data-playing');
    toast('Trình duyệt chặn phát tự động — bấm lại giúp nhé.', 'error');
  });
}


function qmode() {
  const el = document.querySelector('input[name="hf-qmode"]:checked');
  return el ? el.value : 'random';
}

function renderQpick() {
  const { items, picked, want } = _qpick;
  const subset = _qpick.mode === 'subset';
  const listEl = $('hf-qpick-list');
  const footEl = $('hf-qpick-foot');
  listEl.dataset.pick = subset ? 'subset' : 'order';
  if (!items.length) {
    listEl.innerHTML = subset
      ? '<p class="adm-hint" style="padding:12px">Bộ đề này chưa có câu hỏi nào.</p>'
      : '<p class="adm-hint" style="padding:12px">Chủ đề này chưa có câu nào cho Part đang chọn.</p>';
    footEl.textContent = '';
    return;
  }

  listEl.innerHTML = items.map((q, idx) => {
    const at = picked.indexOf(q.id);
    const lvl = q.level
      ? `<span class="av-qpick__level" data-level="${esc(q.level)}">${esc(q.level)}</span>` : '';
    // Câu chưa giao được: MỜ nhưng không ẩn, và nói rõ cách mở khoá. Ẩn đi thì
    // giáo viên thấy danh sách ngắn không rõ vì sao ngắn.
    const blocked = q.giveable ? ''
      : '<span class="av-qpick__blocked">chưa có bản đọc</span>';
    // Nghe thử: học viên chỉ có audio này, nên giáo viên phải nghe được ĐÚNG
    // thứ các em sẽ nghe trước khi giao. Nút riêng, không lồng trong nút chọn —
    // nút trong nút là HTML không hợp lệ và bấm nghe sẽ chọn nhầm câu.
    const play = q.audio_url
      ? `<button type="button" class="av-qpick__play" data-play="${esc(q.audio_url)}"
                 title="Nghe thử" aria-label="Nghe thử câu này">▶</button>` : '';
    return `<div class="av-qpick__item">
      <button type="button" class="av-qpick__row" data-id="${esc(q.id)}"
              aria-pressed="${at !== -1}" ${q.giveable ? '' : 'disabled'}>
        <span class="av-qpick__num" aria-hidden="true">${subset ? idx + 1 : (at !== -1 ? at + 1 : '')}</span>
        <span class="av-qpick__text">${esc(q.question_text || '')}</span>
        <span class="av-qpick__meta">${lvl}${blocked}</span>
      </button>${play}
    </div>`;
  }).join('');

  if (subset) {
    // Không có mục tiêu "đủ N câu" ở đây — cả bộ vốn đã bật. Con số cần nói là
    // GIAO BAO NHIÊU, và bỏ đi bao nhiêu so với bộ gốc.
    const off = items.length - picked.length;
    footEl.dataset.ready = String(picked.length > 0);
    footEl.innerHTML = `<span>Giao <strong>${picked.length}/${items.length}</strong> câu</span>`
      + (picked.length
        ? (off ? `<span>Đã bỏ ${off} câu khỏi buổi này.</span>`
               : '<span>Giao trọn bộ, theo đúng thứ tự người soạn đã sắp.</span>')
        : '<span>Chọn ít nhất một câu.</span>');
    return;
  }
  const ready = picked.length === want;
  footEl.dataset.ready = String(ready);
  footEl.innerHTML = `<span>Đã chọn <strong>${picked.length}/${want}</strong></span>`
    + (ready ? '<span>Thứ tự trên là thứ tự học viên sẽ nghe.</span>'
             : `<span>Chọn thêm ${want - picked.length} câu.</span>`);
}

function toggleQpick(id) {
  const at = _qpick.picked.indexOf(id);
  if (_qpick.mode === 'subset') {
    // Bật/tắt tự do: không có trần, vì mặc định là CẢ BỘ và giáo viên đang trừ
    // đi. Giữ đúng thứ tự trong bộ để `picked` đọc được như một danh sách thật.
    if (at !== -1) _qpick.picked.splice(at, 1);
    else _qpick.picked.push(id);
    const order = _qpick.items.map((q) => q.id);
    _qpick.picked.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    renderQpick();
    return;
  }
  if (at !== -1) {
    _qpick.picked.splice(at, 1);           // bỏ chọn: các số sau tự dồn lên
  } else if (_qpick.picked.length < _qpick.want) {
    _qpick.picked.push(id);
  } else {
    // Đã đủ. Thay câu ĐẦU thay vì im lặng không làm gì — im lặng khiến giáo
    // viên tưởng nút hỏng, còn ở đây họ luôn thấy một thay đổi.
    _qpick.picked.shift();
    _qpick.picked.push(id);
  }
  renderQpick();
}

async function loadQpick() {
  _qpick.mode = 'order';
  const topicId = $('hf-topic').value;
  const part = $('hf-part').value;
  $('hf-qpick-field').hidden = !topicId;
  if (!topicId) return;

  const manual = qmode() === 'manual';
  $('hf-qpick').hidden = !manual;
  $('hf-qmode-hint').textContent = manual
    ? 'Bấm theo thứ tự bạn muốn học viên nghe.'
    : 'Web sẽ bốc ngẫu nhiên từ những câu đã có bản đọc, chốt một lần lúc giao.';
  if (!manual) { _qpick.picked = []; return; }

  // Đổi chủ đề/Part thì bỏ hết lựa chọn cũ: giữ lại nghĩa là gửi id của câu
  // thuộc chủ đề khác, và backend sẽ từ chối đúng lúc giáo viên bấm Giao.
  if (_qpick.topicId !== topicId || _qpick.part !== part) _qpick.picked = [];
  _qpick.topicId = topicId;
  _qpick.part = part;

  $('hf-qpick-list').innerHTML = '<p class="adm-hint" style="padding:12px">Đang tải câu hỏi…</p>';
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/speaking-topics/' + encodeURIComponent(topicId)
      + '/questions?part=' + encodeURIComponent(part));
    if ($('hf-topic').value !== topicId || $('hf-part').value !== part) return;
    _qpick.items = (r && r.items) || [];
    _qpick.want = (r && r.questions_per_give) || 1;
    renderQpick();
  } catch (err) {
    $('hf-qpick-list').innerHTML =
      '<p class="adm-banner" style="margin:12px">Không đọc được câu hỏi của chủ đề này.</p>';
  }
}

/* ── Kho bài tập theo buổi (giáo trình) ─────────────────────────────────── */

/**
 * Bộ bài tập của khoá mà lớp này thuộc về.
 *
 * Hai lý do "không giao được" nói TÁCH RIÊNG, vì admin làm hai việc khác nhau:
 * đã giao rồi là việc xong, còn chưa có câu hỏi là việc CHƯA làm (nạp tệp JSONL
 * của buổi ấy).
 */
async function loadCourseBanks() {
  const sel = $('hf-cbank');
  const note = $('hf-cbank-note');
  const stillCurrent = () => ($('hf-skill') || {}).value === 'course';

  sel.innerHTML = '<option value="">Đang tải kho bài tập…</option>';
  note.textContent = '';
  note.dataset.tone = 'ok';
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/course-banks');
    if (!stillCurrent()) return;
    const items = (r && r.items) || [];
    const free = items.filter((b) => !b.already_given && b.ready);
    sel.innerHTML = free.length
      ? '<option value="">— Chọn buổi —</option>' + free.map((b) =>
        `<option value="${esc(b.id)}">Buổi ${esc(b.lesson_no)} · ${esc(b.title)}`
        + ` (${esc(b.question_count)} câu)</option>`).join('')
      : '<option value="">Chưa có buổi nào giao được</option>';

    const given = items.filter((b) => b.already_given).length;
    const empty = items.filter((b) => !b.already_given && !b.ready).length;
    const bits = [];
    if (given) bits.push(`${given} buổi lớp này đã làm`);
    if (empty) bits.push(`${empty} buổi chưa nạp câu hỏi`);
    note.textContent = items.length
      ? (bits.length ? `Đã ẩn: ${bits.join(', ')}.` : '')
      : 'Khoá này chưa có bộ bài tập nào.';
    note.dataset.tone = (empty || !items.length) ? 'warn' : 'ok';
  } catch (err) {
    if (!stillCurrent()) return;
    sel.innerHTML = '<option value="">Không đọc được kho bài tập</option>';
    // Backend nói rõ khi lớp chưa gắn khoá — câu duy nhất chỉ ra việc phải làm.
    note.textContent = (err && err.message) ? String(err.message) : 'Không đọc được kho.';
    note.dataset.tone = 'error';
  }
}

/* ── Bài sau buổi học ────────────────────────────────────────────────────── */

let _lessonSets = [];

/**
 * Bộ đề theo buổi của khoá mà lớp này thuộc về.
 *
 * Ba trạng thái KHÔNG được gộp thành một chữ "không dùng được", vì admin làm ba
 * việc khác nhau:
 *   · lớp chưa gắn khoá  → gắn lớp vào khoá (backend trả 400 kèm đúng câu này)
 *   · thiếu bản đọc      → chạy mẻ tạo audio
 *   · lớp đã giao rồi    → xong việc, chọn buổi khác
 */
async function loadLessonSets() {
  const sel = $('hf-set');
  const note = $('hf-set-note');
  const stillCurrent = () => hfKind() === 'lesson';

  sel.innerHTML = '<option value="">Đang tải kho đề của khoá…</option>';
  note.textContent = '';
  note.dataset.tone = 'ok';
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/speaking-lesson-sets');
    if (!stillCurrent()) return;
    _lessonSets = (r && r.items) || [];
    const free = _lessonSets.filter((s) => !s.already_given && s.ready);
    sel.innerHTML = free.length
      ? '<option value="">— Chọn buổi —</option>' + free.map((s) =>
        `<option value="${esc(s.id)}">Buổi ${esc(s.lesson_no)} · ${esc(s.title)}</option>`).join('')
      : '<option value="">Chưa có buổi nào giao được</option>';

    const given = _lessonSets.filter((s) => s.already_given).length;
    const short = _lessonSets.filter((s) => !s.already_given && !s.ready);
    const bits = [];
    if (given) bits.push(`${given} buổi lớp này đã làm`);
    if (short.length) {
      const n = short.reduce((a, s) => a + (s.missing_audio || 0), 0);
      bits.push(`${short.length} buổi còn thiếu ${n} bản đọc`);
    }
    note.textContent = bits.length ? `Đã ẩn: ${bits.join(', ')}.` : '';
    note.dataset.tone = short.length ? 'warn' : 'ok';
    if (!_lessonSets.length) {
      note.textContent = 'Khoá này chưa có bộ đề nào cho buổi học.';
      note.dataset.tone = 'warn';
    }
  } catch (err) {
    if (!stillCurrent()) return;
    sel.innerHTML = '<option value="">Không đọc được kho đề của khoá</option>';
    // Backend nói RÕ lý do khi lớp chưa gắn khoá; chép lại nguyên câu đó thay vì
    // thay bằng một câu chung chung — nó là câu duy nhất chỉ ra việc phải làm.
    note.textContent = err && err.message ? String(err.message) : 'Không đọc được kho đề.';
    note.dataset.tone = 'error';
  }
}

/** Câu trong bộ đã chọn. Mặc định BẬT HẾT — giáo viên trừ đi, không cộng vào. */
async function loadSetQuestions() {
  const setId = $('hf-set').value;
  $('hf-qpick-field').hidden = !setId;
  if (!setId) return;
  $('hf-qpick').hidden = false;
  $('hf-qmode-hint').textContent =
    'Cả bộ được giao. Bấm một câu để BỎ câu đó khỏi buổi này.';

  _qpick.mode = 'subset';
  if (_qpick.topicId !== setId) _qpick.picked = [];
  _qpick.topicId = setId;

  $('hf-qpick-list').innerHTML = '<p class="adm-hint" style="padding:12px">Đang tải câu hỏi…</p>';
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/speaking-lesson-sets/' + encodeURIComponent(setId) + '/questions');
    if ($('hf-set').value !== setId) return;
    // Chuẩn hoá về ĐÚNG một tên: bộ hiển thị đọc `giveable`, và hai tên cho
    // cùng một khái niệm sẽ khiến một trong hai chỗ quên mất tên kia.
    _qpick.items = ((r && r.items) || []).map((q) => ({ ...q, giveable: !!q.ready }));
    // Bật hết những câu giao được. Câu chưa có bản đọc KHÔNG tự bật — bật rồi bị
    // backend từ chối lúc bấm Giao là bắt giáo viên đi tìm xem câu nào hỏng.
    _qpick.picked = _qpick.items.filter((q) => q.ready).map((q) => q.id);
    _qpick.want = _qpick.picked.length;
    renderQpick();
  } catch (err) {
    $('hf-qpick-list').innerHTML =
      '<p class="adm-banner" style="margin:12px">Không đọc được câu hỏi của bộ đề này.</p>';
  }
}

/* ── Bộ quy hạn ───────────────────────────────────────────────────────────
 *
 * "7 ngày" tự nó không kiểm tra được: giáo viên gõ 7, bấm Giao, và chỉ biết
 * mình đặt trúng hay trượt vào hôm học viên kêu. Nên số ngày được quy ngay ra
 * MỐC TUYỆT ĐỐI sẽ được lưu thật.
 *
 * Ngày được đếm theo GIỜ VIỆT NAM, không theo múi giờ trình duyệt — cùng luật
 * với `defaultDueDateVietnam` và với backend. Một admin đang ở nước ngoài mà
 * tính bằng máy mình sẽ lệch một ngày ở ranh giới ngày.
 */
const _VN_WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm',
  'Thứ Sáu', 'Thứ Bảy'];

function vietnamDatePlusDays(days, at = new Date()) {
  const today = vietnamParts(at).date;                    // 'YYYY-MM-DD' giờ VN
  const [y, m, d] = today.split('-').map(Number);
  // UTC ở đây là cố ý: chỉ dùng để CỘNG NGÀY trên lịch, không phải để đổi múi
  // giờ. Dùng `new Date(y, m-1, d)` sẽ dựng ngày theo múi giờ trình duyệt và
  // qua DST có thể nhảy sai một ngày.
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base;
}

function renderDueResolve() {
  const box = $('hf-due-resolve');
  if (!box || hfKind() !== 'lesson') return;
  const atEl = $('hf-due-resolve-at');
  const whyEl = $('hf-due-resolve-why');
  const days = Number($('hf-due-days').value);
  const time = $('hf-due-time').value || '19:00';

  if (!days || days < 1 || days > 90) {
    box.dataset.empty = 'true';
    atEl.textContent = '—';
    whyEl.textContent = 'Nhập số ngày từ 1 đến 90 để xem hạn cụ thể.';
    return;
  }
  const d = vietnamDatePlusDays(days);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  box.dataset.empty = 'false';
  atEl.textContent = `${time} · ${_VN_WEEKDAY[d.getUTCDay()]} ${dd}/${mm}/${d.getUTCFullYear()}`;
  whyEl.textContent = `Giờ Việt Nam — ${days} ngày kể từ hôm nay. Sau mốc này hệ thống không nhận bài nữa.`;
}

function openHomeworkModal() {
  const daily = document.querySelector('input[name="hf-kind"][value="daily"]');
  if (daily) daily.checked = true;
  // Luôn quay về CẢ LỚP. Giữ lựa chọn của lần trước là để giáo viên giao nhầm
  // cho ba em rồi tưởng cả lớp đã nhận.
  if ($('hf-who')) $('hf-who').value = 'all';
  _who.picked = new Set();
  syncWho();
  $('hf-set').value = '';
  $('hf-cbank').value = '';
  $('hf-pass-pct').value = '';
  $('hf-retake-size').value = '';
  $('hf-due-days').value = '7';
  _lessonSets = [];
  $('hf-skill').value = 'speaking';
  $('hf-title').value = '';
  $('hf-topic').value = '';
  $('hf-test').value = '';
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
  $('hf-due').value = defaultDueDateVietnam();
  $('hf-due-time').value = '19:00';
  _topicsByPart = {};   // lớp khác thì "đã giao" khác — không tái dùng cache
  _qpick = { items: [], picked: [], want: 1, topicId: null, part: null };
  const rnd = document.querySelector('input[name="hf-qmode"][value="random"]');
  if (rnd) rnd.checked = true;
  $('hf-qpick-field').hidden = true;
  $('hf-qpick').hidden = true;
  $('hf-error').hidden = true;
  $('hf-warning').hidden = true;
  applyHomeworkKind();
  $('homework-modal').hidden = false;
  $('hf-title').focus();
}

function closeHomeworkModal() { $('homework-modal').hidden = true; }

async function submitHomework() {
  const lesson = hfKind() === 'lesson';
  const skill = lesson ? 'speaking' : $('hf-skill').value;
  const title = $('hf-title').value.trim();
  const topic = $('hf-topic').value.trim();
  const testId = $('hf-test').value;

  if (!title) {
    $('hf-error').textContent = 'Nhập tên bài giao để tiếp tục.';
    $('hf-error').hidden = false;
    return;
  }
  if (lesson) return submitLessonHomework(title);
  if (skill === 'speaking' && !topic) {
    $('hf-error').textContent = 'Chọn một chủ đề để tiếp tục.';
    $('hf-error').hidden = false;
    return;
  }
  // Chặn ở đây để giáo viên không mất một vòng gọi mạng chỉ để nghe backend nói
  // cùng một câu.
  if (skill === 'speaking' && qmode() === 'manual' && _qpick.picked.length !== _qpick.want) {
    $('hf-error').textContent =
      `Part ${$('hf-part').value} cần đúng ${_qpick.want} câu — bạn đã chọn ${_qpick.picked.length}.`;
    $('hf-error').hidden = false;
    return;
  }
  if (skill === 'course') return submitCourseHomework(title);
  if (skill !== 'speaking' && !testId) {
    $('hf-error').textContent = 'Chọn một đề để tiếp tục.';
    $('hf-error').hidden = false;
    return;
  }

  $('btn-hf-submit').disabled = true;
  try {
    const r = await api.post(
      '/admin/cohorts/' + encodeURIComponent(_cohortId) + '/assignments',
      skill === 'speaking'
        ? {
          skill, title, topic,
          content_id: topic,
          topic: ($('hf-topic').selectedOptions[0] || {}).text || '',
          // Bỏ trống = web bốc. Gửi mảng rỗng cũng là bỏ trống, nên chỉ gửi khi
          // giáo viên thật sự đã chọn.
          question_ids: (qmode() === 'manual' && _qpick.picked.length)
            ? _qpick.picked : null,
          mode: $('hf-mode').value,
          part: Number($('hf-part').value),
          due_date: $('hf-due').value || null,
          due_time: $('hf-due-time').value || null,
          instructions: $('hf-instructions').value.trim() || null,
          student_ids: whoRecipients(),
        }
        : {
          skill, title,
          content_id: testId,
          due_date: $('hf-due').value || null,
          due_time: $('hf-due-time').value || null,
          instructions: $('hf-instructions').value.trim() || null,
          student_ids: whoRecipients(),
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
    // Bảng ngày dựng TỪ danh sách bài giao — giao/lưu trữ/xoá làm nó cũ ngay.
    invalidateProgress();
  } catch (err) {
    $('hf-error').textContent = 'Không giao được bài: ' + (err.message || err);
    $('hf-error').hidden = false;
  } finally {
    $('btn-hf-submit').disabled = false;
  }
}

/**
 * Giao bài sau buổi học.
 *
 * Tách khỏi `submitHomework` chứ không nhồi thêm nhánh vào cùng một payload:
 * hai loại bài KHÔNG gửi cùng bộ trường (`due_date` với `due_days` loại trừ
 * nhau, backend từ chối nếu có cả hai), và một hàm gửi cả hai hình dạng sẽ chỉ
 * đúng cho tới lần thêm trường tiếp theo.
 */
async function submitLessonHomework(title) {
  const setId = $('hf-set').value;
  const days = Number($('hf-due-days').value);

  if (!setId) {
    $('hf-error').textContent = 'Chọn một buổi để tiếp tục.';
    $('hf-error').hidden = false;
    return;
  }
  if (!_qpick.picked.length) {
    $('hf-error').textContent = 'Chọn ít nhất một câu để giao.';
    $('hf-error').hidden = false;
    return;
  }
  if (!days || days < 1 || days > 90) {
    $('hf-error').textContent = 'Số ngày được nộp phải từ 1 đến 90.';
    $('hf-error').hidden = false;
    return;
  }

  $('btn-hf-submit').disabled = true;
  try {
    const all = _qpick.items.length;
    const r = await api.post(
      '/admin/cohorts/' + encodeURIComponent(_cohortId) + '/assignments',
      {
        skill: 'speaking',
        kind: 'lesson',
        title,
        content_id: setId,
        topic: ($('hf-set').selectedOptions[0] || {}).text || '',
        // Giao TRỌN BỘ thì không gửi danh sách — để backend tự lấy cả bộ. Gửi
        // đủ id cũng ra cùng kết quả, nhưng khi ấy bài giao ghim theo một bản
        // chụp của trình duyệt thay vì theo bộ đề thật.
        question_ids: _qpick.picked.length === all ? null : _qpick.picked,
        mode: $('hf-mode').value,
        due_days: days,
        due_time: $('hf-due-time').value || null,
        instructions: $('hf-instructions').value.trim() || null,
        student_ids: whoRecipients(),
      },
    );
    closeHomeworkModal();
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
    // Bảng ngày dựng TỪ danh sách bài giao — giao/lưu trữ/xoá làm nó cũ ngay.
    invalidateProgress();
  } catch (err) {
    $('hf-error').textContent = 'Không giao được bài: ' + (err.message || err);
    $('hf-error').hidden = false;
  } finally {
    $('btn-hf-submit').disabled = false;
  }
}

/** Giao một bộ bài tập theo buổi. Payload gọn: bộ đề quyết định tất cả. */
/* ── Chọn người nhận ────────────────────────────────────────────────────────
 *
 * Mặc định là CẢ LỚP. Đổi mặc định là đổi ý nghĩa của mọi thao tác quen tay,
 * nên "chọn học viên" phải là một hành động có chủ đích.
 *
 * Sĩ số lấy từ `loadRoster()` đã nạp sẵn — không gọi lại: mở hộp thoại giao bài
 * mà phải chờ mạng là chờ ở đúng lúc người dùng đang vội nhất.
 */
var _who = { members: [], picked: new Set() };

function whoIsAll() { return !$('hf-who') || $('hf-who').value === 'all'; }

/** Người nhận cho payload. `null` = cả lớp — KHÔNG phải mảng rỗng. */
function whoRecipients() {
  if (whoIsAll()) return null;
  return _who.picked.size ? Array.from(_who.picked) : [];
}

function renderWho() {
  var list = $('hf-who-list');
  if (!list) return;
  list.innerHTML = _who.members.map(function (m) {
    var on = _who.picked.has(m.student_id) ? ' checked' : '';
    return '<label class="cl-pick-row">'
      + '<input type="checkbox" data-who="' + esc(m.student_id) + '"' + on + ' />'
      + '<span>' + esc(m.name || m.student_code || 'Chưa có tên') + '</span>'
      + (m.user_id ? '' : '<em>chưa kích hoạt</em>')
      + '</label>';
  }).join('');
  var n = _who.picked.size;
  $('hf-who-count').textContent = n ? ('Đã chọn ' + n + '/' + _who.members.length) : 'Chưa chọn ai';
}

function syncWho() {
  var pick = $('hf-who-pick');
  if (pick) pick.hidden = whoIsAll();
  var btn = $('btn-hf-submit');
  if (btn) {
    btn.textContent = whoIsAll()
      ? 'Giao cho cả lớp'
      : ('Giao cho ' + _who.picked.size + ' học viên');
    // Chọn "một nhóm" rồi không chọn ai là một bài giao không tới đâu. Chặn ở
    // đây thay vì để backend trả empty_roster — lỗi ấy đúng nhưng tới muộn.
    btn.disabled = !whoIsAll() && _who.picked.size === 0;
  }
  if (!whoIsAll()) renderWho();
}


async function submitCourseHomework(title) {
  const bankId = $('hf-cbank').value;
  if (!bankId) {
    $('hf-error').textContent = 'Chọn một buổi để tiếp tục.';
    $('hf-error').hidden = false;
    return;
  }
  // Cổng thuộc bài: chỉ gửi khi admin ĐIỀN — trống nghĩa là "theo mặc định",
  // và mặc định được phép tiến hoá mà không phải sửa từng bài giao cũ.
  const passPct = parseInt($('hf-pass-pct').value, 10);
  const retakeSize = parseInt($('hf-retake-size').value, 10);
  if ($('hf-pass-pct').value !== '' && (isNaN(passPct) || passPct < 50 || passPct > 100)) {
    $('hf-error').textContent = 'Ngưỡng đạt phải trong khoảng 50–100%.';
    $('hf-error').hidden = false;
    return;
  }
  if ($('hf-retake-size').value !== '' && (isNaN(retakeSize) || retakeSize < 5 || retakeSize > 100)) {
    $('hf-error').textContent = 'Số câu kiểm tra lại phải trong khoảng 5–100.';
    $('hf-error').hidden = false;
    return;
  }
  $('btn-hf-submit').disabled = true;
  try {
    const r = await api.post(
      '/admin/cohorts/' + encodeURIComponent(_cohortId) + '/assignments',
      {
        skill: 'course',
        title,
        content_id: bankId,
        due_date: $('hf-due').value || null,
        due_time: $('hf-due-time').value || null,
        instructions: $('hf-instructions').value.trim() || null,
        // Bỏ trống = VẮNG MẶT trong payload, không phải null: payload gọn là
        // hợp đồng đã ghim, và vắng mặt mới đúng nghĩa "theo mặc định".
        ...(isNaN(passPct) ? {} : { pass_pct: passPct }),
        ...(isNaN(retakeSize) ? {} : { retake_size: retakeSize }),
        student_ids: whoRecipients(),
      },
    );
    closeHomeworkModal();
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
    // Bảng ngày dựng TỪ danh sách bài giao — giao/lưu trữ/xoá làm nó cũ ngay.
    invalidateProgress();
  } catch (err) {
    $('hf-error').textContent = 'Không giao được bài: ' + (err.message || err);
    $('hf-error').hidden = false;
  } finally {
    $('btn-hf-submit').disabled = false;
  }
}

/**
 * Bù học viên mới vào một bài ĐÃ GIAO.
 *
 * Em vào lớp sau ngày giao không có dòng nào trong sổ bài giao, nên bài ấy vô
 * hình với em — còn bảng của giáo viên vẫn đếm em vào mẫu số. Chỉ THÊM, không
 * bao giờ xoá, và bấm bao nhiêu lần cũng vô hại.
 */
async function backfillHomework(assignmentId) {
  try {
    const r = await api.post(
      '/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/assignments/' + encodeURIComponent(assignmentId) + '/backfill', {});
    // Nói rõ KHÔNG CÓ AI để bù, thay vì im lặng như thể vừa làm gì đó.
    toast(r && r.added
      ? `Đã thêm ${r.added} học viên vào bài này (tổng ${r.student_count}).`
      : 'Mọi học viên trong lớp đều đã có bài này rồi.');
    await loadHomework();
    invalidateProgress();
  } catch (err) {
    toast('Không bù được: ' + (err.message || err), 'error');
  }
}

async function setHomeworkStatus(assignmentId, status) {
  const archiving = status === 'archived';
  try {
    await api.patch('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/assignments/' + encodeURIComponent(assignmentId), { status });
    toast(archiving ? 'Đã đóng bài giao. Học viên không còn thấy bài này.' : 'Đã mở lại bài giao.');
    await loadHomework();
    // Bảng ngày dựng TỪ danh sách bài giao — giao/lưu trữ/xoá làm nó cũ ngay.
    invalidateProgress();
  } catch (err) {
    toast((archiving ? 'Không đóng được bài giao: ' : 'Không mở lại được bài giao: ')
      + (err.message || err), 'error');
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
        invalidateProgress();
      } catch (err) {
        toast('Không xoá được bài giao: ' + (err.message || err), 'error');
      }
    },
  });
}

// ── Chi tiết lớp: tiến độ 4 kỹ năng (GĐ 4) ─────────────────────────────────

let _progressLoaded = false;

/**
 * One skill cell.
 *
 * Three states kept apart, because collapsing them is how a page starts lying:
 *   null            → that skill's query failed. Say so; never print 0.
 *   attempts === 0  → genuinely nothing yet.
 *   otherwise       → the count, with the most recent band under it.
 */
function skillCell(cell) {
  if (cell === null || cell === undefined) {
    return '<span class="cl-skill-unknown">không đọc được</span>';
  }
  if (!cell.attempts) return '<span class="cl-skill-none">—</span>';
  const band = cell.last_band != null
    ? `<span class="cl-skill-band">band ${esc(cell.last_band)}</span>` : '';
  return `<div class="cl-skill"><span class="cl-skill-count">${countLabel(cell.attempts)} lượt</span>${band}</div>`;
}

/**
 * Punctuality on assigned homework.
 *
 * Three states, kept apart for the same reason the skill cells are:
 *   null           → the ledger read failed. Say so.
 *   nothing handed in yet → "—", NOT 0%. A student who has submitted nothing is
 *                    not "always late"; 0% would read as a damning verdict on
 *                    someone who may simply be new.
 *   otherwise      → the percentage, flagged when work is actually overdue.
 */
function punctualityCell(h) {
  if (h === null || h === undefined) {
    return '<span class="cl-skill-unknown">không đọc được</span>';
  }
  if (h.on_time_pct === null || h.on_time_pct === undefined) {
    return '<span class="cl-skill-none">—</span>';
  }
  const missing = h.missing
    ? `<span class="cl-roster-gap">${countLabel(h.missing)} chưa nộp</span>` : '';
  return `<div class="cl-skill"><span class="cl-skill-count">${esc(h.on_time_pct)}%</span>${missing}</div>`;
}

/** The most recent activity across all four skills. */
function lastAcrossSkills(skills) {
  const stamps = Object.values(skills || {})
    .filter(Boolean)
    .map((s) => s.last_activity)
    .filter(Boolean);
  if (!stamps.length) return '';
  return stamps.sort().reverse()[0];
}

function renderProgress() {
  $('progress-loading').hidden = true;
  const rows = _progress.students || [];
  const degraded = _progress.degraded || [];

  // Two different failures, two different sentences. A skill that failed to
  // load shows "—" and the admin should reload. A stale homework column is the
  // opposite problem: the numbers ARE there and look canonical, but a
  // Reading/Listening hand-in may not have been folded in yet — reporting that
  // as "Tải lại" would send the admin chasing a number that is not wrong,
  // just behind.
  const DEGRADED_LABEL = {
    speaking: 'Speaking', writing: 'Writing', reading: 'Reading',
    listening: 'Listening', homework: 'bài tập',
  };
  const stale = degraded.includes('homework_stale');
  const unread = degraded.filter((d) => d !== 'homework_stale');
  const notes = [];
  if (unread.length) {
    notes.push('Chưa đọc được số liệu: '
      + unread.map((d) => DEGRADED_LABEL[d] || d).join(', ') + '. Tải lại để thử lại.');
  }
  if (stale) {
    notes.push('Cột bài tập có thể chưa cập nhật bài nộp Reading/Listening mới nhất.');
  }
  _progressNotes = notes;
  renderProgressBanner();

  $('progress-empty').hidden = rows.length > 0;
  $('progress-table-wrap').hidden = rows.length === 0;
  if (!rows.length) return;

  $('progress-tbody').innerHTML = rows.map((r) => {
    // A student with no account has genuinely done nothing in the three
    // user-keyed skills — that is the activation gap, not inactivity.
    const sub = r.activated
      ? `<div class="cl-lesson-sub">${esc(r.student_code) || ''}</div>`
      : '<div class="cl-roster-gap">Chưa kích hoạt</div>';
    const last = lastAcrossSkills(r.skills);
    return `<tr>
      <td><div>${esc(r.name) || '—'}</div>${sub}</td>
      <td>${skillCell(r.skills.speaking)}</td>
      <td>${skillCell(r.skills.writing)}</td>
      <td>${skillCell(r.skills.reading)}</td>
      <td>${skillCell(r.skills.listening)}</td>
      <td>${punctualityCell(r.homework)}</td>
      <td>${last ? esc(lastActiveLabel(last)) : '<span class="cl-skill-none">—</span>'}</td>
    </tr>`;
  }).join('');
}

/**
 * The progress tab loads once and caches. A roster change (adding or removing a
 * student) makes that cache wrong: reopening the tab would show the old class
 * until a full page reload. Called from both roster mutations.
 */
function invalidateProgress() {
  _progressLoaded = false;
  _progress = { students: [], degraded: [] };
  // Bảng ngày dựng TỪ danh sách bài giao, nên giao/lưu trữ/xoá một bài hằng
  // ngày làm nó cũ ngay — kể cả khi thẻ Tiến độ đang đóng. Cờ này là thứ khiến
  // lần mở sau nạp lại (codex #931).
  _dailyBoardLoaded = false;
  // If the tab is currently open, refresh it now rather than on next open.
  if (!$('panel-progress').hidden) {
    _progressLoaded = true;
    loadProgress();
    loadSpeakingPerf();
    loadDailyBoard();
  }
}

/* ── Hiệu suất Speaking của lớp ─────────────────────────────────────────────
 *
 * DANH SÁCH VIỆC CẦN LÀM, không phải bảng xếp hạng. Backend đã xếp "ai cần để
 * mắt" lên đầu; ở đây chỉ vẽ lại đúng thứ tự ấy.
 *
 * Không có cột thứ hạng, cố ý: một em band 5.0 đều đặn không có vấn đề gì, còn
 * một em từ 7.0 tụt xuống 6.0 thì có — dù vẫn cao hơn. Bày thứ hạng ra sẽ trả
 * lời một câu hỏi khác và chôn mất em thứ hai.
 */
/**
 * Bảng bài Speaking HẰNG NGÀY: học viên × ngày.
 *
 * Đọc theo HÀNG là "em này có đều không", đọc theo CỘT là "hôm ấy cả lớp thế
 * nào". Cả hai câu ấy đều không trả lời được bằng cách mở lần lượt hai chục
 * bảng tổng kết của từng bài giao.
 *
 * Ô mang cả hình dạng lẫn màu (ký tự riêng cho mỗi trạng thái), không chỉ màu:
 * một lưới phân biệt bằng xanh/đỏ là một lưới người mù màu không đọc được.
 */
let _dailyBoardLoaded = false;
// MỘT băng cảnh báo, HAI nguồn ghi vào. Hai lượt gọi chạy song song và không
// chờ nhau, nên bên nào vẽ sau cũng sẽ xoá lời của bên kia nếu mỗi bên tự ghi
// thẳng vào DOM — bảng ngày hỏng rồi /progress xong sau là mất hẳn cảnh báo
// (codex #931). Giữ trạng thái riêng, gộp lúc vẽ.
let _progressNotes = [];
let _boardNote = '';

function renderProgressBanner() {
  const el = $('progress-degraded');
  if (!el) return;
  const all = _progressNotes.concat(_boardNote ? [_boardNote] : []);
  el.hidden = all.length === 0;
  if (all.length) el.textContent = all.join(' ');
}


async function loadDailyBoard() {
  const box = $('daily-board');
  if (!box || _dailyBoardLoaded) return;
  _dailyBoardLoaded = true;
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/speaking-daily');
    _boardNote = '';
    renderProgressBanner();
    renderDailyBoard(r);
  } catch (err) {
    // Ẩn lưới (lưới rỗng đọc như "lớp chưa có bài hằng ngày nào") NHƯNG nói ra
    // — đây là mặt đọc dùng để tìm em bỏ bài, nên im lặng ở đây là giấu đúng
    // thứ nó sinh ra để hiện (codex #931).
    box.hidden = true;
    _dailyBoardLoaded = false;   // cho lần mở sau thử lại
    _boardNote = 'Không đọc được bảng bài hằng ngày: ' + (err.message || err)
      + '. Mở lại thẻ này để thử lại.';
    renderProgressBanner();
  }
}

const BOARD_MARK = {
  done:    { ch: '✓', label: 'đã nộp' },
  late:    { ch: '◐', label: 'nộp trễ' },
  missing: { ch: '✕', label: 'không nộp' },
  pending: { ch: '·', label: 'chưa tới hạn' },
  none:    { ch: '',  label: 'không được giao' },
};

/** '2026-08-05' → '05/08'. Cột hẹp, và năm thì cả bảng dùng chung. */
function boardDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}` : esc(iso || '');
}

function renderDailyBoard(d) {
  const box = $('daily-board');
  const days = (d && d.days) || [];
  const rows = (d && d.students) || [];
  if (!days.length || !rows.length) { box.hidden = true; return; }
  box.hidden = false;

  $('board-scope').textContent =
    `${d.assignment_count} bài · ${days.length} ngày gần nhất`;

  $('board-head').innerHTML = '<th class="av-board__name-h">Học viên</th>'
    + days.map((x) => `<th><span>${esc(boardDay(x))}</span></th>`).join('')
    + '<th class="av-board__sum-h">Đã nộp</th>';

  $('board-body').innerHTML = rows.map((r) => {
    const cells = (r.cells || []).map((c, i) => {
      const mk = BOARD_MARK[c.state] || BOARD_MARK.none;
      const day = boardDay(days[i]);
      const band = c.score != null ? ` · band ${c.score}` : '';
      const title = `${r.name || ''} · ${day} · ${mk.label}${band}`;
      // Bấm vào ô là nghe bài của ĐÚNG em ấy ĐÚNG ngày ấy — đường ngắn nhất
      // từ "hôm ấy em này trễ" tới "em ấy đã nói gì".
      const inner = c.session_id
        ? `<a href="/pages/admin/speaking/sessions.html?session=${esc(c.session_id)}"
              target="_blank" rel="noopener">${mk.ch}</a>`
        : mk.ch;
      return `<td class="av-board__cell" data-state="${esc(c.state)}"
                  title="${esc(title)}">${inner}</td>`;
    }).join('');
    // Chưa kích hoạt tài khoản thì em ấy CHƯA TỪNG thấy bài nào — đánh dấu để
    // khỏi bị đọc thành lười.
    const name = esc(r.name || r.student_code || '—')
      + (r.activated ? '' : ' <span class="av-board__na">chưa kích hoạt</span>');
    return `<tr${r.missing ? ' data-alarm="true"' : ''}>
      <th scope="row" class="av-board__name">${name}</th>
      ${cells}
      <td class="av-board__sum">${r.done}/${days.length}</td>
    </tr>`;
  }).join('');

  // Nói RA khi sổ chưa đối chiếu được: im lặng ở đây là để giáo viên nhắc nhầm
  // một em đã nộp.
  $('board-foot').textContent =
    (d.stale ? 'Chưa đối chiếu được bài nộp mới nhất — vài ô có thể còn thiếu. ' : '')
    + 'Ô: ✓ đã nộp · ◐ nộp trễ · ✕ không nộp · · chưa tới hạn · trống = không được giao. '
    + 'Bấm vào ô có bài để nghe và đọc nhận xét.';
}

async function loadSpeakingPerf() {
  const box = $('speaking-perf');
  if (!box) return;
  try {
    const r = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/speaking-performance');
    renderSpeakingPerf(r);
  } catch (err) {
    // Không đọc được thì ẨN hẳn, không hiện một khung rỗng: khung rỗng đọc như
    // "lớp này chưa ai làm bài Speaking", mà sự thật là chưa đọc được.
    box.hidden = true;
  }
}

function perfSpark(bands) {
  if (!bands || bands.length < 2) return '';
  // Thang cố định 3–9: đó là dải band thật của bài thi. Co giãn theo từng em sẽ
  // làm một em dao động 0.5 trông y hệt một em dao động 3 band.
  const lo = 3, hi = 9;
  return '<span class="av-perf__spark" aria-hidden="true">'
    + bands.slice(-8).map((b) => {
      const pct = Math.max(0.1, Math.min(1, (b - lo) / (hi - lo)));
      return `<i style="height:${Math.round(pct * 24)}px"></i>`;
    }).join('') + '</span>';
}

function renderSpeakingPerf(d) {
  const box = $('speaking-perf');
  const items = (d && d.items) || [];
  if (!items.length) { box.hidden = true; return; }
  box.hidden = false;

  const kinds = (d.kinds || []).map((k) => k === 'lesson' ? 'sau buổi học' : 'hằng ngày');
  $('perf-scope').textContent =
    `${d.assignment_count} bài giao${kinds.length ? ' · ' + kinds.join(' + ') : ''}`;

  $('perf-rows').innerHTML = items.map((r) => {
    const flags = [...(r.student_flags || []), ...(r.work_flags || [])];
    // Gộp trùng: cùng một loại cờ trên năm bài là MỘT việc cần làm, không phải
    // năm việc. Nêu số lần để giáo viên biết mức độ.
    const seen = new Map();
    flags.forEach((f) => seen.set(f.code, (seen.get(f.code) || 0) + 1));
    const why = flags.length
      ? [...new Set(flags.map((f) => f.label))].map((lab) => {
        const f = flags.find((x) => x.label === lab);
        const n = seen.get(f.code);
        return esc(lab) + (n > 1 ? ` ×${n}` : '');
      }).join(' · ')
      : `${r.submitted}/${r.assigned} bài`;
    const band = (r.latest_band === null || r.latest_band === undefined)
      ? '—' : Number(r.latest_band).toFixed(1);
    return `<div class="av-perf__row" ${r.flag_level ? `data-level="${esc(r.flag_level)}"` : ''}>
      <span class="av-perf__mark" aria-hidden="true"></span>
      <span class="av-perf__who">
        <span class="av-perf__name">${esc(r.name || r.student_code || '—')}</span>
        <span class="av-perf__sub">${why}</span>
      </span>
      ${perfSpark(r.bands)}
      <span class="av-perf__band" data-empty="${band === '—'}">${esc(band)}</span>
    </div>`;
  }).join('');

  const need = items.filter((r) => r.flag_level).length;
  const noAccount = items.filter((r) => !r.activated).length;
  const bits = [];
  bits.push(need ? `<strong>${need} em cần để mắt</strong>.` : 'Không em nào cần để mắt lúc này.');
  if (noAccount) {
    // Chưa kích hoạt thì CHƯA TỪNG thấy bài nào — nhắc các em ấy là nhắc nhầm người.
    bits.push(`${noAccount} em chưa kích hoạt tài khoản nên chưa nhận được bài.`);
  }
  bits.push('Cột điểm là bài mới nhất; cột vạch là xu hướng, so với chính em ấy.');
  $('perf-foot').innerHTML = bits.join(' ');
}

async function loadProgress() {
  $('progress-loading').hidden = false;
  try {
    _progress = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId) + '/progress');
  } catch (err) {
    // Not an empty class — say so, and let the tab be retried.
    _progress = { students: [], degraded: [] };
    _progressLoaded = false;
    $('progress-loading').hidden = true;
    // Qua trạng thái chung, KHÔNG ghi thẳng DOM: hai lượt gọi chạy song song
    // nên ghi thẳng ở đây sẽ xoá lời cảnh báo của bảng ngày (cùng họ lỗi
    // codex #931 chỉ ra ở chiều ngược lại).
    _progressNotes = ['Không đọc được tiến độ lớp: ' + (err.message || err)
      + '. Mở lại thẻ này để thử lại.'];
    renderProgressBanner();
    $('progress-table-wrap').hidden = true;
    $('progress-empty').hidden = true;
    return;
  }
  renderProgress();
}

// ── Sub-tabs ────────────────────────────────────────────────────────────────

let _lessonsLoaded = false;

function showPanel(name) {
  const PANELS = ['roster', 'lessons', 'homework', 'progress'];
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
  if (name === 'progress') {
    if (!_progressLoaded) {
      _progressLoaded = true;
      loadProgress();
      // Hai lượt gọi RIÊNG, cố ý không chờ nhau: bảng bốn kỹ năng và hiệu suất
      // Speaking là hai nguồn khác nhau, và một bên hỏng không được kéo bên kia
      // biến mất theo.
      loadSpeakingPerf();
    }
    // Bảng ngày có CHỐT RIÊNG (`_dailyBoardLoaded`), nên gọi mỗi lần mở thẻ:
    // lần hỏng đã tự mở chốt, và nếu để lời gọi nằm trong chốt `_progressLoaded`
    // thì việc mở chốt ấy vô nghĩa — rời thẻ rồi quay lại vẫn treo cảnh báo cũ
    // cho tới khi tải lại cả trang (codex #931). Đã nạp xong thì hàm tự thoát.
    loadDailyBoard();
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
  $('tab-progress').addEventListener('click', () => showPanel('progress'));

  $('btn-add-homework').addEventListener('click', openHomeworkModal);
  $('homework-empty').addEventListener('click', (e) => {
    if (e.target.closest('button[data-action="retry-homework"]')) loadHomework();
  });
  $('btn-hf-cancel').addEventListener('click', closeHomeworkModal);
  $('btn-hf-submit').addEventListener('click', submitHomework);
  $('hf-skill').addEventListener('change', applyHomeworkSkill);
  // Chủ đề thuộc về một PART cụ thể — đổi Part mà giữ danh sách cũ là mời admin
  // giao một chủ đề Part 2 dưới nhãn Part 1.
  $('hf-part').addEventListener('change', loadSpeakingTopics);

  // Bộ chọn câu: chủ đề đổi → tải câu của chủ đề mới; Part đổi → cả hai (danh
  // sách chủ đề VÀ danh sách câu, vì câu thuộc về một Part cụ thể).
  $('hf-topic').addEventListener('change', loadQpick);
  $('hf-part').addEventListener('change', loadQpick);
  $('hf-qmode').addEventListener('change', loadQpick);

  // Bài sau buổi học. Dải chọn loại là radio nên phải nghe trên VÙNG CHỨA:
  // gắn vào từng input sẽ mất nếu sau này thêm một loại thứ ba.
  document.querySelector('.av-kind')
    .addEventListener('change', applyHomeworkKind);
  $('hf-set').addEventListener('change', loadSetQuestions);
  // Bộ quy hạn phải chạy theo CẢ hai ô: đổi giờ mà mốc hiện ra vẫn là giờ cũ
  // thì nó đang nói dối về thứ sắp được lưu.
  $('hf-due-days').addEventListener('input', renderDueResolve);
  $('hf-due-time').addEventListener('input', renderDueResolve);
  // Uỷ quyền: danh sách được vẽ lại sau mỗi lần bấm, nên gắn tay từng nút sẽ
  // mất ngay ở lần vẽ kế tiếp.
  $('hf-qpick-list').addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    if (play) { previewQuestionAudio(play.dataset.play, play); return; }
    const row = e.target.closest('.av-qpick__row');
    if (row && !row.disabled) toggleQpick(row.dataset.id);
  });
  // Chọn người nhận. Uỷ quyền cho cả danh sách: nó được vẽ lại mỗi lần chọn.
  $('hf-who').addEventListener('change', syncWho);
  $('hf-who-list').addEventListener('change', (e) => {
    const box = e.target.closest('input[data-who]');
    if (!box) return;
    if (box.checked) _who.picked.add(box.dataset.who);
    else _who.picked.delete(box.dataset.who);
    syncWho();
  });
  $('btn-hf-who-all').addEventListener('click', () => {
    _who.picked = new Set(_who.members.map((m) => m.student_id));
    syncWho();
  });
  $('btn-hf-who-none').addEventListener('click', () => {
    _who.picked = new Set();
    syncWho();
  });
  bindModalBackdrop('homework-modal', closeHomeworkModal);
  // Nút "Xem tự luận" nằm TRONG bảng tổng kết, vốn được vẽ lại mỗi lần mở —
  // nên uỷ quyền trên khung modal thay vì gắn tay từng nút.
  $('tally-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-writing]');
    if (btn && _tallyAsg) openStudentWriting(_tallyAsg, btn.dataset.writing);
  });
  $('homework-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'delete-homework') deleteHomework(btn.dataset.id);
    if (btn.dataset.action === 'tally') openTally(btn.dataset.id);
    if (btn.dataset.action === 'archive-homework') setHomeworkStatus(btn.dataset.id, 'archived');
    if (btn.dataset.action === 'publish-homework') setHomeworkStatus(btn.dataset.id, 'published');
    if (btn.dataset.action === 'backfill') backfillHomework(btn.dataset.id);
  });

  const closeTally = () => { $('tally-modal').hidden = true; };
  $('btn-tally-close').addEventListener('click', closeTally);
  // Bấm ra nền để đóng, như mọi modal khác. Chỉ khi bấm ĐÚNG lớp nền — bấm bên
  // trong thẻ cũng nổi bọt lên đây và sẽ đóng modal giữa lúc đang đọc.
  $('tally-modal').addEventListener('click', (e) => {
    if (e.target === $('tally-modal')) closeTally();
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
