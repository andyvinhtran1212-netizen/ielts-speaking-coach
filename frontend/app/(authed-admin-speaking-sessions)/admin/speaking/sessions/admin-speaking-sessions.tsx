'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Dialog, Field, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { useAdminProfile } from '@/components/admin-access-gate';
import {
  normalizeResponseRegrade,
  normalizeSessionRegrade,
  normalizeSpeakingSessionDetail,
  normalizeSpeakingSessionFilters,
  normalizeSpeakingSessionList,
  normalizeSummaryRebuild,
  speakingSessionFilterKey,
  speakingSessionSearch,
} from '@/lib/admin-speaking-sessions-model.mjs';

import type { SessionAction, SpeakingFeedback, SpeakingSessionDetail, SpeakingSessionFilters, SpeakingSessionRow } from './admin-speaking-sessions-types';

const PAGE_LIMIT = 50;
const MODE: Record<string, string> = { practice: 'Luyện tập', test_part: 'Thi từng Part', test_full: 'Full Test' };
const STATUS: Record<string, string> = { in_progress: 'Đang làm', completed: 'Hoàn tất', grading_failed: 'Chấm lỗi' };
const ERROR: Record<string, string> = { stt_failed: 'STT lỗi', grading_failed: 'Chấm lỗi', save_failed: 'Lưu lỗi', pdf_failed: 'PDF lỗi' };

function formatTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Không rõ' : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function bandTone(value: number | null) {
  return value == null ? '' : value >= 7 ? ' is-good' : value >= 5.5 ? ' is-mid' : ' is-low';
}

function Band({ value }: { value: number | null }) {
  return <span className={`ass-band${bandTone(value)}`}>{value == null ? '—' : value.toFixed(1)}</span>;
}

function statusTone(status: string | null) {
  return status === 'completed' ? 'is-active' : status === 'grading_failed' ? 'is-warning' : 'is-archived';
}

function FeedbackReport({ feedback }: { feedback: SpeakingFeedback | null }) {
  if (!feedback) return null;
  const sections = [
    ['Fluency & Coherence', feedback.fc], ['Lexical Resource', feedback.lr], ['Grammar', feedback.gra],
    ['Pronunciation', feedback.pronunciation], ['Câu trả lời mẫu', feedback.sampleAnswer],
  ] as const;
  const lists = [
    ['Điểm mạnh', feedback.strengths], ['Cần cải thiện', feedback.improvements],
    ['Lỗi ngữ pháp', feedback.grammarIssues], ['Lỗi từ vựng', feedback.vocabularyIssues],
  ] as const;
  const hasContent = sections.some(([, value]) => value) || lists.some(([, value]) => value.length);
  return <details className="ass-feedback"><summary>Báo cáo nhận xét</summary><div className="ass-feedback__body">
    {!hasContent && <p>Đã chấm nhưng không có nội dung nhận xét để hiển thị.</p>}
    {sections.map(([label, value]) => value && <section key={label}><h5>{label}</h5><p>{value}</p></section>)}
    {lists.map(([label, values]) => values.length > 0 && <section key={label}><h5>{label}</h5><ul>{values.map((value, index) => <li key={`${label}-${index}`}>{value}</li>)}</ul></section>)}
  </div></details>;
}

