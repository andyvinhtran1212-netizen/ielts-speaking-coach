'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog } from '@/components/admin-directory-ui';
import {
  LISTENING_STATUS_LABEL, formatListeningContentDate, listeningTestListHref,
  normalizeListeningTestFilters, normalizeListeningTestList,
  normalizeListeningTestMutationReadback,
} from '@/lib/admin-listening-content-model.mjs';
import { consumeListeningTestDeleteReceipt, listeningTestDeleteReceiptKey } from '@/lib/admin-listening-test-detail-model.mjs';

type Status = 'all' | 'draft' | 'published' | 'archived';
type TestType = 'all' | 'exam' | 'full' | 'mini' | 'drill' | 'practice';
type Row = { id: string; testId: string; status: Exclude<Status, 'all'>; type: Exclude<TestType, 'all' | 'exam'>; title: string; bandTarget: number | null; accentProfile: string[]; sectionCount: number; audioReadyCount: number; examOnly: boolean; createdAt: string | null; updatedAt: string | null };
type Snapshot = { key: string; rows: Row[]; total: number; malformedCount: number; readAt: string };
type Action = { row: Row; kind: 'status'; status: Exclude<Status, 'all'> } | { row: Row; kind: 'exam'; examOnly: boolean };
type DeleteReceipt = { kind: 'success' | 'warning'; text: string };

const PAGE_SIZE = 20;
const STATUS_OPTIONS: Array<{ value: Status; label: string }> = (['all', 'draft', 'published', 'archived'] as Status[]).map((value) => ({ value, label: LISTENING_STATUS_LABEL[value] }));
const TYPE_OPTIONS: Array<{ value: TestType; label: string }> = [
  { value: 'all', label: 'Tất cả loại' }, { value: 'exam', label: 'Đề thi' },
  { value: 'full', label: 'Full test' }, { value: 'mini', label: 'Mini test' },
  { value: 'drill', label: 'Luyện kỹ năng' }, { value: 'practice', label: 'Luyện nhanh' },
];
const TYPE_LABEL = { full: 'Full test', mini: 'Mini test', drill: 'Skill drill', practice: 'Quick practice' } as const;
const messageOf = (caught: unknown) => caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định');
const statusClass = (status: string) => status === 'published' ? 'is-live' : status === 'archived' ? 'is-failed' : 'is-new';

