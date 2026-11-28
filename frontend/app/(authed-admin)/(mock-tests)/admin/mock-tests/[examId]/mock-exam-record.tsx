'use client';

// MOCKORG-0086 FR-145 (G09-T34 PR 1): one exam, seven tabs. The exam is read
// from GET /admin/mock-exams; the tab comes from `?tab=` or, without one, from
// the exam's state. Chấm, Phân tích and Trả kết quả come in PR 2; until then
// they point to the existing console.

import { useCallback, useEffect, useState } from 'react';

import { Button, Notice, PageState, Tabs } from '@/components/ui';
import { messageOf } from '@/components/admin-directory-ui';
import {
  MODE_LABELS,
  SKILLS,
  SKILL_NAMES,
  normalizeOrgExamList,
  sittingMinutes,
  whenCopy,
} from '@/lib/mock-exam-org-model.mjs';
import {
  EVENT_LABELS,
  RECORD_TABS,
  dateTimeCopy,
  normalizeEvents,
  recordHref,
  recordTab,
  stateLabelOf,
} from '@/lib/mock-exam-record-model.mjs';

import styles from '../mock-exam-org.module.css';
import record from './mock-exam-record.module.css';
import { MockExamCandidates } from './mock-exam-candidates';
import { MockExamMonitor } from './mock-exam-monitor';

type OrgExam = import('@/lib/mock-exam-org-model.mjs').OrgExam;
type TabId = import('@/lib/mock-exam-record-model.mjs').RecordTabId;
type RecordEvent = import('@/lib/mock-exam-record-model.mjs').RecordEvent;

export function MockExamRecord({ examId, initialTab }: { examId: string; initialTab: string | null }) {
  const [exams, setExams] = useState<OrgExam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = normalizeOrgExamList(await window.api.get<unknown>('/admin/mock-exams'));
      if (!list) throw new Error('Danh sách kỳ thi sai định dạng.');
      setExams(list.rows);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const exam = exams?.find((row) => row.id === examId) || null;
  const active: TabId = tab || recordTab(initialTab, exam?.state || null);
  const choose = (id: string) => {
    const next = recordTab(id, exam?.state || null);
    setTab(next);
    window.history.replaceState(null, '', recordHref(examId, next));
  };

  if (error && !exams) {
    return <main className={styles.page}><PageState kind="error" title="Chưa tải được kỳ thi" body={error} action={<Button variant="secondary" onClick={() => void load()}>Thử lại</Button>} /></main>;
  }
  if (!exams) return <main className={styles.page}><PageState kind="loading" title="Đang tải kỳ thi…" /></main>;
  if (!exam) {
    return <main className={styles.page}><PageState kind="empty" title="Không tìm thấy kỳ thi" body="Kỳ thi này không có trong danh sách. Có thể nó đã bị xoá hoặc đường dẫn sai." action={<Button href="/admin/mock-tests">Về danh sách kỳ thi</Button>} /></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <p><a href="/admin/mock-tests">Kỳ thi</a></p>
          <h1>{exam.title}</h1>
          <p className={record.meta}>
            <span>{stateLabelOf(exam.state)}</span>
            <span>·</span>
            <span>{MODE_LABELS[exam.mode]}</span>
            <span>·</span>
            <span>{whenCopy(exam)}</span>
          </p>
        </div>
        {exam.status === 'draft' && <Button href={`/admin/mock-tests/${encodeURIComponent(exam.id)}/setup`}>Tiếp tục tổ chức</Button>}
      </header>
      <Tabs items={RECORD_TABS} active={active} label="Các thẻ của kỳ thi" onChange={choose}>
        <div className={record.panel}>
          {active === 'de' && <PapersTab exam={exam} />}
          {active === 'thi-sinh' && <MockExamCandidates exam={exam} exams={exams} />}
          {active === 'theo-doi' && (exam.status === 'draft'
            ? <Notice kind="info">Kỳ thi còn ở Nháp. Lên lịch xong thì phòng thi hiện ở đây.</Notice>
            : <MockExamMonitor examId={exam.id} />)}
          {(active === 'cham' || active === 'phan-tich' || active === 'tra-ket-qua') && <LaterTab exam={exam} tab={active} />}
          {active === 'nhat-ky' && <EventsTab examId={exam.id} />}
        </div>
      </Tabs>
    </main>
  );
}

