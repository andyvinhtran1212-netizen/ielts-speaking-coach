'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  dictationReportsHref, dictationReportsRollbackHref,
  formatDictationDuration, formatDictationReportDate,
  normalizeDictationAggregate, normalizeDictationReportDetail,
  normalizeDictationReportFilters, normalizeDictationReportList,
} from '@/lib/admin-listening-dictation-model.mjs';

type Filters = { user: string; test: string; page: number; session: string };
type User = { id: string; email: string | null; displayName: string | null };
type Row = { id: string; user: User; totalSentences: number; correctCount: number; accuracy: number; sectionNumber: number | null; durationSeconds: number | null; testId: string | null; sectionTitle: string | null; completedAt: string | null; createdAt: string | null };
type Sentence = { index: number; reference: string; userText: string; score: number; correctWords: number; totalWords: number; listenCount: number | null; timeSeconds: number | null; ops: { miss: number; wrong: number; extra: number } };
type Detail = Row & { totalWords: number; correctWords: number; sentences: Sentence[]; malformedSentenceCount: number; missingSentenceCount: number; opCounts: { miss: number; wrong: number; extra: number } | null; associationLookupFailed: boolean; associationLookupFailures: string[] };
type Aggregate = { sessionCount: number; meanAccuracy: number; topMissed: Array<{ label: string; count: number }>; topWrong: Array<{ label: string; count: number }>; malformedWordCount: number };
type ListSnapshot = { key: string; rows: Row[]; total: number; malformedCount: number; associationLookupFailed: boolean; associationLookupFailures: string[]; readAt: string };
type AggregateState = { key: string; phase: 'loading' } | { key: string; phase: 'ready'; value: Aggregate } | { key: string; phase: 'error'; message: string };
type DetailState = { key: string; phase: 'loading' } | { key: string; phase: 'ready'; value: Detail } | { key: string; phase: 'error'; message: string };

const PAGE_SIZE = 50;
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const accuracyTone = (value: number) => value >= .85 ? 'is-high' : value >= .6 ? 'is-mid' : 'is-low';
const accuracyLabel = (value: number) => value >= .85 ? 'Cao' : value >= .6 ? 'Đang cải thiện' : 'Cần xem lại';

