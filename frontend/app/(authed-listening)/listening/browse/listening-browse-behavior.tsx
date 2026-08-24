'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

const PAGE_LIMIT = 24;

const MODE_LINKS = [
  ['dictation', 'Chép chính tả', '/listening/dictation'],
  ['gist', 'Ý chính', '/listening/gist'],
  ['true_false', 'Đúng/Sai', '/listening/tf'],
  ['mcq', 'Trắc nghiệm', '/listening/mcq'],
] as const;

interface Filters {
  accent: string;
  cefr: string;
  section: string;
}

interface RawContent {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  accent_tag?: unknown;
  cefr_level?: unknown;
  ielts_section?: unknown;
  audio_duration_seconds?: unknown;
  available_modes?: unknown;
}

interface ListeningContent {
  key: string;
  id: string;
  title: string;
  description: string;
  accent: string | null;
  cefr: string | null;
  section: string | null;
  minutes: number;
  availableModes: string[] | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; items: ListeningContent[]; total: number }
  | { status: 'error' };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeItems(items: unknown[]): ListeningContent[] {
  return items.flatMap((value) => {
    const raw: RawContent = value && typeof value === 'object' ? value : {};
    const id = textValue(raw.id);
    if (!id) return [];
    const duration = Number(raw.audio_duration_seconds || 0);
    const modes = Array.isArray(raw.available_modes)
      ? raw.available_modes.filter((mode): mode is string => typeof mode === 'string')
      : null;
    return [{
      key: id,
      id,
      title: textValue(raw.title) || 'Bài nghe',
      description: textValue(raw.description),
      accent: displayValue(raw.accent_tag),
      cefr: displayValue(raw.cefr_level),
      section: displayValue(raw.ielts_section),
      minutes: Number.isFinite(duration) ? Math.round(duration / 60) : 0,
      availableModes: modes,
    }];
  });
}

function buildPath(filters: Filters, offset: number): string {
  const query = new URLSearchParams();
  if (filters.accent) query.set('accent_tag', filters.accent);
  if (filters.cefr) query.set('cefr_level', filters.cefr);
  if (filters.section) query.set('ielts_section', filters.section);
  query.set('limit', String(PAGE_LIMIT));
  query.set('offset', String(offset));
  return `/api/listening/content?${query.toString()}`;
}

async function fetchContentPage(filters: Filters, offset: number, signal: AbortSignal) {
  const payload = await window.api.getWith<unknown>(
    buildPath(filters, offset), undefined, { signal },
  );
  const record = payload && typeof payload === 'object'
    ? payload as { items?: unknown; total?: unknown }
    : {};
  const items = Array.isArray(record.items) ? record.items : [];
  const reportedTotal = Number(record.total);
  return {
    items,
    total: Number.isFinite(reportedTotal)
      ? Math.max(offset + items.length, reportedTotal)
      : offset + items.length,
  };
}

function FiltersBar({ filters, onChange }: {
  filters: Filters;
  onChange: (key: keyof Filters, value: string) => void;
}) {
  return (
    <details className="browse-filter-panel" open>
      <summary>
        <span>Bộ lọc bài nghe</span>
        <span className="browse-filter-count">
          {Object.values(filters).filter(Boolean).length
            ? `${Object.values(filters).filter(Boolean).length} đang dùng`
            : 'Tất cả'}
        </span>
      </summary>
      <div className="browse-filters">
      <label>
        Giọng đọc
        <select id="filter-accent" value={filters.accent} onChange={(event) => onChange('accent', event.target.value)}>
          <option value="">Tất cả</option>
          <option value="us_general">US</option>
          <option value="uk_rp">UK</option>
          <option value="au">AU</option>
          <option value="ca">CA</option>
          <option value="other">Khác</option>
        </select>
      </label>
      <label>
        Trình độ CEFR
        <select id="filter-cefr" value={filters.cefr} onChange={(event) => onChange('cefr', event.target.value)}>
          <option value="">Tất cả</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
          <option value="C1">C1</option>
          <option value="C2">C2</option>
        </select>
      </label>
      <label>
        Phần thi
        <select id="filter-section" value={filters.section} onChange={(event) => onChange('section', event.target.value)}>
          <option value="">Tất cả</option>
          <option value="1">Section 1</option>
          <option value="2">Section 2</option>
          <option value="3">Section 3</option>
          <option value="4">Section 4</option>
        </select>
      </label>
      </div>
    </details>
  );
}

