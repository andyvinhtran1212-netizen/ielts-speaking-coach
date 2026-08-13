'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, messageOf } from '@/components/admin-directory-ui';
import {
  claimReadback, findInstructorReview, instructorGradeHref, instructorQueueFilters,
  instructorQueueHref, instructorQueuePath, normalizeClaimAck, normalizeInstructorQueue,
  normalizeReleaseAck, pendingInstructorOperation, releaseReadback,
} from '@/lib/admin-writing-instructor-queue-model.mjs';

type Status = 'queued' | 'claimed' | 'edited' | 'delivered' | 'released';
type Review = { id: string; essayId: string; status: Status; claimedBy: string | null; claimedAt: string | null; deliveredAt: string | null; instructorNote: string | null; createdAt: string; updatedAt: string };
type Row = { review: Review; essayId: string; studentEmail: string | null; studentLevel: number; taskType: string; submittedAt: string; ageHours: number; isOverdue: boolean };
type Snapshot = { account: string; view: string; rows: Row[]; malformed: number; readAt: string };
type Pending = { account: string; action: 'claim' | 'release'; reviewId: string; essayId: string | null; startedAt: string };
type Banner = { kind: 'success' | 'warning' | 'error'; title: string; detail: string };

const POLL_INTERVAL_MS = 30_000;
const RECONCILE_PATH = '/admin/instructor/queue?status=queued&status=claimed&status=edited&status=delivered&status=released';
const VIEWS = [
  { id: 'all_active', label: 'Đang hoạt động', note: 'Chờ nhận + đang xử lý' },
  { id: 'queued', label: 'Chờ nhận', note: 'FIFO chưa có người giữ' },
  { id: 'my_claims', label: 'Bài của tôi', note: 'Đang claim hoặc đã sửa' },
  { id: 'delivered', label: 'Đã trả', note: 'Lịch sử trả bài chỉ đọc' },
] as const;
const STATUS_COPY: Record<Status, string> = { queued: 'Chờ nhận', claimed: 'Đang review', edited: 'Đã sửa · chờ trả', delivered: 'Đã trả', released: 'Đã thả' };
const TASK_COPY: Record<string, string> = { task1_academic: 'Task 1 Academic', task1_general: 'Task 1 General', task2: 'Task 2' };
const storageKey = (account: string) => `awiq-pending:${account}`;
const statusCodeOf = (caught: unknown) => typeof caught === 'object' && caught !== null && 'status' in caught ? Number((caught as { status?: unknown }).status) : 0;
const definitive = (status: number) => Number.isInteger(status) && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
const formatDate = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const formatAge = (hours: number) => hours < 1 ? `${Math.max(1, Math.round(hours * 60))} phút` : hours < 24 ? `${Math.round(hours)} giờ` : `${Math.floor(hours / 24)} ngày ${Math.floor(hours % 24)} giờ`;

function readPending(account: string): Pending | null {
  try { return pendingInstructorOperation(JSON.parse(sessionStorage.getItem(storageKey(account)) || 'null'), account) as Pending | null; } catch { return null; }
}
function writePending(value: Pending | null) {
  if (!value) return;
  sessionStorage.setItem(storageKey(value.account), JSON.stringify(value));
}
function clearPending(account: string) { sessionStorage.removeItem(storageKey(account)); }