export function AdminListeningDictation() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = normalizeDictationReportFilters({ user: params?.get('user'), test: params?.get('test'), page: params?.get('page'), session: params?.get('session') }) as Filters;
  const [draft, setDraft] = useState({ user: filters.user, test: filters.test });
  const offset = (filters.page - 1) * PAGE_SIZE;
  const listKey = `${profile.id}:${filters.user}:${filters.test}:${offset}`;
  const aggregateKey = `${profile.id}:${filters.user}:${filters.test}`;
  const listScope = useRef(listKey);
  const aggregateScope = useRef(aggregateKey);
  const listSequence = useRef(0);
  const aggregateSequence = useRef(0);
  const detailSequence = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const [snapshot, setSnapshot] = useState<ListSnapshot | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<AggregateState | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const current = snapshot?.key === listKey ? snapshot : null;
  const currentAggregate = aggregate?.key === aggregateKey ? aggregate : null;

  useEffect(() => setDraft({ user: filters.user, test: filters.test }), [filters.test, filters.user]);

  const queryForScope = useCallback((includePage: boolean) => {
    const query = new URLSearchParams();
    if (filters.user) query.set('user_query', filters.user);
    if (filters.test) query.set('test_id', filters.test);
    if (includePage) { query.set('limit', String(PAGE_SIZE)); query.set('offset', String(offset)); }
    return query;
  }, [filters.test, filters.user, offset]);

  const loadList = useCallback(async (preserve = true) => {
    const request = ++listSequence.current;
    const owner = listKey;
    setListLoading(true); setListError(null);
    try {
      const normalized = normalizeDictationReportList(await window.api.get<unknown>(`/admin/listening/dictation-reports?${queryForScope(true)}`), { limit: PAGE_SIZE, offset }) as Omit<ListSnapshot, 'key' | 'readAt'> | null;
      if (!normalized) throw new Error('Phản hồi danh sách không đúng contract canonical.');
      if (request !== listSequence.current || listScope.current !== owner) return;
      const lastPage = Math.max(1, Math.ceil(normalized.total / PAGE_SIZE));
      if (!normalized.rows.length && filters.page > lastPage) {
        router.replace(dictationReportsHref({ ...filters, page: lastPage }));
        return;
      }
      setSnapshot({ key: owner, ...normalized, readAt: new Date().toISOString() });
    } catch (caught) {
      if (request === listSequence.current && listScope.current === owner) setListError(`${preserve && current ? 'Không thể làm mới — đang giữ snapshot trước. ' : ''}${messageOf(caught)}`);
    } finally {
      if (request === listSequence.current && listScope.current === owner) setListLoading(false);
    }
  }, [current, filters, listKey, offset, queryForScope, router]);

  const loadAggregate = useCallback(async () => {
    const request = ++aggregateSequence.current;
    const owner = aggregateKey;
    setAggregate({ key: owner, phase: 'loading' });
    try {
      const normalized = normalizeDictationAggregate(await window.api.get<unknown>(`/admin/listening/dictation-reports/aggregate?${queryForScope(false)}`)) as Aggregate | null;
      if (!normalized) throw new Error('Phản hồi tổng hợp không đúng contract canonical.');
      if (request !== aggregateSequence.current || aggregateScope.current !== owner) return;
      setAggregate({ key: owner, phase: 'ready', value: normalized });
    } catch (caught) {
      if (request === aggregateSequence.current && aggregateScope.current === owner) setAggregate({ key: owner, phase: 'error', message: messageOf(caught) });
    }
  }, [aggregateKey, queryForScope]);

  useEffect(() => {
    listScope.current = listKey; setSnapshot(null); setListError(null); void loadList(false);
    return () => { listSequence.current += 1; };
  }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    aggregateScope.current = aggregateKey; void loadAggregate();
    return () => { aggregateSequence.current += 1; };
  }, [aggregateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sessionId = filters.session;
    const request = ++detailSequence.current;
    if (!sessionId) { setDetail(null); return; }
    const key = `${profile.id}:${sessionId}`;
    setDetail({ key, phase: 'loading' });
    void (async () => {
      try {
        const normalized = normalizeDictationReportDetail(await window.api.get<unknown>(`/admin/listening/dictation-reports/${encodeURIComponent(sessionId)}`), sessionId) as Detail | null;
        if (!normalized) throw new Error('Phản hồi chi tiết không đúng identity hoặc contract.');
        if (request !== detailSequence.current) return;
        setDetail({ key, phase: 'ready', value: normalized });
        window.requestAnimationFrame(() => detailHeading.current?.focus());
      } catch (caught) {
        if (request === detailSequence.current) setDetail({ key, phase: 'error', message: messageOf(caught) });
      }
    })();
    return () => { detailSequence.current += 1; };
  }, [filters.session, profile.id]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    router.push(dictationReportsHref({ ...filters, ...draft, page: 1, session: '' }));
  };
  const selectSession = (session: string) => router.push(dictationReportsHref({ ...filters, session }));
  const closeDetail = () => router.push(dictationReportsHref({ ...filters, session: '' }));
  const maxPage = current ? Math.max(1, Math.ceil(current.total / PAGE_SIZE)) : 1;
  const activeFilterCount = [filters.user, filters.test].filter(Boolean).length;

  return <main className="aldict-shell">
    <header className="aldict-hero">
      <div><p className="alc-eyebrow">Listening · Dictation evidence</p><h1>Báo cáo chép chính tả</h1><p>Từ tổng quan lỗi thường gặp đến từng câu chuẩn và phần học viên đã gõ — cùng một phạm vi lọc canonical.</p></div>
      <div className="aldict-hero__actions"><a className="adm-btn-secondary" href="/admin/listening/attempts">Lượt làm bài</a><a className="adm-btn-secondary" href="/admin/feedback">Feedback inbox</a></div>
    </header>

    <section className="aldict-context" aria-labelledby="aldict-context-title"><div><p className="alc-eyebrow">Review path</p><h2 id="aldict-context-title">Đọc từ tín hiệu đến bằng chứng</h2></div><ol><li><span>1</span><strong>Xu hướng</strong><small>accuracy + từ thường sai</small></li><li><span>2</span><strong>Phiên học</strong><small>người học + test + thời lượng</small></li><li><span>3</span><strong>Từng câu</strong><small>câu chuẩn + câu đã gõ + lỗi</small></li></ol></section>

    <section className="aldict-workspace" aria-labelledby="aldict-list-title">
      <div className="aldict-section-head"><div><p>Canonical report scope</p><h2 id="aldict-list-title">Phiên chép chính tả đã lưu</h2><span>{current ? `${current.total} phiên · ${activeFilterCount} bộ lọc · đọc lúc ${formatDictationReportDate(current.readAt)}` : 'Đang đọc từ backend…'}</span></div><button className="adm-btn-secondary" type="button" disabled={listLoading} onClick={() => { void loadList(); void loadAggregate(); }}>{listLoading ? 'Đang tải…' : 'Làm mới tất cả'}</button></div>

      <form className="aldict-filters" onSubmit={applyFilters}>
        <label><span>Học viên</span><input type="search" value={draft.user} placeholder="Email hoặc tên" onChange={(event) => setDraft((value) => ({ ...value, user: event.target.value }))} /></label>
        <label><span>Test ID</span><input type="search" value={draft.test} placeholder="Ví dụ C19-T1" onChange={(event) => setDraft((value) => ({ ...value, test: event.target.value }))} /></label>
        <div className="aldict-filter-actions"><button className="adm-btn-primary" type="submit">Áp dụng</button>{activeFilterCount > 0 && <button className="adm-btn-secondary" type="button" onClick={() => router.push('/admin/listening/dictation')}>Xóa lọc</button>}</div>
      </form>

      <AggregatePanel state={currentAggregate} expectedKey={aggregateKey} onRetry={loadAggregate} />

      {listError && <div className="alc-banner is-error" role="alert"><strong>Không tải được danh sách</strong><span>{listError}</span></div>}
      {current?.associationLookupFailed && <div className="alc-banner is-warning" role="alert"><strong>Lookup học viên thất bại</strong><span>Danh tính được đánh dấu lỗi; session vẫn giữ nguyên, không bị diễn giải thành dữ liệu trống.</span></div>}
      {!!current?.malformedCount && <div className="alc-banner is-warning" role="status"><strong>Dữ liệu cần kiểm tra</strong><span>Đã loại {current.malformedCount} dòng sai contract; tổng backend vẫn giữ nguyên.</span></div>}
      {listLoading && !current && <div className="aldict-state" role="status">Đang đọc các phiên chép chính tả…</div>}
      {current && !current.rows.length && <div className="aldict-state"><strong>Không có phiên phù hợp</strong><span>Thử bỏ bớt bộ lọc hoặc kiểm tra lại Test ID.</span></div>}
      {!!current?.rows.length && <div className="aldict-table-wrap" role="region" aria-label="Bảng phiên chép chính tả" tabIndex={0}><table className="aldict-table"><thead><tr><th>Hoàn thành</th><th>Học viên</th><th>Test & phần</th><th>Câu hoàn hảo</th><th>Độ chính xác</th><th>Thời lượng</th><th></th></tr></thead><tbody>{current.rows.map((row) => <ReportRow key={row.id} row={row} lookupFailed={current.associationLookupFailures.includes('users')} selected={filters.session === row.id} onSelect={selectSession} />)}</tbody></table></div>}
      {current && current.total > PAGE_SIZE && <nav className="aldict-pagination" aria-label="Phân trang phiên dictation"><button type="button" disabled={listLoading || filters.page === 1} onClick={() => router.push(dictationReportsHref({ ...filters, page: filters.page - 1 }))}>← Trước</button><span>Trang {filters.page}/{maxPage} · {current.total} phiên</span><button type="button" disabled={listLoading || offset + PAGE_SIZE >= current.total} onClick={() => router.push(dictationReportsHref({ ...filters, page: filters.page + 1 }))}>Sau →</button></nav>}
    </section>

    {filters.session && <ReportDetail state={detail} expectedKey={`${profile.id}:${filters.session}`} headingRef={detailHeading} onClose={closeDetail} />}
    <a className="alc-rollback" href={dictationReportsRollbackHref(filters)}>Mở bản HTML rollback{filters.user ? ' · giữ bộ lọc học viên' : ''} ↗</a>
  </main>;
}

