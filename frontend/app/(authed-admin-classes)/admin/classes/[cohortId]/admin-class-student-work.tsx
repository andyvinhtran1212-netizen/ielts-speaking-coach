'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Dialog, messageOf } from '@/components/admin-directory-ui';
import { normalizeStudentWork, studentWorkAction } from '@/lib/admin-class-student-work-model.mjs';

import type { SubmissionAssignment, SubmissionStudent } from './admin-class-submissions-types';
import type { StudentWorkItem, StudentWorkPayload, StudentWorkSubject } from './admin-class-student-work-types';

const STATUS = {
  submitted: 'Đã nộp', late: 'Nộp trễ', missing: 'Không nộp', pending: 'Chưa nộp', 'no-account': 'Chưa kích hoạt',
} as Record<string, string>;
const SKILL = { speaking: 'Speaking', reading: 'Reading', listening: 'Listening', course: 'Theo khóa' } as Record<string, string>;

function formatVietnam(value: string | null) {
  if (!value) return 'Không đặt hạn';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Ngày không hợp lệ' : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function assignmentFrom(item: StudentWorkItem): SubmissionAssignment {
  return { id: item.assignment_id, title: item.title, skill: item.skill, status: item.archived ? 'archived' : 'published', due_at: item.due_at, content_id: item.bank_id };
}

export function AdminClassStudentWork({ cohortId, subject, onClose, onOpenAssignment }: {
  cohortId: string;
  subject: StudentWorkSubject | null;
  onClose: () => void;
  onOpenAssignment: (assignment: SubmissionAssignment, student: SubmissionStudent) => void;
}) {
  const [data, setData] = useState<StudentWorkPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    if (!subject) return;
    const requestId = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const normalized = normalizeStudentWork(
        await window.api.get<unknown>(`/admin/cohorts/${encodeURIComponent(cohortId)}/students/${encodeURIComponent(subject.student_id)}/work`),
        subject.student_id,
      ) as StudentWorkPayload | null;
      if (requestId !== sequence.current) return;
      if (!normalized) throw new Error('Dữ liệu bài của học viên không đúng định dạng.');
      setData(normalized);
    } catch (caught) {
      if (requestId === sequence.current) setError(messageOf(caught));
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, [cohortId, subject]);

  useEffect(() => {
    setData(null); setError(null);
    if (subject) void load();
    return () => { sequence.current += 1; };
  }, [subject?.student_id, load]);

  const counts = useMemo(() => {
    const items = data?.items || [];
    return { assigned: items.length, submitted: items.filter((item) => item.status === 'submitted' || item.status === 'late').length, missing: items.filter((item) => item.status === 'missing').length };
  }, [data]);

  return <Dialog
    open={Boolean(subject)}
    title={data?.student.name || subject?.name || 'Bài của học viên'}
    description={<span>{data?.student.student_code || subject?.student_code || 'Chưa có mã học viên'} · {data ? data.student.activated ? 'Đã kích hoạt' : 'Chưa kích hoạt' : subject?.user_id ? 'Đã kích hoạt' : 'Chưa kích hoạt'}</span>}
    panelClassName="acw-dialog"
    onClose={onClose}
    actions={<><button className="adm-btn-secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Đang tải…' : 'Tải lại'}</button><button className="adm-btn-primary" type="button" onClick={onClose}>Đóng</button></>}
  >
    {error && <div className={data ? 'acd-warning' : 'acd-state is-error'} role="alert"><strong>Không đọc được bài mới nhất</strong><span>{error}{data ? ' Danh sách dưới đây có thể đã cũ.' : ''}</span>{!data && <button className="adm-btn-secondary" type="button" onClick={() => void load()} disabled={loading}>Thử lại</button>}</div>}
    {loading && !data && <div className="acd-state" role="status"><strong>Đang đối chiếu bài đã giao…</strong><span>Hệ thống đang đọc sổ bài tập chuẩn của học viên.</span></div>}
    {data && <div className="acw-content">
      <dl className="acw-summary" aria-label="Tóm tắt bài tập của học viên"><div><dt>Được giao</dt><dd>{counts.assigned}</dd></div><div><dt>Đã nộp</dt><dd>{counts.submitted}</dd></div><div><dt>Không nộp</dt><dd>{counts.missing}</dd></div></dl>
      {data.homework_stale && <div className="acd-warning" role="alert">Chưa đối chiếu được một phần dữ liệu. Danh sách hoặc trạng thái bên dưới có thể còn thiếu.</div>}
      {data.discarded_item_count > 0 && <div className="acd-warning" role="alert">Có {data.discarded_item_count} bài trả về sai định dạng nên chưa thể hiển thị.</div>}
      {!data.items.length ? <div className="acd-state"><strong>Chưa được giao bài nào</strong><span>Chỉ những bài thực sự có phần của học viên trong lớp mới xuất hiện tại đây.</span></div> : <div className="acw-list" aria-label="Bài đã giao">
        {data.items.map((item) => { const action = studentWorkAction(item); return <article key={item.assignment_id} className="acw-item" data-status={item.status}>
          <i aria-hidden="true" />
          <div className="acw-item-main"><div className="acw-item-title"><h3>{item.title}</h3>{item.archived && <span className="adm-status-pill is-archived">Đã đóng</span>}</div><p>{SKILL[item.skill] || item.skill} · Hạn {formatVietnam(item.due_at)}</p>{item.submitted_at && <small>Nộp {formatVietnam(item.submitted_at)}</small>}</div>
          <div className="acw-result"><span className={`adm-status-pill ${item.status === 'submitted' ? 'is-active' : item.status === 'late' || item.status === 'missing' ? 'is-warning' : 'is-archived'}`}>{STATUS[item.status] || item.status}</span>{item.score != null && <strong>{item.skill === 'course' ? `${Math.round(item.score)}%` : item.score.toFixed(1)}</strong>}</div>
          <div className="acw-action">{action?.kind === 'external' ? <a className="adm-btn-secondary adm-btn-sm" href={action.href} target="_blank" rel="noopener noreferrer">{action.label}</a> : action ? <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => onOpenAssignment(assignmentFrom(item), { studentId: subject!.student_id, userId: subject!.user_id, name: data.student.name || subject!.name, hasWriting: item.has_writing })}>{action.label}</button> : <span>Chưa có bài để mở</span>}</div>
        </article>; })}
      </div>}
    </div>}
  </Dialog>;
}