function ModeLinks({ item }: { item: ListeningContent }) {
  if (item.availableModes === null) {
    return <span className="mode-empty is-warning">Chưa đồng bộ được dạng luyện</span>;
  }
  const links = MODE_LINKS.filter(([mode]) => item.availableModes?.includes(mode));
  if (!links.length) {
    return <span className="mode-empty">Chưa có dạng luyện nào cho bài này</span>;
  }
  return links.map(([mode, label, page]) => (
    <a className="mode-link" href={`${page}?content_id=${encodeURIComponent(item.id)}`} key={mode}>
      {label}
    </a>
  ));
}

function ContentCard({ item }: { item: ListeningContent }) {
  return (
    <article className="content-card" data-content-id={item.id}>
      <div className="content-card__head"><span>Bài nghe</span>{item.minutes > 0 ? <small>{item.minutes} phút</small> : null}</div>
      <h3>{item.title}</h3>
      <div className="desc">{item.description}</div>
      <div className="meta-row">
        {item.accent && <span className="meta-pill">{item.accent}</span>}
        {item.cefr && <span className="meta-pill is-brand">{item.cefr}</span>}
        {item.section && <span className="meta-pill">Section {item.section}</span>}
      </div>
      <div className="mode-links"><strong>Chọn dạng luyện</strong><div><ModeLinks item={item} /></div></div>
    </article>
  );
}

export function ListeningBrowseBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return <ListeningBrowseLibrary accountKey={accountKey} key={accountKey || status} />;
}

function ListeningBrowseLibrary({ accountKey }: { accountKey: string | null }) {
  const [filters, setFilters] = useState<Filters>({ accent: '', cefr: '', section: '' });
  const [offset, setOffset] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  useEffect(() => {
    if (!accountKey) {
      setState({ status: 'loading' });
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    if (offset === 0) setState({ status: 'loading' });
    else setLoadingMore(true);
    setLoadMoreError(false);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (listening content browse)',
      );
      if (!ready || disposed) {
        if (!disposed) {
          if (offset === 0) setState({ status: 'error' });
          else setLoadMoreError(true);
          setLoadingMore(false);
        }
        return;
      }
      try {
        const page = await fetchContentPage(filters, offset, controller.signal);
        if (!disposed) {
          const normalized = normalizeItems(page.items);
          setState((current) => {
            if (offset === 0 || current.status !== 'ready') {
              return { status: 'ready', items: normalized, total: page.total };
            }
            const known = new Set(current.items.map((item) => item.id));
            const additions = normalized.filter((item) => !known.has(item.id));
            return {
              status: 'ready',
              items: [...current.items, ...additions],
              total: Math.max(current.total, page.total),
            };
          });
        }
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        if (offset === 0) setState({ status: 'error' });
        else setLoadMoreError(true);
      } finally {
        if (!disposed) setLoadingMore(false);
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, filters, offset, retryKey]);

  const changeFilter = (key: keyof Filters, value: string) => {
    setOffset(0);
    setRetryKey(0);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const shown = state.status === 'ready' ? state.items.length : 0;
  const hasMore = state.status === 'ready' && shown < state.total;

  return (
    <>
      <FiltersBar filters={filters} onChange={changeFilter} />
      {state.status === 'loading' && <div className="empty-state" id="state-loading" role="status">Đang tải…</div>}
      {state.status === 'ready' && state.items.length === 0 && (
        <div className="empty-state" id="state-empty" role="status">Chưa có bài nghe nào khớp bộ lọc.</div>
      )}
      {state.status === 'error' && (
        <div className="browse-state is-error" id="state-error" role="alert">
          <div><strong>Chưa tải được kho bài nghe</strong><p>Không tải được danh sách bài nghe. Vui lòng thử lại.</p></div>
          <button type="button" onClick={() => setRetryKey((current) => current + 1)}>Thử lại</button>
        </div>
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <>
          <div className="browse-results-head">
            <div><p className="browse-eyebrow">Kết quả</p><h2>{state.total} bài nghe phù hợp</h2></div>
            <span>Đang hiển thị {shown}</span>
          </div>
          <div className="content-grid" id="content-grid">
            {state.items.map((item) => <ContentCard item={item} key={item.key} />)}
          </div>
          {hasMore ? (
            <div className="browse-pagination">
              {loadMoreError ? (
                <p className="browse-pagination__error" role="alert">
                  Chưa tải được trang tiếp theo. Các bài đã tải vẫn được giữ lại.
                </p>
              ) : null}
              <button
                type="button"
                className="av-button av-button-secondary"
                disabled={loadingMore}
                onClick={() => loadMoreError
                  ? setRetryKey((current) => current + 1)
                  : setOffset((current) => current + PAGE_LIMIT)}
              >
                {loadingMore ? 'Đang tải…' : loadMoreError ? 'Thử lại' : `Xem thêm (${shown}/${state.total})`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
