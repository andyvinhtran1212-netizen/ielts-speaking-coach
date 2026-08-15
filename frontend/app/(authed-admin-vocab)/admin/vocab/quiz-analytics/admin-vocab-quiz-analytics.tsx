'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  QUIZ_SCOPES,
  formatDuration,
  formatRatio,
  isUuid,
  normalizeQuizBankAnalytics,
  normalizeQuizBanks,
  normalizeQuizStudentDetail,
  normalizeQuizStudentRollup,
  quizScopeQuery,
} from '@/lib/admin-vocab-quiz-analytics-model.mjs';

type Scope = 'vocab' | 'course';
type Tab = 'students' | 'hard';
type Student = { userId: string; name: string; email: string; sessions: number; gradedSessions: number; timeSec: number; avgAccuracy: number | null; wordsMastered: number; lastActive: string };
type Rollup = { overview: { activeLearners: number; totalSessions: number; totalTimeSec: number; totalWordsMastered: number; avgAccuracy: number | null }; students: Student[] };
type Bank = { id: string; code: string; title: string; wordsCount: number; published: boolean };
type ErrorRow = { label: string; total: number; wrong: number; errorRate: number | null };
type Analytics = { items: ErrorRow[]; skills: ErrorRow[]; sessionCount: number };
type Detail = { user: { userId: string; name: string; email: string }; banks: Array<{ bankId: string; code: string; title: string; skillArea: string; wordsCount: number | null; mastered: number; inProgress: number }>; recentSessions: Array<{ code: string; accuracy: number | null; wordsMastered: number; totalQuestions: number; totalCorrect: number; durationSec: number; endedAt: string; endedBy: string }> };

const SCOPE_COPY = {
  vocab: { title: 'Kết quả luyện tập từ vựng', description: 'Theo dõi Quick-Check, độ chính xác, thời gian và số từ đã thuộc.' },
  course: { title: 'Kết quả bài tập theo buổi', description: 'Theo dõi bài giáo trình, thời gian, lượt làm và trục kiến thức sai nhiều nhất.' },
} as const;
const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');
const dateOnly = (value: string) => value ? value.slice(0, 10) : '—';

function updateUrl(scope: Scope, tab: Tab, bankId = '') {
  const url = new URL(window.location.href);
  url.searchParams.set('scope', scope);
  url.searchParams.set('tab', tab);
  if (bankId) url.searchParams.set('bank_id', bankId); else url.searchParams.delete('bank_id');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function ErrorTable({ title, rows }: { title: string; rows: ErrorRow[] }) {
  return <section className="avv-error-table"><div className="avv-section-head"><div><p className="avv-eyebrow">Error rate</p><h3>{title}</h3></div></div>{rows.length ? <div className="avv-table-wrap"><table className="avv-table"><thead><tr><th>{title.includes('Kỹ năng') ? 'Kỹ năng' : 'Mục'}</th><th>Lượt</th><th>Sai</th><th>Tỉ lệ sai</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><td data-label="Mục"><strong>{row.label}</strong></td><td data-label="Lượt">{row.total}</td><td data-label="Sai">{row.wrong}</td><td data-label="Tỉ lệ sai"><strong>{formatRatio(row.errorRate)}</strong><span className="avv-error-meter" aria-hidden="true"><i style={{ width: `${Math.round((row.errorRate ?? 0) * 100)}%` }} /></span></td></tr>)}</tbody></table></div> : <div className="avv-state">Chưa có dữ liệu.</div>}</section>;
}