function SessionDetail({ data, busy, onAction }: { data: SpeakingSessionDetail; busy: boolean; onAction: (action: SessionAction) => void }) {
  const responseMap = useMemo(() => new Map(data.responses.map((response) => [response.questionId, response])), [data.responses]);
  const degraded = data.userLookupFailed || data.questionsLookupFailed || data.responsesLookupFailed || data.fullTestSiblingsLookupFailed || data.malformedQuestions > 0 || data.malformedResponses > 0;
  return <div className="ass-detail">
    {degraded && <div className="ass-warning" role="alert"><strong>Chi tiết chưa đầy đủ.</strong><span>{[
      data.userLookupFailed ? 'Không tra được hồ sơ học viên.' : '', data.questionsLookupFailed ? 'Không đọc được câu hỏi.' : '',
      data.responsesLookupFailed ? 'Không đọc được câu trả lời.' : '', data.malformedQuestions ? `${data.malformedQuestions} câu hỏi sai định dạng.` : '',
      data.malformedResponses ? `${data.malformedResponses} câu trả lời sai định dạng.` : '',
      data.fullTestSiblingsLookupFailed ? 'Không xác minh được các Part cùng Full Test.' : '',
    ].filter(Boolean).join(' ')}</span></div>}
    <dl className="ass-detail__meta">
      <div><dt>Session ID</dt><dd><code>{data.id}</code></dd></div>
      <div><dt>Học viên</dt><dd>{data.userDisplayName || data.userEmail || data.userId || 'Không rõ'}{data.userLookupFailed && <small>Lookup hồ sơ lỗi</small>}</dd></div>
      <div><dt>Mode</dt><dd>{MODE[data.mode || ''] || data.mode || '—'}{data.part != null && ` · Part ${data.part}`}</dd></div>
      <div><dt>Trạng thái</dt><dd><span className={`adm-status-pill ${statusTone(data.status)}`}>{STATUS[data.status || ''] || data.status || '—'}</span></dd></div>
      <div><dt>Chủ đề</dt><dd>{data.topic || '—'}</dd></div>
      <div><dt>Bắt đầu</dt><dd>{formatTime(data.startedAt)}</dd></div>
    </dl>
    <section className="ass-score-panel" aria-label="Band hiện tại">
      <div className="ass-score-panel__overall"><span>Overall</span><Band value={data.overallBand} /></div>
      {[['FC', data.bandFc], ['LR', data.bandLr], ['GRA', data.bandGra], ['P', data.bandP]].map(([label, value]) => <div key={String(label)}><span>{label}</span><Band value={value as number | null} /></div>)}
    </section>
    {data.errorCode && <section className="ass-error-card" role="alert"><div><span>{ERROR[data.errorCode] || data.errorCode}</span><strong>{data.failedStep || 'Không rõ bước lỗi'}</strong></div><p>{data.errorMessage || 'Không có mô tả lỗi.'}</p><time dateTime={data.lastErrorAt || undefined}>{formatTime(data.lastErrorAt)}</time></section>}
    <section className="ass-repair"><div><p className="acd-eyebrow">Repair controls</p><h3>Khôi phục kết quả canonical</h3><span>Repair chỉ chấm các câu lỗi/thiếu. Full regrade có thể thay đổi cả điểm đang hợp lệ.</span></div><div>
      <button className="adm-btn-secondary" type="button" disabled={busy || data.responsesLookupFailed} onClick={() => onAction({ kind: 'repair', sessionId: data.id })}>Repair câu lỗi</button>
      <button className="adm-btn-secondary" type="button" disabled={busy || data.responsesLookupFailed} onClick={() => onAction({ kind: 'rebuild', sessionId: data.id, detailId: data.id, full: false, p2Id: null, p3Id: null })}>Tổng hợp lại</button>
      {data.mode === 'test_full' && <button className="adm-btn-secondary" type="button" disabled={busy || data.responsesLookupFailed || data.fullTestSiblingsLookupFailed || !data.p1SessionId || !data.p2SessionId || !data.p3SessionId} title={!data.p1SessionId || !data.p2SessionId || !data.p3SessionId ? 'Full Test chưa có đủ ba Part để tổng hợp.' : undefined} onClick={() => onAction({ kind: 'rebuild', sessionId: data.p1SessionId!, detailId: data.id, full: true, p2Id: data.p2SessionId, p3Id: data.p3SessionId })}>Tổng hợp Full Test</button>}
      <button className="adm-btn-danger" type="button" disabled={busy || data.responsesLookupFailed} onClick={() => onAction({ kind: 'force', sessionId: data.id })}>Full regrade</button>
    </div></section>
    {!data.questions.length && !data.questionsLookupFailed ? <div className="acd-state"><strong>Session chưa có câu hỏi</strong><span>Không có dữ liệu câu hỏi để đối chiếu.</span></div> : <div className="ass-responses">{data.questions.map((question, index) => {
      const response = responseMap.get(question.id);
      return <article className="ass-response" key={question.id}><header><span>Q{index + 1}</span><h4>{question.text || 'Câu hỏi không có nội dung'}</h4>{response && <Band value={response.overallBand} />}</header>
        {!response ? <p className="ass-muted">Chưa có câu trả lời.</p> : <>
          <div className="ass-response__status"><span>STT <strong>{response.sttStatus || '—'}</strong></span><span>Grading <strong>{response.gradingStatus || '—'}</strong></span></div>
          {response.audioUrl ? <audio controls preload="none" src={response.audioUrl}>Trình duyệt không hỗ trợ audio.</audio> : response.audioStored ? <p className="ass-warning is-compact">Audio có trong storage nhưng chưa lấy được URL phát an toàn.</p> : <p className="ass-muted">Không có audio.</p>}
          {response.transcript ? <blockquote className="ass-transcript">{response.transcript}</blockquote> : <p className="ass-muted">Chưa có transcript.</p>}
          <FeedbackReport feedback={response.feedback} />
          <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={busy} onClick={() => onAction({ kind: 'response', responseId: response.id, sessionId: data.id })}>Chấm lại câu này</button>
        </>}
      </article>;
    })}</div>}
  </div>;
}

