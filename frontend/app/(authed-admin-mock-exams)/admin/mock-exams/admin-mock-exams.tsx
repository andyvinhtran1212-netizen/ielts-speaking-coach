'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { messageOf } from '@/components/admin-directory-ui';
import {
  nextExamSection,
  normalizeExam,
  normalizeExamList,
  normalizePickerList,
  normalizeProgress,
} from '@/lib/admin-mock-exams-model.mjs';
import { ExamContentLibrary } from './exam-content-library';
import { ExamCreateForm } from './exam-create-form';
import { RetakeAssignmentDialog } from './retake-assignment-dialog';

type Exam = {
  id: string; code: string; title: string; status: string; examMode: string; isOpen: boolean; activeSection: string;
  cohortId: string | null; listeningTestId: string | null; readingTestId: string | null;
  writingTask1PromptId: string | null; writingTask2PromptId: string | null;
};
type Picker = { id: string; title?: string; test_id?: string; task_type?: string; name?: string };
type Progress = { activeSection: string; sections: Record<string, { submitted: number; total: number }> };
type Notice = { kind: 'success' | 'error' | 'warning'; message: string };

const SECTION_LABEL: Record<string, string> = {
  not_started: 'Chưa bắt đầu', listening: 'Listening', reading: 'Reading', writing: 'Writing', done: 'Đã xong',
};