function AggregatePanel({ state, expectedKey, onRetry }: { state: AggregateState | null; expectedKey: string; onRetry: () => void }) {
  const current = state?.key === expectedKey ? state : null;
  if (!current || current.phase === 'loading') return <section className="aldict-aggregate" aria-label="Tổng hợp dictation"><div className="aldict-state" role="status">Đang tính tổng hợp cùng phạm vi lọc…</div></section>;
  if (current.phase === 'error') return <section className="aldict-aggregate" aria-label="Tổng hợp dictation"><div className="alc-banner is-error" role="alert"><strong>Không tải được tổng hợp</strong><span>{current.message}</span><button className="adm-btn-secondary" type="button" onClick={onRetry}>Thử lại tổng hợp</button></div></section>;
  const value = current.value;
  return <section className="aldict-aggregate" aria-labelledby="aldict-aggregate-title">
    <div className="aldict-aggregate__head"><div><p className="alc-eyebrow">Aggregate</p><h3 id="aldict-aggregate-title">Tín hiệu trong phạm vi hiện tại</h3></div><span>Không lấy mẫu; backend đọc hết các trang dữ liệu.</span></div>
    {!!value.malformedWordCount && <div className="alc-banner is-warning" role="status"><strong>Từ lỗi sai contract</strong><span>Đã loại {value.malformedWordCount} mục trend không hợp lệ.</span></div>}
    <div className="aldict-kpis"><article><span>Số phiên</span><strong>{value.sessionCount}</strong><small>phiên hoàn tất</small></article><article><span>Chính xác trung bình</span><strong>{value.sessionCount ? `${Math.round(value.meanAccuracy * 100)}%` : '—'}</strong><small>{value.sessionCount ? accuracyLabel(value.meanAccuracy) : 'Chưa có dữ liệu'}</small></article></div>
    <div className="aldict-trends"><WordTrend title="Từ hay bỏ sót" rows={value.topMissed} /><WordTrend title="Từ hay viết sai" rows={value.topWrong} /></div>
  </section>;
}

