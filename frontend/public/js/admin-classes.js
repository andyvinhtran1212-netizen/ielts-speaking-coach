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
                  data-id="${esc(a.id)}">Xem ai nộp</button> ${action}</td>
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

function tallyRow(r) {
  const when = r.submitted_at
    ? hhmm(r.submitted_at) + (r.status === 'late' ? ' · trễ' : '')
    : (TALLY_WHEN[r.status] || '');
  // Chưa chấm là chưa chấm — hiện 0.0 là hiện một ĐIỂM SỐ mà không ai cho.
  const band = (r.score === null || r.score === undefined) ? '—' : Number(r.score).toFixed(1);
  const empty = (r.score === null || r.score === undefined);
  return `<div class="av-tally__row" data-status="${esc(r.status)}">
    <span class="av-tally__mark" aria-hidden="true"></span>
    <span class="av-tally__name">${esc(r.name || r.student_code || '—')}</span>
    <span class="av-tally__when">${esc(when)}</span>
    <span class="av-tally__band" data-empty="${empty}">${esc(band)}</span>
  </div>`;
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
  const rows = ((d && d.students) || []).map(tallyRow).join('');
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
  return `<div class="av-tally" data-state="${sealed ? 'sealed' : 'live'}">
    <div class="av-tally__head">
      <span class="av-tally__count">${c.submitted || 0}<small>/${c.total || 0} đã nộp</small></span>
      <span class="av-tally__state">${sealed ? 'Đã chốt' : 'Đang nhận bài'}</span>
    </div>
    <div class="av-tally__rows">${rows}</div>
    <p class="av-tally__foot">${notes.join(' ')}</p>
  </div>`;
}

async function openTally(assignmentId) {
  const body = $('tally-body');
  $('tally-modal').hidden = false;
  body.innerHTML = '<p class="adm-hint">Đang tải…</p>';
  try {
    const d = await api.get('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/assignments/' + encodeURIComponent(assignmentId) + '/tally');
    $('tally-modal-title').textContent = d.assignment.title || 'Bảng tổng kết';
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

const SKILL_LABEL = { speaking: 'Speaking', reading: 'Reading', listening: 'Listening' };

let _testsBySkill = {};

/** Show only the fields the chosen skill actually uses. */
function applyHomeworkSkill() {
  const skill = $('hf-skill').value;
  const isSpeaking = skill === 'speaking';
  $('hf-topic-field').hidden = !isSpeaking;
  $('hf-speaking-row').hidden = !isSpeaking;
  $('hf-test-field').hidden = isSpeaking;
  $('homework-modal-title').textContent = 'Giao bài ' + (SKILL_LABEL[skill] || '');
  if (isSpeaking) loadSpeakingTopics();
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

let _qpick = { items: [], picked: [], want: 1, topicId: null, part: null };
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
  const listEl = $('hf-qpick-list');
  const footEl = $('hf-qpick-foot');
  if (!items.length) {
    listEl.innerHTML = '<p class="adm-hint" style="padding:12px">Chủ đề này chưa có câu nào cho Part đang chọn.</p>';
    footEl.textContent = '';
    return;
  }

  listEl.innerHTML = items.map((q) => {
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
        <span class="av-qpick__num" aria-hidden="true">${at !== -1 ? at + 1 : ''}</span>
        <span class="av-qpick__text">${esc(q.question_text || '')}</span>
        <span class="av-qpick__meta">${lvl}${blocked}</span>
      </button>${play}
    </div>`;
  }).join('');

  const ready = picked.length === want;
  footEl.dataset.ready = String(ready);
  footEl.innerHTML = `<span>Đã chọn <strong>${picked.length}/${want}</strong></span>`
    + (ready ? '<span>Thứ tự trên là thứ tự học viên sẽ nghe.</span>'
             : `<span>Chọn thêm ${want - picked.length} câu.</span>`);
}

function toggleQpick(id) {
  const at = _qpick.picked.indexOf(id);
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

function openHomeworkModal() {
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
  applyHomeworkSkill();
  $('homework-modal').hidden = false;
  $('hf-title').focus();
}

function closeHomeworkModal() { $('homework-modal').hidden = true; }

async function submitHomework() {
  const skill = $('hf-skill').value;
  const title = $('hf-title').value.trim();
  const topic = $('hf-topic').value.trim();
  const testId = $('hf-test').value;

  if (!title) {
    $('hf-error').textContent = 'Nhập tên bài giao để tiếp tục.';
    $('hf-error').hidden = false;
    return;
  }
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
        }
        : {
          skill, title,
          content_id: testId,
          due_date: $('hf-due').value || null,
          due_time: $('hf-due-time').value || null,
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

async function setHomeworkStatus(assignmentId, status) {
  const archiving = status === 'archived';
  try {
    await api.patch('/admin/cohorts/' + encodeURIComponent(_cohortId)
      + '/assignments/' + encodeURIComponent(assignmentId), { status });
    toast(archiving ? 'Đã đóng bài giao. Học viên không còn thấy bài này.' : 'Đã mở lại bài giao.');
    await loadHomework();
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
  $('progress-degraded').hidden = notes.length === 0;
  if (notes.length) $('progress-degraded').textContent = notes.join(' ');

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
  // If the tab is currently open, refresh it now rather than on next open.
  if (!$('panel-progress').hidden) {
    _progressLoaded = true;
    loadProgress();
  }
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
    $('progress-degraded').hidden = false;
    $('progress-degraded').textContent =
      'Không đọc được tiến độ lớp: ' + (err.message || err) + '. Mở lại thẻ này để thử lại.';
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
  if (name === 'progress' && !_progressLoaded) {
    _progressLoaded = true;
    loadProgress();
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
  // Uỷ quyền: danh sách được vẽ lại sau mỗi lần bấm, nên gắn tay từng nút sẽ
  // mất ngay ở lần vẽ kế tiếp.
  $('hf-qpick-list').addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    if (play) { previewQuestionAudio(play.dataset.play, play); return; }
    const row = e.target.closest('.av-qpick__row');
    if (row && !row.disabled) toggleQpick(row.dataset.id);
  });
  bindModalBackdrop('homework-modal', closeHomeworkModal);
  $('homework-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'delete-homework') deleteHomework(btn.dataset.id);
    if (btn.dataset.action === 'tally') openTally(btn.dataset.id);
    if (btn.dataset.action === 'archive-homework') setHomeworkStatus(btn.dataset.id, 'archived');
    if (btn.dataset.action === 'publish-homework') setHomeworkStatus(btn.dataset.id, 'published');
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
