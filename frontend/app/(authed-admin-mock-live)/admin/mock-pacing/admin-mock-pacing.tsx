'use client';

import { useEffect, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { messageOf } from '@/components/admin-directory-ui';
import { gapBarHeight, normalizePacing } from '@/lib/admin-mock-live-model.mjs';

type Timeline = { qNum: string; at: string; gapSeconds: number | null; isAnswered: boolean };
type QuestionSection = { kind: 'questions'; startedAt: string | null; endedAt: string | null; answered: number | null; total: number | null; timeline: Timeline[]; answersInFinalMinutes: number | null; idleTailSeconds: number | null; workedInPaperOrder: boolean | null; longGapCount: number };
type WritingSection = { kind: 'writing'; startedAt: string | null; endedAt: string | null; tasks: { task: string; wordCount: number | null; lastSavedAt: string | null }[] };
type Pacing = { sittingId: string; examId: string; studentName: string; examCode: string; status: string; sections: Record<string, QuestionSection | WritingSection> };

const LABEL: Record<string, string> = { listening: 'Listening', reading: 'Reading', writing: 'Writing' };

function fmtTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function mmss(value: number | null) {
  if (value == null) return '—';
  const seconds = Math.max(0, Math.round(value));
  return `${Math.floor(seconds / 60)}p${String(seconds % 60).padStart(2, '0')}s`;
}

function Kpi({ label, value, warning = false }: { label: string; value: string | number; warning?: boolean }) {
  return <div className={warning ? 'is-warning' : ''}><span>{label}</span><strong>{value}</strong></div>;
}

function QuestionPacing({ section, data }: { section: string; data: QuestionSection }) {
  const cleared = data.timeline.filter((row) => !row.isAnswered).length;
  return <section className="mpn-card"><header><div><p className="mpn-kicker">Answer timeline</p><h2>{LABEL[section]}</h2></div><span>{fmtTime(data.startedAt)} → {fmtTime(data.endedAt)}</span></header><div className="mpn-kpis"><Kpi label="Đã trả lời" value={`${data.answered ?? '—'}${data.total ? `/${data.total}` : ''}`} /><Kpi label="Theo thứ tự đề" value={data.workedInPaperOrder == null ? '—' : data.workedInPaperOrder ? 'Có' : 'Không'} /><Kpi label="Lần nghỉ dài" value={data.longGapCount} warning={data.longGapCount > 0} /><Kpi label="Đáp án 5 phút cuối" value={data.answersInFinalMinutes ?? '—'} warning={(data.answersInFinalMinutes || 0) > 5} /><Kpi label="Ngừng làm sớm" value={mmss(data.idleTailSeconds)} warning={(data.idleTailSeconds || 0) > 300} /></div>{data.timeline.length ? <><div className="mpn-strip" role="img" aria-label={`Dòng thời gian ${LABEL[section]} gồm ${data.timeline.length} lần lưu`}>{data.timeline.map((row, index) => <div key={`${row.qNum}:${row.at}:${index}`} className={`mpn-bar ${row.gapSeconds != null && row.gapSeconds >= 90 ? 'is-long' : ''} ${!row.isAnswered ? 'is-cleared' : ''}`} style={{ height: `${gapBarHeight(row.gapSeconds)}px` }} title={`Câu ${row.qNum} — ${row.isAnswered ? 'lưu đáp án' : 'xoá ô'} lúc ${fmtTime(row.at)}, cách lần trước ${mmss(row.gapSeconds)}`}><span>{row.qNum}</span></div>)}</div><p className="mpn-legend">Mỗi cột là một lần lưu theo thứ tự về máy chủ. Cột cao hơn biểu thị khoảng cách tới lần lưu trước dài hơn; vàng là từ 90 giây, gạch chéo là xoá ô{cleared ? ` (${cleared} lần)` : ''}.</p></> : <p className="mpn-empty">Không có lần lưu nào — dữ liệu không đủ để dựng nhịp làm bài.</p>}</section>;
}

function WritingPacing({ data }: { data: WritingSection }) {
  return <section className="mpn-card"><header><div><p className="mpn-kicker">Autosave snapshot</p><h2>Writing</h2></div><span>{fmtTime(data.startedAt)} → {fmtTime(data.endedAt)}</span></header><div className="mpn-kpis">{data.tasks.map((task) => <div key={task.task}><span>{task.task === 'task1' ? 'Task 1 · số từ' : 'Task 2 · số từ'}</span><strong>{task.wordCount ?? '—'}</strong><small>Lưu cuối {fmtTime(task.lastSavedAt)}</small></div>)}</div><p className="mpn-legend">Writing không có timestamp theo từng câu. Số từ và giờ lưu cuối đến từ bản nháp autosave trên máy chủ.</p></section>;
}

export function AdminMockPacing({ sittingId }: { sittingId: string }) {
  const profile = useAdminProfile();
  const [data, setData] = useState<Pacing | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let dead = false;
    setData(null); setError('');
    if (!sittingId) {
      setError('Thiếu tham số sitting trong URL. Mở trang này từ một học viên trong phòng thi.');
      return () => { dead = true; };
    }
    (async () => {
      try {
        const normalized = normalizePacing(await window.api.get<unknown>(`/admin/mock-exams/sittings/${encodeURIComponent(sittingId)}/pacing`)) as Pacing | null;
        if (!normalized || normalized.sittingId !== sittingId) throw new Error('Dữ liệu nhịp làm bài sai contract hoặc không khớp lượt thi.');
        if (!dead) setData(normalized);
      } catch (caught) {
        if (!dead) setError(`Không tải được nhịp làm bài: ${messageOf(caught)}`);
      }
    })();
    return () => { dead = true; };
  }, [profile.id, sittingId]);

  return <main className="mpn-shell">
    <p className="mpn-back"><a href={data ? `/admin/mock-live?exam_id=${encodeURIComponent(data.examId)}` : '/admin/mock-live'}>← Phòng thi trực tiếp</a></p>
    {error && <div className="mpn-state is-error" role="alert">{error}</div>}
    {!data && !error && <div className="mpn-state" role="status">Đang dựng nhịp làm bài từ dữ liệu máy chủ…</div>}
    {data && <><header className="mpn-hero"><div><p className="mpn-kicker">Mock Test · Pacing reconstruction</p><h1>{data.studentName}</h1><p><span className="mpn-code">{data.examCode || data.examId}</span><span className="mpn-pill">{data.status || '—'}</span></p></div><a className="adm-btn-secondary" href={`/admin/mock-live?exam_id=${encodeURIComponent(data.examId)}`}>Về đúng phòng thi</a></header><div className="mpn-caveat" role="note"><b>Cách đọc số liệu.</b> Timestamp là <b>lần sửa cuối cùng</b> của mỗi câu, không phải lịch sử mọi lần sửa. Khoảng cách giữa hai cột chỉ khoanh vùng thời gian từ lần lưu trước tới lần lưu sau, không phải thời gian suy nghĩ chính xác. Một câu cũ được sửa lại sẽ làm thứ tự thay đổi; không có timestamp cũng không chứng minh học viên không nỗ lực.</div>{['listening', 'reading', 'writing'].map((section) => { const value = data.sections[section]; if (!value) return null; return value.kind === 'writing' ? <WritingPacing key={section} data={value} /> : <QuestionPacing key={section} section={section} data={value} />; })}</>}
  </main>;
}