function WordTrend({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  return <article><h4>{title}</h4>{rows.length ? <ul>{rows.map((row) => <li key={row.label}><span>{row.label}</span><strong>{row.count}</strong></li>)}</ul> : <p>Chưa có lỗi loại này trong phạm vi.</p>}</article>;
}

function ReportRow({ row, lookupFailed, selected, onSelect }: { row: Row; lookupFailed: boolean; selected: boolean; onSelect: (id: string) => void }) {
  return <tr data-session-id={row.id} aria-current={selected ? 'true' : undefined}>
    <td data-label="Hoàn thành"><time dateTime={row.completedAt || row.createdAt || undefined}>{formatDictationReportDate(row.completedAt || row.createdAt)}</time><code>{row.id}</code></td>
    <td data-label="Học viên"><strong>{lookupFailed ? '⚠ Lookup failed' : row.user.displayName || row.user.email || 'Association không còn'}</strong><small>{lookupFailed ? row.user.id : row.user.email || row.user.id}</small></td>
    <td data-label="Test & phần"><strong>{row.testId || 'Test đã xóa'}</strong><small>{row.sectionTitle || (row.sectionNumber == null ? 'Không rõ phần' : `Section ${row.sectionNumber}`)}</small></td>
    <td data-label="Câu hoàn hảo"><strong>{row.correctCount}/{row.totalSentences}</strong><small>điểm câu = 100%</small></td>
    <td data-label="Độ chính xác"><strong className={`aldict-accuracy ${accuracyTone(row.accuracy)}`}>{Math.round(row.accuracy * 100)}%</strong><small>{accuracyLabel(row.accuracy)}</small></td>
    <td data-label="Thời lượng"><span>{formatDictationDuration(row.durationSeconds)}</span></td>
    <td data-label="Thao tác"><button className="aldict-open" type="button" aria-pressed={selected} onClick={() => onSelect(row.id)}>Xem từng câu</button></td>
  </tr>;
}

function ReportDetail({ state, expectedKey, headingRef, onClose }: { state: DetailState | null; expectedKey: string; headingRef: RefObject<HTMLHeadingElement | null>; onClose: () => void }) {
  const current = state?.key === expectedKey ? state : null;
  return <section className="aldict-detail" aria-labelledby="aldict-detail-title">
    <div className="aldict-detail__head"><div><p className="alc-eyebrow">Sentence evidence</p><h2 id="aldict-detail-title" tabIndex={-1} ref={headingRef}>Chi tiết phiên chép chính tả</h2></div><button className="adm-btn-secondary" type="button" onClick={onClose}>Đóng</button></div>
    {(!current || current.phase === 'loading') && <div className="aldict-state" role="status">Đang đọc chi tiết phiên…</div>}
    {current?.phase === 'error' && <div className="alc-banner is-error" role="alert"><strong>Không tải được chi tiết</strong><span>{current.message}</span></div>}
    {current?.phase === 'ready' && <DetailBody detail={current.value} />}
  </section>;
}

function DetailBody({ detail }: { detail: Detail }) {
  const userName = detail.associationLookupFailed ? '⚠ Lookup failed' : detail.user.displayName || detail.user.email || detail.user.id;
  return <>
    {detail.associationLookupFailed && <div className="alc-banner is-warning" role="alert"><strong>Lookup học viên thất bại</strong><span>Không đọc được danh tính canonical cho phiên này; evidence vẫn được giữ nguyên.</span></div>}
    {!!detail.malformedSentenceCount && <div className="alc-banner is-warning" role="status"><strong>Chi tiết cần kiểm tra</strong><span>Đã loại {detail.malformedSentenceCount} câu sai hoặc trùng contract.</span></div>}
    {!!detail.missingSentenceCount && <div className="alc-banner is-warning" role="alert"><strong>Evidence chưa đầy đủ</strong><span>Thiếu {detail.missingSentenceCount}/{detail.totalSentences} câu so với tổng canonical; không dùng bảng dưới để thay thế kết quả tổng.</span></div>}
    <div className="aldict-detail__summary"><div><span>Học viên</span><strong>{userName}</strong><small>{detail.user.email || detail.user.id}</small></div><div><span>Test & phần</span><strong>{detail.testId || 'Test đã xóa'}</strong><small>{detail.sectionTitle || `Section ${detail.sectionNumber ?? '?'}`}</small></div><div><span>Độ chính xác</span><strong>{Math.round(detail.accuracy * 100)}%</strong><small>{accuracyLabel(detail.accuracy)}</small></div><div><span>Câu hoàn hảo</span><strong>{detail.correctCount}/{detail.totalSentences}</strong><small>score = 100%</small></div><div><span>Từ đúng</span><strong>{detail.correctWords}/{detail.totalWords}</strong><small>word-level evidence</small></div><div><span>Thời lượng</span><strong>{formatDictationDuration(detail.durationSeconds)}</strong><small>{detail.opCounts ? `sót ${detail.opCounts.miss} · sai ${detail.opCounts.wrong} · thừa ${detail.opCounts.extra}` : 'Không có error trend'}</small></div></div>
    {!detail.sentences.length ? <div className="aldict-state"><strong>Phiên không có evidence từng câu</strong><span>Summary vẫn là dữ liệu canonical; kiểm tra record nếu đây không phải dữ liệu cũ.</span></div> : <div className="aldict-sentence-wrap" role="region" aria-label="Chi tiết từng câu dictation" tabIndex={0}><table className="aldict-sentence-table"><thead><tr><th>Câu</th><th>Điểm</th><th>Câu chuẩn</th><th>Học viên gõ</th><th>Nghe & thời gian</th><th>Lỗi</th></tr></thead><tbody>{detail.sentences.map((sentence) => <tr key={sentence.index}><td data-label="Câu"><strong>{sentence.index + 1}</strong></td><td data-label="Điểm"><strong className={`aldict-accuracy ${accuracyTone(sentence.score)}`}>{Math.round(sentence.score * 100)}%</strong><small>{sentence.correctWords}/{sentence.totalWords} từ</small></td><td data-label="Câu chuẩn">{sentence.reference}</td><td data-label="Học viên gõ">{sentence.userText || <em>(bỏ trống)</em>}</td><td data-label="Nghe & thời gian"><span>{sentence.listenCount == null ? '— lượt nghe' : `${sentence.listenCount} lượt nghe`}</span><small>{formatDictationDuration(sentence.timeSeconds)}</small></td><td data-label="Lỗi"><span>sót {sentence.ops.miss}</span><small>sai {sentence.ops.wrong} · thừa {sentence.ops.extra}</small></td></tr>)}</tbody></table></div>}
  </>;
}