export function AdminVocabQuizAnalytics() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const requestedScope = params?.get('scope') ?? 'vocab';
  const requestedTab = params?.get('tab') ?? 'students';
  const requestedBank = params?.get('bank_id') ?? '';
  const [scope, setScope] = useState<Scope>(QUIZ_SCOPES.includes(requestedScope) ? requestedScope as Scope : 'vocab');
  const [tab, setTab] = useState<Tab>(requestedTab === 'hard' ? 'hard' : 'students');
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [rollupLoading, setRollupLoading] = useState(true);
  const [rollupError, setRollupError] = useState<string | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksReady, setBanksReady] = useState(false);
  const [bankId, setBankId] = useState(isUuid(requestedBank) ? requestedBank : '');
  const [banksLoading, setBanksLoading] = useState(false);
  const [hard, setHard] = useState<Analytics | null>(null);
  const [hardLoading, setHardLoading] = useState(false);
  const [hardError, setHardError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const rollupSeq = useRef(0);
  const bankSeq = useRef(0);
  const hardSeq = useRef(0);
  const detailSeq = useRef(0);
  const scopeAccountRef = useRef(`${profile.id}:${scope}`);
  const accountRef = useRef(profile.id);
  accountRef.current = profile.id;

  const loadRollup = useCallback(async (targetScope: Scope) => {
    const query = quizScopeQuery(targetScope);
    if (!query) return;
    const requestId = ++rollupSeq.current;
    const account = profile.id;
    setRollupLoading(true); setRollupError(null);
    try {
      const result = normalizeQuizStudentRollup(await window.api.get<unknown>(`/admin/quiz/students?${query}`));
      if (!result) throw new Error('Backend trả rollup không đúng định dạng.');
      if (requestId === rollupSeq.current && account === accountRef.current) setRollup(result as Rollup);
    } catch (caught) {
      if (requestId === rollupSeq.current && account === accountRef.current) { setRollup(null); setRollupError(`Không tải được kết quả học viên: ${messageOf(caught)}`); }
    } finally {
      if (requestId === rollupSeq.current && account === accountRef.current) setRollupLoading(false);
    }
  }, [profile.id]);

  const loadBanks = useCallback(async (targetScope: Scope) => {
    const query = quizScopeQuery(targetScope);
    if (!query) return;
    const requestId = ++bankSeq.current;
    const account = profile.id;
    setBanksLoading(true); setBanksReady(false); setHardError(null);
    try {
      const result = normalizeQuizBanks(await window.api.get<unknown>(`/admin/quiz/banks?${query}`), targetScope);
      if (!result) throw new Error('Backend trả danh sách bank không đúng định dạng.');
      if (requestId === bankSeq.current && account === accountRef.current) { setBanks(result as Bank[]); setBanksReady(true); }
    } catch (caught) {
      if (requestId === bankSeq.current && account === accountRef.current) { setBanks([]); setHardError(`Không tải được danh sách bank: ${messageOf(caught)}`); }
    } finally {
      if (requestId === bankSeq.current && account === accountRef.current) setBanksLoading(false);
    }
  }, [profile.id]);

  const loadHard = useCallback(async (targetBankId: string) => {
    if (!isUuid(targetBankId)) { setHard(null); return; }
    const requestId = ++hardSeq.current;
    const account = profile.id;
    setHardLoading(true); setHardError(null);
    try {
      const result = normalizeQuizBankAnalytics(await window.api.get<unknown>(`/admin/quiz/banks/${encodeURIComponent(targetBankId)}/analytics`));
      if (!result) throw new Error('Backend trả analytics không đúng định dạng.');
      if (requestId === hardSeq.current && account === accountRef.current) setHard(result as Analytics);
    } catch (caught) {
      if (requestId === hardSeq.current && account === accountRef.current) { setHard(null); setHardError(`Không tải được từ/skill dễ sai: ${messageOf(caught)}`); }
    } finally {
      if (requestId === hardSeq.current && account === accountRef.current) setHardLoading(false);
    }
  }, [profile.id]);

  const openStudent = async (student: Student) => {
    const requestId = ++detailSeq.current;
    const account = profile.id;
    setDetail({ user: { userId: student.userId, name: student.name, email: student.email }, banks: [], recentSessions: [] });
    setDetailLoading(true); setDetailError(null);
    try {
      const query = quizScopeQuery(scope);
      const result = normalizeQuizStudentDetail(await window.api.get<unknown>(`/admin/quiz/students/${encodeURIComponent(student.userId)}?${query}`), student.userId);
      if (!result) throw new Error('Backend trả drill-down không đúng định dạng.');
      if (requestId === detailSeq.current && account === accountRef.current) setDetail(result as Detail);
    } catch (caught) {
      if (requestId === detailSeq.current && account === accountRef.current) setDetailError(`Không tải được chi tiết học viên: ${messageOf(caught)}`);
    } finally {
      if (requestId === detailSeq.current && account === accountRef.current) setDetailLoading(false);
    }
  };

  useEffect(() => {
    const scopeAccount = `${profile.id}:${scope}`;
    if (scopeAccountRef.current !== scopeAccount) setBankId('');
    scopeAccountRef.current = scopeAccount;
    setRollup(null); setDetail(null); setBanks([]); setBanksReady(false); setHard(null);
    void loadRollup(scope);
    return () => { rollupSeq.current += 1; bankSeq.current += 1; hardSeq.current += 1; detailSeq.current += 1; };
  }, [loadRollup, profile.id, scope]);

  useEffect(() => {
    if (tab === 'hard') void loadBanks(scope);
  }, [loadBanks, profile.id, scope, tab]);

  useEffect(() => {
    if (tab !== 'hard' || !bankId || !banksReady || banksLoading || hardLoading || hard || hardError) return;
    if (!banks.some((bank) => bank.id === bankId)) {
      setBankId('');
      updateUrl(scope, tab);
      return;
    }
    void loadHard(bankId);
  }, [bankId, banks, banksLoading, banksReady, hard, hardError, hardLoading, loadHard, scope, tab]);

  useEffect(() => {
    if (!detail) return undefined;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [detail]);

  const changeScope = (next: Scope) => { setScope(next); setBankId(''); setHard(null); updateUrl(next, tab); };
  const changeTab = (next: Tab) => { bankSeq.current += 1; hardSeq.current += 1; setTab(next); setBanksReady(false); setBankId(''); setHard(null); setHardError(null); updateUrl(scope, next); };
  const changeBank = (next: string) => { setBankId(next); setHard(null); setHardError(null); updateUrl(scope, tab, next); };
  const copy = SCOPE_COPY[scope];

  return (
    <main className="avv-shell avv-console-shell avv-quiz-analytics">
      <header className="avv-stats-hero"><div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Tín hiệu người học</p><h1>{copy.title}</h1><p>{copy.description}</p></div><div className="avv-stats-actions"><label>Phạm vi<select aria-label="Phạm vi" value={scope} onChange={(event) => changeScope(event.target.value as Scope)}><option value="vocab">Luyện từ vựng</option><option value="course">Bài tập theo buổi</option></select></label><button className="btn-secondary" type="button" disabled={rollupLoading} onClick={() => void loadRollup(scope)}>↺ Tải lại</button></div></header>

      {rollupError ? <p className="avv-banner is-error" role="alert">{rollupError}</p> : null}
      {rollupLoading ? <div className="avv-state">Đang tải tổng quan…</div> : rollup ? <section className="avv-stats-grid"><article className="avv-stat"><span>Học viên hoạt động</span><strong>{rollup.overview.activeLearners}</strong></article><article className="avv-stat"><span>Tổng phiên</span><strong>{rollup.overview.totalSessions}</strong></article><article className="avv-stat"><span>Tổng thời gian</span><strong>{formatDuration(rollup.overview.totalTimeSec)}</strong></article><article className="avv-stat"><span>{scope === 'vocab' ? 'Từ đã thuộc' : 'Phiên đã chấm'}</span><strong>{scope === 'vocab' ? rollup.overview.totalWordsMastered : rollup.students.reduce((sum, student) => sum + student.gradedSessions, 0)}</strong></article><article className="avv-stat"><span>Độ chính xác TB</span><strong>{formatRatio(rollup.overview.avgAccuracy)}</strong></article></section> : null}

      <div className="avv-native-tabs" role="tablist" aria-label="Chế độ phân tích"><button role="tab" aria-selected={tab === 'students'} aria-controls="quiz-students-panel" className={tab === 'students' ? 'is-active' : ''} type="button" onClick={() => changeTab('students')}>Theo học viên</button><button role="tab" aria-selected={tab === 'hard'} aria-controls="quiz-hard-panel" className={tab === 'hard' ? 'is-active' : ''} type="button" onClick={() => changeTab('hard')}>{scope === 'vocab' ? 'Từ khó' : 'Trục khó'} (toàn lớp)</button></div>

      <section id="quiz-students-panel" role="tabpanel" hidden={tab !== 'students'}>{rollup && !rollupLoading ? rollup.students.length ? <div className="avv-table-wrap"><table className="avv-table avv-student-analytics-table"><thead><tr><th>Học viên</th><th>Phiên</th><th>Đã thuộc</th><th>Chính xác</th><th>Thời gian</th><th>Hoạt động</th><th><span className="sr-only">Chi tiết</span></th></tr></thead><tbody>{rollup.students.map((student) => <tr key={student.userId}><td data-label="Học viên"><strong>{student.name || '(không tên)'}</strong><small>{student.email}</small></td><td data-label="Phiên">{student.sessions}</td><td data-label="Đã thuộc">{scope === 'vocab' ? student.wordsMastered : '—'}</td><td data-label="Chính xác">{formatRatio(student.avgAccuracy)}</td><td data-label="Thời gian">{formatDuration(student.timeSec)}</td><td data-label="Hoạt động">{dateOnly(student.lastActive)}</td><td className="avv-row-actions"><button className="btn-secondary" type="button" onClick={() => void openStudent(student)}>Xem chi tiết</button></td></tr>)}</tbody></table></div> : <div className="avv-state">Chưa có học viên nào trong phạm vi này.</div> : null}</section>

      <section id="quiz-hard-panel" role="tabpanel" hidden={tab !== 'hard'} className="avv-hard-panel"><label>Chọn bộ để xem mục/skill dễ sai<select aria-label="Chọn bộ" disabled={banksLoading} value={bankId} onChange={(event) => changeBank(event.target.value)}><option value="">{banksLoading ? 'Đang tải…' : '— chọn bộ —'}</option>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.code} · {bank.title}</option>)}</select></label>{hardError ? <p className="avv-banner is-error" role="alert">{hardError}</p> : null}{hardLoading ? <div className="avv-state">Đang tải analytics…</div> : hard ? <><p className="avv-analysis-summary">Tổng phiên của bộ: <strong>{hard.sessionCount}</strong></p><ErrorTable title="Mục dễ sai" rows={hard.items} /><ErrorTable title="Kỹ năng dễ sai" rows={hard.skills} /></> : <div className="avv-state">Chọn một bank để xem tín hiệu khó.</div>}</section>

      {detail ? <div className="av-modal-backdrop avv-dialog" role="dialog" aria-modal="true" aria-labelledby="quiz-student-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><section className="av-modal avv-dialog-card avv-dialog-card--wide"><button autoFocus className="avv-dialog-close" type="button" aria-label="Đóng" onClick={() => setDetail(null)}>×</button><p className="avv-eyebrow">Drill-down học viên</p><h2 id="quiz-student-title">{detail.user.name || '(không tên)'}</h2><p>{detail.user.email}</p>{detailError ? <p className="avv-banner is-error" role="alert">{detailError}</p> : detailLoading ? <div className="avv-state">Đang tải chi tiết…</div> : <><h3>Tiến độ theo bộ</h3>{detail.banks.length ? <div className="avv-bank-progress">{detail.banks.map((bank) => { const total = bank.wordsCount ?? bank.mastered + bank.inProgress; const percent = total ? Math.round(bank.mastered / total * 100) : 0; return <article key={bank.bankId}><div><strong>{bank.code} · {bank.title}</strong><span>{bank.mastered}/{total}</span></div><div className="avv-progress-track"><i style={{ width: `${percent}%` }} /></div></article>; })}</div> : <p className="avv-state">Chưa có tiến độ.</p>}<h3>Phiên gần đây</h3>{detail.recentSessions.length ? <div className="avv-table-wrap"><table className="avv-table"><thead><tr><th>Bộ</th><th>Chính xác</th><th>Đã thuộc</th><th>Thời gian</th><th>Kết thúc</th></tr></thead><tbody>{detail.recentSessions.map((session, index) => <tr key={`${session.code}-${session.endedAt}-${index}`}><td data-label="Bộ">{session.code}</td><td data-label="Chính xác">{formatRatio(session.accuracy)}</td><td data-label="Đã thuộc">{session.wordsMastered}</td><td data-label="Thời gian">{formatDuration(session.durationSec)}</td><td data-label="Kết thúc">{dateOnly(session.endedAt)}{session.endedBy === 'paused' ? ' · tạm dừng' : ''}</td></tr>)}</tbody></table></div> : <p className="avv-state">Chưa có phiên nào.</p>}</>}</section></div> : null}
    </main>
  );
}
