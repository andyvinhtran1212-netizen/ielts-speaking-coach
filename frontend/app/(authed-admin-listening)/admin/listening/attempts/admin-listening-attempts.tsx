'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  LISTENING_ATTEMPT_STATUS_LABEL, LISTENING_ATTEMPT_TYPE_LABEL,
  formatListeningAttemptDate, formatListeningAttemptDuration,
  listeningAttemptsHref, listeningAttemptsRollbackHref,
  normalizeListeningAttemptDetail, normalizeListeningAttemptFilters,
  normalizeListeningAttemptList,
} from '@/lib/admin-listening-attempts-model.mjs';

type Status = 'all' | 'submitted' | 'in_progress' | 'abandoned';
type TestType = 'all' | 'full' | 'mini' | 'drill' | 'practice';
type Filters = { user: string; test: string; type: TestType; status: Status; page: number; attempt: string };
type IdentityUser = { id: string; email: string | null; displayName: string | null };
type IdentityTest = { id: string; testId: string | null; title: string | null; type: Exclude<TestType, 'all'> | null };
type Row = { id: string; status: Exclude<Status, 'all'>; score: number | null; totalQuestions: number | null; accuracy: number | null; durationSeconds: number | null; user: IdentityUser; test: IdentityTest; startedAt: string | null; submittedAt: string | null; createdAt: string | null };
type Detail = Row & { questions: Array<{ qNum: number; correct: boolean; userAnswer: string | null; expected: string | null; trapCaught: boolean; trapMissed: boolean }>; malformedQuestionCount: number; trapSummary: { caught: number; missed: number } | null; bandEstimate: number | null; associationLookupFailed: boolean; associationLookupFailures: string[] };
type Snapshot = { key: string; rows: Row[]; total: number; malformedCount: number; readAt: string; associationLookupFailed: boolean; associationLookupFailures: string[] };
type DetailState = { key: string; phase: 'loading' } | { key: string; phase: 'ready'; value: Detail } | { key: string; phase: 'error'; message: string };

const PAGE_SIZE = 50;
const STATUS_OPTIONS = Object.entries(LISTENING_ATTEMPT_STATUS_LABEL) as Array<[Status, string]>;
const TYPE_OPTIONS = Object.entries(LISTENING_ATTEMPT_TYPE_LABEL) as Array<[TestType, string]>;
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusClass = (status: string) => status === 'submitted' ? 'is-live' : status === 'abandoned' ? 'is-failed' : 'is-new';
const accuracyClass = (accuracy: number | null) => accuracy == null ? '' : accuracy >= 0.85 ? 'is-high' : accuracy >= 0.6 ? 'is-mid' : 'is-low';
const lookupLabel = (tables: string[]) => tables.map((table) => table === 'users' ? 'học viên' : 'test').join(' và ');