function PapersTab({ exam }: { exam: OrgExam }) {
  const paper: Record<string, boolean> = {
    listening: Boolean(exam.listeningTestId),
    reading: Boolean(exam.readingTestId),
    writing: Boolean(exam.writingTask1PromptId || exam.writingTask2PromptId),
    speaking: exam.hasSpeakingPaper,
  };
  return (
    <>
      <table className={styles.table}>
        <thead><tr><th>Kỹ năng</th><th>Đề</th></tr></thead>
        <tbody>
          {SKILLS.filter((s) => exam.skills.includes(s)).map((s) => (
            <tr key={s}><td>{SKILL_NAMES[s]}</td><td>{paper[s] ? 'Đã chọn đề' : 'Chưa chọn đề'}</td></tr>
          ))}
          {!exam.skills.length && <tr><td colSpan={2}>Chưa chọn kỹ năng nào.</td></tr>}
        </tbody>
      </table>
      <dl className={styles.summary}>
        <div><dt>Cách thi</dt><dd>{MODE_LABELS[exam.mode]}</dd></div>
        <div><dt>Thời gian</dt><dd>{whenCopy(exam)}</dd></div>
        <div><dt>Thời lượng làm bài</dt><dd>khoảng {sittingMinutes(exam, exam.skills)} phút</dd></div>
      </dl>
      {exam.status === 'draft'
        ? <p className={styles.help}>Kỳ thi còn ở Nháp, sửa đề ở trang tổ chức.</p>
        : <p className={styles.help}>Đề đã khoá vì kỳ thi đã lên lịch. Muốn đổi đề thì tạo kỳ thi khác.</p>}
    </>
  );
}

const LATER: Record<'cham' | 'phan-tich' | 'tra-ket-qua', string> = {
  cham: 'Chấm bài',
  'phan-tich': 'Phân tích',
  'tra-ket-qua': 'Trả kết quả',
};

function LaterTab({ exam, tab }: { exam: OrgExam; tab: 'cham' | 'phan-tich' | 'tra-ket-qua' }) {
  return (
    <Notice
      kind="info"
      title={`${LATER[tab]} chưa có ở trang mới`}
      action={<Button variant="secondary" href={`/admin/mock-tests?view=console&tab=review&exam_id=${encodeURIComponent(exam.id)}`}>Mở bảng chấm hiện tại</Button>}
    >
      Thẻ này sẽ có ở bản sau. Trong lúc chờ, chấm và trả kết quả ở bảng chấm hiện tại.
    </Notice>
  );
}

function EventsTab({ examId }: { examId: string }) {
  const [kind, setKind] = useState('');
  const [events, setEvents] = useState<RecordEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
      const value = normalizeEvents(await window.api.get<unknown>(`/admin/mock-exams/${encodeURIComponent(examId)}/events${query}`));
      if (!value) throw new Error('Nhật ký sai định dạng.');
      setEvents(value);
    } catch (caught) {
      setEvents(null);
      setError(messageOf(caught));
    }
  }, [examId, kind]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className={record.toolbar}>
        <label className={styles.field}>
          <span>Loại sự kiện</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Tất cả</option>
            {Object.entries(EVENT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <Button variant="secondary" onClick={() => void load()}>Tải lại</Button>
      </div>
      {error && <Notice kind="error" title="Chưa đọc được nhật ký">{error}</Notice>}
      {events && (
        <div className={record.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Lúc</th><th>Sự kiện</th><th>Người làm</th><th>Chi tiết</th></tr></thead>
            <tbody>
              {events.length ? events.map((e) => (
                <tr key={e.id}><td>{dateTimeCopy(e.at)}</td><td>{e.label}</td><td>{e.actor}</td><td>{e.detail || '—'}</td></tr>
              )) : <tr><td colSpan={4}>Chưa có sự kiện nào{kind ? ' thuộc loại này' : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.help}>Hiện nhật ký ghi cộng giờ, nhắn phòng và trả kết quả. Mở/đóng phòng, bắt đầu/thu phần và cho thi bù chưa được ghi vào đây.</p>
    </>
  );
}
