'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { messageOf } from '@/components/admin-directory-ui';
import {
  clockSeconds,
  filterLiveStudents,
  liveStudentNeedsAttention,
  nextConfiguredSection,
  normalizeLiveSnapshot,
  normalizePublishedExams,
} from '@/lib/admin-mock-live-model.mjs';
import { VoidSittingDialog } from './void-sitting-dialog';

type ExamOption = { id: string; code: string; title: string; examMode: string; isOpen: boolean };
type StudentSection = { state: string; answered: number | null; total: number | null; submittedAt: string | null; lastActivityAt: string | null; live: boolean; stalled: boolean };
type Student = {
  userId: string | null; studentName: string; sittingId: string | null; status: string; started: boolean;
  inRoster: boolean; needsRetest: boolean; sections: Record<string, StudentSection>;
  speaking: { required: boolean; count: number; completedAt: string | null };
  integrity: { blurCount: number; blurSeconds: number; offlineEvents: number; resumes: number };
};
type Rollup = { submitted: number; working: number; absent: number; missed: number; expected: number };
type Snapshot = {
  exam: { id: string; code: string; title: string; examMode: string; status: string; isOpen: boolean; activeSection: string; collectedSection: string | null; sectionTimeLeftSeconds: number | null; configuredSections: string[] };
  roster: { expected: number | null; started: number; notStarted: string[]; offRoster: string[] };
  sections: Record<string, Rollup>; students: Student[]; serverTime: string | null;
};
type Notice = { kind: 'success' | 'warning' | 'error'; message: string };
type VoidTarget = { sittingId: string; studentName: string };

const LABEL: Record<string, string> = {
  not_started: 'Chưa bắt đầu', listening: 'Listening', reading: 'Reading', writing: 'Writing', done: 'Đã xong',
};
const FILTERS = [
  ['all', 'Tất cả'], ['working', 'Đang làm'], ['problem', 'Cần chú ý'], ['absent', 'Chưa vào'],
] as const;