export function AdminListeningAttempts() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = normalizeListeningAttemptFilters({
    user: params?.get('user'), test: params?.get('test'), type: params?.get('type'),
    status: params?.get('status'), page: params?.get('page'), attempt: params?.get('attempt'),
  }) as Filters;
  const [draft, setDraft] = useState({ user: filters.user, test: filters.test, type: filters.type, status: filters.status });
  const offset = (filters.page - 1) * PAGE_SIZE;
  const key = `${profile.id}:${filters.user}:${filters.test}:${filters.type}:${filters.status}:${offset}`;
  const scope = useRef(key);
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const current = snapshot?.key === key ? snapshot : null;

  useEffect(() => setDraft({ user: filters.user, test: filters.test, type: filters.type, status: filters.status }), [filters.user, filters.test, filters.type, filters.status]);

  const load = useCallback(async (preserve = true) => {
    const request = ++sequence.current;
    const owner = key;
    setLoading(true); setLoadError(null);
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (filters.user) query.set('user_query', filters.user);
    if (filters.test) query.set('test_query', filters.test);
    if (filters.type !== 'all') query.set('test_type', filters.type);
    if (filters.status !== 'all') query.set('status', filters.status);
    try {
      const normalized = normalizeListeningAttemptList(await window.api.get<unknown>(`/admin/listening/attempts?${query}`), { limit: PAGE_SIZE, offset, type: filters.type, status: filters.status }) as Omit<Snapshot, 'key' | 'readAt'> | null;
      if (!normalized) throw new Error('Phản hồi danh sách không đúng contract canonical.');
      if (request !== sequence.current || scope.current !== owner) return;
      const lastPage = Math.max(1, Math.ceil(normalized.total / PAGE_SIZE));
      if (!normalized.rows.length && filters.page > lastPage) {
        router.replace(listeningAttemptsHref({ ...filters, page: lastPage }));
        return;
      }
      setSnapshot({ key: owner, ...normalized, readAt: new Date().toISOString() });
    } catch (caught) {
      if (request === sequence.current && scope.current === owner) setLoadError(`${preserve && current ? 'Không thể làm mới — đang giữ snapshot trước. ' : ''}${messageOf(caught)}`);
    } finally {
      if (request === sequence.current && scope.current === owner) setLoading(false);
    }
  }, [current, filters.page, filters.status, filters.test, filters.type, filters.user, key, offset, router]);

  useEffect(() => {
    scope.current = key; setSnapshot(null); setLoadError(null); void load(false);
    return () => { sequence.current += 1; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const attemptId = filters.attempt;
    const request = ++detailSequence.current;
    if (!attemptId) { setDetail(null); return; }
    const detailKey = `${profile.id}:${attemptId}`;
    setDetail({ key: detailKey, phase: 'loading' });
    void (async () => {
      try {
        const normalized = normalizeListeningAttemptDetail(await window.api.get<unknown>(`/admin/listening/attempts/${encodeURIComponent(attemptId)}`), attemptId) as Detail | null;
        if (!normalized) throw new Error('Phản hồi chi tiết không đúng identity hoặc contract.');
        if (request !== detailSequence.current) return;
        setDetail({ key: detailKey, phase: 'ready', value: normalized });
        window.requestAnimationFrame(() => detailHeading.current?.focus());
      } catch (caught) {
        if (request === detailSequence.current) setDetail({ key: detailKey, phase: 'error', message: messageOf(caught) });
      }
    })();
    return () => { detailSequence.current += 1; };
  }, [filters.attempt, profile.id]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    router.push(listeningAttemptsHref({ ...filters, ...draft, page: 1, attempt: '' }));
  };
  const selectAttempt = (attempt: string) => router.push(listeningAttemptsHref({ ...filters, attempt }));
  const closeDetail = () => router.push(listeningAttemptsHref({ ...filters, attempt: '' }));
  const maxPage = current ? Math.max(1, Math.ceil(current.total / PAGE_SIZE)) : 1;
  const activeFilterCount = [filters.user, filters.test, filters.type !== 'all', filters.status !== 'all'].filter(Boolean).length;

  return <main className="ala-shell">
    <header className="ala-hero">
      <div><p className="alc-eyebrow">Listening · Learner evidence</p><h1>Lượt làm bài Listening</h1><p>Đọc lịch sử nộp bài, thời lượng và đáp án từng câu từ cùng nguồn dữ liệu mà hệ thống chấm điểm đã lưu.</p></div>
      <div className="ala-hero__actions"><a className="adm-btn-secondary" href="/admin/listening/tests">Kho test</a><a className="adm-btn-secondary" href="/pages/admin/listening/dictation-reports.html">Báo cáo dictation ↗</a></div>
    </header>

    <section className="ala-context" aria-labelledby="ala-context-title"><div><p className="alc-eyebrow">Canonical read boundary</p><h2 id="ala-context-title">Một attempt, ba lớp bằng chứng</h2></div><ol><li><span>1</span><strong>Danh tính</strong><small>user + test association</small></li><li><span>2</span><strong>Kết quả</strong><small>điểm, tỉ lệ, thời lượng</small></li><li><span>3</span><strong>Từng câu</strong><small>trả lời, đáp án, trap</small></li></ol></section>

    <section className="ala-library" aria-labelledby="ala-list-title">
      <div className="ala-section-head"><div><p>Attempt inventory</p><h2 id="ala-list-title">Lịch sử đã lưu</h2><span>{current ? `${current.total} lượt · ${activeFilterCount} bộ lọc · đọc lúc ${formatListeningAttemptDate(current.readAt)}` : 'Đang đọc từ backend…'}</span></div><button className="adm-btn-secondary" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
      <form className="ala-filters" onSubmit={applyFilters}>
        <label><span>Học viên</span><input type="search" value={draft.user} placeholder="Email hoặc tên" onChange={(event) => setDraft((value) => ({ ...value, user: event.target.value }))} /></label>
        <label><span>Bài Listening</span><input type="search" value={draft.test} placeholder="Test ID hoặc tiêu đề" onChange={(event) => setDraft((value) => ({ ...value, test: event.target.value }))} /></label>
        <label><span>Loại bài</span><select value={draft.type} onChange={(event) => setDraft((value) => ({ ...value, type: event.target.value as TestType }))}>{TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Trạng thái</span><select value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as Status }))}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="ala-filter-actions"><button className="adm-btn-primary" type="submit">Áp dụng</button>{activeFilterCount > 0 && <button className="adm-btn-secondary" type="button" onClick={() => router.push('/admin/listening/attempts')}>Xóa lọc</button>}</div>
      </form>

      {loadError && <div className="alc-banner is-error" role="alert"><strong>Không tải được attempt inventory</strong><span>{loadError}</span></div>}
      {current?.associationLookupFailed && <div className="alc-banner is-warning" role="alert"><strong>Lookup association thất bại</strong><span>Không đọc được {lookupLabel(current.associationLookupFailures)}. Các ô liên quan được đánh dấu lỗi, không bị diễn giải thành dữ liệu trống.</span></div>}
      {!!current?.malformedCount && <div className="alc-banner is-warning" role="status"><strong>Dữ liệu cần kiểm tra</strong><span>Đã loại {current.malformedCount} dòng sai contract; tổng backend vẫn giữ nguyên.</span></div>}
      {loading && !current && <div className="ala-state" role="status">Đang đọc lịch sử làm bài…</div>}
      {current && !current.rows.length && <div className="ala-state"><strong>Không có attempt phù hợp</strong><span>Thử bỏ bớt bộ lọc hoặc kiểm tra lại Test ID.</span></div>}
      {!!current?.rows.length && <div className="ala-table-wrap" role="region" aria-label="Bảng lượt làm bài Listening" tabIndex={0}><table className="ala-table"><thead><tr><th>Thời điểm</th><th>Học viên</th><th>Bài</th><th>Trạng thái</th><th>Kết quả</th><th>Thời lượng</th><th></th></tr></thead><tbody>{current.rows.map((row) => <AttemptRow key={row.id} row={row} failedLookups={current.associationLookupFailures} selected={filters.attempt === row.id} onSelect={selectAttempt} />)}</tbody></table></div>}
      {current && current.total > PAGE_SIZE && <nav className="ala-pagination" aria-label="Phân trang lượt làm bài"><button type="button" disabled={loading || filters.page === 1} onClick={() => router.push(listeningAttemptsHref({ ...filters, page: filters.page - 1 }))}>← Trước</button><span>Trang {filters.page}/{maxPage} · {current.total} lượt</span><button type="button" disabled={loading || offset + PAGE_SIZE >= current.total} onClick={() => router.push(listeningAttemptsHref({ ...filters, page: filters.page + 1 }))}>Sau →</button></nav>}
    </section>

    {filters.attempt && <AttemptDetail state={detail} expectedKey={`${profile.id}:${filters.attempt}`} headingRef={detailHeading} onClose={closeDetail} />}
    <a className="alc-rollback" href={listeningAttemptsRollbackHref(filters)}>Mở bản HTML rollback{filters.user ? ' · giữ bộ lọc học viên' : ''} ↗</a>
  </main>;
}

