'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  BULK_MAX,
  TABS,
  libraryQuery,
  normalizeLibraryFilters,
  normalizeLibraryList,
  normalizePublishResult,
  normalizeTab,
  publishSummary,
  titleProblem,
} from '@/lib/admin-library-model.mjs';

type Shelf = 'writing' | 'speaking';
type Blocker = { code: string; message: string };
type Row = {
  id: string; slug: string; titleEn: string; topicSlug: string | null; published: boolean;
  publishedAt: string | null; updatedAt: string | null; blockers: Blocker[];
  taskType?: string; questionType?: string | null; task1Subtype?: string | null;
  part?: number; titleVi?: string | null; videoSource?: string | null; durationS?: number | null; hasAudio?: boolean;
};
type LibraryList = {
  items: Row[]; total: number; page: number; pageSize: number; pageCount: number;
  counts: { all: number; published: number; draft: number }; topics: { slug: string; label: string }[];
};
type Filters = { status: string; q: string; topic: string; page: number; task?: string; part?: string };
type PublishResult = {
  changed: string[]; unchanged: string[]; rejected: { id: string; slug: string | null; reasons: Blocker[] }[]; auditLogged: boolean;
};
type Banner = { kind: 'success' | 'warning' | 'error'; text: string; rejected?: PublishResult['rejected'] };

const API = { writing: '/admin/library/writing-samples', speaking: '/admin/library/speaking-samples' } as const;
const STATUS_LABEL: Record<string, string> = { all: 'Tất cả', published: 'Đã đăng', draft: 'Bản nháp' };
const TASK_LABEL: Record<string, string> = { task2: 'Task 2', task1_academic: 'Task 1' };

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? '—' : at.toLocaleDateString('vi-VN');
}

function kindLabel(shelf: Shelf, row: Row) {
  if (shelf === 'speaking') return `Part ${row.part}`;
  return `${TASK_LABEL[row.taskType || ''] || row.taskType}${row.questionType ? ` · ${row.questionType}` : row.task1Subtype ? ` · ${row.task1Subtype}` : ''}`;
}