export function AdminWritingInstructorQueue() {
  const profile = useAdminProfile(); const router = useRouter(); const params = useSearchParams();
  const filters = useMemo(() => instructorQueueFilters({ view: params?.get('view'), embed: params?.get('embed'), mocklane: params?.get('mocklane') }), [params]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null); const [busy, setBusy] = useState<string | null>(null); const [releaseTarget, setReleaseTarget] = useState<Row | null>(null);
  const [pending, setPending] = useState<Pending | null>(null); const requestRef = useRef(0); const accountRef = useRef(profile.id); const loadRunning = useRef(false); accountRef.current = profile.id;
  const current = snapshot?.account === profile.id && snapshot.view === filters.view ? snapshot : null;
  const navigate = useCallback((view: string) => router.replace(instructorQueueHref({ ...filters, view }), { scroll: false }), [filters, router]);

  const loadQueue = useCallback(async (quiet = false) => {
    if (loadRunning.current && quiet) return null;
    const request = ++requestRef.current; const account = profile.id; const view = filters.view; loadRunning.current = true;
    if (!quiet) setLoading(true);
    try {
      const normalized = normalizeInstructorQueue(await window.api.get<unknown>(instructorQueuePath(view, account)));
      if (!normalized) throw new Error('Hàng đợi trả dữ liệu sai contract.');
      if (request !== requestRef.current || accountRef.current !== account) return null;
      const next = { account, view, rows: normalized.rows as Row[], malformed: normalized.malformedCount, readAt: new Date().toISOString() };
      setSnapshot(next); setLoadError(null); return next;
    } catch (caught) {
      if (request === requestRef.current && accountRef.current === account) setLoadError(messageOf(caught));
      return null;
    } finally {
      if (request === requestRef.current && accountRef.current === account) { setLoading(false); loadRunning.current = false; }
    }
  }, [filters.view, profile.id]);

  const reconcile = useCallback(async (operation: Pending, announce = true) => {
    const account = profile.id; setBusy(operation.reviewId); if (announce) setBanner({ kind: 'warning', title: 'Đang đối chiếu thao tác', detail: 'Chỉ đọc lại canonical state; không gửi lại POST.' });
    try {
      const normalized = normalizeInstructorQueue(await window.api.get<unknown>(RECONCILE_PATH));
      if (!normalized) throw new Error('Canonical readback sai contract.');
      if (accountRef.current !== account) return false;
      const row = findInstructorReview(normalized.rows, operation.reviewId) as Row | null;
      if (operation.action === 'claim') {
        const confirmed = claimReadback(row, account) as Row | null;
        if (confirmed) {
          clearPending(account); setPending(null); setBanner({ kind: 'success', title: 'Đã xác nhận quyền giữ bài', detail: 'Đang mở workspace chấm từ essay canonical.' });
          window.location.href = instructorGradeHref(confirmed.essayId, filters); return true;
        }
        if (row?.review.claimedBy && row.review.claimedBy !== account) {
          clearPending(account); setPending(null); setBanner({ kind: 'warning', title: 'Bài đã thuộc instructor khác', detail: 'Không gửi lại claim. Hàng đợi sẽ được làm mới.' }); await loadQueue(); return false;
        }
        if (row?.review.status === 'queued' && row.review.claimedBy === null) {
          clearPending(account); setPending(null); setBanner({ kind: 'warning', title: 'Claim chưa được ghi nhận', detail: 'Canonical state vẫn là Chờ nhận. Bạn có thể claim lại từ hàng đợi đã làm mới.' }); await loadQueue(); return false;
        }
        if (['delivered', 'released'].includes(row?.review.status || '')) {
          clearPending(account); setPending(null); setBanner({ kind: 'warning', title: 'Workflow đã đi tiếp', detail: 'Bài không còn ở trạng thái cần claim. Hàng đợi đã được làm mới theo canonical state.' }); await loadQueue(); return false;
        }
        throw new Error('Backend chưa xác nhận bài thuộc quyền của tài khoản hiện tại.');
      }
      const confirmed = releaseReadback(row) as Row | null;
      if (confirmed || (row?.review.claimedBy && row.review.claimedBy !== account)) {
        clearPending(account); setPending(null); setReleaseTarget(null); setBanner({ kind: 'success', title: 'Đã xác nhận thả bài', detail: row?.review.claimedBy ? 'Bài hiện đã được instructor khác nhận.' : 'Bài đã trở về hàng chờ.' }); await loadQueue(); return true;
      }
      if (['delivered', 'released'].includes(row?.review.status || '')) {
        clearPending(account); setPending(null); setReleaseTarget(null); setBanner({ kind: 'warning', title: 'Workflow đã đi tiếp', detail: 'Bài đã rời lane đang review; không gửi lại release.' }); await loadQueue(); return true;
      }
      throw new Error('Backend chưa xác nhận bài đã rời quyền sở hữu hiện tại.');
    } catch (caught) {
      setBanner({ kind: 'error', title: 'Chưa đối chiếu được thao tác', detail: `${messageOf(caught)} Không bấm lại hành động; dùng “Đối chiếu lại”.` }); return false;
    } finally { setBusy(null); }
  }, [filters, loadQueue, profile.id]);

  useEffect(() => {
    const stored = readPending(profile.id); setPending(stored);
    if (stored) void reconcile(stored, false).then((confirmed) => { if (!confirmed) void loadQueue(); });
    else void loadQueue();
  }, [loadQueue, profile.id, reconcile]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(() => { if (!document.hidden) void loadQueue(true); }, POLL_INTERVAL_MS); };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const visibility = () => { if (document.hidden) stop(); else { void loadQueue(true); start(); } };
    start(); document.addEventListener('visibilitychange', visibility); return () => { stop(); document.removeEventListener('visibilitychange', visibility); };
  }, [loadQueue]);

  const claim = async (row: Row) => {
    const operation: Pending = { account: profile.id, action: 'claim', reviewId: row.review.id, essayId: row.essayId, startedAt: new Date().toISOString() };
    writePending(operation); setPending(operation); setBusy(row.review.id); setBanner(null);
    try {
      const raw = await window.api.post<unknown>(`/admin/instructor/reviews/${encodeURIComponent(row.review.id)}/claim`, {});
      if (!normalizeClaimAck(raw, row.review.id, profile.id)) throw new Error('Claim ACK không khớp review, owner hoặc trạng thái mong đợi.');
      await reconcile(operation, false);
    } catch (caught) {
      const status = statusCodeOf(caught);
      if (definitive(status)) { clearPending(profile.id); setPending(null); setBanner({ kind: 'error', title: 'Claim bị từ chối', detail: messageOf(caught) }); }
      else await reconcile(operation, false);
    } finally { setBusy(null); }
  };

  const release = async () => {
    const row = releaseTarget; if (!row) return;
    const operation: Pending = { account: profile.id, action: 'release', reviewId: row.review.id, essayId: row.essayId, startedAt: new Date().toISOString() };
    writePending(operation); setPending(operation); setBusy(row.review.id); setBanner(null);
    try {
      const raw = await window.api.post<unknown>(`/admin/instructor/reviews/${encodeURIComponent(row.review.id)}/release`, {});
      if (!normalizeReleaseAck(raw, row.review.id)) throw new Error('Release ACK không khớp review hoặc trạng thái queued mong đợi.');
      await reconcile(operation, false);
    } catch (caught) {
      const status = statusCodeOf(caught);
      if (status === 403) await reconcile(operation, false);
      else if (definitive(status)) { clearPending(profile.id); setPending(null); setReleaseTarget(null); setBanner({ kind: 'error', title: 'Release bị từ chối', detail: messageOf(caught) }); }
      else await reconcile(operation, false);
    } finally { setBusy(null); }
  };

  const rows = current?.rows || [];
  return <main className="awi-shell">
    <header className="awi-hero"><div><p className="awi-eyebrow">Writing · Human review lane</p><h1>Hàng đợi Instructor</h1><p>Nhận bài theo FIFO, chỉnh feedback trong workspace và chỉ kết luận thao tác sau canonical readback.</p></div><div className="awi-hero__actions"><a className="adm-btn-secondary" href="/admin/writing">Writing workspace</a><button className="adm-btn-primary" type="button" disabled={loading || Boolean(busy)} onClick={() => void loadQueue()}>{loading ? 'Đang làm mới…' : 'Làm mới canonical'}</button></div></header>
    <section className="awi-flow" aria-label="Chu trình instructor"><div><span>01</span><strong>Claim atomic</strong><small>Một instructor giữ bài</small></div><i>→</i><div><span>02</span><strong>Review & chỉnh sửa</strong><small>Mở essay canonical</small></div><i>→</i><div><span>03</span><strong>Deliver có kiểm chứng</strong><small>Học viên mới nhìn thấy</small></div></section>
    {banner && <div className={`awi-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}><div><strong>{banner.title}</strong><span>{banner.detail}</span></div>{pending && <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={Boolean(busy)} onClick={() => void reconcile(pending)}>{busy ? 'Đang đối chiếu…' : 'Đối chiếu lại'}</button>}</div>}
    {loadError && current && <div className="awi-banner is-warning" role="alert"><div><strong>Đang hiển thị snapshot cũ</strong><span>{loadError} · đọc lúc {formatDate(current.readAt)}</span></div></div>}
    {current && current.malformed > 0 && <div className="awi-banner is-warning" role="alert"><div><strong>Dữ liệu bị loại</strong><span>{current.malformed} dòng sai contract không được hiển thị.</span></div></div>}
    <nav className="awi-tabs" aria-label="Bộ lọc hàng đợi">{VIEWS.map((item) => <button type="button" className={filters.view === item.id ? 'is-active' : ''} aria-current={filters.view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)} disabled={Boolean(busy)} key={item.id}><span><strong>{item.label}</strong><small>{item.note}</small></span></button>)}</nav>
    <section className="awi-workspace" aria-labelledby="awi-list-title"><header><div><p className="awi-eyebrow">Canonical queue snapshot</p><h2 id="awi-list-title">{VIEWS.find((item) => item.id === filters.view)?.label}</h2><p>{filters.view === 'delivered' ? 'Lịch sử đã trả; mở bài ở chế độ xem.' : 'Bài cũ nhất được ưu tiên trước. Poll tuần tự mỗi 30 giây và tạm dừng khi tab ẩn.'}</p></div><div className="awi-count"><strong>{rows.length}</strong><span>bài hiển thị</span></div></header>
      {loading && !current ? <div className="awi-state" role="status"><span className="awi-spinner"/><strong>Đang đọc hàng đợi…</strong></div> : loadError && !current ? <div className="awi-state is-error" role="alert"><strong>Không tải được hàng đợi</strong><p>{loadError}</p><button className="adm-btn-secondary" type="button" onClick={() => void loadQueue()}>Thử lại</button></div> : !rows.length ? <div className="awi-state"><strong>{filters.view === 'my_claims' ? 'Bạn chưa giữ bài nào' : filters.view === 'delivered' ? 'Chưa có bài đã trả' : 'Hàng đợi đang trống'}</strong><p>Snapshot canonical hiện không có bài ở lane này.</p></div> : <div className="awi-list">{rows.map((row) => <QueueRow row={row} adminId={profile.id} filters={filters} busy={busy === row.review.id} onClaim={() => void claim(row)} onRelease={() => setReleaseTarget(row)} key={row.review.id}/>)}</div>}
    </section>
    <Dialog open={releaseTarget !== null} title="Thả bài về hàng chờ?" description="Quyền giữ bài của bạn sẽ được gỡ. Instructor khác có thể claim ngay sau đó." onClose={() => setReleaseTarget(null)} busy={Boolean(busy)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setReleaseTarget(null)} disabled={Boolean(busy)}>Giữ bài</button><button className="adm-btn-danger" type="button" onClick={() => void release()} disabled={Boolean(busy)}>{busy ? 'Đang đối chiếu…' : 'Xác nhận thả bài'}</button></>}><p className="awi-dialog-copy">Mọi chỉnh sửa đã lưu trong workspace vẫn được giữ. Thao tác chỉ được báo thành công sau khi đọc lại trạng thái canonical.</p></Dialog>
  </main>;
}

function QueueRow({ row, adminId, filters, busy, onClaim, onRelease }: { row: Row; adminId: string; filters: { view: string; embed: string; mocklane: string }; busy: boolean; onClaim: () => void; onRelease: () => void }) {
  const mine = row.review.claimedBy === adminId; const activeMine = mine && ['claimed', 'edited'].includes(row.review.status); const locked = Boolean(row.review.claimedBy) && !mine;
  return <article className={`awi-row${row.isOverdue ? ' is-overdue' : ''}`}><div className="awi-row__age"><span className={row.isOverdue ? 'is-overdue' : row.ageHours >= 24 ? 'is-warning' : ''}>{formatAge(row.ageHours)}</span><time>{formatDate(row.submittedAt)}</time></div><div className="awi-row__student"><strong>{row.studentEmail || 'Học viên chưa có email'}</strong><span>Level {row.studentLevel} · {TASK_COPY[row.taskType] || row.taskType}</span></div><div className="awi-row__status"><span className={`awi-status is-${row.review.status}`}>{STATUS_COPY[row.review.status]}</span>{locked && <small>Đang do instructor khác giữ</small>}{activeMine && <small>Bạn đang giữ bài này</small>}</div><div className="awi-row__actions">{row.review.status === 'queued' && <button className="adm-btn-primary" type="button" onClick={onClaim} disabled={busy}>{busy ? 'Đang đối chiếu…' : 'Claim & mở bài'}</button>}{activeMine && <><a className="adm-btn-primary" href={instructorGradeHref(row.essayId, filters)}>Mở workspace</a><button className="adm-btn-secondary" type="button" onClick={onRelease} disabled={busy}>Thả bài</button></>}{locked && <span className="awi-locked">Đã khóa</span>}{row.review.status === 'delivered' && <a className="adm-btn-secondary" href={instructorGradeHref(row.essayId, filters)}>Xem bài</a>}</div></article>;
}