function AttemptRow({ row, failedLookups, selected, onSelect }: { row: Row; failedLookups: string[]; selected: boolean; onSelect: (id: string) => void }) {
  const userFailed = failedLookups.includes('users');
  const testFailed = failedLookups.includes('listening_tests');
  return <tr data-attempt-id={row.id} aria-current={selected ? 'true' : undefined}>
    <td data-label="Thời điểm"><time dateTime={row.submittedAt || row.createdAt || undefined}>{formatListeningAttemptDate(row.submittedAt || row.createdAt)}</time><code>{row.id}</code></td>
    <td data-label="Học viên"><strong>{userFailed ? '⚠ Lookup failed' : row.user.displayName || row.user.email || 'Association không còn'}</strong><small>{userFailed ? row.user.id : row.user.email || row.user.id}</small></td>
    <td data-label="Bài"><strong>{testFailed ? '⚠ Lookup failed' : row.test.title || row.test.testId || 'Association không còn'}</strong><small>{testFailed ? row.test.id : [row.test.testId, row.test.type ? LISTENING_ATTEMPT_TYPE_LABEL[row.test.type] : null].filter(Boolean).join(' · ') || row.test.id}</small></td>
    <td data-label="Trạng thái"><span className={`adm-status-pill ${statusClass(row.status)}`}>{LISTENING_ATTEMPT_STATUS_LABEL[row.status]}</span></td>
    <td data-label="Kết quả">{row.score == null || row.totalQuestions == null ? <span>—</span> : <><strong>{row.score}/{row.totalQuestions}</strong><small className={`ala-accuracy ${accuracyClass(row.accuracy)}`}>{Math.round((row.accuracy || 0) * 100)}%</small></>}</td>
    <td data-label="Thời lượng"><span>{formatListeningAttemptDuration(row.durationSeconds)}</span></td>
    <td data-label="Thao tác"><button type="button" className="ala-open" aria-pressed={selected} onClick={() => onSelect(row.id)}>Xem từng câu</button></td>
  </tr>;
}