export function AdminMockExams() {
  const profile = useAdminProfile();
  const [exams, setExams] = useState<Exam[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [readings, setReadings] = useState<Picker[]>([]);
  const [listenings, setListenings] = useState<Picker[]>([]);
  const [prompts, setPrompts] = useState<Picker[]>([]);
  const [cohorts, setCohorts] = useState<Picker[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [examContractWarning, setExamContractWarning] = useState<string | null>(null);
  const [pickerWarning, setPickerWarning] = useState<string | null>(null);
  const [progressWarning, setProgressWarning] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [assignmentExam, setAssignmentExam] = useState<Exam | null>(null);
  const accountRef = useRef(profile.id);
  const requestRef = useRef(0);
  const loadingRef = useRef(false);
  const examsRef = useRef<Exam[]>([]);
  accountRef.current = profile.id;
  examsRef.current = exams;

  const loadExams = async (silent = false, force = false): Promise<boolean> => {
    if (loadingRef.current && !force) return false;
    loadingRef.current = true;
    const request = ++requestRef.current;
    const account = profile.id;
    if (!silent) setLoading(true);
    try {
      const normalized = normalizeExamList(await window.api.get<unknown>('/admin/mock-exams'));
      if (request !== requestRef.current || accountRef.current !== account) return false;
      if (!normalized) throw new Error('Danh sách đề thi sai contract.');
      const nextExams = normalized.rows as Exam[];
      const published = nextExams.filter((row) => row.status === 'published');
      const progressResults = await Promise.allSettled(published.map(async (row) => {
        const value = normalizeProgress(await window.api.get<unknown>(`/admin/mock-exams/${encodeURIComponent(row.id)}/section-progress`));
        if (!value) throw new Error(`progress ${row.code || row.id} sai contract`);
        return [row.id, value] as const;
      }));
      if (request !== requestRef.current || accountRef.current !== account) return false;
      const progressMap: Record<string, Progress> = {};
      let failedProgress = 0;
      for (const result of progressResults) {
        if (result.status === 'fulfilled') progressMap[result.value[0]] = result.value[1] as Progress;
        else failedProgress += 1;
      }
      setExams(nextExams);
      examsRef.current = nextExams;
      setProgress(progressMap);
      setProgressWarning(failedProgress ? `${failedProgress} đề published không tải được tiến độ; không chuyển phần từ snapshot thiếu.` : null);
      setExamContractWarning(normalized.malformedCount ? `${normalized.malformedCount} đề sai contract/duplicate đã bị loại khỏi màn hình.` : null);
      return true;
    } catch (caught) {
      if (request === requestRef.current && accountRef.current === account) {
        setNotice({ kind: 'error', message: `${examsRef.current.length ? 'Không làm mới được; đang giữ snapshot cũ. ' : ''}${messageOf(caught)}` });
      }
      return false;
    } finally {
      if (request === requestRef.current) loadingRef.current = false;
      if (request === requestRef.current && accountRef.current === account) setLoading(false);
    }
  };

  useEffect(() => {
    let dead = false;
    const account = profile.id;
    setExams([]); setProgress({}); setNotice(null); setExamContractWarning(null); setPickerWarning(null); setAssignmentExam(null);
    (async () => {
      const specs = [
        ['Reading', '/admin/mock-exams/reading-tests', ['items', 'tests'], setReadings],
        ['Listening', '/admin/listening/tests?limit=100&status=published&test_type=exam', ['items', 'tests'], setListenings],
        ['Writing', '/admin/writing/prompts', ['items', 'prompts'], setPrompts],
        ['Lớp', '/admin/cohorts?is_active=true', ['items', 'cohorts'], setCohorts],
      ] as const;
      const results = await Promise.allSettled(specs.map(async ([label, path, keys, setter]) => {
        const rows = normalizePickerList(await window.api.get<unknown>(path), [...keys]);
        if (!rows) throw new Error(`${label} sai contract`);
        return { label, rows: rows as Picker[], setter };
      }));
      if (dead || accountRef.current !== account) return;
      const failed: string[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') result.value.setter(result.value.rows);
        else failed.push(messageOf(result.reason).replace(' sai contract', ''));
      }
      setPickerWarning(failed.length ? `Không tải được picker: ${failed.join(', ')}. Không tạo đề cho tới khi tải lại đủ.` : null);
    })();
    void loadExams();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadExams(true); }, 15_000);
    return () => { dead = true; window.clearInterval(timer); requestRef.current += 1; loadingRef.current = false; };
    // loadExams intentionally follows the account lifecycle, not render identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const cohortNames = useMemo(() => new Map(cohorts.map((row) => [row.id, row.name || row.id])), [cohorts]);
  const examCounts = useMemo(() => ({
    drafts: exams.filter((row) => row.status === 'draft').length,
    published: exams.filter((row) => row.status === 'published').length,
    open: exams.filter((row) => row.isOpen).length,
    retakes: exams.filter((row) => row.examMode === 'retake').length,
  }), [exams]);

  const mutate = async (key: string, operation: () => Promise<unknown>, success: string, postcondition: () => boolean) => {
    setBusyKey(key); setNotice(null);
    let operationError: unknown = null;
    try {
      try { await operation(); } catch (caught) { operationError = caught; }
      const reconciled = await loadExams(false, true);
      if (!reconciled) {
        setNotice({ kind: 'error', message: 'Yêu cầu có thể đã được ghi nhưng chưa xác nhận được trạng thái backend. Không thao tác lại; tải lại trang để đối chiếu.' });
        return false;
      }
      if (postcondition()) {
        setNotice({ kind: 'success', message: operationError ? `${success} Phản hồi ban đầu bị gián đoạn nhưng trạng thái backend đã xác nhận.` : success });
        return true;
      }
      setNotice({ kind: 'error', message: operationError ? messageOf(operationError) : 'Backend không xác nhận thay đổi vừa yêu cầu.' });
      return false;
    } finally { setBusyKey(''); }
  };

  const create = async (payload: Record<string, unknown>) => {
    if (pickerWarning) { setNotice({ kind: 'error', message: 'Picker đang thiếu dữ liệu; tải lại trang trước khi tạo đề.' }); return false; }
    const before = new Set(examsRef.current.map((row) => row.id));
    const code = String(payload.code || '').trim();
    setBusyKey('create'); setNotice(null);
    let ackId = '';
    let operationError: unknown = null;
    try {
      try {
        const ack = normalizeExam(await window.api.post<unknown>('/admin/mock-exams', payload));
        if (!ack || ack.code !== code) throw new Error('ACK tạo đề không khớp mã đề yêu cầu.');
        ackId = ack.id;
      } catch (caught) { operationError = caught; }
      const reconciled = await loadExams(false, true);
      if (!reconciled) {
        setNotice({ kind: 'error', message: 'Lệnh tạo có thể đã được ghi nhưng chưa xác nhận được backend. Không bấm tạo lại; tải lại trang và tìm theo mã đề.' });
        return false;
      }
      const created = examsRef.current.find((row) => (ackId && row.id === ackId) || (!before.has(row.id) && row.code === code));
      if (!created) {
        setNotice({ kind: 'error', message: operationError ? messageOf(operationError) : 'Backend không trả lại đề vừa tạo trong danh sách canonical.' });
        return false;
      }
      setNotice({ kind: 'success', message: operationError ? `Đã xác nhận ${created.code} được tạo dù phản hồi ban đầu bị gián đoạn.` : 'Đã tạo đề nháp từ dữ liệu backend.' });
      return true;
    } finally { setBusyKey(''); }
  };

  const publish = async (exam: Exam) => {
    if (!window.confirm(`Publish đề “${exam.code}”? Nội dung được chọn sẽ được đánh dấu exam-only.`)) return;
    await mutate(`${exam.id}:publish`, () => window.api.patch<unknown>(`/admin/mock-exams/${encodeURIComponent(exam.id)}`, { status: 'published' }), `Đã publish ${exam.code}.`, () => examsRef.current.some((row) => row.id === exam.id && row.status === 'published'));
  };

  const toggleOpen = async (exam: Exam) => {
    const next = !exam.isOpen;
    if (!window.confirm(next ? `Mở kỳ “${exam.code}” cho học viên bắt đầu?` : `Đóng kỳ “${exam.code}”? Học viên chưa vào sẽ bị chặn.`)) return;
    await mutate(`${exam.id}:open`, () => window.api.post<unknown>(`/admin/mock-exams/${encodeURIComponent(exam.id)}/open`, { is_open: next }), next ? `Đã mở kỳ ${exam.code}.` : `Đã đóng kỳ ${exam.code}.`, () => examsRef.current.some((row) => row.id === exam.id && row.isOpen === next));
  };

  const advance = async (exam: Exam, current: string, snapshot: Progress) => {
    const next = nextExamSection(exam, current);
    if (!next) return;
    const section = snapshot.sections[current];
    const remaining = section ? Math.max(0, section.total - section.submitted) : 0;
    const message = current === 'not_started'
      ? `Bắt đầu kỳ thi và mở ${SECTION_LABEL[next]} cho toàn bộ học viên?`
      : `Thu ${SECTION_LABEL[current]} (${section?.submitted || 0}/${section?.total || 0} đã nộp${remaining ? `, ${remaining} sẽ được thu tự động` : ''}) và mở ${SECTION_LABEL[next]}?`;
    if (!window.confirm(message)) return;
    await mutate(`${exam.id}:advance`, () => window.api.post<unknown>(`/admin/mock-exams/${encodeURIComponent(exam.id)}/advance`, { from_section: current }), `Đã chuyển ${exam.code} sang ${SECTION_LABEL[next]}.`, () => examsRef.current.some((row) => row.id === exam.id && row.activeSection === next));
  };

  return (
    <main className="mex-shell">
      <header className="mex-hero"><div><p className="mex-kicker">Mock Test · Soạn & giao đề</p><h1>Quản lý đề thi</h1><p>Tạo bản nháp, gắn nội dung, giao đúng lớp và chuyển đề sang phòng thi live.</p></div><a className="adm-btn-secondary" href="/admin/mock-tests">Trung tâm vận hành</a></header>
      <section className="mex-overview" aria-label="Tổng quan quản lý đề"><div><span>Tổng đề</span><strong>{exams.length}</strong></div><div><span>Đang soạn</span><strong>{examCounts.drafts}</strong></div><div><span>Đã publish</span><strong>{examCounts.published}</strong></div><div className={examCounts.open ? 'is-live' : ''}><span>Phòng đang mở</span><strong>{examCounts.open}</strong></div><div><span>Đề test lại</span><strong>{examCounts.retakes}</strong></div></section>
      <nav className="aop-workflow" aria-label="Quy trình vận hành đề thi"><div className="aop-workflow__step is-current"><b>01</b><span><strong>Soạn đề</strong><small>Nội dung & thời lượng</small></span></div><div className="aop-workflow__step is-current"><b>02</b><span><strong>Giao đề</strong><small>Publish & gán lớp</small></span></div><div className="aop-workflow__step"><b>03</b><span><strong>Phòng live</strong><small>Mở phần & theo dõi</small></span></div><div className="aop-workflow__step"><b>04</b><span><strong>Thu bài</strong><small>Sweep & đối chiếu</small></span></div><div className="aop-workflow__step"><b>05</b><span><strong>Chấm nháp</strong><small>Nhận hồ sơ & chốt band</small></span></div><div className="aop-workflow__step"><b>06</b><span><strong>Trả kết quả</strong><small>Công bố canonical</small></span></div></nav>
      {notice && <div className={`mex-alert is-${notice.kind}`} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.message}</div>}
      {examContractWarning && <div className="mex-alert is-warning" role="alert">{examContractWarning}</div>}
      {pickerWarning && <div className="mex-alert is-error" role="alert">{pickerWarning}</div>}
      {progressWarning && <div className="mex-alert is-warning" role="alert">{progressWarning}</div>}
      <ExamCreateForm readings={readings} listenings={listenings} prompts={prompts} cohorts={cohorts} disabled={busyKey === 'create' || Boolean(pickerWarning)} onCreate={create} onError={(message) => setNotice({ kind: 'error', message })} />

      <section className="mex-list-section">
        <div className="mex-section-head"><div><p className="mex-kicker">02 · Giao đề</p><h2>Kho đề vận hành</h2><p className="mex-section-copy">Chọn đúng hành động tiếp theo theo trạng thái canonical của từng đề.</p></div><button className="adm-btn-secondary" type="button" onClick={() => void loadExams()} disabled={loading}>Tải lại</button></div>
        {loading && !exams.length ? <div className="mex-empty" role="status">Đang tải danh sách đề…</div> : !exams.length ? <div className="mex-empty">Chưa có đề nào.</div> : <div className="mex-exam-grid">{exams.map((exam) => {
          const snapshot = progress[exam.id];
          const active = snapshot?.activeSection || exam.activeSection;
          const next = nextExamSection(exam, active);
          const isRetake = exam.examMode === 'retake';
          const busy = busyKey.startsWith(`${exam.id}:`);
          // Starting an exam is safe here. Every later transition must happen
          // in the live room, where the canonical collect/sweep token is
          // visible and Advance stays locked until final-save ACKs settle.
          const canAdvance = !isRetake && exam.status === 'published' && Boolean(snapshot) && active === 'not_started' && Boolean(next);
          return <article className="mex-card mex-exam" key={exam.id}>
            <div className="mex-exam-head"><div><strong>{exam.code || 'Chưa có mã'}</strong><h3>{exam.title || 'Chưa có tiêu đề'}</h3></div><div className="mex-pill-row"><span className={`mex-pill is-${exam.status}`}>{exam.status === 'published' ? 'Đã publish' : exam.status === 'draft' ? 'Bản nháp' : exam.status}</span><span className="mex-pill">{isRetake ? 'Test lại' : 'Theo lớp'}</span>{!isRetake && <span className={`mex-pill ${exam.isOpen ? 'is-open' : ''}`}>{exam.isOpen ? 'Phòng đang mở' : 'Phòng đóng'}</span>}</div></div>
            <ol className="mex-exam-flow" aria-label="Tiến trình đề"><li className="is-done">Soạn đề</li><li className={exam.status === 'published' ? 'is-done' : 'is-current'}>Publish & giao</li><li className={exam.isOpen || active !== 'not_started' ? 'is-done' : exam.status === 'published' ? 'is-current' : ''}>Phòng thi</li><li className={active === 'done' ? 'is-done' : active !== 'not_started' ? 'is-current' : ''}>Thu & chấm</li></ol>
            <dl className="mex-meta"><div><dt>Lớp</dt><dd>{exam.cohortId ? cohortNames.get(exam.cohortId) || exam.cohortId : isRetake ? 'Gán từng học viên' : 'Chưa gán'}</dd></div><div><dt>Phần hiện tại</dt><dd>{SECTION_LABEL[active] || active}</dd></div></dl>
            {!isRetake && snapshot && <div className="mex-progress-row">{['listening', 'reading', 'writing'].filter((section) => section === 'writing' || (section === 'listening' ? exam.listeningTestId : exam.readingTestId)).map((section) => { const item = snapshot.sections[section] || { submitted: 0, total: 0 }; return <span key={section} className={active === section ? 'is-active' : ''}><strong>{SECTION_LABEL[section]}</strong>{item.submitted}/{item.total} đã nộp{active === section && item.total > item.submitted ? ` · ${item.total - item.submitted} đang làm` : ''}</span>; })}</div>}
            {!isRetake && exam.status === 'published' && !snapshot && <div className="mex-alert is-warning">Không có snapshot tiến độ; thao tác chuyển phần đã bị khóa.</div>}
            <div className="mex-card-actions">
              {exam.status === 'draft' && <button className="adm-btn-primary" type="button" onClick={() => void publish(exam)} disabled={busy}>Publish & sẵn sàng giao</button>}
              {isRetake ? <button className="adm-btn-primary" type="button" onClick={() => setAssignmentExam(exam)} disabled={busy}>Gán test lại</button> : <>
                {!(active === 'done' && !exam.isOpen) && <button className={exam.isOpen ? 'adm-btn-secondary' : 'adm-btn-primary'} type="button" onClick={() => void toggleOpen(exam)} disabled={busy || (exam.status !== 'published' && !exam.isOpen)}>{exam.isOpen ? 'Đóng kỳ' : 'Mở kỳ'}</button>}
                {active === 'done' && !exam.isOpen && <span className="mex-ended">Kỳ thi đã kết thúc</span>}
                {canAdvance && <button className="adm-btn-primary" type="button" onClick={() => void advance(exam, active, snapshot)} disabled={busy}>{busyKey === `${exam.id}:advance` ? 'Đang chuyển…' : `Mở ${SECTION_LABEL[next || '']}`}</button>}
                {!isRetake && active !== 'not_started' && active !== 'done' && <span className="mex-ended">Thu bài và chuyển phần tại Phòng thi trực tiếp</span>}
                {exam.status === 'published' && <a className="adm-btn-secondary" href={`/admin/mock-tests?tab=live&exam_id=${encodeURIComponent(exam.id)}`}>Phòng thi trực tiếp</a>}
              </>}
              <a className="adm-btn-secondary" href={`/admin/mock-tests?tab=review&exam_id=${encodeURIComponent(exam.id)}`}>Duyệt bài</a>
            </div>
          </article>;
        })}</div>}
      </section>

      <ExamContentLibrary accountId={profile.id} cohorts={cohorts} />
      {assignmentExam && <RetakeAssignmentDialog exam={assignmentExam} exams={exams} cohorts={cohorts} onClose={() => setAssignmentExam(null)} onChanged={async () => { await loadExams(true, true); }} />}
    </main>
  );
}
