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
  user_submitted_attempt_count?: unknown;
}

interface PracticeTest {
  key: string;
  id: string;
  title: string;
  trap: string | null;
  bestScore: string | null;
  attemptCount: number;
  submittedAttemptCount: number;
}

interface PracticeGroup {
  title: string | null;
  items: PracticeTest[];
}

type OverviewState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; counts: Record<TabKey, number> }
  | { status: 'error' };

type TabState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error' };

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
      submittedAttemptCount: positiveCount(raw.user_submitted_attempt_count),
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

function hasTab(cache: Partial<Record<TabKey, PracticeTest[]>>, key: TabKey): boolean {
  return Object.prototype.hasOwnProperty.call(cache, key);
}

function hashTab(): TabKey | null {
  const wanted = window.location.hash.replace(/^#/, '');
  return TABS.some((tab) => tab.key === wanted) ? wanted as TabKey : null;
}

function PracticeTabs({
  counts,
  active,
  onSelect,
}: {
  counts?: Record<TabKey, number>;
  active?: TabKey | null;
  onSelect?: (key: TabKey) => void;
}) {
  return (
    <nav className="lp-tabs" id="practice-tabs" aria-label="Nhóm bài luyện">
      {counts ? TABS.filter((tab) => counts[tab.key] > 0).map((tab) => (
        <button
          className={`lp-tab${tab.key === active ? ' is-active' : ''}`}
          aria-pressed={tab.key === active}
          data-group={tab.key}
          key={tab.key}
          type="button"
          onClick={() => onSelect?.(tab.key)}
        >
          {tab.label}
          <span className="lp-tab-count">{counts[tab.key]}</span>
        </button>
      )) : null}
    </nav>
  );
}

export function ListeningPracticeBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return <ListeningPracticeLibrary accountKey={accountKey} key={accountKey || status} />;
}

function ListeningPracticeLibrary({ accountKey }: { accountKey: string | null }) {
  const [overview, setOverview] = useState<OverviewState>({ status: 'loading' });
  const [active, setActive] = useState<TabKey | null>(null);
  const [cache, setCache] = useState<Partial<Record<TabKey, PracticeTest[]>>>({});
  const [tabState, setTabState] = useState<TabState>({ status: 'idle' });

  useEffect(() => {
    if (!accountKey) {
      setOverview({ status: 'loading' });
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    setOverview({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (listening practice overview)',
      );
      if (!ready || disposed) {
        if (!disposed) setOverview({ status: 'error' });
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
        setOverview({ status: 'error' });
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
        if (!disposed) setTabState({ status: 'error' });
        return;
      }
      try {
        const items = await fetchAllTests(active, controller.signal);
        if (disposed) return;
        setCache((current) => ({ ...current, [active]: normalizeTests(items) }));
        setTabState({ status: 'ready' });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setTabState({ status: 'error' });
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
    return (
      <>
        <PracticeTabs />
        <div className="empty-state" id="state-loading" role="status">Đang tải…</div>
      </>
    );
  }
  if (overview.status === 'empty') {
    return (
      <>
        <PracticeTabs />
        <div className="empty-state" id="state-empty" role="status">
          <p><strong>Chưa có bài luyện nào.</strong></p>
          <p>Hãy quay lại sau khi quản trị viên đăng nội dung.</p>
        </div>
      </>
    );
  }
  if (overview.status === 'error') {
    return (
      <>
        <PracticeTabs />
        <div className="error-banner" id="state-error" role="alert">
          Không tải được Luyện nhanh. Vui lòng thử lại.
        </div>
      </>
    );
  }

  const activeTab = TABS.find((tab) => tab.key === active) || null;
  const activeItems = active && hasTab(cache, active) ? cache[active] || [] : [];
  const groups = active ? groupTests(active, activeItems) : [];

  return (
    <>
      <PracticeTabs counts={overview.counts} active={active} onSelect={setActive} />

      {tabState.status === 'error' ? (
        <div className="error-banner" id="state-error" role="alert">
          Không tải được danh sách bài luyện. Vui lòng thử lại.
        </div>
      ) : (
        <div id="practice-body">
          <div id="practice-panel">
            {tabState.status === 'loading' ? <p className="lp-lede" role="status">Đang tải…</p> : null}
            {tabState.status === 'ready' && activeTab ? (
              <>
                <p className="lp-lede">{activeTab.lede}</p>
                {!activeItems.length ? (
                  <div className="empty-state" id="state-tab-empty" role="status">
                    Nhóm này hiện chưa có bài luyện khả dụng.
                  </div>
                ) : null}
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
                        const completed = test.submittedAttemptCount > 0;
                        return (
                          <article
                            className="lt-card"
                            data-status={completed ? 'done' : 'new'}
                            data-test-id={test.id}
                            key={test.key}
                          >
                            <div className="lt-card-title">{test.title}</div>
                            <div className="lt-card-stats">
                              {test.bestScore != null ? (
                                <>Tốt nhất <strong>{test.bestScore}</strong> · </>
                              ) : null}
                              {test.attemptCount > 0 ? <>đã mở {test.attemptCount} lượt</> : 'chưa làm'}
                            </div>
                            <a
                              className={completed ? 'lt-card-cta secondary' : 'lt-card-cta'}
                              href={`/listening/practice-run?id=${encodeURIComponent(test.id)}`}
                            >
                              {completed ? 'Làm lại' : 'Bắt đầu'}
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