function actionCopy(action: SessionAction | null) {
  if (!action) return { title: '', description: '', button: '' };
  if (action.kind === 'response') return { title: 'Chấm lại câu trả lời?', description: 'Kết quả cũ của câu này sẽ bị ghi đè; band session và điểm bài tập lớp sẽ được tính lại.', button: 'Chấm lại câu' };
  if (action.kind === 'repair') return { title: 'Repair các câu lỗi?', description: 'Chỉ câu grading failed hoặc chưa có band được chấm lại; các câu tốt được giữ nguyên.', button: 'Repair session' };
  if (action.kind === 'force') return { title: 'Full regrade toàn bộ session?', description: 'Mọi câu đều được chấm lại bằng logic hiện tại. Điểm có thể tăng, giảm hoặc giữ nguyên.', button: 'Full regrade' };
  return { title: action.full ? 'Tổng hợp lại Full Test?' : 'Tổng hợp lại band?', description: 'Không gọi AI; hệ thống tính lại band từ response đã lưu và đồng bộ điểm bài tập lớp.', button: 'Tổng hợp lại' };
}

export function AdminSpeakingSessions() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = useMemo(() => normalizeSpeakingSessionFilters({ email: params?.get('email') || '', mode: params?.get('mode') || '', status: params?.get('status') || '', error: params?.get('error') || '', dateFrom: params?.get('from') || '', dateTo: params?.get('to') || '' }) as SpeakingSessionFilters, [params]);
  const selectedId = params?.get('session')?.trim() || null;
  const [draft, setDraft] = useState<SpeakingSessionFilters>(filters);
  const [snapshot, setSnapshot] = useState<{ key: string; rows: SpeakingSessionRow[]; malformed: number } | null>(null);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SpeakingSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<SessionAction | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const mutationLock = useRef(false);
  const profileId = useRef(profile.id); profileId.current = profile.id;
  const filterKey = speakingSessionFilterKey(filters);
  const key = `${profile.id}\u0000${filterKey}`;
  const rows = snapshot?.key === key ? snapshot.rows : [];

  const loadList = useCallback(async (target: SpeakingSessionFilters, reset = true) => {
    const account = profile.id;
    const requestId = ++listSequence.current;
    reset ? setLoading(true) : setLoadingMore(true);
    setListError(null);
    const offset = reset ? 0 : nextOffset;
    try {
      const query = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(offset) });
      if (target.mode) query.set('mode', target.mode);
      if (target.status) query.set('status', target.status);
      if (target.error === 'has_error') query.set('has_error', 'true'); else if (target.error) query.set('error_code', target.error);
      if (target.dateFrom) query.set('date_from', target.dateFrom);
      if (target.dateTo) query.set('date_to', target.dateTo);
      if (target.email) {
        if (/^[0-9a-f-]{36}$/i.test(target.email)) query.set('user_id', target.email);
        else query.set('user_email', target.email);
      }
      const normalized = normalizeSpeakingSessionList(await window.api.get<unknown>(`/admin/sessions?${query}`)) as { rows: SpeakingSessionRow[]; malformedCount: number; returnedCount: number } | null;
      if (requestId !== listSequence.current || profileId.current !== account) return false;
      if (!normalized) throw new Error('Danh sách session không đúng định dạng.');
      const targetKey = `${account}\u0000${speakingSessionFilterKey(target)}`;
      const previous = !reset && snapshot?.key === targetKey ? snapshot.rows : [];
      const seen = new Set(previous.map((row) => row.id));
      const merged = [...previous, ...normalized.rows.filter((row) => !seen.has(row.id) && seen.add(row.id))];
      setSnapshot({ key: targetKey, rows: merged, malformed: (reset ? 0 : snapshot?.malformed || 0) + normalized.malformedCount });
      setNextOffset(offset + normalized.returnedCount);
      setHasMore(normalized.returnedCount === PAGE_LIMIT);
      return true;
    } catch (caught) {
      if (requestId === listSequence.current && profileId.current === account) setListError(messageOf(caught));
      return false;
    } finally {
      if (requestId === listSequence.current && profileId.current === account) { setLoading(false); setLoadingMore(false); }
    }
  }, [nextOffset, profile.id, snapshot]);

  const loadDetail = useCallback(async (sessionId: string) => {
    const account = profile.id;
    const requestId = ++detailSequence.current;
    setDetailLoading(true); setDetailError(null);
    try {
      const normalized = normalizeSpeakingSessionDetail(await window.api.get<unknown>(`/admin/sessions/${encodeURIComponent(sessionId)}`), sessionId) as SpeakingSessionDetail | null;
      if (requestId !== detailSequence.current || profileId.current !== account) return false;
      if (!normalized) throw new Error('Chi tiết session không đúng định dạng.');
      setDetail(normalized); return true;
    } catch (caught) {
      if (requestId === detailSequence.current && profileId.current === account) setDetailError(messageOf(caught));
      return false;
    } finally { if (requestId === detailSequence.current && profileId.current === account) setDetailLoading(false); }
  }, [profile.id]);

  useEffect(() => { setDraft(filters); setBanner(null); void loadList(filters, true); return () => { listSequence.current += 1; }; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDetail(null); setDetailError(null); if (selectedId) void loadDetail(selectedId); else detailSequence.current += 1; return () => { detailSequence.current += 1; }; }, [selectedId, profile.id, loadDetail]);

  const navigate = (nextFilters: SpeakingSessionFilters, sessionId = selectedId) => {
    const search = speakingSessionSearch(nextFilters, sessionId);
    router.replace(`/admin/speaking/sessions${search ? `?${search}` : ''}`, { scroll: false });
  };
  const apply = () => {
    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) { setBanner({ kind: 'error', text: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.' }); return; }
    if (speakingSessionFilterKey(draft) === filterKey) void loadList(draft, true); else navigate(draft, selectedId);
  };
  const reset = () => { const empty = normalizeSpeakingSessionFilters({}) as SpeakingSessionFilters; setDraft(empty); navigate(empty, selectedId); };
  const open = (id: string) => navigate(filters, id);
  const close = () => navigate(filters, null);

  const executeAction = async () => {
    const action = confirming;
    if (!action || mutationLock.current) return;
    mutationLock.current = true; setMutationBusy(true); setBanner(null);
    const account = profile.id;
    try {
      let successText = '';
      let partialResult = false;
      if (action.kind === 'response') {
        const result = normalizeResponseRegrade(await window.api.post<unknown>(`/admin/responses/${encodeURIComponent(action.responseId)}/regrade`, {}), action.responseId, action.sessionId);
        if (!result) throw new Error('Máy chủ không xác nhận đúng response đã chấm lại.');
        partialResult = !result.sessionUpdated || result.remainingFailed > 0;
        successText = partialResult
          ? `Đã chấm lại câu nhưng session còn ${result.remainingFailed} response lỗi hoặc thiếu band.`
          : `Đã chấm lại câu${result.reTranscribed ? ' và tạo transcript mới' : ''}.`;
      } else if (action.kind === 'repair' || action.kind === 'force') {
        const suffix = action.kind === 'force' ? '?force=true' : '';
        const result = normalizeSessionRegrade(await window.api.post<unknown>(`/admin/sessions/${encodeURIComponent(action.sessionId)}/regrade${suffix}`, {}), action.sessionId);
        if (!result) throw new Error('Máy chủ không xác nhận đúng session đã chấm lại.');
        partialResult = result.partialFailure || !result.ok;
        successText = partialResult ? `Regrade chỉ hoàn tất một phần: ${result.regraded} thành công, ${result.failed} lỗi.` : `Đã chấm lại ${result.regraded} câu; giữ nguyên ${result.skipped} câu.`;
      } else {
        const ids = [action.sessionId, action.full ? action.p2Id : null, action.full ? action.p3Id : null].filter(Boolean) as string[];
        const query = new URLSearchParams(); if (action.full && action.p2Id) query.set('p2_id', action.p2Id); if (action.full && action.p3Id) query.set('p3_id', action.p3Id);
        const result = normalizeSummaryRebuild(await window.api.post<unknown>(`/admin/sessions/${encodeURIComponent(action.sessionId)}/rebuild-summary${query.size ? `?${query}` : ''}`, {}), ids);
        if (!result) throw new Error('Máy chủ không xác nhận đủ các session đã tổng hợp.');
        const failed = result.filter((item: { ok: boolean }) => !item.ok).length;
        partialResult = failed > 0;
        successText = failed ? `Tổng hợp một phần: ${result.length - failed}/${result.length} session thành công.` : `Đã tổng hợp ${result.length} session.`;
      }
      if (profileId.current !== account) return;
      const detailId = action.kind === 'rebuild' ? action.detailId : action.sessionId;
      const [detailOk, listOk] = await Promise.all([loadDetail(detailId), loadList(filters, true)]);
      if (profileId.current !== account) return;
      setBanner(detailOk && listOk && !partialResult
        ? { kind: 'success', text: `${successText} Đã đồng bộ lại từ máy chủ.` }
        : { kind: 'error', text: detailOk && listOk ? `${successText} Session vẫn cần được kiểm tra.` : `${successText} Nhưng chưa đọc lại được toàn bộ trạng thái chuẩn; hãy tải lại trước khi tiếp tục.` });
    } catch (caught) { if (profileId.current === account) setBanner({ kind: 'error', text: `Không hoàn tất thao tác: ${messageOf(caught)}` }); }
    finally { mutationLock.current = false; setMutationBusy(false); setConfirming(null); }
  };

  const copy = actionCopy(confirming);
  return <main className="ass-shell">
    <header className="ass-header"><div><p className="acd-eyebrow">Speaking · Quality assurance</p><h1>Sessions & grading</h1><p>Tìm session, nghe lại bằng chứng và khôi phục điểm từ dữ liệu canonical.</p></div><a className="adm-btn-secondary" href="/admin/speaking">← Speaking workspace</a></header>
    <section className="ass-filters" aria-label="Bộ lọc session"><Field label="Email chính xác / User ID"><input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') apply(); }} placeholder="student@example.com" /></Field>
      <Field label="Mode"><select value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value })}><option value="">Tất cả</option><option value="practice">Luyện tập</option><option value="test_part">Thi từng Part</option><option value="test_full">Full Test</option></select></Field>
      <Field label="Trạng thái"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="">Tất cả</option><option value="in_progress">Đang làm</option><option value="completed">Hoàn tất</option><option value="grading_failed">Chấm lỗi</option></select></Field>
      <Field label="Lỗi"><select value={draft.error} onChange={(event) => setDraft({ ...draft, error: event.target.value })}><option value="">Tất cả</option><option value="has_error">Có lỗi</option><option value="stt_failed">STT lỗi</option><option value="grading_failed">Chấm lỗi</option><option value="save_failed">Lưu lỗi</option><option value="pdf_failed">PDF lỗi</option></select></Field>
      <Field label="Từ ngày"><input type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} /></Field><Field label="Đến ngày"><input type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} /></Field>
      <div className="ass-filter-actions"><button className="adm-btn-primary" type="button" onClick={apply}>Áp dụng</button><button className="adm-btn-secondary" type="button" onClick={reset}>Đặt lại</button></div>
    </section>
    <StatusBanner banner={banner} />
    {snapshot?.key === key && snapshot.malformed > 0 && <div className="ass-warning" role="alert"><strong>Có dữ liệu sai định dạng.</strong><span>{snapshot.malformed} session không an toàn đã bị loại khỏi bảng.</span></div>}
    {rows.some((row) => row.userLookupFailed) && <div className="ass-warning" role="alert"><strong>Không tra được hồ sơ học viên.</strong><span>User ID vẫn được giữ nguyên; email không được giả thành trống.</span></div>}
    {listError && <div className="acd-state is-error" role="alert"><strong>{rows.length ? 'Không thể làm mới — đang giữ dữ liệu đã đọc trước đó.' : 'Không tải được sessions.'}</strong><span>{listError}</span><button className="adm-btn-secondary" type="button" onClick={() => void loadList(filters, true)}>Thử lại</button></div>}
    {loading && !rows.length ? <div className="acd-state" role="status"><strong>Đang đọc sessions…</strong><span>Đối chiếu trạng thái grading và hồ sơ học viên.</span></div> : !rows.length && !listError ? <div className="acd-state"><strong>Không có session khớp bộ lọc</strong><span>Thử bỏ bớt điều kiện hoặc chọn khoảng ngày dài hơn.</span></div> : <section className="ass-table-panel"><header><div><p className="acd-eyebrow">Canonical session ledger</p><h2>{rows.length.toLocaleString('vi-VN')} session đã tải</h2></div><button className="adm-btn-secondary" type="button" disabled={loading} onClick={() => void loadList(filters, true)}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button></header><div className="ass-table-wrap" role="region" aria-label="Bảng Sessions Speaking" tabIndex={0}><table><thead><tr><th>Session</th><th>Học viên</th><th>Mode</th><th>Chủ đề</th><th>Band</th><th>Trạng thái</th><th>Lỗi</th><th>Bắt đầu</th><th><span className="sr-only">Hành động</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={row.errorCode ? 'has-error' : ''}><td data-label="Session"><code>{row.id.slice(0, 8)}…</code></td><td data-label="Học viên"><strong>{row.userEmail || row.userId || 'Không rõ'}</strong>{row.userLookupFailed && <small>lookup lỗi</small>}</td><td data-label="Mode"><span>{MODE[row.mode || ''] || row.mode || '—'}{row.part != null && ` · P${row.part}`}</span></td><td data-label="Chủ đề"><span className="ass-topic">{row.topic || '—'}</span></td><td data-label="Band"><Band value={row.overallBand} /></td><td data-label="Trạng thái"><span className={`adm-status-pill ${statusTone(row.status)}`}>{STATUS[row.status || ''] || row.status || '—'}</span></td><td data-label="Lỗi">{row.errorCode ? <span className="ass-error-pill">{ERROR[row.errorCode] || row.errorCode}</span> : '—'}</td><td data-label="Bắt đầu"><time dateTime={row.startedAt || undefined}>{formatTime(row.startedAt)}</time></td><td><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => open(row.id)}>Kiểm tra</button></td></tr>)}</tbody></table></div>{hasMore && <div className="ass-more"><button className="adm-btn-secondary" type="button" disabled={loadingMore} onClick={() => void loadList(filters, false)}>{loadingMore ? 'Đang tải…' : 'Tải thêm 50 session'}</button></div>}</section>}
    <Dialog open={Boolean(selectedId) && !confirming} title={detail ? `${detail.userDisplayName || detail.userEmail || 'Session'} · ${detail.id.slice(0, 8)}` : 'Chi tiết session'} description={detail ? `${MODE[detail.mode || ''] || detail.mode || 'Không rõ mode'} · ${formatTime(detail.startedAt)}` : 'Đang đọc nguồn dữ liệu chuẩn'} onClose={close} busy={mutationBusy} panelClassName="ass-detail-dialog" actions={<><button className="adm-btn-secondary" type="button" disabled={detailLoading || mutationBusy || !selectedId} onClick={() => selectedId && void loadDetail(selectedId)}>{detailLoading ? 'Đang tải…' : 'Tải lại chi tiết'}</button><button className="adm-btn-primary" type="button" disabled={mutationBusy} onClick={close}>Đóng</button></>}>
      {detailError && <div className="acd-state is-error" role="alert"><strong>Không tải được session</strong><span>{detailError}</span></div>}{detailLoading && !detail && <div className="acd-state" role="status">Đang tải chi tiết…</div>}{detail && <SessionDetail data={detail} busy={mutationBusy} onAction={setConfirming} />}
    </Dialog>
    <Dialog open={Boolean(confirming)} title={copy.title} description={copy.description} onClose={() => setConfirming(null)} busy={mutationBusy} actions={<><button className="adm-btn-secondary" type="button" disabled={mutationBusy} onClick={() => setConfirming(null)}>Hủy</button><button className={confirming?.kind === 'force' ? 'adm-btn-danger' : 'adm-btn-primary'} type="button" disabled={mutationBusy} onClick={() => void executeAction()}>{mutationBusy ? 'Đang xử lý…' : copy.button}</button></>} />
  </main>;
}
