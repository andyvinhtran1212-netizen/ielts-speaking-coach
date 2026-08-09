'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

const TABS = [
  {
    key: 'trap',
    label: 'Theo bẫy',
    lede: 'Mỗi bài 10 câu cùng MỘT loại bẫy — chọn đúng chỗ mình hay sai và luyện dứt điểm.',
  },
  {
    key: 'section',
    label: 'Mô phỏng section',
    lede: 'Đoạn ngắn theo Part 1/2/3, bẫy rải rác như trong đề.',
  },
  {
    key: 'curated',
    label: 'Bài soạn riêng',
    lede: 'Bài giảng, bản đồ, sơ đồ quy trình — viết tay, chủ đề đa dạng.',
  },
] as const;

type TabKey = typeof TABS[number]['key'];

interface RawPracticeTest {
  id?: unknown;
  test_id?: unknown;
  title?: unknown;
  trap?: unknown;
  user_best_score?: unknown;
  user_attempt_count?: unknown;
}

interface PracticeTest {
  key: string;
  id: string;
  title: string;
  trap: string | null;
  bestScore: string | null;
  attemptCount: number;
}

interface PracticeGroup {
  title: string | null;
  items: PracticeTest[];
}

type OverviewState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; counts: Record<TabKey, number> }
  | { status: 'error'; message: string };

type TabState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return String(value);
}

