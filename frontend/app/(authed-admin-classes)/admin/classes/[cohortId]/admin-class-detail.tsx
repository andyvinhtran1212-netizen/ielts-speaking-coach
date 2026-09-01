'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, Field, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import {
  latestSkillActivity,
  lessonDraft,
  normalizeCourseOptions,
  normalizeLessonsPayload,
  normalizeProgressPayload,
  normalizeRosterPayload,
  normalizeStudentOptions,
  rosterSummary,
  selectRoster,
  validateLessonDraft,
} from '@/lib/admin-class-detail-model.mjs';
import { normalizeStudentWork } from '@/lib/admin-class-student-work-model.mjs';

import type {
  Banner,
  Course,
  DetailTab,
  Lesson,
  LessonDraft,
  Member,
  ProgressPayload,
  SkillProgress,
  StudentOption,
  RosterPayload,
} from './admin-class-detail-types';
import { AdminClassHomework } from './admin-class-homework';
import { AdminClassSubmissions } from './admin-class-submissions';
import { AdminClassStudentWork } from './admin-class-student-work';
import type { ClassAssignment } from './admin-class-homework-types';
import type { SubmissionAssignment, SubmissionStudent } from './admin-class-submissions-types';
import type { StudentWorkSubject } from './admin-class-student-work-types';

type CohortDraft = {
  name: string;
  codePrefix: string;
  description: string;
  courseId: string;
  error: string;
};

type ConfirmState =
  | { kind: 'remove-member'; member: Member }
  | { kind: 'delete-lesson'; lesson: Lesson }
  | null;

const SKILLS = ['speaking', 'writing', 'reading', 'listening'] as const;
const DETAIL_TABS: DetailTab[] = ['roster', 'progress', 'lessons', 'homework'];
const SKILL_LABEL: Record<(typeof SKILLS)[number], string> = {
  speaking: 'Speaking', writing: 'Writing', reading: 'Reading', listening: 'Listening',
};

function formatDate(value: string | null) {
  if (!value) return 'Chưa đặt ngày';
  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 'Ngày không hợp lệ' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'long' }).format(date);
}

function formatActivity(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Không rõ';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatMoney(value: number | null) {
  if (value == null) return 'Không đọc được';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
}

function SkillCell({ value, target }: { value: SkillProgress | null; target: number | null }) {
  if (value == null) return <span className="acd-unknown">Không đọc được</span>;
  if (!value.attempts) return <span className="acd-muted">Chưa có lượt</span>;
  const recentBands = value.recent_bands.slice(-8);
  const belowTarget = target == null ? 0 : recentBands.filter((band) => band < target).length;
  return (
    <div className="acx-skill">
      <div><strong>{value.attempts.toLocaleString('vi-VN')} lượt</strong>{value.last_band != null && <span>Band {value.last_band}</span>}</div>
      {recentBands.length > 0 && (
        <span className="acx-band-strip" role="img" aria-label={`Các band gần đây: ${recentBands.join(', ')}.${target == null ? ' Chưa đặt band mục tiêu.' : ` ${belowTarget} lượt dưới mục tiêu ${target}.`}`}>
          {recentBands.map((band, index) => (
            <i key={`${band}-${index}`} className={target != null && band < target ? 'is-below' : ''} title={`Band ${band}`} />
          ))}
        </span>
      )}
      {target != null && belowTarget > 0 && <small className="acx-below-target">{belowTarget} dưới mục tiêu {target}</small>}
    </div>
  );
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="acd-state"><strong>{title}</strong><span>{text}</span>{action}</div>;
}