function AttemptDetail({ state, expectedKey, headingRef, onClose }: { state: DetailState | null; expectedKey: string; headingRef: RefObject<HTMLHeadingElement | null>; onClose: () => void }) {
  const current = state?.key === expectedKey ? state : null;
  return <section className="ala-detail" aria-labelledby="ala-detail-title">
    <div className="ala-detail__head"><div><p className="alc-eyebrow">Per-question evidence</p><h2 id="ala-detail-title" tabIndex={-1} ref={headingRef}>Chi tiết lượt làm bài</h2></div><button className="adm-btn-secondary" type="button" onClick={onClose}>Đóng</button></div>
    {(!current || current.phase === 'loading') && <div className="ala-state" role="status">Đang đọc chi tiết attempt…</div>}
    {current?.phase === 'error' && <div className="alc-banner is-error" role="alert"><strong>Không tải được chi tiết</strong><span>{current.message}</span></div>}
    {current?.phase === 'ready' && <DetailBody detail={current.value} />}
  </section>;
}

function DetailBody({ detail }: { detail: Detail }) {
  return <>
    {detail.associationLookupFailed && <div className="alc-banner is-warning" role="alert"><strong>Lookup association thất bại</strong><span>Không đọc được {lookupLabel(detail.associationLookupFailures)} cho attempt này.</span></div>}
    {!!detail.malformedQuestionCount && <div className="alc-banner is-warning" role="status"><strong>Chi tiết cần kiểm tra</strong><span>Đã loại {detail.malformedQuestionCount} dòng chấm sai contract.</span></div>}
    <div className="ala-detail__summary"><div><span>Học viên</span><strong>{detail.user.displayName || detail.user.email || detail.user.id}</strong></div><div><span>Bài</span><strong>{detail.test.title || detail.test.testId || detail.test.id}</strong></div><div><span>Điểm</span><strong>{detail.score == null ? '—' : `${detail.score}/${detail.totalQuestions}`}</strong></div><div><span>Band ước lượng</span><strong>{detail.bandEstimate ?? '—'}</strong></div><div><span>Thời lượng</span><strong>{formatListeningAttemptDuration(detail.durationSeconds)}</strong></div><div><span>Trap</span><strong>{detail.trapSummary ? `${detail.trapSummary.caught} tránh · ${detail.trapSummary.missed} dính` : '—'}</strong></div></div>
    {!detail.questions.length ? <div className="ala-state"><strong>Chưa có chấm điểm từng câu</strong><span>Attempt đang làm hoặc đã bỏ dở có thể chưa tạo grading details.</span></div> : <div className="ala-question-wrap" role="region" aria-label="Đáp án từng câu" tabIndex={0}><table className="ala-question-table"><thead><tr><th>Kết quả</th><th>Câu</th><th>Học viên trả lời</th><th>Đáp án</th><th>Trap</th></tr></thead><tbody>{detail.questions.map((question) => <tr key={question.qNum} className={question.correct ? 'is-correct' : 'is-wrong'}><td data-label="Kết quả"><span aria-label={question.correct ? 'Đúng' : 'Sai'}>{question.correct ? '✓' : '✕'}</span></td><td data-label="Câu"><strong>{question.qNum}</strong></td><td data-label="Học viên trả lời">{question.userAnswer || <em>(bỏ trống)</em>}</td><td data-label="Đáp án">{question.expected ?? '—'}</td><td data-label="Trap">{question.trapCaught ? 'Tránh được' : question.trapMissed ? 'Đã dính' : '—'}</td></tr>)}</tbody></table></div>}
  </>;
}
