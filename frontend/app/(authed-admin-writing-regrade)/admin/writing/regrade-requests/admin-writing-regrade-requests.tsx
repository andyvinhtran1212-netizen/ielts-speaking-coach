'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { KEEP_MIN_CHARS, keepExplanationError, normalizeRegradeDecision, normalizeRegradeList, normalizeRegradeRequest, regradeFilters, regradeHref, regradeLane, regradeMatches, regradeSort, regradeWait, waitLabel } from '@/lib/admin-writing-regrade-model.mjs';

type Status = 'pending' | 'accepted' | 'rejected' | 'fulfilled';
type Lane = 'new' | 'regrading' | 'answered';
type Decision = 'keep' | 'adjust' | 'ai';
type Row = { id: string; essayId: string; status: Status; reason: string; studentName: string; studentCode: string | null; cohortName: string | null; taskType: string | null; essayPrompt: string | null; essayStatus: string | null; essayBand: number | null; adminResponse: string | null; createdAt: string | null; updatedAt: string | null; actionedAt: string | null; fulfilledAt: string | null };
type Snapshot = { account: string; rows: Row[]; capped: boolean; malformed: number; readAt: string; regradeHours: number | null; thresholdsFailed: boolean };
type PendingDecision = { id: string; status: 'accepted' | 'rejected'; decision: Decision; essayId: string };
type Wait = { hours: number; open: boolean; overdue: boolean | null } | null;

// FR-062: Mới → Đang chấm lại → Đã trả lời. "Đang xem" (soft lock) is not
// built yet: it needs a lock column (GOI-09 G09-T39, "Không làm").
const TABS: Array<{ id: Lane; label: string; note: string }> = [
  { id: 'new', label: 'Mới', note: 'Cần quyết định' },
  { id: 'regrading', label: 'Đang chấm lại', note: 'Chờ trả lại bài' },
  { id: 'answered', label: 'Đã trả lời', note: 'Chỉ xem' },
];
const STATUS_COPY: Record<Status, string> = { pending: 'Mới', accepted: 'Đang chấm lại', rejected: 'Đã trả lời · Giữ nguyên điểm', fulfilled: 'Đã trả lời · Đã chấm lại' };
const TASK_COPY: Record<string, string> = { task1_academic: 'Task 1 · Academic', task1_general: 'Task 1 · General', task2: 'Task 2' };
const DECISIONS: Array<{ id: Decision; label: string; sub: string }> = [
  { id: 'keep', label: 'Giữ nguyên điểm', sub: `Gửi học viên giải thích, ít nhất ${KEEP_MIN_CHARS} ký tự` },
  { id: 'adjust', label: 'Điều chỉnh điểm', sub: 'Mở màn chấm ở chế độ chấm lại' },
  { id: 'ai', label: 'Chấm lại bằng AI', sub: 'Tốn chi phí AI của Aver, xem trước rồi mới trả' },
];
const NO_DEDUCT = 'Không trừ lượt chấm AI của học viên.';