function positiveCount(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function normalizeCounts(payload: unknown): Record<TabKey, number> {
  const groups = payload && typeof payload === 'object'
    ? (payload as { practice_groups?: unknown }).practice_groups
    : null;
  const record = groups && typeof groups === 'object'
    ? groups as Record<string, unknown>
    : {};
  return {
    trap: positiveCount(record.trap),
    section: positiveCount(record.section),
    curated: positiveCount(record.curated),
  };
}

function normalizeTests(items: unknown[]): PracticeTest[] {
  return items.flatMap((value, index) => {
    const raw: RawPracticeTest = value && typeof value === 'object' ? value : {};
    const id = textValue(raw.id);
    if (!id) return [];
    const testId = textValue(raw.test_id);
    return [{
      key: `${id}-${index}`,
      id,
      title: textValue(raw.title) || testId || 'Bài luyện',
      trap: textValue(raw.trap) || null,
      bestScore: raw.user_best_score == null ? null : displayValue(raw.user_best_score),
      attemptCount: positiveCount(raw.user_attempt_count),
    }];
  });
}

function groupTests(groupKey: TabKey, items: PracticeTest[]): PracticeGroup[] {
  if (groupKey !== 'trap') return [{ title: null, items }];
  const grouped = new Map<string, PracticeTest[]>();
  items.forEach((test) => {
    const key = test.trap || 'Khác';
    const current = grouped.get(key) || [];
    current.push(test);
    grouped.set(key, current);
  });
  return [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([title, tests]) => ({ title, items: tests }));
}

async function fetchAllTests(groupKey: TabKey, signal: AbortSignal): Promise<unknown[]> {
  const all: unknown[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await window.api.getWith<unknown>(
      `/api/listening/tests?test_type=practice&practice_group=${encodeURIComponent(groupKey)}`
      + `&limit=${PAGE_LIMIT}&offset=${offset}`,
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

function hasTab(cache: Partial<Record<TabKey, PracticeTest[]>>, key: TabKey): boolean {
  return Object.prototype.hasOwnProperty.call(cache, key);
}

function hashTab(): TabKey | null {
  const wanted = window.location.hash.replace(/^#/, '');
  return TABS.some((tab) => tab.key === wanted) ? wanted as TabKey : null;
}

export function ListeningPracticeBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return <div className="empty-state" id="state-loading">Đang tải…</div>;
  }

  return <ListeningPracticeLibrary accountKey={user.id} key={user.id} />;
}

function ListeningPracticeLibrary({ accountKey }: { accountKey: string }) {
  const [overview, setOverview] = useState<OverviewState>({ status: 'loading' });
  const [active, setActive] = useState<TabKey | null>(null);
  const [cache, setCache] = useState<Partial<Record<TabKey, PracticeTest[]>>>({});
  const [tabState, setTabState] = useState<TabState>({ status: 'idle' });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setOverview({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (listening practice overview)',
      );
      if (!ready || disposed) {
        if (!disposed) setOverview({ status: 'error', message: '' });
        return;
      }
      try {
        const payload = await window.api.getWith<unknown>(
          '/api/listening/overview',
          undefined,
          { signal: controller.signal },
        );
        if (disposed) return;
        const counts = normalizeCounts(payload);
        const available = TABS.filter((tab) => counts[tab.key] > 0);
        if (!available.length) {
          setOverview({ status: 'empty' });
          setActive(null);
          return;
        }
        const wanted = hashTab();
        const start = available.find((tab) => tab.key === wanted) || available[0];
        setOverview({ status: 'ready', counts });
        setActive(start.key);
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setOverview({ status: 'error', message: errorMessage(caught) });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey]);

  useEffect(() => {
    if (!active) return;
    window.history.replaceState(null, '', `#${active}`);
  }, [active]);

  useEffect(() => {
    if (!active) {
      setTabState({ status: 'idle' });
      return;
    }
    if (hasTab(cache, active)) {
      setTabState({ status: 'ready' });
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    setTabState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (listening practice tab)',
      );
      if (!ready || disposed) {
        if (!disposed) setTabState({ status: 'error', message: '' });
        return;
      }
      try {
        const items = await fetchAllTests(active, controller.signal);
        if (disposed) return;
        setCache((current) => ({ ...current, [active]: normalizeTests(items) }));
        setTabState({ status: 'ready' });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setTabState({ status: 'error', message: errorMessage(caught) });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
    // Cache is read at each active-tab transition; adding a fetched entry must
    // not restart the request that produced it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey, active]);

  if (overview.status === 'loading') {
    return <div className="empty-state" id="state-loading">Đang tải…</div>;
  }
  if (overview.status === 'empty') {
    return (
      <div className="empty-state" id="state-empty">
        <p><strong>Chưa có bài luyện nào.</strong></p>
        <p>Hãy quay lại sau khi quản trị viên đăng nội dung.</p>
      </div>
    );
  }
  if (overview.status === 'error') {
    return (
      <div className="error-banner" id="state-error">
        Không tải được Luyện nhanh: {overview.message}
      </div>
    );
  }

  const availableTabs = TABS.filter((tab) => overview.counts[tab.key] > 0);
  const activeTab = TABS.find((tab) => tab.key === active) || null;
  const activeItems = active && hasTab(cache, active) ? cache[active] || [] : [];
  const groups = active ? groupTests(active, activeItems) : [];

  return (
    <>
      <nav className="lp-tabs" id="practice-tabs" aria-label="Nhóm bài luyện">
        {availableTabs.map((tab) => (
          <button
            className={`lp-tab${tab.key === active ? ' is-active' : ''}`}
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
            <span className="lp-tab-count">{overview.counts[tab.key]}</span>
          </button>
        ))}
      </nav>

      {tabState.status === 'error' ? (
        <div className="error-banner" id="state-error">
          Không tải được danh sách: {tabState.message}
        </div>
      ) : (
        <div id="practice-body">
          <div id="practice-panel">
            {tabState.status === 'loading' ? <p className="lp-lede">Đang tải…</p> : null}
            {tabState.status === 'ready' && activeTab ? (
              <>
                <p className="lp-lede">{activeTab.lede}</p>
                {groups.map((group, index) => (
                  <section className="lp-group" key={group.title || `${active}-flat-${index}`}>
                    {group.title ? (
                      <h3 className="lp-group-title">
                        {group.title}
                        <span className="lp-group-count">{group.items.length} bài</span>
                      </h3>
                    ) : null}
                    <div className="lt-grid">
                      {group.items.map((test) => {
                        const attempted = test.attemptCount > 0;
                        return (
                          <article className="lt-card" data-test-id={test.id} key={test.key}>
                            <div className="lt-card-title">{test.title}</div>
                            <div className="lt-card-stats">
                              {test.bestScore != null ? (
                                <>Tốt nhất <strong>{test.bestScore}</strong> · </>
                              ) : null}
                              {attempted ? <>đã làm {test.attemptCount} lần</> : 'chưa làm'}
                            </div>
                            <a
                              className={attempted ? 'lt-card-cta secondary' : 'lt-card-cta'}
                              href={`/pages/listening-practice-run.html?id=${encodeURIComponent(test.id)}`}
                            >
                              {attempted ? 'Làm lại' : 'Bắt đầu'}
                            </a>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
