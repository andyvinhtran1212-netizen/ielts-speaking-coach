// Server-side reads for Kiến thức Writing (LIBRARY-0061 T011). Uncached
// (`no-store`), so a guide or a cited sample withdrawn from the Library
// disappears on the next request (FR-022).
import { cache } from 'react';

import { API_BASE, ABORT_MS } from '@/lib/backend';

export type GuideListItem = {
  slug: string;
  title: string;
  summary: string;
  reading_minutes: number;
  groups: string[];
  updated_at: string | null;
};

export type GuideList = {
  total: number;
  groups: { id: string; label: string; items: GuideListItem[] }[];
};

export type GuideNeighbour = { slug: string; title: string } | null;

export type GuideDetail = {
  slug: string;
  title: string;
  groups: { id: string; label: string }[];
  /** Rendered on the server from Markdown; raw HTML in the source is escaped. */
  html: string;
  toc: { id: string; label: string; n: string }[];
  reading_minutes: number;
  updated_at: string | null;
  prev: GuideNeighbour;
  next: GuideNeighbour;
};

/** `missing` is a real 404 from the API; `error` is anything else that failed. */
export type Loaded<T> = { state: 'ok'; data: T } | { state: 'missing' } | { state: 'error' };

async function getJson<T>(path: string, valid: (data: unknown) => data is T): Promise<Loaded<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(ABORT_MS) });
    if (res.status === 404) return { state: 'missing' };
    if (!res.ok) {
      console.error(`[library] ${path} → HTTP ${res.status}`);
      return { state: 'error' };
    }
    const data: unknown = await res.json();
    if (!valid(data)) {
      console.error(`[library] ${path} → unexpected payload`);
      return { state: 'error' };
    }
    return { state: 'ok', data };
  } catch (error) {
    console.error(`[library] ${path} failed`, error);
    return { state: 'error' };
  }
}

function isList(data: unknown): data is GuideList {
  const d = data as GuideList | null;
  return !!d && typeof d.total === 'number' && Array.isArray(d.groups);
}

function isDetail(data: unknown): data is GuideDetail {
  const d = data as GuideDetail | null;
  return !!d && typeof d.slug === 'string' && typeof d.html === 'string' && Array.isArray(d.toc);
}

export function loadGuideList(): Promise<Loaded<GuideList>> {
  return getJson('/api/library/writing-guides', isList);
}

/** Memoized per request, so metadata and the page share one read. */
export const loadGuide = cache((slug: string): Promise<Loaded<GuideDetail>> =>
  getJson(`/api/library/writing-guides/${encodeURIComponent(slug)}`, isDetail),
);