function EditRow({ shelf, row, topics, onCancel, onSaved }: {
  shelf: Shelf; row: Row; topics: LibraryList['topics'];
  onCancel: () => void; onSaved: (banner: Banner) => void;
}) {
  const [title, setTitle] = useState(row.titleEn);
  const [topic, setTopic] = useState(row.topicSlug || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = titleProblem(shelf, title);
  const save = async () => {
    const body: Record<string, string | null> = {};
    if (title.trim() !== row.titleEn) body.title_en = title.trim();
    if ((topic || null) !== row.topicSlug) body.topic_slug = topic || null;
    if (!Object.keys(body).length) { onCancel(); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await window.api.patch<{ changed?: unknown; audit_logged?: unknown }>(`${API[shelf]}/${encodeURIComponent(row.id)}`, body);
      if (!result || !Array.isArray(result.changed) || typeof result.audit_logged !== 'boolean') throw new Error('Phản hồi máy chủ không đúng định dạng');
      onSaved(result.audit_logged
        ? { kind: 'success', text: `Đã lưu “${row.slug}”.` }
        : { kind: 'warning', text: `Đã lưu “${row.slug}” nhưng chưa ghi được nhật ký admin. Báo kỹ thuật kiểm tra.` });
    } catch (caught) {
      setError(messageOf(caught));
      setSaving(false);
    }
  };
  return <div className="alb-edit" role="group" aria-label={`Sửa ${row.slug}`}>
    <label>Tiêu đề tiếng Anh
      <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-invalid={problem ? true : undefined} disabled={saving} />
    </label>
    <label>Chủ đề
      <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={saving}>
        {shelf === 'speaking' && <option value="">Chủ đề khác</option>}
        {shelf === 'writing' && !row.topicSlug && <option value="">— Chọn chủ đề —</option>}
        {topics.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}
      </select>
    </label>
    {problem && <p className="alb-field-error">{problem}</p>}
    {error && <p className="alb-field-error" role="alert">{error}</p>}
    <div className="alb-edit__actions">
      <button type="button" className="adm-btn-primary" disabled={saving || Boolean(problem) || (shelf === 'writing' && !topic)} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
      <button type="button" className="adm-btn-secondary" disabled={saving} onClick={onCancel}>Huỷ</button>
    </div>
  </div>;
}

function ShelfPanel({ shelf }: { shelf: Shelf }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => normalizeLibraryFilters(shelf, {
    status: searchParams?.get('status') || undefined,
    q: searchParams?.get('q') || undefined,
    topic: searchParams?.get('topic') || undefined,
    page: searchParams?.get('page') || undefined,
    task: searchParams?.get('task') || undefined,
    part: searchParams?.get('part') || undefined,
  }) as Filters, [searchParams, shelf]);
  const query = libraryQuery(shelf, filters);
  const [snapshot, setSnapshot] = useState<{ key: string; value: LibraryList } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(filters.q);
  const sequence = useRef(0);
  const key = `${shelf}?${query}`;
  const list = snapshot?.key === key ? snapshot.value : null;

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const normalized = normalizeLibraryList(shelf, await window.api.get<unknown>(`${API[shelf]}${query ? `?${query}` : ''}`)) as LibraryList | null;
      if (!normalized) throw new Error('Phản hồi máy chủ không đúng định dạng');
      if (requestId !== sequence.current) return;
      setSnapshot({ key, value: normalized });
    } catch (caught) {
      if (requestId === sequence.current) setError(messageOf(caught));
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, [key, query, shelf]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelected(new Set()); setEditing(null); setSearch(filters.q); }, [key, filters.q]);

  const navigate = (patch: Partial<Filters>) => {
    const next = { ...filters, page: 1, ...patch };
    const params = new URLSearchParams(libraryQuery(shelf, next));
    params.set('tab', shelf);
    router.replace(`/admin/library?${params}`);
  };

  const publish = async (ids: string[], published: boolean) => {
    if (!ids.length) return;
    setBusy(true);
    setBanner(null);
    try {
      const result = normalizePublishResult(await window.api.post<unknown>(`${API[shelf]}/publish`, { ids, published })) as PublishResult | null;
      if (!result) throw new Error('Phản hồi máy chủ không đúng định dạng');
      const kind = !result.auditLogged || result.rejected.length ? 'warning' : 'success';
      const text = publishSummary(result, { published }) + (result.auditLogged ? '' : ' · chưa ghi được nhật ký admin, báo kỹ thuật kiểm tra');
      setBanner({ kind, text, rejected: result.rejected });
    } catch (caught) {
      setBanner({ kind: 'error', text: `Chưa ${published ? 'đăng' : 'gỡ'} được: ${messageOf(caught)}. Danh sách bên dưới đã tải lại từ máy chủ, xem trạng thái từng mục trước khi thử lại.` });
    } finally {
      setBusy(false);
      setSelected(new Set());
      await load(); // canonical state after every mutation
    }
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else if (next.size < BULK_MAX) next.add(id);
    return next;
  });
  const topicLabel = (slug: string | null) => (slug ? list?.topics.find((t) => t.slug === slug)?.label || slug : shelf === 'speaking' ? 'Chủ đề khác' : '—');
  const slugOf = (id: string) => list?.items.find((r) => r.id === id)?.slug || id;

  return <section className="alb-panel" aria-labelledby={`alb-${shelf}-title`}>
    <h2 id={`alb-${shelf}-title`} className="alb-visually-hidden">{shelf === 'writing' ? 'Bài mẫu Writing' : 'Đề Speaking'}</h2>
    <div className="alb-filters">
      <div className="alb-status" role="group" aria-label="Tình trạng đăng">
        {(['all', 'published', 'draft'] as const).map((status) => <button key={status} type="button" aria-pressed={filters.status === status} onClick={() => navigate({ status })}>
          {STATUS_LABEL[status]}{list && <span className="alb-count">{list.counts[status]}</span>}
        </button>)}
      </div>
      {shelf === 'writing'
        ? <label>Task<select value={filters.task} onChange={(e) => navigate({ task: e.target.value })}><option value="">Tất cả</option><option value="task2">Task 2</option><option value="task1">Task 1</option></select></label>
        : <label>Part<select value={filters.part} onChange={(e) => navigate({ part: e.target.value })}><option value="">Tất cả</option><option value="1">Part 1</option><option value="2">Part 2</option><option value="3">Part 3</option></select></label>}
      <label>Chủ đề<select value={filters.topic} onChange={(e) => navigate({ topic: e.target.value })}><option value="">Tất cả</option>{(list?.topics || []).map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}</select></label>
      <form className="alb-search" role="search" onSubmit={(e) => { e.preventDefault(); navigate({ q: search.trim() }); }}>
        <label>Tìm tiêu đề hoặc slug<input type="search" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} /></label>
        <button type="submit" className="adm-btn-secondary">Tìm</button>
      </form>
    </div>

    {banner && <div className={`alb-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
      <p>{banner.text}</p>
      {banner.rejected && banner.rejected.length > 0 && <ul className="alb-rejected">
        {banner.rejected.map((r) => <li key={r.id}><strong>{r.slug || slugOf(r.id)}</strong>: {r.reasons.map((b) => b.message).join(' ')}</li>)}
      </ul>}
      <button type="button" className="adm-btn-secondary" onClick={() => setBanner(null)}>Đóng</button>
    </div>}

    <div className="alb-bulk" aria-live="polite">
      <span>{selected.size ? `Đã chọn ${selected.size} mục (tối đa ${BULK_MAX})` : 'Chọn mục để đăng hoặc gỡ cùng lúc'}</span>
      <button type="button" className="adm-btn-primary" disabled={busy || !selected.size} onClick={() => void publish([...selected], true)}>{busy ? 'Đang xử lý…' : 'Đăng mục đã chọn'}</button>
      <button type="button" className="adm-btn-secondary" disabled={busy || !selected.size} onClick={() => void publish([...selected], false)}>Gỡ mục đã chọn</button>
    </div>

    {error && !list && <div className="alb-state is-error" role="alert"><p>Chưa tải được danh sách: {error}</p><button type="button" className="adm-btn-secondary" onClick={() => void load()}>Tải lại</button></div>}
    {error && list && <div className="alb-banner is-error" role="alert"><p>Chưa làm mới được danh sách: {error}. Bảng dưới là lần tải trước.</p><button type="button" className="adm-btn-secondary" onClick={() => void load()}>Tải lại</button></div>}

    {!list && !error && <div className="alb-table" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="alb-row is-placeholder" aria-hidden="true" />)}</div>}

    {list && list.items.length === 0 && <div className="alb-state"><p>{list.counts.all === 0 && !filters.q && !filters.topic ? 'Chưa có mục nào được nhập vào kệ này.' : 'Không có mục nào khớp bộ lọc.'}</p></div>}

    {list && list.items.length > 0 && <div className={`alb-table${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
      <div className="alb-row is-head" role="row">
        <span /><span>Tiêu đề</span><span>{shelf === 'writing' ? 'Loại' : 'Part'}</span><span>Chủ đề</span><span>Tình trạng</span><span />
      </div>
      {list.items.map((row) => <div key={row.id} className={`alb-row${row.published ? ' is-published' : ''}`} role="row">
        <span><input type="checkbox" aria-label={`Chọn ${row.slug}`} checked={selected.has(row.id)} disabled={busy || (!selected.has(row.id) && selected.size >= BULK_MAX)} onChange={() => toggle(row.id)} /></span>
        <span className="alb-title">
          <strong>{row.titleEn}</strong>
          <code>{row.slug}</code>
          {row.titleVi && <small>{row.titleVi}</small>}
          {row.blockers.length > 0 && <ul className="alb-blockers" aria-label="Chưa đủ điều kiện đăng">{row.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>}
          {editing === row.id && <EditRow shelf={shelf} row={row} topics={list.topics} onCancel={() => setEditing(null)} onSaved={(next) => { setEditing(null); setBanner(next); void load(); }} />}
        </span>
        <span>{kindLabel(shelf, row)}{shelf === 'speaking' && <small className="alb-media">{row.videoSource ? 'Có video' : row.hasAudio ? 'Audio' : 'Dạng chữ'}</small>}</span>
        <span>{topicLabel(row.topicSlug)}</span>
        <span><span className={`adm-status-pill${row.published ? ' is-active' : ' is-pending'}`}>{row.published ? 'Đã đăng' : 'Bản nháp'}</span><small className="alb-date">{row.published ? `Đăng ${formatDate(row.publishedAt)}` : `Sửa ${formatDate(row.updatedAt)}`}</small></span>
        <span className="alb-actions">
          <button type="button" className="adm-btn-secondary" disabled={busy || editing === row.id} onClick={() => setEditing(row.id)}>Sửa</button>
          <button type="button" className={row.published ? 'adm-btn-secondary' : 'adm-btn-primary'} disabled={busy} onClick={() => void publish([row.id], !row.published)}>{row.published ? 'Gỡ' : 'Đăng'}</button>
        </span>
      </div>)}
    </div>}

    {list && list.pageCount > 1 && <nav className="alb-pager" aria-label="Phân trang">
      <button type="button" className="adm-btn-secondary" disabled={filters.page <= 1} onClick={() => navigate({ page: filters.page - 1 })}>Trang trước</button>
      <span>Trang {list.page} / {list.pageCount} · {list.total} mục</span>
      <button type="button" className="adm-btn-secondary" disabled={filters.page >= list.pageCount} onClick={() => navigate({ page: filters.page + 1 })}>Trang sau</button>
    </nav>}
  </section>;
}

export function AdminLibrary() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = normalizeTab(searchParams?.get('tab') || undefined);
  const current = TABS.find((t) => t.id === tab);
  return <main className="alb-shell">
    <header className="alb-header">
      <div>
        <p className="alb-eyebrow">Nội dung · Thư viện công khai</p>
        <h1>Thư viện công khai</h1>
        <p>Sửa nhanh tiêu đề và chủ đề, đăng hoặc gỡ bài mẫu. Máy chủ kiểm lại điều kiện đăng cho từng mục; mục chưa đủ điều kiện bị loại kèm lý do và giữ nguyên tình trạng.</p>
      </div>
      <a className="adm-btn-secondary" href="/library">Xem Thư viện</a>
    </header>
    <div className="alb-tabs" role="tablist" aria-label="Thẻ Thư viện">
      {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => router.replace(`/admin/library?tab=${t.id}`)}>{t.label}</button>)}
    </div>
    {(tab === 'writing' || tab === 'speaking') && <ShelfPanel key={tab} shelf={tab} />}
    {tab === 'import' && <div className="alb-state" role="status"><p>Chưa có dữ liệu lô nhập.</p><small>Bản ghi lô nhập do script nhập ghi (G09-T36) chưa có trên hệ thống; khi có, thẻ này hiện lô gần nhất.</small></div>}
    {current && !current.live && <div className="alb-state" role="status"><p>Chưa có ở đợt này.</p></div>}
  </main>;
}