function formatDate(value: string | null) {
  if (!value) return 'Chưa có';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

const gradeHref = (essayId: string) => `/admin/writing/grade?essay_id=${encodeURIComponent(essayId)}`;

function WaitBadge({ wait }: { wait: Wait }) {
  if (!wait || !wait.open) return null;
  return <span className={`awr-wait${wait.overdue ? ' is-overdue' : ''}`}>Đã chờ {waitLabel(wait.hours)}{wait.overdue ? ' · quá hạn' : ''}</span>;
}

export function AdminWritingRegradeRequests() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = useMemo(() => regradeFilters({ status: params?.get('status') || '', q: params?.get('q') || '' }) as { status: Lane; q: string }, [params]);
  const [query, setQuery] = useState(filters.q);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [detailStale, setDetailStale] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const mutationLock = useRef(false);
  const pendingDecision = useRef<PendingDecision | null>(null);
  const profileRef = useRef(profile.id); profileRef.current = profile.id;
  const rows = snapshot?.account === profile.id ? snapshot.rows : [];

  const loadAll = useCallback(async (silent = false) => {
    const account = profile.id;
    const requestId = ++sequence.current;
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const normalized = normalizeRegradeList(await window.api.get<unknown>('/admin/writing/regrade-requests')) as { rows: Row[]; capped: boolean; malformedCount: number; regradeHours: number | null; thresholdsFailed: boolean } | null;
      if (!normalized) throw new Error('Danh sách yêu cầu không đúng định dạng.');
      if (requestId !== sequence.current || profileRef.current !== account) return null;
      setSnapshot({ account, rows: normalized.rows, capped: normalized.capped, malformed: normalized.malformedCount, readAt: new Date().toISOString(), regradeHours: normalized.regradeHours, thresholdsFailed: normalized.thresholdsFailed });
      setNow(Date.now());
      return normalized.rows;
    } catch (caught) {
      if (requestId === sequence.current && profileRef.current === account) setLoadError(messageOf(caught));
      return null;
    } finally {
      if (requestId === sequence.current && profileRef.current === account) setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    pendingDecision.current = null; mutationLock.current = false; setSelected(null); setBanner(null); setSnapshot(null);
    void loadAll();
    return () => { sequence.current += 1; detailSequence.current += 1; };
  }, [profile.id, loadAll]);

  useEffect(() => { setQuery(filters.q); }, [filters.q]);

  const visible = useMemo(() => regradeSort(rows.filter((row) => regradeMatches(row, { ...filters, q: query })), filters.status) as Row[], [rows, filters, query]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((tab) => [tab.id, rows.filter((row) => regradeLane(row.status) === tab.id).length])), [rows]);
  const stale = Boolean(loadError && snapshot?.account === profile.id);
  const hours = snapshot?.regradeHours ?? null;
  const waitOf = (row: Row) => regradeWait(row, now, hours) as Wait;

  const navigate = (next: { status: Lane; q: string }) => {
    if (busy) return;
    router.replace(regradeHref(next), { scroll: false });
  };

  const openDetail = async (row: Row) => {
    if (busy) return;
    const detailRequestId = ++detailSequence.current;
    const account = profile.id;
    setSelected(row); setDetailStale(true); setDecision(null); setResponse(''); setDialogError(null); pendingDecision.current = null;
    try {
      const detail = normalizeRegradeRequest(await window.api.get<unknown>(`/admin/writing/regrade-requests/${encodeURIComponent(row.id)}`)) as Row | null;
      if (!detail || detail.id !== row.id) throw new Error('Chi tiết yêu cầu không đúng định dạng.');
      if (detailRequestId !== detailSequence.current || profileRef.current !== account) return;
      setSelected(detail); setDetailStale(false);
    } catch (caught) {
      if (detailRequestId === detailSequence.current && profileRef.current === account) setDialogError(`Không đọc được chi tiết mới nhất: ${messageOf(caught)}`);
    }
  };

  // After the server confirmed a decision, read the detail and the list again
  // so the dialog and the queue show what the database holds.
  const reconcile = async (pending: PendingDecision, account: string) => {
    const detail = normalizeRegradeDecision(
      await window.api.get<unknown>(`/admin/writing/regrade-requests/${encodeURIComponent(pending.id)}`),
      pending.id, pending.status,
    ) as Row | null;
    if (!detail) throw new Error('Chi tiết đọc lại chưa khớp quyết định máy chủ đã xác nhận.');
    const canonical = await loadAll(true);
    if (!canonical) throw new Error('Chưa đọc lại được danh sách.');
    const listed = canonical.find((row) => row.id === pending.id);
    if (!listed || listed.status !== pending.status) throw new Error('Danh sách và chi tiết đang không cùng trạng thái.');
    if (profileRef.current !== account) return null;
    pendingDecision.current = null; setSelected(detail); setDetailStale(false); setDecision(null); setResponse('');
    return detail;
  };

  // "Chấm lại bằng AI": the request is accepted first (the essay leaves the
  // learner's result until it is delivered again), then the existing admin
  // regrade route queues the AI run. A failure here is shown, never hidden.
  const queueAi = async (essayId: string) => {
    try {
      await window.api.post<unknown>(`/admin/writing/essays/${encodeURIComponent(essayId)}/regrade`, {});
      setBanner({ kind: 'success', text: 'Đã nhận yêu cầu và gửi bài cho AI chấm lại. Kết quả mới hiện ở màn chấm để bạn xem trước; học viên chỉ thấy khi bạn trả lại bài.' });
    } catch (caught) {
      setDialogError(`Đã nhận yêu cầu nhưng chưa gửi được bài cho AI: ${messageOf(caught)}. Mở màn chấm để chấm lại bằng AI hoặc chấm tay.`);
    }
  };

  const decide = async () => {
    const row = selected;
    const account = profile.id;
    const retry = pendingDecision.current;
    const chosen = retry?.decision || decision;
    if (!row || !chosen || mutationLock.current || (detailStale && !retry)) return;
    const trimmed = response.trim();
    if (!retry && chosen === 'keep') {
      const problem = keepExplanationError(trimmed);
      if (problem) { setDialogError(problem); return; }
    }
    mutationLock.current = true; setBusy(true); setDialogError(null); setBanner(null);
    try {
      let pending = retry;
      if (!pending) {
        const action = chosen === 'keep' ? 'reject' : 'accept';
        const expected = chosen === 'keep' ? 'rejected' : 'accepted';
        const ack = normalizeRegradeDecision(
          await window.api.patch<unknown>(`/admin/writing/regrade-requests/${encodeURIComponent(row.id)}`, { action, response: chosen === 'keep' ? trimmed : null }),
          row.id, expected,
        ) as Row | null;
        if (!ack) throw new Error('Máy chủ không xác nhận đúng yêu cầu vừa xử lý.');
        pending = { id: row.id, status: expected, decision: chosen, essayId: row.essayId };
        pendingDecision.current = pending;
      }
      const done = await reconcile(pending, account);
      if (!done) return;
      if (pending.decision === 'keep') setBanner({ kind: 'success', text: 'Đã gửi giải thích cho học viên, điểm giữ nguyên. Yêu cầu chuyển sang Đã trả lời.' });
      else if (pending.decision === 'ai') await queueAi(pending.essayId);
      else router.push(gradeHref(pending.essayId));
    } catch (caught) {
      setDialogError(`${pendingDecision.current ? 'Quyết định đã được máy chủ xác nhận nhưng chưa đọc lại xong' : 'Không thể xử lý'}: ${messageOf(caught)}`);
    } finally { mutationLock.current = false; setBusy(false); }
  };

  const close = () => { if (!busy) { detailSequence.current += 1; setSelected(null); setDialogError(null); pendingDecision.current = null; } };
  const dialogStatus = selected?.status || 'pending';
  const keepProblem = decision === 'keep' ? keepExplanationError(response) : null;
  const sendLabel = decision === 'keep' ? 'Gửi giải thích, giữ nguyên điểm' : decision === 'adjust' ? 'Nhận yêu cầu và mở màn chấm' : decision === 'ai' ? 'Chấm lại bằng AI, chấp nhận chi phí' : 'Chọn một quyết định';

  const actions = selected?.status === 'pending'
    ? pendingDecision.current
      ? <><button className="adm-btn-secondary" type="button" onClick={close} disabled={busy}>Đóng</button><button className="adm-btn-primary" type="button" onClick={() => void decide()} disabled={busy}>{busy ? 'Đang đọc lại…' : 'Thử đọc lại'}</button></>
      : <><button className="adm-btn-secondary" type="button" onClick={close} disabled={busy}>Đóng</button><button className={decision === 'ai' ? 'adm-btn-danger' : 'adm-btn-primary'} type="button" onClick={() => void decide()} disabled={busy || detailStale || !decision || Boolean(keepProblem)}>{busy ? 'Đang xử lý…' : sendLabel}</button></>
    : <><button className="adm-btn-secondary" type="button" onClick={close}>Đóng</button>{selected?.status === 'accepted' && <a className="adm-btn-primary" href={gradeHref(selected.essayId)}>Mở màn chấm</a>}</>;

  return <main className="awr-shell">
    <header className="awr-header">
      <div><p className="awr-eyebrow">Chấm bài</p><h1>Yêu cầu chấm lại</h1><p>Học viên gửi yêu cầu từ phiếu kết quả Writing. Đọc nguyên văn lý do, xem bài và điểm đã trả, rồi chọn một trong ba cách xử lý. {NO_DEDUCT}</p></div>
      <a className="awr-hub-link" href="/admin/writing"><span>Khu Writing</span><span aria-hidden="true">↗</span></a>
    </header>

    <section className="awr-principle" aria-label="Ba cách xử lý"><span>01</span><div><strong>Giữ nguyên điểm</strong><small>Giải thích ít nhất {KEEP_MIN_CHARS} ký tự</small></div><i>·</i><span>02</span><div><strong>Điều chỉnh điểm</strong><small>Chấm lại tay ở màn chấm</small></div><i>·</i><span>03</span><div><strong>Chấm lại bằng AI</strong><small>Tốn chi phí AI, xem trước rồi mới trả</small></div></section>

    <nav className="awr-tabs" aria-label="Trạng thái yêu cầu">{TABS.map((tab) => <button type="button" key={tab.id} className={filters.status === tab.id ? 'is-active' : ''} aria-current={filters.status === tab.id ? 'page' : undefined} onClick={() => navigate({ ...filters, status: tab.id })} disabled={busy}><span><strong>{tab.label}</strong><small>{tab.note}</small></span><b>{snapshot ? counts[tab.id] || 0 : '…'}</b></button>)}</nav>

    <StatusBanner banner={banner} />
    {stale && <div className="awr-warning" role="alert"><strong>Danh sách cũ</strong><span>Tải lại lỗi: {loadError}. Danh sách đang hiện được đọc lúc {formatDate(snapshot?.readAt || null)}.</span><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void loadAll()}>Thử lại</button></div>}
    {snapshot?.thresholdsFailed && <div className="awr-warning" role="alert"><strong>Chưa đọc được ngưỡng</strong><span>Ngưỡng “Yêu cầu chấm lại” ở Cài đặt › Ngưỡng vận hành chưa đọc được, nên chưa đánh dấu yêu cầu quá hạn.</span></div>}
    {snapshot?.capped && <div className="awr-warning"><strong>Có lane chạm ngưỡng 300</strong><span>Số đếm và tìm kiếm của ít nhất một trạng thái chỉ tính 300 yêu cầu mới nhất của trạng thái đó.</span></div>}
    {snapshot && snapshot.malformed > 0 && <div className="awr-warning" role="alert"><strong>Dữ liệu bị loại</strong><span>{snapshot.malformed} dòng sai định dạng không được hiển thị; cần kiểm tra backend trước khi quyết định.</span></div>}

    <section className="awr-workspace">
      <header className="awr-workspace__head"><div><p className="awr-eyebrow">Hàng yêu cầu</p><h2>{TABS.find((tab) => tab.id === filters.status)?.label}</h2><p>{filters.status === 'new' ? `Chờ lâu nhất trước. Chờ tính từ lúc học viên gửi${hours != null ? `; quá ${hours} giờ là quá hạn` : ''}.` : filters.status === 'regrading' ? 'Đã nhận, bài đang được chấm lại; trả lại bài ở màn chấm là xong.' : 'Đã trả lời thì chỉ xem, không mở lại được.'}</p></div><div className="awr-count"><strong>{visible.length}</strong><span>yêu cầu hiển thị</span></div></header>
      <div className="awr-toolbar"><label><span>Tìm trong danh sách</span><input value={query} maxLength={120} placeholder="Tên, mã học viên, lớp, đề hoặc lý do…" onChange={(event) => { const q = event.target.value; setQuery(q); navigate({ ...filters, q }); }}/></label><button className="adm-btn-secondary" type="button" onClick={() => void loadAll()} disabled={loading || busy}>Tải lại</button></div>
      {loading && !rows.length ? <div className="awr-state" role="status"><span className="awr-spinner"/><strong>Đang tải yêu cầu…</strong></div>
        : loadError && !rows.length ? <div className="awr-state is-error" role="alert"><strong>Không tải được hàng yêu cầu</strong><p>{loadError}</p><button className="adm-btn-secondary" type="button" onClick={() => void loadAll()}>Thử lại</button></div>
          : !visible.length ? <div className="awr-state"><strong>{filters.status === 'new' && !query ? 'Chưa có yêu cầu chấm lại nào cần xử lý' : 'Không có yêu cầu phù hợp'}</strong><p>{filters.status === 'new' && !query ? 'Khi học viên gửi yêu cầu từ phiếu kết quả, yêu cầu hiện ở tab Mới.' : 'Đổi trạng thái hoặc xoá từ khoá tìm kiếm.'}</p></div>
            : <div className="awr-list">{visible.map((row) => { const wait = waitOf(row); return <article className={`awr-card${wait?.overdue ? ' is-overdue' : ''}`} key={row.id}>
              <div className="awr-card__main"><div className="awr-card__top"><span className={`awr-status is-${row.status}`}>{STATUS_COPY[row.status]}</span><time>{formatDate(row.createdAt)}</time><WaitBadge wait={wait} /></div><h3>{row.studentName}</h3><p className="awr-identity">{[row.studentCode, row.cohortName].filter(Boolean).join(' · ') || 'Chưa có mã/lớp'}</p><blockquote>{row.reason}</blockquote></div>
              <div className="awr-card__essay"><span>{row.taskType ? TASK_COPY[row.taskType] : 'Không rõ loại bài'}</span><strong>{row.essayPrompt || 'Không đọc được đề bài'}</strong><small>{row.essayBand != null ? `Band hiện tại ${row.essayBand}` : 'Chưa có band'}</small></div>
              <div className="awr-card__action"><button className="adm-btn-secondary" type="button" onClick={() => void openDetail(row)} disabled={busy}>{row.status === 'pending' ? 'Xử lý' : 'Xem'}</button></div>
            </article>; })}</div>}
    </section>

    <Dialog open={selected !== null} title="Xử lý yêu cầu chấm lại" description={selected ? `${selected.studentName} · ${STATUS_COPY[dialogStatus]}` : ''} onClose={close} busy={busy} panelClassName="awr-dialog" actions={actions}>
      {selected && <div className="awr-detail">
        <section className="is-reason"><span>Lý do của học viên · {formatDate(selected.createdAt)}</span><blockquote>{selected.reason}</blockquote><WaitBadge wait={waitOf(selected)} /></section>
        <section><span>Học viên</span><strong>{selected.studentName}</strong><p>{[selected.studentCode, selected.cohortName].filter(Boolean).join(' · ') || 'Chưa có mã/lớp'}</p></section>
        <section><span>Bài và kết quả hiện tại</span><strong>{selected.taskType ? TASK_COPY[selected.taskType] : 'Không rõ loại bài'}{selected.essayBand != null ? ` · Band ${selected.essayBand}` : ''}</strong><p>{selected.essayPrompt || 'Không đọc được đề bài'}</p><a href={gradeHref(selected.essayId)}>Mở bài ở màn chấm ↗</a></section>
        <p className="awr-no-deduct" role="note"><strong>{NO_DEDUCT}</strong> Cả ba cách xử lý đều không dùng lượt chấm AI của học viên; chi phí chấm lại bằng AI tính cho Aver.</p>
        {selected.adminResponse && <section className="is-response"><span>Giải thích đã gửi học viên</span><p>{selected.adminResponse}</p></section>}
        {selected.status === 'pending' && !pendingDecision.current && <fieldset className="awr-decisions" disabled={busy || detailStale}><legend>Quyết định</legend>{DECISIONS.map((item) => <label key={item.id} className={decision === item.id ? 'is-active' : ''}><input type="radio" name="awr-decision" value={item.id} checked={decision === item.id} onChange={() => { setDecision(item.id); setDialogError(null); }}/><span><strong>{item.label}</strong><small>{item.sub}</small></span></label>)}</fieldset>}
        {selected.status === 'pending' && decision === 'keep' && !pendingDecision.current && <label className="awr-reject"><span>Giải thích gửi học viên <b>*</b></span><textarea autoFocus rows={5} maxLength={1000} value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Vì sao điểm giữ nguyên, và học viên cần làm gì để lên band…"/><small>{response.trim().length}/{KEEP_MIN_CHARS} ký tự tối thiểu{keepProblem ? ` · ${keepProblem}` : ''}</small></label>}
        {selected.status === 'pending' && decision === 'adjust' && !pendingDecision.current && <p className="awr-decision-note">Màn chấm mở với bài này. Bài tạm rời phiếu của học viên; điểm mới chỉ tới học viên khi bạn trả lại bài.</p>}
        {selected.status === 'pending' && decision === 'ai' && !pendingDecision.current && <div className="awr-cost" role="note"><strong>Cảnh báo · tốn chi phí AI</strong><p>AI chấm lại trên bản bài đã lưu của học viên. Chi phí ghi vào Chi phí AI của Aver. Kết quả mới hiện ở màn chấm để bạn xem trước; học viên chưa thấy gì cho tới khi bạn trả lại bài.</p></div>}
        {detailStale && <div className="awr-inline-error">Đang dùng dữ liệu từ danh sách; quyết định bị khoá tới khi đọc được chi tiết mới nhất.</div>}
        {dialogError && <div className="awr-inline-error" role="alert">{dialogError}</div>}
      </div>}
    </Dialog>
  </main>;
}
