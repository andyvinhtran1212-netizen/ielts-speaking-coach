'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import { ListeningTestsShell } from './page-shell';

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
  user_submitted_attempt_count?: unknown;
}

interface ListeningTest {
  key: string;
  id: string;
  catalogId: string;
  title: string;
  bandTarget: string | null;
  themes: string | null;
  bestScore: string | null;
  attemptCount: number;
  submittedAttemptCount: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; tests: ListeningTest[] }
  | { status: 'error'; message: string };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return textValue(value) || null;
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
    return [{
      key: `${id}-${index}`,
      id,
      catalogId: textValue(raw?.test_id),
      title: textValue(raw?.title) || 'Untitled test',
      bandTarget: displayValue(raw?.band_target),
      themes: themeSummary(raw?.themes) || null,
      bestScore: raw?.user_best_score == null ? null : displayValue(raw.user_best_score),
      attemptCount: nonNegativeInteger(raw?.user_attempt_count),
      submittedAttemptCount: nonNegativeInteger(raw?.user_submitted_attempt_count),
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

export function ListeningTestsBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return <ListeningTestsLibrary accountKey={accountKey} key={accountKey || status} />;
}

function ListeningTestsLibrary({ accountKey }: { accountKey: string | null }) {
  const [filter, setFilter] = useState<'all' | 'new' | 'done'>('all');
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!accountKey) {
      setState({ status: 'loading' });
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (listening full tests)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error', message: 'Không tải được danh sách bài thi.' });
        return;
      }

      try {
        const items = await fetchAllTests(controller.signal);
        if (disposed) return;
        setState({ status: 'ready', tests: normalizeTests(items) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error', message: 'Không tải được danh sách bài thi.' });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey]);

  const tests = state.status === 'ready' ? state.tests : [];
  const filteredTests = tests.filter((test) => {
    const submitted = test.submittedAttemptCount > 0;
    if (filter === 'done') return submitted;
    if (filter === 'new') return !submitted;
    return true;
  });
  const totalCount = state.status === 'ready' ? tests.length : null;

  return (
    <ListeningTestsShell totalCount={totalCount}>
      {state.status === 'loading' ? (
        <div className="empty-state" id="state-loading" role="status">Đang tải danh sách tests…</div>
      ) : null}
      {state.status === 'error' ? (
        <div className="error-banner" id="state-error" role="alert">{state.message}</div>
      ) : null}
      {state.status === 'ready' && !tests.length ? (
        <div className="empty-state" id="state-empty" role="status">
          <p><strong>Chưa có test nào sẵn sàng.</strong></p>
          <p>Hãy quay lại sau khi admin xuất bản test mới.</p>
        </div>
      ) : null}
      {state.status === 'ready' && tests.length ? (
        <section className="lt-library" id="lt-library" aria-labelledby="lt-library-title">
          <div className="lt-toolbar">
            <div>
              <p className="eyebrow">THƯ VIỆN FULL TEST</p>
              <h2 id="lt-library-title">Chọn đề thi</h2>
            </div>
            <div className="lt-filter" role="group" aria-label="Lọc full test">
              {([
                ['all', 'Tất cả'],
                ['new', 'Chưa làm'],
                ['done', 'Đã làm'],
              ] as const).map(([value, label]) => (
                <button
                  aria-pressed={filter === value}
                  className={`lt-filter__button${filter === value ? ' is-active' : ''}`}
                  data-filter={value}
                  key={value}
                  onClick={() => setFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="lt-visible-count" id="lt-visible-count" aria-live="polite">
            {filteredTests.length} đề thi
          </p>
          <div id="lt-grid" className="lt-grid">
            {!filteredTests.length ? (
              <p className="lt-filter-empty">Không có đề nào trong nhóm này.</p>
            ) : null}
            {filteredTests.map((test) => {
              const attempted = test.submittedAttemptCount > 0;
              return (
                <article
                  className="lt-card"
                  data-status={attempted ? 'done' : 'new'}
                  data-test-id={test.id}
                  key={test.key}
                >
                  <div className="lt-card__head">
                    <div className="lt-card-code">{test.catalogId || 'FULL TEST'}</div>
                    <span className={`lt-card-status${attempted ? ' is-done' : ''}`}>
                      {attempted ? 'Đã làm' : 'Chưa làm'}
                    </span>
                  </div>
                  <h3 className="lt-card-title">{test.title}</h3>
                  <div className="lt-card-facts" aria-label="Cấu trúc đề thi">
                    <span>4 sections</span>
                    <span>40 câu</span>
                    <span>~30 phút</span>
                    {test.bandTarget ? <span>Band {test.bandTarget}</span> : null}
                  </div>
                  {test.themes ? <p className="lt-card-theme">{test.themes}</p> : null}
                  <div className="lt-card-stats">
                    {test.bestScore != null ? (
                      <span>Điểm tốt nhất <strong>{test.bestScore}/40</strong></span>
                    ) : null}
                    {test.attemptCount > 0 ? (
                      <span><strong>{test.attemptCount}</strong> lượt làm</span>
                    ) : (
                      <span>Chưa làm</span>
                    )}
                  </div>
                  <div className="lt-card-actions">
                    <a
                      className="lt-card-cta"
                      href={`/pages/listening-test.html?id=${encodeURIComponent(test.id)}&from=full`}
                    >
                      {attempted ? 'Làm lại' : 'Bắt đầu test'} <span aria-hidden="true">→</span>
                    </a>
                    <a
                      className="lt-card-cta secondary"
                      href={`/pages/listening-test-dictation.html?test_id=${encodeURIComponent(test.id)}`}
                    >
                      Chép chính tả
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </ListeningTestsShell>
  );
}
