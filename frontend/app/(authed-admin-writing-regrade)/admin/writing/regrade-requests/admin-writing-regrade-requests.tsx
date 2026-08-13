'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { normalizeRegradeDecision, normalizeRegradeList, normalizeRegradeRequest, regradeFilters, regradeHref, regradeMatches, regradeSort } from '@/lib/admin-writing-regrade-model.mjs';

type Status = 'pending' | 'accepted' | 'rejected' | 'fulfilled';
type Row = { id: string; essayId: string; status: Status; reason: string; studentName: string; studentCode: string | null; cohortName: string | null; taskType: string | null; essayPrompt: string | null; essayStatus: string | null; essayBand: number | null; adminResponse: string | null; createdAt: string | null; updatedAt: string | null; actionedAt: string | null; fulfilledAt: string | null };
type Snapshot = { account: string; rows: Row[]; capped: boolean; malformed: number; readAt: string };
type PendingDecision = { id: string; status: 'accepted' | 'rejected' };

const TABS: Array<{ id: Status; label: string; note: string }> = [
  { id: 'pending', label: 'Đang chờ', note: 'Cần quyết định' },
  { id: 'accepted', label: 'Đã nhận', note: 'Chờ chấm lại' },
  { id: 'rejected', label: 'Đã từ chối', note: 'Đã phản hồi' },
  { id: 'fulfilled', label: 'Đã xong', note: 'Đã trả lại bài' },
];
const STATUS_COPY: Record<Status, string> = { pending: 'Đang chờ', accepted: 'Đã chấp nhận', rejected: 'Đã từ chối', fulfilled: 'Đã chấm lại xong' };
const TASK_COPY: Record<string, string> = { task1_academic: 'Task 1 · Academic', task1_general: 'Task 1 · General', task2: 'Task 2' };