export function AdminClassDetail({ cohortId }: { cohortId: string }) {
  const profile = useAdminProfile();
  const [tab, setTab] = useState<DetailTab>('roster');
  const [roster, setRoster] = useState<RosterPayload | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState('all');
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState(false);
  const [cohortDraft, setCohortDraft] = useState<CohortDraft | null>(null);
  const [memberPicker, setMemberPicker] = useState(false);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState<string | null>(null);
  const [lessonEditor, setLessonEditor] = useState<LessonDraft | null>(null);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [homeworkRefreshKey, setHomeworkRefreshKey] = useState(0);
  const [markingAssignment, setMarkingAssignment] = useState<SubmissionAssignment | null>(null);
  const [markingStudent, setMarkingStudent] = useState<SubmissionStudent | null>(null);
  const [studentWorkSubject, setStudentWorkSubject] = useState<StudentWorkSubject | null>(null);
  const [studentWorkReturn, setStudentWorkReturn] = useState<{ subject: StudentWorkSubject; tab: DetailTab } | null>(null);
  const [requestedAssignmentId, setRequestedAssignmentId] = useState<string | null>(null);
  const [requestedStudentId, setRequestedStudentId] = useState<string | null>(null);
  const overviewSequence = useRef(0);
  const lessonsSequence = useRef(0);
  const progressSequence = useRef(0);
  const studentWorkSequence = useRef(0);

  const loadOverview = useCallback(async (silent = false) => {
    const requestId = ++overviewSequence.current;
    if (!silent) setRosterLoading(true);
    setRosterError(null);
    setCoursesError(null);
    const [rosterResult, courseResult] = await Promise.allSettled([
      window.api.get<unknown>(`/admin/cohorts/${encodeURIComponent(cohortId)}/members`),
      window.api.get<unknown>('/admin/courses'),
    ]);
    if (requestId !== overviewSequence.current) return false;
    let canonical = true;
    if (rosterResult.status === 'fulfilled') {
      const normalized = normalizeRosterPayload(rosterResult.value, cohortId) as RosterPayload | null;
      if (normalized) setRoster(normalized);
      else { canonical = false; setRosterError('Dữ liệu lớp không đúng định dạng.'); }
    } else { canonical = false; setRosterError(messageOf(rosterResult.reason)); }
    if (courseResult.status === 'fulfilled') setCourses(normalizeCourseOptions(courseResult.value) as Course[]);
    else { canonical = false; setCoursesError(messageOf(courseResult.reason)); }
    setRosterLoading(false);
    return canonical;
  }, [cohortId]);

  const loadLessons = useCallback(async (silent = false) => {
    const requestId = ++lessonsSequence.current;
    if (!silent) setLessonsLoading(true);
    setLessonsError(null);
    try {
      const value = await window.api.get<unknown>(`/admin/cohorts/${encodeURIComponent(cohortId)}/lessons`);
      if (requestId !== lessonsSequence.current) return false;
      setLessons(normalizeLessonsPayload(value) as Lesson[]);
      setLessonsLoading(false);
      return true;
    } catch (caught) {
      if (requestId !== lessonsSequence.current) return false;
      setLessonsError(messageOf(caught));
      setLessonsLoading(false);
      return false;
    }
  }, [cohortId]);

  const loadProgress = useCallback(async (silent = false) => {
    const requestId = ++progressSequence.current;
    if (!silent) setProgressLoading(true);
    setProgressError(null);
    try {
      const value = await window.api.get<unknown>(`/admin/cohorts/${encodeURIComponent(cohortId)}/progress`);
      if (requestId !== progressSequence.current) return false;
      setProgress(normalizeProgressPayload(value) as ProgressPayload);
      setProgressLoading(false);
      return true;
    } catch (caught) {
      if (requestId !== progressSequence.current) return false;
      setProgressError(messageOf(caught));
      setProgressLoading(false);
      return false;
    }
  }, [cohortId]);

  useEffect(() => {
    setRoster(null); setLessons(null); setProgress(null); setBanner(null); setHomeworkRefreshKey(0); setMarkingAssignment(null); setMarkingStudent(null); setStudentWorkSubject(null); setStudentWorkReturn(null);
    setRosterError(null); setCoursesError(null); setLessonsError(null); setProgressError(null);
    setLessonsLoading(false); setProgressLoading(false);
    setSearch(''); setAccount('all');
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    const assignmentId = params.get('assignment_id');
    const studentId = params.get('student_id');
    setRequestedAssignmentId(assignmentId);
    setRequestedStudentId(studentId);
    setTab(assignmentId ? 'homework' : requestedTab === 'progress' || requestedTab === 'lessons' || requestedTab === 'homework' ? requestedTab : 'roster');
    void loadOverview();
    return () => {
      overviewSequence.current += 1;
      lessonsSequence.current += 1;
      progressSequence.current += 1;
    };
  }, [profile.id, cohortId, loadOverview]);

  useEffect(() => {
    if (!roster || !requestedStudentId) return;
    const member = roster.members.find((item) => item.student_id === requestedStudentId);
    if (!member) {
      setRequestedStudentId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete('student_id');
      window.history.replaceState({}, '', url);
      setBanner({ kind: 'error', text: 'Học viên trong liên kết không còn thuộc lớp này.' });
      return;
    }
    const subject = { student_id: member.student_id, name: member.name, student_code: member.student_code, user_id: member.user_id };
    if (requestedAssignmentId) {
      const requestId = ++studentWorkSequence.current;
      setMarkingStudent(null);
      void window.api.get<unknown>(`/admin/cohorts/${encodeURIComponent(cohortId)}/students/${encodeURIComponent(member.student_id)}/work`).then((value) => {
        if (requestId !== studentWorkSequence.current) return;
        const normalized = normalizeStudentWork(value, member.student_id) as { items: { assignment_id: string; has_writing: boolean }[] } | null;
        const item = normalized?.items.find((row) => row.assignment_id === requestedAssignmentId);
        if (item) {
          setMarkingStudent({ studentId: member.student_id, userId: member.user_id, name: member.name, hasWriting: item.has_writing });
        } else {
          setBanner({ kind: 'error', text: 'Học viên này không có phần trong bài giao của liên kết.' });
        }
      }).catch(() => {
        if (requestId === studentWorkSequence.current) setBanner({ kind: 'error', text: 'Đã mở bài nhưng chưa đọc được đầy đủ bằng chứng bài làm của học viên.' });
      });
    }
    else if (!markingAssignment) setStudentWorkSubject(subject);
  }, [cohortId, markingAssignment, requestedAssignmentId, requestedStudentId, roster]);

  useEffect(() => {
    if (tab === 'lessons' && lessons == null && !lessonsLoading && !lessonsError) void loadLessons();
    if (tab === 'progress' && progress == null && !progressLoading && !progressError) void loadProgress();
  }, [tab, lessons, lessonsLoading, lessonsError, loadLessons, progress, progressLoading, progressError, loadProgress]);

  useEffect(() => {
    if (roster?.cohort.name) document.title = `${roster.cohort.name} · Lớp & Học viên · Admin`;
  }, [roster?.cohort.name]);

  const members = roster?.members || [];
  const visibleMembers = useMemo(() => selectRoster(members, { search, account }) as Member[], [members, search, account]);
  const summary = useMemo(() => rosterSummary(members), [members]);
  const course = courses.find((item) => item.id === roster?.cohort.course_id) || null;
  const selectedStudentRow = students.find((student) => student.id === selectedStudent) || null;
  const staleRoster = Boolean(rosterError && roster);
  const rosterShapeWarning = Boolean(roster && (roster.discarded_member_count > 0 || roster.member_count !== roster.members.length));

  const selectTab = (next: DetailTab) => {
    setMarkingAssignment(null);
    setMarkingStudent(null);
    setStudentWorkSubject(null);
    setStudentWorkReturn(null);
    setRequestedAssignmentId(null);
    setRequestedStudentId(null);
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    url.searchParams.delete('assignment_id');
    url.searchParams.delete('student_id');
    window.history.replaceState({}, '', url);
  };

  const openSubmissions = useCallback((assignment: ClassAssignment) => {
    setMarkingAssignment(assignment);
    if (!requestedStudentId) setMarkingStudent(null);
    setStudentWorkReturn(null);
    setRequestedAssignmentId(null);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'homework');
    url.searchParams.set('assignment_id', assignment.id);
    window.history.replaceState({}, '', url);
  }, [requestedStudentId]);

  const closeSubmissions = () => {
    setMarkingAssignment(null);
    setMarkingStudent(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('assignment_id');
    if (studentWorkReturn) {
      setTab(studentWorkReturn.tab);
      setStudentWorkSubject(studentWorkReturn.subject);
      setRequestedStudentId(studentWorkReturn.subject.student_id);
      url.searchParams.set('tab', studentWorkReturn.tab);
      url.searchParams.set('student_id', studentWorkReturn.subject.student_id);
      setStudentWorkReturn(null);
    } else {
      setRequestedStudentId(null);
      url.searchParams.delete('student_id');
    }
    window.history.replaceState({}, '', url);
  };

  const openStudentWork = (subject: StudentWorkSubject) => {
    setStudentWorkSubject(subject);
    setRequestedStudentId(subject.student_id);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    url.searchParams.set('student_id', subject.student_id);
    url.searchParams.delete('assignment_id');
    window.history.replaceState({}, '', url);
  };

  const closeStudentWork = () => {
    setStudentWorkSubject(null);
    setRequestedStudentId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('student_id');
    window.history.replaceState({}, '', url);
  };

  const openStudentAssignment = (assignment: SubmissionAssignment, student: SubmissionStudent) => {
    if (!studentWorkSubject) return;
    setStudentWorkReturn({ subject: studentWorkSubject, tab });
    setStudentWorkSubject(null);
    setMarkingStudent(student);
    setMarkingAssignment(assignment);
    setRequestedAssignmentId(null);
    setTab('homework');
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'homework');
    url.searchParams.set('student_id', studentWorkSubject.student_id);
    url.searchParams.set('assignment_id', assignment.id);
    window.history.replaceState({}, '', url);
  };

  const clearMissingAssignment = useCallback(() => {
    setRequestedAssignmentId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('assignment_id');
    window.history.replaceState({}, '', url);
  }, []);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: DetailTab) => {
    if (busy) return;
    const index = DETAIL_TABS.indexOf(current);
    let next: DetailTab | null = null;
    if (event.key === 'ArrowRight') next = DETAIL_TABS[(index + 1) % DETAIL_TABS.length];
    if (event.key === 'ArrowLeft') next = DETAIL_TABS[(index - 1 + DETAIL_TABS.length) % DETAIL_TABS.length];
    if (event.key === 'Home') next = DETAIL_TABS[0];
    if (event.key === 'End') next = DETAIL_TABS[DETAIL_TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    window.requestAnimationFrame(() => document.getElementById(`acx-tab-${next}`)?.focus());
  };

  const refreshCurrent = async () => {
    if (busy) return;
    if (tab === 'lessons') await loadLessons();
    else if (tab === 'progress') await loadProgress();
    else if (tab === 'homework') setHomeworkRefreshKey((value) => value + 1);
    else await loadOverview();
  };

  const invalidateProgress = () => {
    progressSequence.current += 1;
    setProgress(null);
    setProgressError(null);
    setProgressLoading(false);
    if (tab === 'progress') void loadProgress();
  };

  const openCohortEditor = () => {
    if (!roster) return;
    setCohortDraft({
      name: roster.cohort.name,
      codePrefix: roster.cohort.code_prefix || '',
      description: roster.cohort.description || '',
      courseId: roster.cohort.course_id || '',
      error: '',
    });
  };

  const saveCohort = async (event: FormEvent) => {
    event.preventDefault();
    if (!cohortDraft || busy) return;
    const name = cohortDraft.name.trim();
    if (!name) { setCohortDraft({ ...cohortDraft, error: 'Nhập tên lớp để tiếp tục.' }); return; }
    setBusy(true);
    try {
      await window.api.patch(`/admin/cohorts/${encodeURIComponent(cohortId)}`, {
        name,
        code_prefix: cohortDraft.codePrefix.trim() || null,
        description: cohortDraft.description.trim() || null,
        course_id: cohortDraft.courseId || null,
      });
      const canonical = await loadOverview(true);
      setCohortDraft(null);
      setBanner(canonical
        ? { kind: 'success', text: 'Đã lưu thông tin lớp.' }
        : { kind: 'error', text: 'Đã lưu lớp nhưng chưa đọc lại được toàn bộ dữ liệu chuẩn.' });
    } catch (caught) {
      setCohortDraft({ ...cohortDraft, error: messageOf(caught) });
    } finally { setBusy(false); }
  };

  const openMemberPicker = async () => {
    if (busy) return;
    setMemberPicker(true); setStudentsLoading(true); setStudentsError(''); setSelectedStudent('');
    try {
      const value = await window.api.get<unknown>('/admin/students?limit=200');
      const normalized = normalizeStudentOptions(value) as StudentOption[] | null;
      if (!normalized) throw new Error('Dữ liệu danh sách học viên không đúng định dạng.');
      setStudents(normalized);
    } catch (caught) { setStudents([]); setStudentsError(messageOf(caught)); }
    finally { setStudentsLoading(false); }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedStudent || busy) return;
    setBusy(true); setStudentsError('');
    try {
      await window.api.post(`/admin/cohorts/${encodeURIComponent(cohortId)}/students`, { student_id: selectedStudent });
      const canonical = await loadOverview(true);
      setMemberPicker(false); setSelectedStudent(''); invalidateProgress();
      setBanner(canonical
        ? { kind: 'success', text: 'Đã thêm học viên vào lớp; các lớp đang học khác được giữ nguyên.' }
        : { kind: 'error', text: 'Đã xếp lớp nhưng chưa đọc lại được sổ điểm danh chuẩn.' });
    } catch (caught) { setStudentsError(messageOf(caught)); }
    finally { setBusy(false); }
  };

  const removeMember = async (member: Member) => {
    setConfirm(null); setBusy(true); setBanner(null);
    try {
      await window.api.delete(`/admin/cohorts/${encodeURIComponent(cohortId)}/students/${encodeURIComponent(member.student_id)}`);
      const canonical = await loadOverview(true);
      invalidateProgress();
      setBanner(canonical
        ? { kind: 'success', text: `Đã gỡ ${member.name} khỏi lớp. Tài khoản và mã đăng nhập không thay đổi.` }
        : { kind: 'error', text: 'Đã gỡ học viên nhưng chưa đọc lại được sổ điểm danh chuẩn.' });
    } catch (caught) { setBanner({ kind: 'error', text: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const saveLesson = async (event: FormEvent) => {
    event.preventDefault();
    if (!lessonEditor || busy) return;
    const validation = validateLessonDraft(lessonEditor) as { ok: boolean; error?: string; body?: Record<string, unknown> };
    if (!validation.ok || !validation.body) {
      setLessonEditor({ ...lessonEditor, error: validation.error || 'Dữ liệu buổi học không hợp lệ.' });
      return;
    }
    setBusy(true);
    try {
      const base = `/admin/cohorts/${encodeURIComponent(cohortId)}/lessons`;
      if (lessonEditor.id) await window.api.patch(`${base}/${encodeURIComponent(lessonEditor.id)}`, validation.body);
      else await window.api.post(base, validation.body);
      const canonical = await loadLessons(true);
      const wasEdit = Boolean(lessonEditor.id);
      setLessonEditor(null);
      setBanner(canonical
        ? { kind: 'success', text: wasEdit ? 'Đã lưu buổi học.' : 'Đã thêm buổi học.' }
        : { kind: 'error', text: 'Đã lưu buổi học nhưng chưa đọc lại được dòng thời gian chuẩn.' });
    } catch (caught) { setLessonEditor({ ...lessonEditor, error: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const deleteLesson = async (lesson: Lesson) => {
    setConfirm(null); setBusy(true); setBanner(null);
    try {
      await window.api.delete(`/admin/cohorts/${encodeURIComponent(cohortId)}/lessons/${encodeURIComponent(lesson.id)}`);
      const canonical = await loadLessons(true);
      setBanner(canonical
        ? { kind: 'success', text: 'Đã xoá buổi học. Bài tập từng gắn với buổi này vẫn được giữ.' }
        : { kind: 'error', text: 'Đã xoá buổi học nhưng chưa đọc lại được dòng thời gian chuẩn.' });
    } catch (caught) { setBanner({ kind: 'error', text: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  if (!roster && rosterLoading) return <main className="acd-shell"><EmptyState title="Đang mở lớp…" text="Đang tải hồ sơ và sổ điểm danh chuẩn." /></main>;

  if (!roster && rosterError) return (
    <main className="acd-shell">
      <a className="acx-back" href="/admin/classes">← Quay lại danh sách lớp</a>
      <EmptyState title="Không mở được lớp" text={rosterError} action={<button className="adm-btn-secondary" type="button" onClick={() => void loadOverview()}>Thử lại</button>} />
    </main>
  );

  return (
    <main className="acd-shell acx-shell">
      <nav className="acx-breadcrumb" aria-label="Đường dẫn"><a href="/admin/classes">Lớp & Học viên</a><span>/</span><strong aria-current="page">{roster?.cohort.name}</strong></nav>

      <header className="acx-hero">
        <div>
          <p className="acd-eyebrow">Hồ sơ lớp học</p>
          <h1>{roster?.cohort.name}</h1>
          <div className="acx-meta">
            <span className={`adm-status-pill ${roster?.cohort.is_active ? 'is-active' : 'is-archived'}`}>{roster?.cohort.is_active ? 'Đang hoạt động' : 'Đã lưu trữ'}</span>
            {course ? <span className="adm-chip">{course.code ? `${course.code} · ` : ''}{course.name}</span> : roster?.cohort.course_id ? <span className="acd-unknown">Không đọc được khoá đã gán</span> : <span className="acd-muted">Chưa gán khoá</span>}
            {roster?.cohort.code_prefix && <code>{roster.cohort.code_prefix}</code>}
          </div>
          {roster?.cohort.description && <p>{roster.cohort.description}</p>}
        </div>
        <div className="acx-hero-actions">
          <button className="adm-btn-secondary" type="button" onClick={() => void refreshCurrent()} disabled={busy || rosterLoading || lessonsLoading || progressLoading}>Tải lại</button>
          <button className="adm-btn-secondary" type="button" onClick={openCohortEditor} disabled={busy}>Sửa thông tin lớp</button>
        </div>
      </header>

      <section className="acd-kpis" aria-label="Tóm tắt sĩ số lớp">
        <div className="acd-kpi"><span>Tổng học viên</span><strong>{summary.total.toLocaleString('vi-VN')}</strong></div>
        <div className="acd-kpi"><span>Đã kích hoạt</span><strong>{summary.activated.toLocaleString('vi-VN')}</strong></div>
        <div className="acd-kpi"><span>Chưa kích hoạt</span><strong>{summary.unactivated.toLocaleString('vi-VN')}</strong></div>
      </section>

      <StatusBanner banner={banner} />
      {staleRoster && <div className="acd-warning" role="alert">Không đọc được sổ mới nhất: {rosterError}. Số liệu đầu trang và sổ bên dưới có thể đã cũ.</div>}
      {rosterShapeWarning && <div className="acd-warning" role="alert">Sĩ số backend báo {roster?.member_count.toLocaleString('vi-VN')} nhưng chỉ đọc được {roster?.members.length.toLocaleString('vi-VN')} hồ sơ hợp lệ. Bảng và KPI có thể thiếu học viên.</div>}
      {coursesError && <div className="acd-warning" role="alert">Không đọc được danh mục khoá: {coursesError}. Liên kết khoá hiện tại được giữ nguyên khi sửa.</div>}

      <div className="acx-section-nav">
        <nav className="acx-tabs" role="tablist" aria-label="Nội dung lớp">
          {([
            ['roster', 'Sổ điểm danh', 'Sĩ số và trạng thái tài khoản'],
            ['progress', 'Tiến độ 4 kỹ năng', 'Nhịp học và nộp đúng hạn'],
            ['lessons', 'Buổi học', 'Dòng thời gian nội dung'],
            ['homework', 'Bài tập', 'Giao bài và theo dõi hạn'],
          ] as const).map(([value, label, hint]) => (
            <button id={`acx-tab-${value}`} key={value} type="button" role="tab" aria-controls={tab === value ? `acx-panel-${value}` : undefined} aria-selected={tab === value} aria-disabled={busy} tabIndex={tab === value ? 0 : -1} className={tab === value ? 'is-active' : ''} onClick={() => { if (!busy) selectTab(value); }} onKeyDown={(event) => handleTabKeyDown(event, value)}>
              <span>{label}</span><small>{hint}</small>
            </button>
          ))}
        </nav>
        <button className="acx-legacy-workspace" type="button" onClick={() => { selectTab('homework'); window.requestAnimationFrame(() => document.getElementById('acx-panel-homework')?.scrollIntoView({ behavior: 'smooth' })); }}><span>Nhận bài & Chấm bài</span><small>Chọn một bài trong workspace native</small></button>
      </div>

      {tab === 'roster' && (
        <section id="acx-panel-roster" className="acd-workspace" role="tabpanel" aria-labelledby="acx-tab-roster">
          <div className="acx-section-head"><div><p className="acd-eyebrow">Vận hành sĩ số</p><h2>Sổ điểm danh</h2><p>{summary.unactivated ? `${summary.unactivated} học viên chưa kích hoạt sẽ không nhận được bài giao theo tài khoản.` : 'Tất cả học viên trong lớp đã có tài khoản.'}</p></div><button className="adm-btn-primary" type="button" onClick={() => void openMemberPicker()} disabled={busy}>Thêm học viên</button></div>
          <div className="acx-roster-toolbar">
            <Field label="Tìm học viên"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên hoặc mã học viên…" disabled={busy} /></Field>
            <Field label="Tài khoản"><select value={account} onChange={(event) => setAccount(event.target.value)} disabled={busy}><option value="all">Tất cả</option><option value="activated">Đã kích hoạt</option><option value="unactivated">Chưa kích hoạt</option></select></Field>
            <span>{visibleMembers.length.toLocaleString('vi-VN')} / {members.length.toLocaleString('vi-VN')} học viên</span>
          </div>
          {!members.length ? <EmptyState title="Lớp chưa có học viên" text="Thêm hồ sơ học viên đã có để bắt đầu vận hành lớp." /> : !visibleMembers.length ? <EmptyState title="Không có học viên khớp bộ lọc" text="Thử đổi từ khoá hoặc trạng thái tài khoản." /> : (
            <div className="acd-table-scroll" tabIndex={0} role="region" aria-label="Bảng sổ điểm danh, có thể cuộn ngang"><table className="acd-table acx-roster-table"><thead><tr><th>Học viên</th><th>Mã HV</th><th>Phiên nói</th><th>Hoạt động gần nhất</th><th>Chi phí AI</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>
              {visibleMembers.map((member) => <tr key={member.student_id}>
                <td><div className="acx-person"><strong>{member.name}</strong><span className={member.user_id ? 'is-active' : 'is-warning'}>{member.user_id ? 'Đã kích hoạt' : 'Chưa kích hoạt'}</span></div></td>
                <td><code>{member.student_code || '—'}</code></td>
                <td>{member.sessions == null ? <span className="acd-unknown">Không đọc được</span> : member.sessions.toLocaleString('vi-VN')}</td>
                <td>{formatActivity(member.last_active)}</td><td>{formatMoney(member.ai_cost_usd)}</td>
                <td><div className="acx-row-actions"><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => openStudentWork({ student_id: member.student_id, name: member.name, student_code: member.student_code, user_id: member.user_id })} disabled={busy}>Xem bài</button><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setConfirm({ kind: 'remove-member', member })} disabled={busy}>Gỡ khỏi lớp</button></div></td>
              </tr>)}
            </tbody></table></div>
          )}
        </section>
      )}

      {tab === 'progress' && (
        <section id="acx-panel-progress" className="acd-workspace" role="tabpanel" aria-labelledby="acx-tab-progress">
          <div className="acx-section-head"><div><p className="acd-eyebrow">Tín hiệu cần hành động</p><h2>Tiến độ 4 kỹ năng</h2><p>Mỗi ô giữ riêng trạng thái chưa có dữ liệu và không đọc được dữ liệu.</p></div></div>
          {progressError && <div className={progress ? 'acd-warning' : 'acd-state is-error'} role="alert"><strong>Không đọc được tiến độ mới nhất</strong><span>{progressError}{progress ? ' Bảng dưới đây là ảnh chụp lần tải trước.' : ''}</span><button className="adm-btn-secondary" type="button" onClick={() => void loadProgress()} disabled={busy || progressLoading}>Thử lại</button></div>}
          {progress?.degraded.length ? <div className="acd-warning" role="alert">{progress.degraded.includes('homework_stale') && 'Cột bài tập có thể chưa cập nhật một số bài nộp mới nhất. '}{progress.degraded.filter((item) => item !== 'homework_stale').length > 0 && `Không đọc được: ${progress.degraded.filter((item) => item !== 'homework_stale').join(', ')}.`}</div> : null}
          {progressLoading && !progress ? <EmptyState title="Đang tính tiến độ…" text="Đang đối chiếu dữ liệu bốn kỹ năng và sổ bài tập." /> : progress && !progress.students.length ? <EmptyState title="Chưa có dữ liệu tiến độ" text="Lớp chưa có học viên trong sổ điểm danh." /> : progress ? (
            <div className="acd-table-scroll" tabIndex={0} role="region" aria-label="Bảng tiến độ bốn kỹ năng, có thể cuộn ngang"><table className="acd-table acx-progress-table"><thead><tr><th>Học viên</th>{SKILLS.map((skill) => <th key={skill}>{SKILL_LABEL[skill]}</th>)}<th>Nộp đúng hạn</th><th>Hoạt động gần nhất</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>
              {progress.students.map((row) => <tr key={row.student_id}>
                <td><div className="acx-person"><strong>{row.name}</strong><span className={row.activated ? 'is-active' : 'is-warning'}>{row.activated ? row.student_code || 'Đã kích hoạt' : 'Chưa kích hoạt'}</span></div></td>
                {SKILLS.map((skill) => <td key={skill}><SkillCell value={row.skills[skill]} target={row.target_band} /></td>)}
                <td>{row.homework == null ? <span className="acd-unknown">Không đọc được</span> : row.homework.on_time_pct == null ? <span className="acd-muted">Chưa có bài nộp</span> : <div className="acx-punctual"><strong>{row.homework.on_time_pct}%</strong>{row.homework.missing > 0 && <span>{row.homework.missing} chưa nộp</span>}</div>}</td>
                <td>{formatActivity(latestSkillActivity(row.skills))}</td>
                <td><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => { const member = members.find((item) => item.student_id === row.student_id); openStudentWork({ student_id: row.student_id, name: row.name, student_code: row.student_code, user_id: member?.user_id || null }); }} disabled={busy}>Xem bài</button></td>
              </tr>)}
            </tbody></table></div>
          ) : null}
        </section>
      )}

      {tab === 'lessons' && (
        <section id="acx-panel-lessons" className="acd-workspace" role="tabpanel" aria-labelledby="acx-tab-lessons">
          <div className="acx-section-head"><div><p className="acd-eyebrow">Giáo trình của lớp</p><h2>Buổi học</h2><p>Học viên chỉ thấy những buổi đã đăng; bản nháp được giữ riêng.</p></div><button className="adm-btn-primary" type="button" onClick={() => setLessonEditor(lessonDraft() as LessonDraft)} disabled={busy}>Thêm buổi học</button></div>
          <div className="acx-lesson-summary"><strong>{lessons == null ? '—' : `${lessons.length} buổi`}</strong><span>{lessons == null ? 'Chưa đọc được trạng thái' : `${lessons.filter((lesson) => lesson.is_published).length} đã đăng`}</span></div>
          {lessonsError && <div className={lessons ? 'acd-warning' : 'acd-state is-error'} role="alert"><strong>Không đọc được dòng thời gian mới nhất</strong><span>{lessonsError}{lessons ? ' Danh sách dưới đây có thể đã cũ.' : ''}</span><button className="adm-btn-secondary" type="button" onClick={() => void loadLessons()} disabled={busy || lessonsLoading}>Thử lại</button></div>}
          {lessonsLoading && !lessons ? <EmptyState title="Đang tải buổi học…" text="Đang đọc dòng thời gian nội dung chuẩn." /> : lessons && !lessons.length ? <EmptyState title="Chưa có buổi học" text="Thêm buổi đầu tiên và lưu nháp trước khi đăng cho học viên." /> : lessons ? <div className="acx-lessons">
            {lessons.map((lesson) => <article className="acx-lesson" key={lesson.id}>
              <div className="acx-lesson-marker"><span>{lesson.lesson_no != null ? `Buổi ${lesson.lesson_no}` : 'Chưa số'}</span><i /></div>
              <div className="acx-lesson-card"><div className="acx-lesson-head"><div><div className="acx-lesson-title"><h3>{lesson.title}</h3><span className={`adm-status-pill ${lesson.is_published ? 'is-active' : 'is-archived'}`}>{lesson.is_published ? 'Đã đăng' : 'Bản nháp'}</span></div><p>{formatDate(lesson.lesson_date)}</p></div><div><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setLessonEditor(lessonDraft(lesson) as LessonDraft)} disabled={busy}>Sửa</button><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setConfirm({ kind: 'delete-lesson', lesson })} disabled={busy}>Xoá</button></div></div>
                {lesson.body_md && <p className="acx-lesson-body">{lesson.body_md}</p>}
                {lesson.attachments.length > 0 && <div className="acx-files">{lesson.attachments.map((file, index) => file.is_safe ? <a key={`${file.url}-${index}`} href={file.url} target="_blank" rel="noopener noreferrer">{file.label}</a> : <span className="acx-file-legacy" key={`${file.url}-${index}`}>{file.label || 'Tài liệu chưa đặt tên'} · liên kết cũ không mở được</span>)}</div>}
              </div>
            </article>)}
          </div> : null}
        </section>
      )}

      {tab === 'homework' && markingAssignment && (
        <AdminClassSubmissions
          cohortId={cohortId}
          assignment={markingAssignment}
          initialStudent={markingStudent}
          backLabel={studentWorkReturn ? `Quay lại bài của ${studentWorkReturn.subject.name}` : undefined}
          memberNames={Object.fromEntries(members.map((member) => [member.student_id, member.name]))}
          memberUserIds={Object.fromEntries(members.map((member) => [member.student_id, member.user_id]))}
          memberNamesAvailable={Boolean(roster)}
          onBack={closeSubmissions}
          onMutation={() => { setHomeworkRefreshKey((value) => value + 1); invalidateProgress(); }}
        />
      )}

      <AdminClassStudentWork cohortId={cohortId} subject={studentWorkSubject} onClose={closeStudentWork} onOpenAssignment={openStudentAssignment} />

      {tab === 'homework' && !markingAssignment && (
        <AdminClassHomework
          cohortId={cohortId}
          members={members}
          refreshKey={homeworkRefreshKey}
          onMutation={invalidateProgress}
          onOpenSubmissions={openSubmissions}
          onOpenAssignmentMissing={clearMissingAssignment}
          openAssignmentId={requestedAssignmentId}
        />
      )}

      <Dialog open={Boolean(cohortDraft)} title="Sửa thông tin lớp" description="Các trường tuỳ chọn để trống sẽ được xoá khỏi bản ghi khi lưu." busy={busy} onClose={() => setCohortDraft(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setCohortDraft(null)} disabled={busy}>Hủy</button><button className="adm-btn-primary" type="submit" form="acx-cohort-form" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button></>}>
        <form id="acx-cohort-form" className="acd-form" onSubmit={saveCohort}>
          <Field label="Tên lớp"><input autoFocus required maxLength={200} value={cohortDraft?.name || ''} onChange={(event) => cohortDraft && setCohortDraft({ ...cohortDraft, name: event.target.value, error: '' })} /></Field>
          <Field label="Khóa học" hint={coursesError ? 'Không đọc được danh mục; giá trị hiện tại được giữ nguyên.' : undefined}><select value={cohortDraft?.courseId || ''} onChange={(event) => cohortDraft && setCohortDraft({ ...cohortDraft, courseId: event.target.value, error: '' })} disabled={Boolean(coursesError)}><option value="">Chưa gán khoá</option>{cohortDraft?.courseId && !courses.some((item) => item.id === cohortDraft.courseId) && <option value={cohortDraft.courseId}>Khoá hiện tại (không đọc được tên)</option>}{courses.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ''}{item.name}{item.is_active ? '' : ' · đã lưu trữ'}</option>)}</select></Field>
          <Field label="Tiền tố mã"><input maxLength={20} value={cohortDraft?.codePrefix || ''} onChange={(event) => cohortDraft && setCohortDraft({ ...cohortDraft, codePrefix: event.target.value, error: '' })} /></Field>
          <Field label="Mô tả"><textarea rows={4} value={cohortDraft?.description || ''} onChange={(event) => cohortDraft && setCohortDraft({ ...cohortDraft, description: event.target.value, error: '' })} /></Field>
          {cohortDraft?.error && <div className="acd-inline-error" role="alert">{cohortDraft.error}</div>}
        </form>
      </Dialog>

      <Dialog open={memberPicker} title="Thêm học viên vào lớp" description="Thao tác này thêm một lớp đang học và không gỡ học viên khỏi các lớp khác. Tài khoản và mã truy cập không đổi." busy={busy} onClose={() => setMemberPicker(false)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setMemberPicker(false)} disabled={busy}>Hủy</button><button className="adm-btn-primary" type="submit" form="acx-member-form" disabled={busy || studentsLoading || !selectedStudent}>{busy ? 'Đang thêm…' : 'Thêm vào lớp'}</button></>}>
        <form id="acx-member-form" className="acd-form" onSubmit={addMember}>
          <Field label="Học viên" hint="Danh sách tối đa 200 hồ sơ; dùng Danh bạ học viên nếu cần tìm ngoài phạm vi này."><select autoFocus value={selectedStudent} onChange={(event) => { setSelectedStudent(event.target.value); setStudentsError(''); }} disabled={studentsLoading || busy}><option value="">{studentsLoading ? 'Đang tải…' : 'Chọn học viên'}</option>{students.map((student) => { const alreadyHere = student.cohorts.some((item) => item.id === cohortId); const names = student.cohorts.map((item) => item.name).filter(Boolean).join(', '); return <option key={student.id} value={student.id} disabled={alreadyHere}>{student.full_name} · {student.student_code}{alreadyHere ? ' · đã trong lớp' : names ? ` · đang học ${names}` : ''}{student.membership_lookup_failed || student.cohort_lookup_failed ? ' · ⚠ lớp chưa đọc đủ' : ''}</option>; })}</select></Field>
          {selectedStudentRow?.membership_lookup_failed || selectedStudentRow?.cohort_lookup_failed ? <div className="acd-warning">Không đọc được đầy đủ danh sách lớp hiện tại. Thao tác thêm vẫn an toàn và không gỡ lớp khác; hãy tải lại để xác nhận.</div> : null}
          {selectedStudentRow?.cohorts.length ? <div className="acd-note">Các lớp đang học sẽ được giữ nguyên: {selectedStudentRow.cohorts.map((item) => item.name || 'Lớp không đọc được tên').join(', ')}.</div> : null}
          {studentsError && <div className="acd-inline-error" role="alert">{studentsError}</div>}
        </form>
      </Dialog>

      <Dialog open={Boolean(lessonEditor)} title={lessonEditor?.id ? 'Sửa buổi học' : 'Thêm buổi học'} description="Tiêu đề là bắt buộc. Tắt trạng thái đăng để giữ nội dung ở bản nháp." busy={busy} onClose={() => setLessonEditor(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setLessonEditor(null)} disabled={busy}>Hủy</button><button className="adm-btn-primary" type="submit" form="acx-lesson-form" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu buổi học'}</button></>}>
        <form id="acx-lesson-form" className="acd-form" onSubmit={saveLesson}>
          <div className="acx-form-row"><Field label="Buổi số"><input type="number" min="1" step="1" value={lessonEditor?.lessonNo || ''} onChange={(event) => lessonEditor && setLessonEditor({ ...lessonEditor, lessonNo: event.target.value, error: '' })} /></Field><Field label="Ngày học"><input type="date" value={lessonEditor?.lessonDate || ''} onChange={(event) => lessonEditor && setLessonEditor({ ...lessonEditor, lessonDate: event.target.value, error: '' })} /></Field></div>
          <Field label="Tiêu đề"><input autoFocus required maxLength={300} value={lessonEditor?.title || ''} onChange={(event) => lessonEditor && setLessonEditor({ ...lessonEditor, title: event.target.value, error: '' })} /></Field>
          <Field label="Nội dung"><textarea rows={6} value={lessonEditor?.body || ''} onChange={(event) => lessonEditor && setLessonEditor({ ...lessonEditor, body: event.target.value, error: '' })} placeholder="Mục tiêu, nội dung đã học, việc cần chuẩn bị…" /></Field>
          <div className="acx-attachments"><div className="acx-attachments-head"><strong>Tài liệu</strong><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => lessonEditor && setLessonEditor({ ...lessonEditor, attachments: [...lessonEditor.attachments, { label: '', url: '', is_safe: true }], attachmentsTouched: true, error: '' })}>Thêm tài liệu</button></div>{lessonEditor?.attachments.map((attachment, index) => <div className="acx-attachment-row" key={index}><input aria-label={`Tên tài liệu ${index + 1}`} placeholder="Tên tài liệu" value={attachment.label} onChange={(event) => lessonEditor && setLessonEditor({ ...lessonEditor, attachments: lessonEditor.attachments.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value, is_safe: true } : item), attachmentsTouched: true, error: '' })} /><input aria-label={`Đường dẫn tài liệu ${index + 1}`} type="text" inputMode="url" placeholder="https://…" value={attachment.url} onChange={(event) => lessonEditor && setLessonEditor({ ...lessonEditor, attachments: lessonEditor.attachments.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value, is_safe: true } : item), attachmentsTouched: true, error: '' })} /><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => lessonEditor && setLessonEditor({ ...lessonEditor, attachments: lessonEditor.attachments.filter((_, itemIndex) => itemIndex !== index), attachmentsTouched: true, error: '' })}>Xoá</button></div>)}</div>
          <label className="acx-publish"><input type="checkbox" checked={Boolean(lessonEditor?.isPublished)} onChange={(event) => lessonEditor && setLessonEditor({ ...lessonEditor, isPublished: event.target.checked, error: '' })} /><span><strong>Hiển thị cho học viên</strong><small>Tắt để lưu bản nháp và đăng sau.</small></span></label>
          {lessonEditor?.error && <div className="acd-inline-error" role="alert">{lessonEditor.error}</div>}
        </form>
      </Dialog>

      <Dialog open={Boolean(confirm)} title={confirm?.kind === 'remove-member' ? 'Gỡ học viên khỏi lớp?' : 'Xoá buổi học?'} description={confirm?.kind === 'remove-member' ? <>Gỡ <strong>{confirm.member.name}</strong> khỏi sổ điểm danh. Tài khoản và lịch sử không bị xoá.</> : confirm?.kind === 'delete-lesson' ? <>Xoá <strong>{confirm.lesson.title}</strong>. Bài tập đã gắn vẫn tồn tại nhưng không còn liên kết buổi.</> : undefined} busy={busy} onClose={() => setConfirm(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirm(null)} disabled={busy}>Hủy</button><button className="adm-btn-primary" type="button" onClick={() => { if (confirm?.kind === 'remove-member') void removeMember(confirm.member); if (confirm?.kind === 'delete-lesson') void deleteLesson(confirm.lesson); }} disabled={busy}>{confirm?.kind === 'remove-member' ? 'Gỡ khỏi lớp' : 'Xoá buổi học'}</button></>} />
    </main>
  );
}