function fmtClock(value: number | null) {
  if (value == null) return '—';
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : minutes}:${String(rest).padStart(2, '0')}`;
}

function fmtTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function studentIntegrity(student: Student) {
  const bits: string[] = [];
  if (student.integrity.blurCount) bits.push(`rời tab ${student.integrity.blurCount}×${student.integrity.blurSeconds ? ` (${Math.round(student.integrity.blurSeconds / 60)}p)` : ''}`);
  if (student.integrity.offlineEvents) bits.push(`mất mạng ${student.integrity.offlineEvents}×`);
  if (student.integrity.resumes) bits.push(`vào lại ${student.integrity.resumes}×`);
  return bits.join(' · ');
}

function SectionCell({ section }: { section?: StudentSection }) {
  if (!section) return <span className="mlv-cell-note">—</span>;
  if (section.state === 'absent') return <span className="mlv-cell"><i className="mlv-dot is-absent" /><span className="mlv-cell-note">chưa vào</span></span>;
  if (section.state === 'waiting') return <span className="mlv-cell"><i className="mlv-dot is-waiting" /><span className="mlv-cell-note">chờ mở</span></span>;
  if (section.state === 'missed') return <span className="mlv-cell"><i className="mlv-dot is-missed" /><b className="mlv-flag is-blank">chưa thu</b></span>;
  if (section.state === 'submitted') return <span className="mlv-cell"><i className="mlv-dot is-submitted" /><span className="mlv-cell-note">nộp {fmtTime(section.submittedAt)}</span></span>;
  if (!section.live) return <span className="mlv-cell"><i className="mlv-dot is-working" /><span className="mlv-cell-note">đang làm · chưa có tín hiệu live</span></span>;
  return <span className="mlv-cell"><i className="mlv-dot is-working" /><span className="mlv-cell-number">{section.answered == null ? '—' : section.answered}{section.total ? `/${section.total}` : ''}</span>{section.answered === 0 ? <b className="mlv-flag is-blank">trắng</b> : section.stalled ? <b className="mlv-flag is-stalled">im</b> : null}{section.lastActivityAt && <span className="mlv-cell-note">{fmtTime(section.lastActivityAt)}</span>}</span>;
}

export function AdminMockLive({ initialExamId, embedded }: { initialExamId: string; embedded: boolean }) {
  const profile = useAdminProfile();
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [examId, setExamId] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [filter, setFilter] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const accountRef = useRef(profile.id);
  const selectedRef = useRef('');
  const snapshotRef = useRef<Snapshot | null>(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const clockAnchorRef = useRef<{ seconds: number | null; at: number } | null>(null);
  accountRef.current = profile.id;
  selectedRef.current = examId;
  snapshotRef.current = snapshot;
  busyRef.current = Boolean(busyKey);

  const loadSnapshot = useCallback(async (wanted: string, silent = false): Promise<Snapshot | null> => {
    if (!wanted) return null;
    const request = ++requestRef.current;
    const account = profile.id;
    if (!silent) setLoading(true);
    try {
      const normalized = normalizeLiveSnapshot(await window.api.get<unknown>(`/admin/mock-exams/${encodeURIComponent(wanted)}/live`)) as Snapshot | null;
      if (request !== requestRef.current || accountRef.current !== account || selectedRef.current !== wanted) return null;
      if (!normalized || normalized.exam.id !== wanted) throw new Error('Bảng phòng thi sai contract hoặc không khớp kỳ thi đang chọn.');
      setRefreshError('');
      snapshotRef.current = normalized;
      setSnapshot(normalized);
      clockAnchorRef.current = { seconds: normalized.exam.sectionTimeLeftSeconds, at: Date.now() };
      setClockNow(Date.now());
      return normalized;
    } catch (caught) {
      if (request === requestRef.current && accountRef.current === account && selectedRef.current === wanted) {
        setRefreshError(`${snapshotRef.current ? 'Không làm mới được; đang giữ snapshot cũ. ' : 'Không tải được phòng thi. '}${messageOf(caught)}`);
      }
      return null;
    } finally {
      if (request === requestRef.current && accountRef.current === account && selectedRef.current === wanted) setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    let dead = false;
    const account = profile.id;
    setLoading(true); setNotice(null); setRefreshError(''); setSnapshot(null); snapshotRef.current = null; setExams([]); setExamId(''); selectedRef.current = '';
    (async () => {
      try {
        const normalized = normalizePublishedExams(await window.api.get<unknown>('/admin/mock-exams')) as ExamOption[] | null;
        if (dead || accountRef.current !== account) return;
        if (!normalized) throw new Error('Danh sách đề published sai contract.');
        setExams(normalized);
        const requested = initialExamId.trim();
        if (requested && !normalized.some((exam) => exam.id === requested)) {
          setNotice({ kind: 'error', message: embedded ? 'Không mở được kỳ này. Chọn một đề đã publish ở rail bên trái.' : 'Kỳ thi trong URL chưa publish, đã archive hoặc không tồn tại. Chọn lại từ danh sách.' });
          setLoading(false);
          return;
        }
        const chosen = requested || normalized[0]?.id || '';
        if (!chosen) {
          setNotice({ kind: 'warning', message: 'Chưa có đề published để theo dõi.' });
          setLoading(false);
          return;
        }
        selectedRef.current = chosen;
        setExamId(chosen);
        if (!requested && !embedded) window.history.replaceState(null, '', `/admin/mock-live?exam_id=${encodeURIComponent(chosen)}`);
        await loadSnapshot(chosen);
      } catch (caught) {
        if (!dead && accountRef.current === account) {
          setNotice({ kind: 'error', message: `Không tải được danh sách đề: ${messageOf(caught)}` });
          setLoading(false);
        }
      }
    })();
    return () => { dead = true; requestRef.current += 1; };
  }, [embedded, initialExamId, loadSnapshot, profile.id]);

  useEffect(() => {
    if (!examId || !autoRefresh) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !busyRef.current) void loadSnapshot(examId, true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, examId, loadSnapshot]);

  useEffect(() => {
    if (!snapshot || snapshot.exam.examMode === 'retake' || snapshot.exam.collectedSection === snapshot.exam.activeSection || snapshot.exam.sectionTimeLeftSeconds == null) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  const changeExam = (nextId: string) => {
    if (!nextId || nextId === examId || busyRef.current) return;
    requestRef.current += 1;
    selectedRef.current = nextId;
    snapshotRef.current = null;
    setExamId(nextId); setSnapshot(null); setFilter('all'); setNotice(null); setRefreshError(''); setLoading(true);
    window.history.replaceState(null, '', `/admin/mock-live?exam_id=${encodeURIComponent(nextId)}`);
    void loadSnapshot(nextId);
  };

  const reconcileMutation = async (key: string, operation: () => Promise<unknown>, postcondition: (next: Snapshot) => boolean, success: string) => {
    if (!examId || busyRef.current) return false;
    setBusyKey(key); setNotice(null);
    let operationError: unknown = null;
    try {
      try { await operation(); } catch (caught) { operationError = caught; }
      const canonical = await loadSnapshot(examId);
      if (!canonical) {
        setNotice({ kind: 'error', message: 'Yêu cầu có thể đã được ghi nhưng chưa xác nhận được trạng thái backend. Không thao tác lại; tải lại để đối chiếu.' });
        return false;
      }
      if (postcondition(canonical)) {
        setNotice({ kind: 'success', message: operationError ? `${success} Backend đã xác nhận dù phản hồi ban đầu bị gián đoạn.` : success });
        return true;
      }
      setNotice({ kind: 'error', message: operationError ? messageOf(operationError) : 'Backend không xác nhận thay đổi vừa yêu cầu.' });
      return false;
    } finally { setBusyKey(''); }
  };

  const toggleOpen = async () => {
    if (!snapshot) return;
    const exam = snapshot.exam;
    const next = !exam.isOpen;
    if (!window.confirm(`${next ? 'MỞ' : 'ĐÓNG'} kỳ thi “${exam.code} — ${exam.title}”?`)) return;
    await reconcileMutation('open', () => window.api.post(`/admin/mock-exams/${encodeURIComponent(exam.id)}/open`, { is_open: next }), (value) => value.exam.isOpen === next, next ? 'Đã mở kỳ thi.' : 'Đã đóng kỳ thi.');
  };

  const collect = async () => {
    if (!snapshot) return;
    const exam = snapshot.exam;
    const summary = snapshot.sections[exam.activeSection];
    const pending = summary?.working || 0;
    if (!window.confirm(`THU BÀI ${LABEL[exam.activeSection]} của kỳ “${exam.code}”${pending ? ` — ${pending} học viên đang làm sẽ bị thu tự động` : ''}?\n\nCả lớp sẽ vào phòng chờ không có đồng hồ. Hành động này không hoàn tác được.`)) return;
    await reconcileMutation('collect', () => window.api.post(`/admin/mock-exams/${encodeURIComponent(exam.id)}/collect?from_section=${encodeURIComponent(exam.activeSection)}`, {}), (value) => value.exam.activeSection === exam.activeSection && value.exam.collectedSection === exam.activeSection, `Đã đóng phần ${LABEL[exam.activeSection]} và xếp hàng thu bài.`);
  };

  const advance = async () => {
    if (!snapshot) return;
    const exam = snapshot.exam;
    const next = nextConfiguredSection(exam);
    if (!next) return;
    const pending = snapshot.sections[exam.activeSection]?.working || 0;
    const message = exam.activeSection === 'not_started'
      ? `Bắt đầu kỳ “${exam.code}” và mở ${LABEL[next]} cho cả lớp?`
      : `Mở ${LABEL[next]} của kỳ “${exam.code}”?${pending ? ` ${pending} học viên chưa nộp ${LABEL[exam.activeSection]} sẽ bị thu tự động.` : ''}`;
    if (!window.confirm(`${message}\n\nHành động này không hoàn tác được.`)) return;
    await reconcileMutation('advance', () => window.api.post(`/admin/mock-exams/${encodeURIComponent(exam.id)}/advance`, { from_section: exam.activeSection }), (value) => value.exam.activeSection === next, `Đã chuyển sang ${LABEL[next]}.`);
  };

  const recollect = async (section: string) => {
    if (!snapshot || busyRef.current) return;
    const exam = snapshot.exam;
    if (!window.confirm(`Thu lại ${LABEL[section]} của kỳ “${exam.code}”? Các bài chưa thu sẽ được xếp hàng xử lý theo hiện trạng.`)) return;
    setBusyKey(`recollect:${section}`); setNotice(null);
    try {
      let acked = false;
      let operationError: unknown = null;
      try {
        const ack = await window.api.post<unknown>(`/admin/mock-exams/${encodeURIComponent(exam.id)}/collect?section=${encodeURIComponent(section)}&from_section=${encodeURIComponent(exam.activeSection)}`, {});
        acked = Boolean(ack && typeof ack === 'object' && (ack as Record<string, unknown>).queued === true && (ack as Record<string, unknown>).section === section);
        if (!acked) operationError = new Error('ACK thu lại sai contract.');
      } catch (caught) { operationError = caught; }
      const canonical = await loadSnapshot(exam.id);
      if (!canonical) setNotice({ kind: 'error', message: 'Lệnh thu lại có thể đã được nhận nhưng chưa tải được trạng thái canonical. Không bấm lại; chờ poll kế tiếp.' });
      else if (acked) setNotice({ kind: 'success', message: `Đã xếp hàng thu lại ${LABEL[section]}; số “chưa thu” sẽ giảm theo dữ liệu backend.` });
      else setNotice({ kind: 'error', message: `${messageOf(operationError)} Không tự gửi lại để tránh chạy hai sweep đồng thời.` });
    } finally { setBusyKey(''); }
  };

  const confirmVoid = async (reason: string) => {
    if (!voidTarget || !snapshot) return;
    const target = voidTarget;
    const closed = await reconcileMutation(`void:${target.sittingId}`, () => window.api.post(`/admin/mock-exams/sittings/${encodeURIComponent(target.sittingId)}/void`, { reason }), (value) => !value.students.some((student) => student.sittingId === target.sittingId), `Đã huỷ lượt thi của ${target.studentName}.`);
    if (closed) setVoidTarget(null);
  };

  const visibleStudents = useMemo(() => snapshot ? filterLiveStudents(snapshot.students, filter) as Student[] : [], [filter, snapshot]);
  const filterCounts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, snapshot ? filterLiveStudents(snapshot.students, key).length : 0])), [snapshot]);
  const problems = snapshot ? snapshot.students.filter(liveStudentNeedsAttention).length : 0;
  const paused = Boolean(snapshot && snapshot.exam.examMode !== 'retake' && snapshot.exam.collectedSection === snapshot.exam.activeSection);
  const seconds = paused ? null : clockSeconds(clockAnchorRef.current, clockNow);
  const speakingShown = snapshot?.students.some((student) => student.speaking.required) || false;
  const nextSection = snapshot ? nextConfiguredSection(snapshot.exam) : null;

  return (
    <main className="mlv-shell">
      {!embedded && <header className="mlv-hero"><div><p className="mlv-kicker">Mock Test · Live operations</p><h1>Phòng thi trực tiếp</h1><p>Theo dõi tín hiệu máy chủ theo từng học viên; mọi thao tác điều phối được đối chiếu lại với backend.</p></div><div className="mlv-hero-actions"><a className="adm-btn-secondary" href="/admin/mock-exams">Quản lý đề</a><a className="adm-btn-secondary" href="/admin/mock-tests?tab=review">Duyệt bài</a></div></header>}

      <section className="mlv-toolbar" aria-label="Điều khiển cập nhật">
        {!embedded && <label>Kỳ thi<select value={examId} onChange={(event) => changeExam(event.target.value)} disabled={Boolean(busyKey)}><option value="">Chọn kỳ thi</option>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.code || exam.id} — {exam.title}{exam.examMode === 'retake' ? ' [test lại]' : exam.isOpen ? ' · ĐANG MỞ' : ' · đóng'}</option>)}</select></label>}
        <label className="mlv-check"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} /> Tự cập nhật (5s)</label>
        <button type="button" className="adm-btn-secondary" onClick={() => void loadSnapshot(examId)} disabled={!examId || Boolean(busyKey) || loading}>Cập nhật ngay</button>
      </section>

      {notice && <div className={`mlv-alert is-${notice.kind}`} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.message}</div>}
      {refreshError && <div className="mlv-alert is-error" role="alert">{refreshError}</div>}
      {loading && !snapshot && <div className="mlv-state" role="status">Đang tải snapshot phòng thi…</div>}
      {!loading && !snapshot && !notice && <div className="mlv-state">Chưa có kỳ thi để hiển thị.</div>}

      {snapshot && <>
        <section className="mlv-identity">
          <div className="mlv-identity-top"><span className="mlv-code">{snapshot.exam.code || snapshot.exam.id}</span><span>{snapshot.exam.title}</span><span className={`mlv-pill ${snapshot.exam.isOpen ? 'is-live' : ''}`}>{snapshot.exam.isOpen ? 'Đang mở' : 'Đã đóng'}</span><span className="mlv-pill">{snapshot.exam.examMode === 'retake' ? 'Test lại' : 'Sequential'}</span><span className="mlv-pill">{LABEL[snapshot.exam.activeSection]}</span>{snapshot.roster.offRoster.length > 0 && <span className="mlv-pill is-warning">{snapshot.roster.offRoster.length} ngoài danh sách</span>}</div>
          <div className="mlv-identity-main">
            {snapshot.exam.examMode !== 'retake' && <div><span className="mlv-clock-label">{paused ? `Đã thu ${LABEL[snapshot.exam.activeSection]} · đang nghỉ` : `Còn lại · ${LABEL[snapshot.exam.activeSection]}`}</span><strong className={`mlv-clock ${seconds != null && seconds <= 120 ? 'is-low' : ''}`}>{fmtClock(seconds)}</strong></div>}
            <div className="mlv-actions">
              {snapshot.exam.examMode !== 'retake' && <>
                {!(snapshot.exam.activeSection === 'done' && !snapshot.exam.isOpen) ? <button type="button" className="adm-btn-secondary" onClick={() => void toggleOpen()} disabled={Boolean(busyKey)}>{snapshot.exam.isOpen ? 'Đóng kỳ' : 'Mở kỳ'}</button> : <span className="mlv-ended">Kỳ thi đã kết thúc</span>}
                {snapshot.exam.activeSection !== 'done' && snapshot.exam.activeSection !== 'not_started' && !paused && (snapshot.sections[snapshot.exam.activeSection]?.working || 0) > 0 && <button type="button" className="adm-btn-primary" onClick={() => void collect()} disabled={Boolean(busyKey)}>Thu bài ({snapshot.sections[snapshot.exam.activeSection].working} đang làm)</button>}
                {snapshot.exam.activeSection !== 'done' && snapshot.exam.activeSection !== 'not_started' && !paused && (snapshot.sections[snapshot.exam.activeSection]?.working || 0) === 0 && <span className="mlv-pill is-live">Đã thu đủ</span>}
                {nextSection && <button type="button" className="adm-btn-primary" onClick={() => void advance()} disabled={Boolean(busyKey)}>{snapshot.exam.activeSection === 'not_started' ? `Bắt đầu · mở ${LABEL[nextSection]}` : `Mở ${LABEL[nextSection]} →`}</button>}
              </>}
              <a className="adm-btn-secondary" href={`/admin/mock-tests?tab=review&exam_id=${encodeURIComponent(snapshot.exam.id)}`}>Duyệt bài →</a>
            </div>
          </div>
        </section>

        {snapshot.exam.configuredSections.filter((section) => snapshot.sections[section]?.missed > 0).map((section) => <div className="mlv-missed" key={section} role="alert"><span>⚠ <b>{LABEL[section]}</b> còn <b>{snapshot.sections[section].missed}</b> bài chưa thu vì sweep bị gián đoạn.</span><button type="button" className="adm-btn-danger" onClick={() => void recollect(section)} disabled={Boolean(busyKey)}>Thu lại {LABEL[section]}</button></div>)}

        <section className="mlv-stats" aria-label="Tổng quan phòng thi">
          <article><span>Danh sách lớp</span><strong>{snapshot.roster.expected == null ? '—' : snapshot.roster.expected}</strong><small>{snapshot.roster.expected == null ? 'Đề không gắn lớp' : 'học viên được xếp thi'}</small></article>
          <article className={snapshot.roster.expected != null && snapshot.roster.started < snapshot.roster.expected ? 'is-alert' : ''}><span>Đã vào thi</span><strong>{snapshot.roster.started}</strong><small>{snapshot.roster.expected == null ? 'roster chưa xác định' : `vắng ${Math.max(0, snapshot.roster.expected - snapshot.roster.started)}`}</small></article>
          <article className={problems ? 'is-alert' : ''}><span>Cần chú ý</span><strong>{problems}</strong><small>trắng / im / chưa vào / chưa thu</small></article>
          {snapshot.exam.configuredSections.map((section) => <article className={snapshot.sections[section].missed ? 'is-alert' : ''} key={section}><span>{LABEL[section]}</span><strong>{snapshot.sections[section].submitted}/{snapshot.sections[section].expected}</strong><small>{snapshot.sections[section].missed ? `${snapshot.sections[section].missed} bài chưa thu` : 'đã nộp'}</small></article>)}
        </section>

        <section className="mlv-filterbar" aria-label="Lọc học viên">{FILTERS.map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label} <span>{filterCounts[key]}</span></button>)}</section>
        <div className="mlv-table-wrap"><table className="mlv-table"><thead><tr><th>Học viên</th>{snapshot.exam.configuredSections.map((section) => <th key={section}>{LABEL[section]}</th>)}{speakingShown && <th>Speaking</th>}<th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{visibleStudents.length ? visibleStudents.map((student) => <tr key={student.sittingId || student.userId || student.studentName} className={`${!student.started ? 'is-absent' : ''} ${!student.inRoster ? 'is-offroster' : ''}`}><td><b>{student.studentName}</b>{!student.inRoster && <span className="mlv-pill is-warning">ngoài DS</span>}{student.needsRetest && <span className="mlv-pill">cần test lại</span>}</td>{snapshot.exam.configuredSections.map((section) => <td key={section}><SectionCell section={student.sections[section]} /></td>)}{speakingShown && <td>{!student.speaking.required ? '—' : student.speaking.completedAt ? <span className="mlv-cell"><i className="mlv-dot is-submitted" />{fmtTime(student.speaking.completedAt)}</span> : <span className="mlv-cell"><i className="mlv-dot is-waiting" />{student.speaking.count} phần</span>}</td>}<td><span>{student.status}</span>{studentIntegrity(student) && <small>{studentIntegrity(student)}</small>}</td><td>{student.sittingId && <div className="mlv-row-actions"><a className="mlv-row-link" href={`/admin/mock-pacing?sitting=${encodeURIComponent(student.sittingId)}`}>Nhịp làm bài</a>{student.status !== 'released' && <button type="button" onClick={() => setVoidTarget({ sittingId: student.sittingId!, studentName: student.studentName })} disabled={Boolean(busyKey)}>Huỷ lượt</button>}</div>}</td></tr>) : <tr><td colSpan={snapshot.exam.configuredSections.length + (speakingShown ? 4 : 3)} className="mlv-empty">Không có học viên nào khớp bộ lọc.</td></tr>}</tbody></table></div>
        <div className="mlv-legend"><span><i className="mlv-dot is-submitted" /> đã nộp</span><span><i className="mlv-dot is-working" /> đang làm</span><span><i className="mlv-dot is-waiting" /> chờ mở</span><span><i className="mlv-dot is-absent" /> chưa vào</span><span><b className="mlv-flag is-stalled">im</b> không có lần lưu mới &gt;5 phút</span><span><b className="mlv-flag is-blank">trắng</b> chưa lưu câu nào</span><span className="mlv-updated">Snapshot máy chủ: {fmtTime(snapshot.serverTime)}</span></div>
      </>}
      {voidTarget && <VoidSittingDialog studentName={voidTarget.studentName} busy={busyKey === `void:${voidTarget.sittingId}`} onCancel={() => setVoidTarget(null)} onConfirm={confirmVoid} />}
    </main>
  );
}