function formatDate(value: string | null) {
  if (!value) return 'Chưa có';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function AdminWritingRegradeRequests() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = useMemo(() => regradeFilters({ status: params?.get('status') || '', q: params?.get('q') || '' }) as { status: Status; q: string }, [params]);
  const [query, setQuery] = useState(filters.q);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [detailStale, setDetailStale] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
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
      const normalized = normalizeRegradeList(await window.api.get<unknown>('/admin/writing/regrade-requests')) as { rows: Row[]; capped: boolean; malformedCount: number } | null;
      if (!normalized) throw new Error('Snapshot yêu cầu không đúng định dạng canonical.');
      if (requestId !== sequence.current || profileRef.current !== account) return null;
      setSnapshot({ account, rows: normalized.rows, capped: normalized.capped, malformed: normalized.malformedCount, readAt: new Date().toISOString() });
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
  const counts = useMemo(() => Object.fromEntries(TABS.map((tab) => [tab.id, rows.filter((row) => row.status === tab.id).length])), [rows]);
  const stale = Boolean(loadError && snapshot?.account === profile.id);

  const navigate = (next: { status: Status; q: string }) => {
    if (busy) return;
    router.replace(regradeHref(next), { scroll: false });
  };

  const openDetail = async (row: Row) => {
    if (busy) return;
    const detailRequestId = ++detailSequence.current;
    const account = profile.id;
    setSelected(row); setDetailStale(true); setRejectMode(false); setResponse(''); setDialogError(null); pendingDecision.current = null;
    try {
      const detail = normalizeRegradeRequest(await window.api.get<unknown>(`/admin/writing/regrade-requests/${encodeURIComponent(row.id)}`)) as Row | null;
      if (!detail || detail.id !== row.id) throw new Error('Chi tiết yêu cầu không đúng định dạng.');
      if (detailRequestId !== detailSequence.current || profileRef.current !== account) return;
      setSelected(detail); setDetailStale(false);
    } catch (caught) {
      if (detailRequestId === detailSequence.current && profileRef.current === account) setDialogError(`Không đọc được chi tiết mới nhất: ${messageOf(caught)}`);
    }
  };

  const reconcile = async (pending: PendingDecision, account: string) => {
    const detail = normalizeRegradeDecision(
      await window.api.get<unknown>(`/admin/writing/regrade-requests/${encodeURIComponent(pending.id)}`),
      pending.id, pending.status,
    ) as Row | null;
    if (!detail) throw new Error('Chi tiết đọc lại chưa khớp quyết định máy chủ đã xác nhận.');
    const canonical = await loadAll(true);
    if (!canonical) throw new Error('Chưa đọc lại được danh sách canonical.');
    const listed = canonical.find((row) => row.id === pending.id);
    if (!listed || listed.status !== pending.status) throw new Error('Danh sách và chi tiết đang không cùng trạng thái.');
    if (profileRef.current !== account) return;
    pendingDecision.current = null; setSelected(detail); setDetailStale(false); setRejectMode(false); setResponse('');
    setBanner({ kind: 'success', text: pending.status === 'accepted' ? 'Đã chấp nhận atomically và đối chiếu lại. Bài đã về trạng thái Chờ trả để admin chấm lại.' : 'Đã từ chối và đối chiếu phản hồi từ máy chủ.' });
  };

  const decide = async (action: 'accept' | 'reject') => {
    const row = selected;
    const account = profile.id;
    if (!row || mutationLock.current || detailStale) return;
    if (action === 'reject' && !rejectMode) { setRejectMode(true); setDialogError(null); return; }
    const trimmed = response.trim();
    if (action === 'reject' && !trimmed) { setDialogError('Vui lòng nhập lý do từ chối để học viên hiểu quyết định.'); return; }
    mutationLock.current = true; setBusy(true); setDialogError(null); setBanner(null);
    try {
      if (pendingDecision.current) {
        await reconcile(pendingDecision.current, account);
        return;
      }
      const expected = action === 'accept' ? 'accepted' : 'rejected';
      const ack = normalizeRegradeDecision(
        await window.api.patch<unknown>(`/admin/writing/regrade-requests/${encodeURIComponent(row.id)}`, { action, response: action === 'reject' ? trimmed : null }),
        row.id, expected,
      ) as Row | null;
      if (!ack) throw new Error('Máy chủ không xác nhận đúng yêu cầu vừa xử lý.');
      pendingDecision.current = { id: row.id, status: expected };
      await reconcile(pendingDecision.current, account);
    } catch (caught) {
      setDialogError(`${pendingDecision.current ? 'Quyết định đã được máy chủ xác nhận nhưng chưa đối chiếu xong' : 'Không thể xử lý'}: ${messageOf(caught)}`);
    } finally { mutationLock.current = false; setBusy(false); }
  };

  const close = () => { if (!busy) { detailSequence.current += 1; setSelected(null); setDialogError(null); pendingDecision.current = null; } };
  const dialogStatus = selected?.status || 'pending';

  return <main className="awr-shell">
    <header className="awr-header">
      <div><p className="awr-eyebrow">Writing · Quality control</p><h1>Yêu cầu chấm lại</h1><p>Một bàn quyết định rõ ràng: đọc lý do, kiểm bài gốc, rồi Accept hoặc Reject trên cùng trạng thái canonical.</p></div>
      <a className="awr-hub-link" href="/admin/writing"><span>Writing workspace</span><span aria-hidden="true">↗</span></a>
    </header>

    <section className="awr-principle" aria-label="Luồng xử lý yêu cầu"><span>01</span><div><strong>Đọc yêu cầu</strong><small>Đối chiếu bài và band đã trả</small></div><i>→</i><span>02</span><div><strong>Quyết định atomic</strong><small>Essay và request cùng giao dịch</small></div><i>→</i><span>03</span><div><strong>Chấm & trả lại</strong><small>Fulfilled khi re-deliver</small></div></section>

    <nav className="awr-tabs" aria-label="Trạng thái yêu cầu">{TABS.map((tab) => <button type="button" key={tab.id} className={filters.status === tab.id ? 'is-active' : ''} aria-current={filters.status === tab.id ? 'page' : undefined} onClick={() => navigate({ ...filters, status: tab.id })} disabled={busy}><span><strong>{tab.label}</strong><small>{tab.note}</small></span><b>{counts[tab.id] || 0}</b></button>)}</nav>

    <StatusBanner banner={banner} />
    {stale && <div className="awr-warning" role="alert"><strong>Snapshot cũ</strong><span>Refresh lỗi: {loadError}. Danh sách đang hiển thị được đọc lúc {formatDate(snapshot?.readAt || null)}.</span><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void loadAll()}>Thử lại</button></div>}
    {snapshot?.capped && <div className="awr-warning"><strong>Có lane chạm ngưỡng 300</strong><span>Count và tìm kiếm của ít nhất một trạng thái chỉ phản ánh 300 yêu cầu mới nhất trong lane đó.</span></div>}
    {snapshot && snapshot.malformed > 0 && <div className="awr-warning" role="alert"><strong>Dữ liệu bị loại</strong><span>{snapshot.malformed} dòng sai contract không được hiển thị; cần kiểm tra backend trước khi quyết định.</span></div>}

    <section className="awr-workspace">
      <header className="awr-workspace__head"><div><p className="awr-eyebrow">Decision queue</p><h2>{TABS.find((tab) => tab.id === filters.status)?.label}</h2><p>{filters.status === 'pending' ? 'Ưu tiên yêu cầu cũ trước; mở từng hồ sơ để quyết định.' : 'Lịch sử chỉ đọc theo kết quả đã persisted.'}</p></div><div className="awr-count"><strong>{visible.length}</strong><span>yêu cầu hiển thị</span></div></header>
      <div className="awr-toolbar"><label><span>Tìm trong snapshot</span><input value={query} maxLength={120} placeholder="Tên, mã học viên, lớp, đề hoặc lý do…" onChange={(event) => { const q = event.target.value; setQuery(q); navigate({ ...filters, q }); }}/></label><button className="adm-btn-secondary" type="button" onClick={() => void loadAll()} disabled={loading || busy}>Làm mới canonical</button></div>
      {loading && !rows.length ? <div className="awr-state" role="status"><span className="awr-spinner"/><strong>Đang tải yêu cầu…</strong></div>
        : loadError && !rows.length ? <div className="awr-state is-error" role="alert"><strong>Không tải được hàng yêu cầu</strong><p>{loadError}</p><button className="adm-btn-secondary" type="button" onClick={() => void loadAll()}>Thử lại</button></div>
          : !visible.length ? <div className="awr-state"><strong>Không có yêu cầu phù hợp</strong><p>Đổi trạng thái hoặc xoá từ khoá tìm kiếm.</p></div>
            : <div className="awr-list">{visible.map((row) => <article className="awr-card" key={row.id}>
              <div className="awr-card__main"><div className="awr-card__top"><span className={`awr-status is-${row.status}`}>{STATUS_COPY[row.status]}</span><time>{formatDate(row.createdAt)}</time></div><h3>{row.studentName}</h3><p className="awr-identity">{[row.studentCode, row.cohortName].filter(Boolean).join(' · ') || 'Chưa có mã/lớp'}</p><blockquote>{row.reason}</blockquote></div>
              <div className="awr-card__essay"><span>{row.taskType ? TASK_COPY[row.taskType] : 'Không rõ loại bài'}</span><strong>{row.essayPrompt || 'Không đọc được đề bài'}</strong><small>{row.essayBand != null ? `Band đã trả ${row.essayBand}` : 'Chưa có band canonical'} · Essay: {row.essayStatus || 'không rõ'}</small></div>
              <div className="awr-card__action"><button className="adm-btn-secondary" type="button" onClick={() => void openDetail(row)} disabled={busy}>Mở hồ sơ</button></div>
            </article>)}</div>}
    </section>

    <Dialog open={selected !== null} title="Hồ sơ yêu cầu chấm lại" description={selected ? `${selected.studentName} · ${STATUS_COPY[dialogStatus]}` : ''} onClose={close} busy={busy} panelClassName="awr-dialog" actions={<>{selected?.status === 'pending' ? pendingDecision.current ? <><button className="adm-btn-secondary" type="button" onClick={close} disabled={busy}>Đóng</button><button className="adm-btn-primary" type="button" onClick={() => void decide(pendingDecision.current?.status === 'rejected' ? 'reject' : 'accept')} disabled={busy}>{busy ? 'Đang đối chiếu…' : 'Thử đối chiếu lại'}</button></> : <><button className="adm-btn-secondary" type="button" onClick={close} disabled={busy}>Đóng</button><button className="adm-btn-danger" type="button" onClick={() => void decide('reject')} disabled={busy || detailStale}>{busy ? 'Đang xử lý…' : rejectMode ? 'Xác nhận từ chối' : 'Từ chối'}</button><button className="adm-btn-primary" type="button" onClick={() => void decide('accept')} disabled={busy || detailStale}>{busy ? 'Đang xử lý…' : 'Chấp nhận & mở chấm lại'}</button></> : <><button className="adm-btn-secondary" type="button" onClick={close}>Đóng</button>{selected?.status === 'accepted' && <a className="adm-btn-primary" href={`/admin/writing/grade?essay_id=${encodeURIComponent(selected.essayId)}`}>Mở bài để chấm lại</a>}</>}</>}>
      {selected && <div className="awr-detail"><section><span>Học viên</span><strong>{selected.studentName}</strong><p>{[selected.studentCode, selected.cohortName].filter(Boolean).join(' · ') || 'Chưa có mã/lớp'}</p></section><section><span>Bài đã trả</span><strong>{selected.taskType ? TASK_COPY[selected.taskType] : 'Không rõ loại bài'}{selected.essayBand != null ? ` · Band ${selected.essayBand}` : ''}</strong><p>{selected.essayPrompt || 'Không đọc được đề bài'}</p><a href={`/admin/writing/grade?essay_id=${encodeURIComponent(selected.essayId)}`}>Mở workspace chấm ↗</a></section><section className="is-reason"><span>Lý do của học viên</span><blockquote>{selected.reason}</blockquote></section>{selected.adminResponse && <section className="is-response"><span>Phản hồi admin</span><p>{selected.adminResponse}</p></section>}{rejectMode && selected.status === 'pending' && <label className="awr-reject"><span>Lý do từ chối <b>*</b></span><textarea autoFocus rows={5} maxLength={1000} value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Giải thích ngắn gọn, cụ thể và có thể hành động…"/><small>{response.length}/1000</small></label>}{detailStale && <div className="awr-inline-error">Đang dùng snapshot danh sách; hành động bị khóa đến khi đọc được detail canonical.</div>}{dialogError && <div className="awr-inline-error" role="alert">{dialogError}</div>}</div>}
    </Dialog>
  </main>;
}