export function AdminListeningTests() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = normalizeListeningTestFilters({ status: params?.get('status'), type: params?.get('type'), search: params?.get('search'), page: params?.get('page') }) as { status: Status; type: TestType; search: string; page: number };
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const offset = (filters.page - 1) * PAGE_SIZE;
  const key = `${profile.id}:${filters.status}:${filters.type}:${filters.search}:${offset}`;
  const sequence = useRef(0);
  const scope = useRef(key);
  const receiptProfile = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteReceipt, setDeleteReceipt] = useState<DeleteReceipt | null>(null);
  const current = snapshot?.key === key ? snapshot : null;

  useEffect(() => setSearchDraft(filters.search), [filters.search]);
  useEffect(() => {
    if (receiptProfile.current === profile.id) return;
    receiptProfile.current = profile.id;
    setDeleteReceipt(null);
    const receiptKey = listeningTestDeleteReceiptKey(profile.id);
    setDeleteReceipt(consumeListeningTestDeleteReceipt(receiptKey) as DeleteReceipt | null);
  }, [profile.id]);
  useEffect(() => {
    if (searchDraft === filters.search) return;
    const timer = window.setTimeout(() => router.replace(listeningTestListHref({ ...filters, search: searchDraft, page: 1 })), 350);
    return () => window.clearTimeout(timer);
  }, [filters, router, searchDraft]);

  const load = useCallback(async (preserve = true) => {
    const request = ++sequence.current;
    const owner = key;
    setLoading(true); setLoadError(null);
    const query = new URLSearchParams({ status: filters.status, test_type: filters.type, search: filters.search, limit: String(PAGE_SIZE), offset: String(offset) });
    try {
      const normalized = normalizeListeningTestList(await window.api.get<unknown>(`/admin/listening/tests?${query}`), { ...filters, limit: PAGE_SIZE, offset }) as { rows: Row[]; malformedCount: number; total: number } | null;
      if (!normalized) throw new Error('Phản hồi danh sách test không đúng contract canonical.');
      if (request !== sequence.current || scope.current !== owner) return;
      const lastPage = Math.max(1, Math.ceil(normalized.total / PAGE_SIZE));
      if (!normalized.rows.length && filters.page > lastPage) { router.replace(listeningTestListHref({ ...filters, page: lastPage })); return; }
      setSnapshot({ key: owner, rows: normalized.rows, total: normalized.total, malformedCount: normalized.malformedCount, readAt: new Date().toISOString() });
      return true;
    } catch (caught) {
      if (request === sequence.current && scope.current === owner) setLoadError(`${preserve && current ? 'Không thể làm mới — đang giữ snapshot trước. ' : ''}${messageOf(caught)}`);
      return false;
    } finally { if (request === sequence.current && scope.current === owner) setLoading(false); }
  }, [current, filters, key, offset, router]);

  useEffect(() => {
    scope.current = key; setSnapshot(null); setLoadError(null); setNotice(null); setAction(null); setBusy(false); void load(false);
    return () => { sequence.current += 1; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (patch: Partial<typeof filters>) => router.push(listeningTestListHref({ ...filters, ...patch, page: 1 }));
  const mutate = async () => {
    if (!action || busy) return;
    const target = action; const owner = key;
    setBusy(true); setLoadError(null); setNotice(null);
    try {
      if (target.kind === 'status') await window.api.patch(`/admin/listening/tests/${encodeURIComponent(target.row.id)}/status`, { status: target.status });
      else await window.api.patch(`/admin/listening/tests/${encodeURIComponent(target.row.id)}`, { exam_only: target.examOnly });
      const readback = normalizeListeningTestMutationReadback(await window.api.get<unknown>(`/admin/listening/tests/${encodeURIComponent(target.row.id)}`), target.row.id, target.kind === 'status' ? { status: target.status } : { examOnly: target.examOnly });
      if (!readback) throw new Error('Backend chưa xác nhận thay đổi vừa chọn.');
      if (scope.current !== owner) return;
      const refreshed = await load(false);
      if (scope.current !== owner) return;
      setAction(null);
      const saved = target.kind === 'status' ? LISTENING_STATUS_LABEL[target.status] : target.examOnly ? 'chỉ dùng cho kỳ thi' : 'trở lại thư viện luyện tập';
      setNotice(refreshed ? `Đã đối chiếu backend: ${saved}.` : `Backend đã xác nhận ${saved}, nhưng danh sách chưa làm mới được. Dùng “Làm mới” để đối chiếu lại.`);
    } catch (caught) {
      if (scope.current === owner) setLoadError(`Không xác nhận được thay đổi canonical: ${messageOf(caught)}. Danh sách chưa được sửa lạc quan.`);
    } finally { if (scope.current === owner) setBusy(false); }
  };

  const maxPage = current ? Math.max(1, Math.ceil(current.total / PAGE_SIZE)) : 1;
  return <main className="alt-shell">
    <header className="alt-hero"><div><p className="alc-eyebrow">Listening · Test operations</p><h1>Kho test Listening</h1><p>Đối chiếu cấu trúc section, audio và phạm vi hiển thị trước khi phát hành hoặc dành riêng đề cho kỳ thi.</p></div><div className="alt-hero__actions"><a className="adm-btn-primary" href="/admin/listening/import-fulltest">Import full test</a><a className="adm-btn-secondary" href="/admin/listening/import-drills">Import skill drill</a><a className="adm-btn-secondary" href="/admin/listening/audit">Audit chất lượng</a></div></header>
    <section className="alt-boundary" aria-labelledby="alt-boundary-title"><div><p className="alc-eyebrow">Visibility boundary</p><h2 id="alt-boundary-title">Published chưa chắc nằm trong thư viện luyện tập</h2></div><div><span className="adm-status-pill is-live">Published</span><p>Đã qua cổng audio và có thể được phân phối.</p></div><div><span className="alt-scope is-exam">Đề kỳ thi</span><p><code>exam_only=true</code> ẩn đề khỏi thư viện luyện tập.</p></div></section>
    <section className="alt-library" aria-labelledby="alt-list-title">
      <div className="alt-section-head"><div><p>Canonical inventory</p><h2 id="alt-list-title">Test bundles đã lưu</h2><span>{current ? `${current.total} test · đọc lúc ${formatListeningContentDate(current.readAt)}` : 'Đang đọc từ backend…'}</span></div><button className="adm-btn-secondary" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
      <div className="alt-toolbar"><nav className="alt-status" aria-label="Lọc trạng thái">{STATUS_OPTIONS.map((item) => <button type="button" key={item.value} aria-current={filters.status === item.value ? 'page' : undefined} onClick={() => setFilter({ status: item.value })}>{item.label}</button>)}</nav><label><span>Loại test</span><select value={filters.type} onChange={(event) => setFilter({ type: event.target.value as TestType })}>{TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="alt-search"><span>Tìm Test ID</span><input type="search" value={searchDraft} placeholder="ILR-LIS-…" onChange={(event) => setSearchDraft(event.target.value)} /></label></div>
      {loadError && <div className="alc-banner is-error" role="alert"><strong>Cần kiểm tra</strong><span>{loadError}</span></div>}
      {notice && <div className="alc-banner is-success" role="status"><strong>Đã lưu</strong><span>{notice}</span></div>}
      {deleteReceipt && <div className={`alc-banner is-${deleteReceipt.kind}`} role="status"><strong>{deleteReceipt.kind === 'warning' ? 'Đã xóa, cần dọn storage' : 'Đã xóa'}</strong><span>{deleteReceipt.text}</span></div>}
      {!!current?.malformedCount && <div className="alc-banner is-warning" role="status"><strong>Dữ liệu cần kiểm tra</strong><span>Đã loại {current.malformedCount} dòng sai contract hoặc không khớp bộ lọc; tổng backend vẫn được giữ nguyên.</span></div>}
      {loading && !current && <div className="alt-state" role="status">Đang đọc kho test…</div>}
      {current && !current.rows.length && <div className="alt-state"><strong>Không có test phù hợp</strong><span>Thử bộ lọc khác hoặc import một pack mới.</span></div>}
      {!!current?.rows.length && <div className="alt-table-wrap" role="region" aria-label="Bảng test Listening" tabIndex={0}><table className="alt-table"><thead><tr><th>Test</th><th>Loại & phạm vi</th><th>Cấu trúc</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{current.rows.map((row) => <TestRow key={row.id} row={row} busy={busy} onAction={setAction} />)}</tbody></table></div>}
      {current && current.total > PAGE_SIZE && <nav className="alt-pagination" aria-label="Phân trang test"><button type="button" disabled={loading || busy || filters.page === 1} onClick={() => router.push(listeningTestListHref({ ...filters, page: filters.page - 1 }))}>← Trước</button><span>Trang {filters.page}/{maxPage} · {current.total} test</span><button type="button" disabled={loading || busy || offset + PAGE_SIZE >= current.total} onClick={() => router.push(listeningTestListHref({ ...filters, page: filters.page + 1 }))}>Sau →</button></nav>}
    </section>
    <a className="alc-rollback" href="/pages/admin/listening/tests.html">Mở bản HTML rollback ↗</a>
    <Dialog open={Boolean(action)} title={dialogTitle(action)} description={dialogDescription(action)} busy={busy} onClose={() => setAction(null)} actions={<><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setAction(null)}>Hủy</button><button className={action?.kind === 'status' && action.status === 'archived' ? 'adm-btn-danger' : 'adm-btn-primary'} type="button" disabled={busy} onClick={() => void mutate()}>{busy ? 'Đang đối chiếu…' : 'Xác nhận thay đổi'}</button></>} />
  </main>;
}

function TestRow({ row, busy, onAction }: { row: Row; busy: boolean; onAction: (action: Action) => void }) {
  const statusActions: Array<{ status: Exclude<Status, 'all'>; label: string }> = row.status === 'draft' ? [{ status: 'published', label: 'Phát hành' }, { status: 'archived', label: 'Lưu trữ' }] : row.status === 'published' ? [{ status: 'archived', label: 'Lưu trữ' }] : [{ status: 'draft', label: 'Khôi phục' }];
  return <tr data-test-id={row.id}><td data-label="Test"><a className="alt-title" href={`/admin/listening/tests/${encodeURIComponent(row.id)}`}>{row.testId}</a><strong>{row.title}</strong><small>{row.bandTarget == null ? 'Chưa đặt band' : `Band ${row.bandTarget}`} · {row.accentProfile.join(' · ') || 'Chưa đặt accent'}</small></td><td data-label="Loại & phạm vi"><span>{TYPE_LABEL[row.type]}</span><span className={`alt-scope ${row.examOnly ? 'is-exam' : 'is-library'}`}>{row.examOnly ? 'Đề kỳ thi' : 'Thư viện luyện tập'}</span></td><td data-label="Cấu trúc"><strong>{row.sectionCount} section</strong><small>{row.audioReadyCount}/{row.sectionCount} section có audio</small></td><td data-label="Trạng thái"><span className={`adm-status-pill ${statusClass(row.status)}`}>{LISTENING_STATUS_LABEL[row.status]}</span><time dateTime={row.updatedAt || row.createdAt || undefined}>{formatListeningContentDate(row.updatedAt || row.createdAt)}</time></td><td data-label="Thao tác"><div className="alt-actions"><a href={`/admin/listening/tests/${encodeURIComponent(row.id)}`}>Mở test</a><a href={`/admin/listening/tests/${encodeURIComponent(row.id)}#sections`}>Sections</a>{statusActions.map((item) => <button type="button" key={item.status} disabled={busy} onClick={() => onAction({ row, kind: 'status', status: item.status })}>{item.label}</button>)}<button type="button" disabled={busy} onClick={() => onAction({ row, kind: 'exam', examOnly: !row.examOnly })}>{row.examOnly ? 'Trả về thư viện' : 'Dành cho kỳ thi'}</button></div></td></tr>;
}

function dialogTitle(action: Action | null) { if (!action) return ''; return action.kind === 'status' ? `Chuyển ${action.row.testId} sang ${LISTENING_STATUS_LABEL[action.status]}?` : `${action.examOnly ? 'Dành' : 'Trả'} ${action.row.testId} ${action.examOnly ? 'cho kỳ thi' : 'về thư viện'}?`; }
function dialogDescription(action: Action | null) { if (!action) return ''; if (action.kind === 'status') return action.status === 'published' ? 'Backend sẽ kiểm cổng audio trước khi phát hành. UI chỉ xác nhận sau canonical GET.' : 'Đề sẽ không còn hiển thị cho học viên; dữ liệu attempt vẫn được giữ.'; return action.examOnly ? 'Đề biến mất khỏi thư viện luyện tập nhưng vẫn có thể được gán vào kỳ thi.' : 'Backend có thể từ chối nếu một kỳ thi chưa lưu trữ vẫn đang dùng đề này.'; }
