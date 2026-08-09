'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

interface RawListeningTest {
  id?: unknown;
  test_id?: unknown;
  title?: unknown;
  band_target?: unknown;
  themes?: unknown;
  user_best_score?: unknown;
  user_attempt_count?: unknown;
}

interface ListeningTest {
  key: string;
  id: string;
  catalogId: string;
  title: string;
  meta: string | null;
  bestScore: string | null;
  attemptCount: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; tests: ListeningTest[] }
  | { status: 'error'; message: string };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return String(value);
}

function nonNegativeInteger(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function themeSummary(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return Object.values(value)
    .filter(Boolean)
    .slice(0, 3)
    .map((item) => displayValue(item) || '')
    .filter(Boolean)
    .join(' · ');
}

function normalizeTests(items: unknown[]): ListeningTest[] {
  return items.flatMap((value, index) => {
    const raw: RawListeningTest = value && typeof value === 'object' ? value : {};
    const id = textValue(raw?.id);
    if (!id) return [];
    const band = raw?.band_target ? displayValue(raw.band_target) : null;
    const themes = themeSummary(raw?.themes);
    const meta = [band ? `Band ${band}` : '', themes].filter(Boolean).join(' · ');
    return [{
      key: `${id}-${index}`,
      id,
      catalogId: textValue(raw?.test_id),
      title: textValue(raw?.title) || 'Untitled test',
      meta: meta || null,
      bestScore: raw?.user_best_score == null ? null : displayValue(raw.user_best_score),
      attemptCount: nonNegativeInteger(raw?.user_attempt_count),
    }];
  });
}

async function fetchAllTests(signal: AbortSignal): Promise<unknown[]> {
  const all: unknown[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await window.api.getWith<unknown>(
      `/api/listening/tests?test_type=full&limit=${PAGE_LIMIT}&offset=${offset}`,
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

export function ListeningTestsBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return <div className="empty-state" id="state-loading">Đang tải danh sách tests…</div>;
  }

  return <ListeningTestsLibrary accountKey={user.id} key={user.id} />;
}

function ListeningTestsLibrary({ accountKey }: { accountKey: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (listening full tests)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error', message: '' });
        return;
      }

      try {
        const items = await fetchAllTests(controller.signal);
        if (disposed) return;
        setState({ status: 'ready', tests: normalizeTests(items) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error', message: errorMessage(caught) });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey]);

  if (state.status === 'loading') {
    return <div className="empty-state" id="state-loading">Đang tải danh sách tests…</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="error-banner" id="state-error">
        Không tải được danh sách tests: {state.message}
      </div>
    );
  }
  if (!state.tests.length) {
    return (
      <div className="empty-state" id="state-empty">
        <p><strong>Chưa có test nào sẵn sàng.</strong></p>
        <p>Hãy quay lại sau khi admin xuất bản test mới.</p>
      </div>
    );
  }

  return (
    <section id="lt-grid" className="lt-grid">
      {state.tests.map((test) => {
        const attempted = test.attemptCount > 0;
        return (
          <article className="lt-card" data-test-id={test.id} key={test.key}>
            <div className="lt-card-meta">{test.catalogId}</div>
            <div className="lt-card-title">{test.title}</div>
            {test.meta ? (
              <div className="lt-card-meta" style={{ textTransform: 'none', letterSpacing: 0 }}>
                {test.meta}
              </div>
            ) : null}
            <div className="lt-card-stats">
              {test.bestScore != null ? (
                <span>Điểm tốt nhất: <strong>{test.bestScore}/40</strong></span>
              ) : null}
              {attempted ? (
                <span>Đã làm: <strong>{test.attemptCount}</strong> lần</span>
              ) : (
                <span>Chưa làm</span>
              )}
            </div>
            <div
              className="lt-card-actions"
              style={{ display: 'flex', gap: 'var(--av-space-2)', flexWrap: 'wrap' }}
            >
              <a
                className={attempted ? 'lt-card-cta secondary' : 'lt-card-cta'}
                href={`/pages/listening-test.html?id=${encodeURIComponent(test.id)}&from=full`}
              >
                {attempted ? 'Làm lại' : 'Bắt đầu test'}
              </a>
              <a
                className="lt-card-cta secondary"
                href={`/pages/listening-test-dictation.html?test_id=${encodeURIComponent(test.id)}`}
              >
                ✍️ Chép chính tả
              </a>
            </div>
          </article>
        );
      })}
    </section>
  );
}
