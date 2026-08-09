'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

const MODE_LINKS = [
  ['dictation', 'Chép chính tả', '/pages/listening-dictation.html'],
  ['gist', 'Ý chính', '/pages/listening-gist.html'],
  ['true_false', 'Đúng/Sai', '/pages/listening-tf.html'],
  ['mcq', 'Trắc nghiệm', '/pages/listening-mcq.html'],
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
  | { status: 'ready'; items: ListeningContent[] }
  | { status: 'error'; message: string };

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  fontSize: 'var(--av-fs-xs)',
  color: 'var(--av-text-muted)',
} as const;

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
  return items.flatMap((value, index) => {
    const raw: RawContent = value && typeof value === 'object' ? value : {};
    const id = textValue(raw.id);
    if (!id) return [];
    const duration = Number(raw.audio_duration_seconds || 0);
    const modes = raw.available_modes === null
      ? null
      : Array.isArray(raw.available_modes)
        ? raw.available_modes.filter((mode): mode is string => typeof mode === 'string')
        : [];
    return [{
      key: `${id}-${index}`,
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

async function fetchAllContent(filters: Filters, signal: AbortSignal): Promise<unknown[]> {
  const all: unknown[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await window.api.getWith<unknown>(
      buildPath(filters, offset),
      undefined,
      { signal },
    );
    const items = payload && typeof payload === 'object'
      ? (payload as { items?: unknown }).items
      : null;
    const pageItems = Array.isArray(items) ? items : [];
    all.push(...pageItems);
    if (pageItems.length < PAGE_LIMIT) return all;
    offset += PAGE_LIMIT;
  }
  throw new Error(
    `Danh sách vượt ${MAX_PAGES * PAGE_LIMIT} mục — chưa tải hết, `
    + 'cần phân trang trên giao diện thay vì tải một lượt.',
  );
}

function errorMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) return caught.message;
  return caught == null ? '' : String(caught);
}

function FiltersBar({ filters, onChange }: {
  filters: Filters;
  onChange: (key: keyof Filters, value: string) => void;
}) {
  return (
    <div className="browse-filters">
      <label style={labelStyle}>
        Accent
        <select id="filter-accent" value={filters.accent} onChange={(event) => onChange('accent', event.target.value)}>
          <option value="">Tất cả</option>
          <option value="us_general">US</option>
          <option value="uk_rp">UK</option>
          <option value="au">AU</option>
          <option value="ca">CA</option>
          <option value="other">Khác</option>
        </select>
      </label>
      <label style={labelStyle}>
        CEFR
        <select id="filter-cefr" value={filters.cefr} onChange={(event) => onChange('cefr', event.target.value)}>
          <option value="">Tất cả</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
          <option value="C1">C1</option>
          <option value="C2">C2</option>
        </select>
      </label>
      <label style={labelStyle}>
        Section
        <select id="filter-section" value={filters.section} onChange={(event) => onChange('section', event.target.value)}>
          <option value="">Tất cả</option>
          <option value="1">Section 1</option>
          <option value="2">Section 2</option>
          <option value="3">Section 3</option>
          <option value="4">Section 4</option>
        </select>
      </label>
    </div>
  );
}

function ModeLinks({ item }: { item: ListeningContent }) {
  if (item.availableModes === null) {
    return <span className="mode-empty">⚠ Không đọc được danh sách dạng luyện</span>;
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
    <div className="content-card">
      <h3>{item.title}</h3>
      <div className="desc">{item.description}</div>
      <div className="meta-row">
        {item.accent && <span className="meta-pill">{item.accent}</span>}
        {item.cefr && <span className="meta-pill is-brand">{item.cefr}</span>}
        {item.section && <span className="meta-pill">Section {item.section}</span>}
        {item.minutes > 0 && <span className="meta-pill">{item.minutes}p</span>}
      </div>
      <div className="mode-links"><ModeLinks item={item} /></div>
    </div>
  );
}

export function ListeningBrowseBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return <div className="empty-state" id="state-loading">Đang tải…</div>;
  }
  return <ListeningBrowseLibrary accountKey={user.id} key={user.id} />;
}

function ListeningBrowseLibrary({ accountKey }: { accountKey: string }) {
  const [filters, setFilters] = useState<Filters>({ accent: '', cefr: '', section: '' });
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (listening content browse)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error', message: '' });
        return;
      }
      try {
        const items = await fetchAllContent(filters, controller.signal);
        if (!disposed) setState({ status: 'ready', items: normalizeItems(items) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error', message: errorMessage(caught) });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, filters]);

  const changeFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <>
      <FiltersBar filters={filters} onChange={changeFilter} />
      {state.status === 'loading' && <div className="empty-state" id="state-loading">Đang tải…</div>}
      {state.status === 'ready' && state.items.length === 0 && (
        <div className="empty-state" id="state-empty">Chưa có bài nghe nào khớp bộ lọc.</div>
      )}
      {state.status === 'error' && (
        <div className="error-banner" id="state-error">Không tải được danh sách. {state.message}</div>
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <div className="content-grid" id="content-grid">
          {state.items.map((item) => <ContentCard item={item} key={item.key} />)}
        </div>
      )}
    </>
  );
}
