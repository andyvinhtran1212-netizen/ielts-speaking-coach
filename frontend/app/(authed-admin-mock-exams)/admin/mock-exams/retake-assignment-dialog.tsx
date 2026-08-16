'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { messageOf } from '@/components/admin-directory-ui';
import {
  localDateTimeIn,
  localToIso,
  normalizeAssignments,
  normalizeRetestSummary,
  retakeServableSkills,
} from '@/lib/admin-mock-exams-model.mjs';

type Exam = {
  id: string; code: string; title: string; status: string; cohortId: string | null;
  listeningTestId: string | null; readingTestId: string | null;
};
type Cohort = { id: string; name?: string };
type Candidate = { userId: string; studentName: string; skills: string[] };
type Assignment = Candidate & { openFrom: string | null; openUntil: string | null };
type Props = {
  exam: Exam;
  exams: Exam[];
  cohorts: Cohort[];
  onClose: () => void;
  onChanged: () => Promise<void>;
};

const SKILLS = [
  { id: 'listening', label: 'Listening' },
  { id: 'reading', label: 'Reading' },
  { id: 'writing', label: 'Writing' },
];

export function RetakeAssignmentDialog({ exam, exams, cohorts, onClose, onChanged }: Props) {
  const [sourceId, setSourceId] = useState('');
  const [openFrom, setOpenFrom] = useState('');
  const [openUntil, setOpenUntil] = useState(() => localDateTimeIn(7));
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const assignmentRequestRef = useRef(0);
  const candidateRequestRef = useRef(0);
  const servable = useMemo(() => retakeServableSkills(exam), [exam]);
  const cohortNames = useMemo(() => new Map(cohorts.map((row) => [row.id, row.name || row.id])), [cohorts]);
  const sources = exams.filter((row) => row.id !== exam.id && row.status === 'published');

  const loadAssignments = async () => {
    const request = ++assignmentRequestRef.current;
    const normalized = normalizeAssignments(await window.api.get<unknown>(`/admin/mock-exams/${encodeURIComponent(exam.id)}/assignments`));
    if (request !== assignmentRequestRef.current) return false;
    if (!normalized) throw new Error('Danh sách assignment sai contract.');
    setAssignments(normalized as Assignment[]);
    return true;
  };

  useEffect(() => {
    let dead = false;
    const request = ++assignmentRequestRef.current;
    (async () => {
      try {
        const normalized = normalizeAssignments(await window.api.get<unknown>(`/admin/mock-exams/${encodeURIComponent(exam.id)}/assignments`));
        if (!dead && request === assignmentRequestRef.current) {
          if (!normalized) throw new Error('Danh sách assignment sai contract.');
          setAssignments(normalized as Assignment[]);
          setError(null);
        }
      } catch (caught) {
        if (!dead && request === assignmentRequestRef.current) setError(messageOf(caught));
      } finally {
        if (!dead && request === assignmentRequestRef.current) setLoadingAssignments(false);
      }
    })();
    return () => { dead = true; assignmentRequestRef.current += 1; candidateRequestRef.current += 1; };
  }, [exam.id]);

  const chooseSource = async (value: string) => {
    const request = ++candidateRequestRef.current;
    setSourceId(value);
    setCandidates([]);
    setPicked({});
    setWarning(null);
    if (!value) { setLoadingCandidates(false); return; }
    setLoadingCandidates(true);
    try {
      const rows = normalizeRetestSummary(await window.api.get<unknown>(`/admin/mock-exams/${encodeURIComponent(value)}/retest-summary`));
      if (request !== candidateRequestRef.current) return;
      if (!rows) throw new Error('Danh sách học viên test lại sai contract.');
      setCandidates(rows as Candidate[]);
      setPicked(Object.fromEntries((rows as Candidate[]).map((row) => [row.userId, row.skills.filter((skill) => servable.includes(skill))])));
      setError(null);
    } catch (caught) {
      if (request === candidateRequestRef.current) setError(messageOf(caught));
    } finally {
      if (request === candidateRequestRef.current) setLoadingCandidates(false);
    }
  };

  const toggleStudent = (userId: string, enabled: boolean) => {
    setPicked((current) => ({ ...current, [userId]: enabled ? candidates.find((row) => row.userId === userId)?.skills.filter((skill) => servable.includes(skill)) || [] : [] }));
  };
  const toggleSkill = (userId: string, skill: string, enabled: boolean) => {
    setPicked((current) => {
      const skills = new Set(current[userId] || []);
      if (enabled) skills.add(skill); else skills.delete(skill);
      return { ...current, [userId]: [...skills] };
    });
  };

  const assign = async () => {
    const until = localToIso(openUntil);
    const from = localToIso(openFrom);
    if (!until) return setError('Phải đặt hạn đóng hợp lệ để bài vắng mặt được thu.');
    if (from && new Date(until) < new Date(from)) return setError('Hạn đóng không được sớm hơn giờ mở.');
    const rows = Object.entries(picked).filter(([, skills]) => skills.length).map(([userId, skills]) => ({ user_id: userId, skills, open_from: from, open_until: until }));
    if (!rows.length) return setError('Chọn ít nhất một học viên và kỹ năng.');
    setBusy(true);
    setError(null);
    try {
      const response = await window.api.post<{ assigned?: string[]; skipped?: string[]; locked?: string[]; refresh_failed?: string[] }>(`/admin/mock-exams/${encodeURIComponent(exam.id)}/assignments`, { assignments: rows, source_exam_id: sourceId || null });
      const names = new Map(candidates.map((row) => [row.userId, row.studentName]));
      const locked = Array.isArray(response?.locked) ? response.locked : [];
      const failed = Array.isArray(response?.refresh_failed) ? response.refresh_failed : [];
      setWarning([
        locked.length ? `Đang làm bài, giữ assignment cũ: ${locked.map((id) => names.get(id) || id).join(', ')}.` : '',
        failed.length ? `Không làm mới được lượt thi: ${failed.map((id) => names.get(id) || id).join(', ')}.` : '',
      ].filter(Boolean).join(' '));
      if (!await loadAssignments()) throw new Error('Không xác nhận được assignment sau khi ghi.');
      await onChanged();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const unassign = async (row: Assignment) => {
    if (!window.confirm(`Gỡ assignment test lại của ${row.studentName}? Lượt đang làm có thể bị void theo luật backend.`)) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.delete<unknown>(`/admin/mock-exams/${encodeURIComponent(exam.id)}/assignments/${encodeURIComponent(row.userId)}`);
      if (!await loadAssignments()) throw new Error('Không xác nhận được trạng thái sau khi gỡ assignment.');
      await onChanged();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mex-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="mex-dialog" role="dialog" aria-modal="true" aria-labelledby="mex-assign-title">
        <div className="mex-dialog-head"><div><p className="mex-kicker">Retake assignment</p><h2 id="mex-assign-title">Gán test lại · {exam.code}</h2></div><button className="adm-btn-secondary" type="button" onClick={onClose} disabled={busy}>Đóng</button></div>
        {error && <div className="mex-alert is-error" role="alert">{error}</div>}
        {warning && <div className="mex-alert is-warning" role="alert">{warning}</div>}
        <div className="mex-dialog-grid">
          <label><span>Đề gốc</span><select value={sourceId} onChange={(event) => void chooseSource(event.target.value)} disabled={busy}><option value="">Chọn đề có kết quả cần test lại</option>{sources.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.title}{row.cohortId ? ` · ${cohortNames.get(row.cohortId) || row.cohortId}` : ''}</option>)}</select></label>
          <label><span>Mở từ</span><input type="datetime-local" value={openFrom} onChange={(event) => setOpenFrom(event.target.value)} /></label>
          <label><span>Đóng lúc *</span><input type="datetime-local" value={openUntil} onChange={(event) => setOpenUntil(event.target.value)} required /></label>
        </div>
        <p className="mex-help">Kỹ năng phục vụ được: {servable.join(', ')}. Kỹ năng thiếu đề bị khóa trước khi gửi.</p>
        <div className="mex-table-wrap">
          {loadingCandidates ? <p role="status">Đang tải học viên…</p> : !sourceId ? <p>Chọn đề gốc để hiện học viên cần test lại.</p> : !candidates.length ? <p>Không có học viên được đánh dấu test lại.</p> : (
            <table className="mex-table"><thead><tr><th>Chọn</th><th>Học viên</th>{SKILLS.map((skill) => <th key={skill.id}>{skill.label}</th>)}</tr></thead><tbody>{candidates.map((row) => {
              const active = (picked[row.userId] || []).length > 0;
              return <tr key={row.userId}><td><input aria-label={`Chọn ${row.studentName}`} type="checkbox" checked={active} onChange={(event) => toggleStudent(row.userId, event.target.checked)} /></td><td>{row.studentName}</td>{SKILLS.map((skill) => <td key={skill.id}><input aria-label={`${row.studentName} · ${skill.label}`} type="checkbox" disabled={!servable.includes(skill.id)} checked={(picked[row.userId] || []).includes(skill.id)} onChange={(event) => toggleSkill(row.userId, skill.id, event.target.checked)} /></td>)}</tr>;
            })}</tbody></table>
          )}
        </div>
        <div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void assign()} disabled={busy || loadingCandidates || !sourceId}>{busy ? 'Đang ghi…' : 'Gán assignment đã chọn'}</button></div>
        <div className="mex-current"><h3>Assignment hiện tại</h3>{loadingAssignments ? <p role="status">Đang tải assignment…</p> : !assignments.length ? <p>Chưa gán học viên nào.</p> : <ul>{assignments.map((row) => <li key={row.userId}><span><strong>{row.studentName}</strong><small>{row.skills.join(', ')}{row.openUntil ? ` · hạn ${new Date(row.openUntil).toLocaleString('vi-VN')}` : ''}</small></span><button className="adm-btn-secondary" type="button" onClick={() => void unassign(row)} disabled={busy}>Gỡ</button></li>)}</ul>}</div>
      </section>
    </div>
  );
}
